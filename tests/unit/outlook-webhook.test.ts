/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We mock @sentry/nextjs, the env module, the supabase service client,
// the DB helper, and the Inngest client before importing the route
// handler — Next.js modules touch globals that need to be in place.

const captureMessageMock = vi.fn()
const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureMessage: captureMessageMock,
  captureException: captureExceptionMock,
}))

// env: dynamic so individual tests can flip OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET.
const envState: { OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET?: string } = {
  OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET: 'a'.repeat(64),
}
vi.mock('@/lib/env', () => ({
  get env() {
    return envState
  },
}))

const getOutlookCredentialsBySubscriptionIdMock = vi.fn()
vi.mock('@/lib/db/outlook-credentials', () => ({
  getOutlookCredentialsBySubscriptionId: getOutlookCredentialsBySubscriptionIdMock,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({}),
}))

const inngestSendMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendMock },
}))

// Import the route handlers AFTER mocks are in place. NextRequest /
// NextResponse from next/server work in the node test env.
async function importRoute() {
  return await import('@/app/api/outlook/webhook/route')
}

// Tiny helper: build a NextRequest-equivalent for the route handler.
async function makeRequest(opts: {
  method: 'GET' | 'POST'
  url?: string
  body?: unknown
}) {
  const { NextRequest } = await import('next/server')
  return new NextRequest(opts.url ?? 'https://example.com/api/outlook/webhook', {
    method: opts.method,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers:
      opts.body !== undefined
        ? { 'content-type': 'application/json' }
        : undefined,
  })
}

beforeEach(() => {
  captureMessageMock.mockReset()
  captureExceptionMock.mockReset()
  getOutlookCredentialsBySubscriptionIdMock.mockReset()
  inngestSendMock.mockReset()
  inngestSendMock.mockResolvedValue(undefined)
  envState.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET = 'a'.repeat(64)
})

afterEach(() => {
  vi.resetModules()
})

describe('outlook webhook — GET validationToken handshake', () => {
  it('returns 200 text/plain with the token body', async () => {
    const { GET } = await importRoute()
    const req = await makeRequest({
      method: 'GET',
      url: 'https://example.com/api/outlook/webhook?validationToken=xyz',
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toBe('xyz')
  })

  it('returns 400 when validationToken is missing', async () => {
    const { GET } = await importRoute()
    const req = await makeRequest({ method: 'GET' })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })
})

describe('outlook webhook — POST fail-closed (M-3)', () => {
  it('returns 503 when OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET is unset', async () => {
    envState.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET = undefined
    const { POST } = await importRoute()
    const req = await makeRequest({
      method: 'POST',
      body: { value: [{ subscriptionId: 'sub-1', clientState: 'cs' }] },
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('without configured clientState secret'),
      expect.objectContaining({ level: 'error' }),
    )
    expect(inngestSendMock).not.toHaveBeenCalled()
  })
})

describe('outlook webhook — POST clientState validation', () => {
  it('does not fire Inngest when clientState does not match the row', async () => {
    getOutlookCredentialsBySubscriptionIdMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'cred-1',
        user_id: 'user-1',
        organization_id: 'org-1',
        microsoft_email: 'a@b.com',
        subscription_client_state: 'expected-state',
        revoked_at: null,
      },
    })

    const { POST } = await importRoute()
    const req = await makeRequest({
      method: 'POST',
      body: {
        value: [
          {
            subscriptionId: 'sub-1',
            clientState: 'WRONG-STATE',
            resource: "Users/u/mailFolders('Inbox')/Messages/m",
            resourceData: { id: 'm' },
          },
        ],
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(202)
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('clientState mismatch'),
      expect.objectContaining({ level: 'error' }),
    )
    expect(inngestSendMock).not.toHaveBeenCalled()
  })
})

describe('outlook webhook — POST happy path', () => {
  it('fires exactly one event per unique subscriptionId', async () => {
    getOutlookCredentialsBySubscriptionIdMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'cred-1',
        user_id: 'user-1',
        organization_id: 'org-1',
        microsoft_email: 'a@b.com',
        subscription_client_state: 'cs',
        revoked_at: null,
      },
    })

    const { POST } = await importRoute()
    const req = await makeRequest({
      method: 'POST',
      body: {
        value: [
          {
            subscriptionId: 'sub-1',
            clientState: 'cs',
            resource: "Users/u/mailFolders('Inbox')/Messages/m1",
            resourceData: { id: 'm1' },
          },
          {
            subscriptionId: 'sub-1',
            clientState: 'cs',
            resource: "Users/u/mailFolders('Inbox')/Messages/m2",
            resourceData: { id: 'm2' },
          },
        ],
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(202)
    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: 'outlook/history-changed',
      data: expect.objectContaining({
        user_id: 'user-1',
        organization_id: 'org-1',
        microsoft_email: 'a@b.com',
      }),
    })
  })
})

describe('outlook webhook — POST silently drops orphan subscription', () => {
  it('does not fire Inngest when no credential row matches subscriptionId', async () => {
    getOutlookCredentialsBySubscriptionIdMock.mockResolvedValue({
      ok: true,
      data: null,
    })

    const { POST } = await importRoute()
    const req = await makeRequest({
      method: 'POST',
      body: {
        value: [
          {
            subscriptionId: 'sub-unknown',
            clientState: 'whatever',
            resource: "Users/u/mailFolders('Inbox')/Messages/m",
            resourceData: { id: 'm' },
          },
        ],
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(202)
    expect(inngestSendMock).not.toHaveBeenCalled()
    expect(captureMessageMock).not.toHaveBeenCalled()
  })
})

describe('outlook webhook — POST rejects unexpected resource', () => {
  it('captures Sentry message and skips when resource is not Inbox/messages', async () => {
    getOutlookCredentialsBySubscriptionIdMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'cred-1',
        user_id: 'user-1',
        organization_id: 'org-1',
        microsoft_email: 'a@b.com',
        subscription_client_state: 'cs',
        revoked_at: null,
      },
    })

    const { POST } = await importRoute()
    const req = await makeRequest({
      method: 'POST',
      body: {
        value: [
          {
            subscriptionId: 'sub-1',
            clientState: 'cs',
            // SentItems instead of Inbox — unexpected resource
            resource: "Users/u/mailFolders('SentItems')/Messages/m",
            resourceData: { id: 'm' },
          },
        ],
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(202)
    expect(captureMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('unexpected resource'),
      expect.objectContaining({ level: 'error' }),
    )
    expect(inngestSendMock).not.toHaveBeenCalled()
  })
})
