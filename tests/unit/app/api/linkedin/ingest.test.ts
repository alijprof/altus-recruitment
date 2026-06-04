/**
 * @vitest-environment node
 *
 * Plan 03-01 Task A.2 — `/api/linkedin/ingest` POST handler.
 *
 * Coverage:
 *   - 401 when no Authorization header
 *   - 401 when getUser(token) returns no user
 *   - 400 on malformed body (missing name)
 *   - 200 + Inngest event on happy-path insert
 *   - 200 with updated:true when dedup hit (linkedin_url match)
 *   - 426 when X-Altus-Extension-Version is below the minimum
 *   - CORS: OPTIONS returns 204; POST response sets Access-Control-Allow-Origin
 *     ONLY for an allowlisted chrome-extension://<id> origin
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

const envState: {
  LINKEDIN_EXTENSION_ID?: string
  LINKEDIN_EXTENSION_MIN_VERSION?: string
} = {
  LINKEDIN_EXTENSION_ID: 'abcdefghijklmnopabcdefghijklmnop',
  LINKEDIN_EXTENSION_MIN_VERSION: '0.1.0',
}
vi.mock('@/lib/env', () => ({
  get env() {
    return envState
  },
}))

const getUserMock = vi.fn()
const createClientMock = vi.fn(async () => ({
  auth: { getUser: getUserMock },
  rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
}))
// Token-scoped client used for the DATA queries. getProfile /
// upsertCandidateFromLinkedIn are themselves mocked, so this object's shape is
// irrelevant — it just must not throw on construction (the real helper would
// need NEXT_PUBLIC_SUPABASE_* env which the test deliberately omits).
const createBearerClientMock = vi.fn(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createBearerClient: createBearerClientMock,
}))

const getProfileMock = vi.fn()
vi.mock('@/lib/db/profiles', () => ({
  getProfile: getProfileMock,
}))

const upsertCandidateFromLinkedInMock = vi.fn()
vi.mock('@/lib/db/candidates-linkedin', () => ({
  upsertCandidateFromLinkedIn: upsertCandidateFromLinkedInMock,
  getCandidateByLinkedInUrl: vi.fn(),
  getCandidateByEmailLowercase: vi.fn(),
}))

const inngestSendMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendMock },
}))

async function importRoute() {
  return await import('@/app/api/linkedin/ingest/route')
}

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

const VALID_BODY = {
  name: 'Alex Placeholder',
  headline: 'Senior Engineer',
  current_role: 'Senior Engineer',
  current_company: 'PlaceholderCo',
  location: 'London',
  about: null,
  work_experience: [],
  education: [],
  skills: ['TS', 'PG'],
  linkedin_url: 'https://www.linkedin.com/in/placeholder/',
  capture_confidence: 0.9,
}

type RequestInitWithBody = RequestInit & { body?: string }

function makeRequest(opts: {
  method: 'POST' | 'OPTIONS'
  body?: unknown
  headers?: Record<string, string>
  origin?: string
  /** Set to false to omit the X-Altus-Extension-Version header. */
  withVersion?: boolean
}): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.withVersion !== false && opts.method !== 'OPTIONS'
      ? { 'x-altus-extension-version': '0.1.0' }
      : {}),
    ...(opts.headers ?? {}),
  }
  if (opts.origin) headers.origin = opts.origin
  const init: RequestInitWithBody = {
    method: opts.method,
    headers,
  }
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  }
  return new Request('http://localhost:3000/api/linkedin/ingest', init)
}

beforeEach(() => {
  getUserMock.mockReset()
  getProfileMock.mockReset()
  upsertCandidateFromLinkedInMock.mockReset()
  inngestSendMock.mockClear()
  envState.LINKEDIN_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
  envState.LINKEDIN_EXTENSION_MIN_VERSION = '0.1.0'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OPTIONS /api/linkedin/ingest', () => {
  it('returns 204 with CORS headers for allowlisted extension origin', async () => {
    const route = await importRoute()
    const res = await route.OPTIONS(
      makeRequest({ method: 'OPTIONS', origin: EXT_ORIGIN }) as never,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(EXT_ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('omits Allow-Origin for a non-allowlisted origin', async () => {
    const route = await importRoute()
    const res = await route.OPTIONS(
      makeRequest({ method: 'OPTIONS', origin: 'https://evil.example.com' }) as never,
    )
    // 204 either way (we don't fail preflight on origin alone — the browser
    // enforces by reading Allow-Origin), but the header MUST NOT be set
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('POST /api/linkedin/ingest — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const route = await importRoute()
    const res = await route.POST(makeRequest({ method: 'POST', body: VALID_BODY }) as never)
    expect(res.status).toBe(401)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('returns 401 when getUser(token) returns no user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const route = await importRoute()
    const res = await route.POST(
      makeRequest({
        method: 'POST',
        body: VALID_BODY,
        headers: { authorization: 'Bearer bad-token' },
      }) as never,
    )
    expect(res.status).toBe(401)
    expect(getUserMock).toHaveBeenCalledWith('bad-token')
  })
})

describe('POST /api/linkedin/ingest — extension version', () => {
  it('returns 426 when X-Altus-Extension-Version is below the minimum', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const route = await importRoute()
    const res = await route.POST(
      makeRequest({
        method: 'POST',
        body: VALID_BODY,
        headers: {
          authorization: 'Bearer good',
          'x-altus-extension-version': '0.0.1',
        },
      }) as never,
    )
    expect(res.status).toBe(426)
  })
})

describe('POST /api/linkedin/ingest — body validation', () => {
  it('returns 400 when the body is missing the required `name` field', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const route = await importRoute()
    const { name: _name, ...withoutName } = VALID_BODY
    const res = await route.POST(
      makeRequest({
        method: 'POST',
        body: withoutName,
        headers: { authorization: 'Bearer good' },
      }) as never,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when linkedin_url is not a URL', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const route = await importRoute()
    const res = await route.POST(
      makeRequest({
        method: 'POST',
        body: { ...VALID_BODY, linkedin_url: 'not-a-url' },
        headers: { authorization: 'Bearer good' },
      }) as never,
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/linkedin/ingest — happy path', () => {
  it('returns 200 + emits inngest event on new candidate', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getProfileMock.mockResolvedValue({
      ok: true,
      data: {
        full_name: 'Recruiter',
        email: 'r@example.com',
        organization_id: 'org-1',
        role: 'recruiter',
      },
    })
    upsertCandidateFromLinkedInMock.mockResolvedValue({
      ok: true,
      data: { id: 'cand-new-1', created: true },
    })
    const route = await importRoute()
    const res = await route.POST(
      makeRequest({
        method: 'POST',
        body: VALID_BODY,
        headers: { authorization: 'Bearer good', origin: EXT_ORIGIN },
        origin: EXT_ORIGIN,
      }) as never,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, candidate_id: 'cand-new-1', updated: false })
    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    expect(inngestSendMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'linkedin/captured',
      data: { organization_id: 'org-1', candidate_id: 'cand-new-1', user_id: 'u1' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe(EXT_ORIGIN)
  })

  it('returns 200 with updated:true when dedupe hit', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getProfileMock.mockResolvedValue({
      ok: true,
      data: {
        full_name: 'Recruiter',
        email: 'r@example.com',
        organization_id: 'org-1',
        role: 'recruiter',
      },
    })
    upsertCandidateFromLinkedInMock.mockResolvedValue({
      ok: true,
      data: { id: 'cand-existing-1', created: false },
    })
    const route = await importRoute()
    const res = await route.POST(
      makeRequest({
        method: 'POST',
        body: VALID_BODY,
        headers: { authorization: 'Bearer good' },
      }) as never,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(true)
    expect(body.candidate_id).toBe('cand-existing-1')
  })
})
