/**
 * @vitest-environment node
 *
 * Plan 03-05 / Task E.1 — REPEAT-01 + D3-20.
 *
 * Asserts the `Mail.Send` incremental-consent contract for the outlook
 * integration. `sendMail` MUST:
 *   1. Refuse to call Graph when the cached creds do not contain `Mail.Send`,
 *      and return a `needs_consent` discriminant with an HTTPS consent URL
 *      the UI can render as a banner link.
 *   2. On 403 / insufficient_scope / AADSTS65001 from Graph (the recruiter
 *      revoked or partially consented mid-session), surface the same
 *      `needs_consent` shape so the UI banner appears instead of a generic
 *      send-failed error (RESEARCH §Pitfall 9).
 *   3. Successfully invoke `client.api('/me/sendMail').post(...)` when the
 *      scope is present, returning `{ ok: true }`.
 *
 * Mocks the outlook DB helper + getValidAccessToken so the test never
 * touches MSAL or Graph in-process. The Graph SDK call is mocked via the
 * `@microsoft/microsoft-graph-client` module factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

// MSAL is heavy; we don't need its behavior here.
vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: class {},
}))

// Mock the Graph SDK so `client.api(...).post(...)` is observable.
const apiPostMock = vi.fn()
const apiSpy = vi.fn(() => ({ post: apiPostMock }))
vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    init: () => ({ api: apiSpy }),
  },
}))

// Mock the outlook_credentials DB helper. Each test sets the return value.
const getOutlookCredentialsMock = vi.fn()
vi.mock('@/lib/db/outlook-credentials', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/outlook-credentials')
  >('@/lib/db/outlook-credentials')
  return {
    ...actual,
    getOutlookCredentials: (...args: unknown[]) => getOutlookCredentialsMock(...args),
  }
})

// Stub env so getMsal() / authorize-URL helpers don't throw when imported
// transitively. Note `OUTLOOK_REDIRECT_URI` MUST be set for
// `buildIncrementalConsentUrl` to embed `redirect_uri`.
vi.mock('@/lib/env', () => ({
  env: {
    OUTLOOK_TENANT_ID: 'tenant-1',
    OUTLOOK_CLIENT_ID: 'client-1',
    OUTLOOK_CLIENT_SECRET: 'secret-1',
    OUTLOOK_REDIRECT_URI: 'https://app.example.com/auth/outlook/callback',
    OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET: 'shh',
  },
}))

// We mock getValidAccessToken via a separate test-only export to avoid
// needing MSAL plumbing. The real getValidAccessToken decrypts cached
// tokens and refreshes via MSAL — neither concern this test.
const getValidAccessTokenMock = vi.fn()

import {
  __setMailSendTestOverrides,
  buildIncrementalConsentUrl,
  hasMailSendScope,
  OUTLOOK_SCOPES,
  sendMail,
} from '@/lib/integrations/outlook'

const supabaseStub = { __mock: 'supabase' } as never

beforeEach(() => {
  apiPostMock.mockReset()
  apiSpy.mockClear()
  getOutlookCredentialsMock.mockReset()
  getValidAccessTokenMock.mockReset()
  __setMailSendTestOverrides({
    getValidAccessToken: getValidAccessTokenMock,
  })
})

afterEach(() => {
  __setMailSendTestOverrides(null)
  vi.clearAllMocks()
})

describe('OUTLOOK_SCOPES contains Mail.Send (D3-20)', () => {
  it('includes Mail.Send so the consent URL requests it', () => {
    expect(OUTLOOK_SCOPES).toContain('Mail.Send')
  })
})

describe('hasMailSendScope', () => {
  it('returns true when the scope is granted', () => {
    expect(
      hasMailSendScope({ scopes: ['offline_access', 'Mail.Read', 'Mail.Send'] }),
    ).toBe(true)
  })

  it('returns false when the scope is missing', () => {
    expect(
      hasMailSendScope({ scopes: ['offline_access', 'Mail.Read', 'User.Read'] }),
    ).toBe(false)
  })
})

describe('buildIncrementalConsentUrl', () => {
  it('returns an HTTPS Microsoft authorize URL with prompt=consent and Mail.Send', () => {
    const url = buildIncrementalConsentUrl()
    expect(url).toMatch(/^https:\/\/login\.microsoftonline\.com\//)
    expect(url).toContain('prompt=consent')
    // Mail.Send may be URL-encoded; assert against decoded form.
    expect(decodeURIComponent(url)).toContain('Mail.Send')
  })
})

describe('sendMail (REPEAT-01 + D3-20)', () => {
  it('returns { ok: false, code: "not_connected" } when the credentials row is absent', async () => {
    getOutlookCredentialsMock.mockResolvedValue({ ok: true, data: null })

    const result = await sendMail(supabaseStub, {
      userId: 'user-1',
      to: 'client@example.com',
      subject: 'Checking in',
      html: '<p>Hi</p>',
    })

    expect(result).toEqual({ ok: false, code: 'not_connected' })
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('returns { ok: false, code: "needs_consent", consentUrl } when Mail.Send is not granted', async () => {
    getOutlookCredentialsMock.mockResolvedValue({
      ok: true,
      data: {
        scopes: ['offline_access', 'Mail.Read', 'User.Read'],
        revoked_at: null,
      },
    })

    const result = await sendMail(supabaseStub, {
      userId: 'user-1',
      to: 'client@example.com',
      subject: 'Checking in',
      html: '<p>Hi</p>',
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.code === 'needs_consent') {
      expect(result.consentUrl).toMatch(/^https:\/\/login\.microsoftonline\.com\//)
      expect(decodeURIComponent(result.consentUrl)).toContain('Mail.Send')
    } else {
      throw new Error(`expected needs_consent, got ${JSON.stringify(result)}`)
    }
    // Never call Graph when the scope is missing — D3-20 invariant.
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('sends mail via Graph and returns { ok: true } when Mail.Send is granted', async () => {
    getOutlookCredentialsMock.mockResolvedValue({
      ok: true,
      data: {
        scopes: ['offline_access', 'Mail.Read', 'Mail.Send', 'User.Read'],
        revoked_at: null,
      },
    })
    getValidAccessTokenMock.mockResolvedValue('access-token')
    apiPostMock.mockResolvedValue(undefined)

    const result = await sendMail(supabaseStub, {
      userId: 'user-1',
      to: 'client@example.com',
      subject: 'Checking in',
      html: '<p>Hi</p>',
    })

    expect(result).toEqual({ ok: true })
    expect(apiSpy).toHaveBeenCalledWith('/me/sendMail')
    const postArg = apiPostMock.mock.calls[0]?.[0] as {
      message: {
        subject: string
        body: { contentType: string; content: string }
        toRecipients: Array<{ emailAddress: { address: string } }>
      }
      saveToSentItems: boolean
    }
    expect(postArg.message.subject).toBe('Checking in')
    expect(postArg.message.body.contentType).toBe('HTML')
    expect(postArg.message.body.content).toBe('<p>Hi</p>')
    expect(postArg.message.toRecipients[0]?.emailAddress.address).toBe(
      'client@example.com',
    )
    expect(postArg.saveToSentItems).toBe(true)
  })

  it('surfaces 403 / insufficient_scope from Graph as needs_consent (Pitfall 9)', async () => {
    getOutlookCredentialsMock.mockResolvedValue({
      ok: true,
      data: {
        scopes: ['offline_access', 'Mail.Read', 'Mail.Send', 'User.Read'],
        revoked_at: null,
      },
    })
    getValidAccessTokenMock.mockResolvedValue('access-token')
    const sendErr = Object.assign(new Error('insufficient_claims'), {
      statusCode: 403,
      code: 'AADSTS65001',
    })
    apiPostMock.mockRejectedValueOnce(sendErr)

    const result = await sendMail(supabaseStub, {
      userId: 'user-1',
      to: 'client@example.com',
      subject: 'Checking in',
      html: '<p>Hi</p>',
    })

    expect(result.ok).toBe(false)
    if (!result.ok && result.code === 'needs_consent') {
      expect(decodeURIComponent(result.consentUrl)).toContain('Mail.Send')
    } else {
      throw new Error(`expected needs_consent, got ${JSON.stringify(result)}`)
    }
  })

  it('returns { ok: false, code: "send_failed" } on other Graph errors', async () => {
    getOutlookCredentialsMock.mockResolvedValue({
      ok: true,
      data: {
        scopes: ['offline_access', 'Mail.Read', 'Mail.Send', 'User.Read'],
        revoked_at: null,
      },
    })
    getValidAccessTokenMock.mockResolvedValue('access-token')
    const sendErr = Object.assign(new Error('something broke'), { statusCode: 500 })
    apiPostMock.mockRejectedValueOnce(sendErr)

    const result = await sendMail(supabaseStub, {
      userId: 'user-1',
      to: 'client@example.com',
      subject: 'Checking in',
      html: '<p>Hi</p>',
    })

    expect(result).toEqual({ ok: false, code: 'send_failed' })
  })
})
