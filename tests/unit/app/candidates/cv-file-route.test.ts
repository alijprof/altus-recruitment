/**
 * @vitest-environment node
 *
 * `GET /candidates/[id]/cv-file/[cvId]` — the signed-URL delivery route
 * (D-01, Plan 07-01; production rework 2026-08-11).
 *
 * These pins were previously carried by cv-file-link.test.tsx against
 * getCvFileUrlAction, which this route replaced. They are ported here rather
 * than dropped: the behaviour is what matters, not which module hosts it.
 *
 * Coverage:
 *   - non-uuid path segments 404 without touching auth or the database
 *   - unauthenticated request redirects to /sign-in (defence in depth)
 *   - a missing / cross-tenant row 404s and mints nothing (TENANCY BARRIER)
 *   - a candidate id that isn't the row's own 404s
 *   - an upload-incomplete row 404s and mints nothing (server mirror of the
 *     UI's disabled state)
 *   - a failed sign returns 502, captures a PII-FREE Sentry event, files no
 *     audit row
 *   - the happy path 302s to the signed URL, no-store, with the `export`
 *     audit row filed BEFORE the response is returned
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CV_UPLOAD_INCOMPLETE_MESSAGE } from '@/lib/cv/parse-messages'

vi.mock('server-only', () => ({}))

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

// notFound()/redirect() throw in real Next too (they return `never`), so
// asserting on a thrown sentinel is faithful, not a test-only shortcut.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('TEST_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`TEST_REDIRECT:${url}`)
  },
}))

const getUserMock = vi.fn()
const createSignedUrlMock = vi.fn()
const storageFromMock = vi.fn(() => ({ createSignedUrl: createSignedUrlMock }))
const createClientMock = vi.fn(async () => ({
  auth: { getUser: getUserMock },
  storage: { from: storageFromMock },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

const getCandidateCVMock = vi.fn()
vi.mock('@/lib/db/candidate-cvs', () => ({
  getCandidateCV: (...args: unknown[]) => getCandidateCVMock(...args),
}))

const recordExportAuditMock = vi.fn()
vi.mock('@/lib/db/audit', () => ({
  recordExportAudit: (...args: unknown[]) => recordExportAuditMock(...args),
}))

// Deliberately NOT mocked: @/lib/cv/cv-file-display. isCvFileDownloadable is
// pure, and running the real predicate is the point — a mock would let the
// route drift away from the exact gate the UI renders its disabled state from.

async function importRoute() {
  return await import('@/app/(app)/candidates/[id]/cv-file/[cvId]/route')
}

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111'
const CV_ID = '22222222-2222-4222-8222-222222222222'
// Embeds a slugified candidate NAME — exactly the PII that must never reach
// Sentry. The 502 test asserts against this literal.
const STORAGE_PATH = '33333333-3333-4333-8333-333333333333/cand/uuid-dana-okafor-cv.pdf'
const SIGNED_URL = 'https://storage.example.test/object/sign/cvs/dana.pdf?token=abc123'

type CvRowOverrides = { storage_path?: string | null; parse_error?: string | null }

function cvRow(overrides: CvRowOverrides = {}) {
  return {
    id: CV_ID,
    candidate_id: CANDIDATE_ID,
    storage_path: STORAGE_PATH,
    parse_error: null,
    version: 3,
    ...overrides,
  }
}

function call(candidateId = CANDIDATE_ID, cvId = CV_ID) {
  return { params: Promise.resolve({ id: candidateId, cvId }) }
}

const request = new Request('https://app.test/candidates/x/cv-file/y')

beforeEach(() => {
  captureExceptionMock.mockReset()
  createClientMock.mockClear()
  storageFromMock.mockClear()
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  getCandidateCVMock.mockReset()
  getCandidateCVMock.mockResolvedValue({ ok: true, data: cvRow() })
  createSignedUrlMock.mockReset()
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: SIGNED_URL }, error: null })
  recordExportAuditMock.mockReset()
  recordExportAuditMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.resetModules()
})

describe('GET /candidates/[id]/cv-file/[cvId]', () => {
  it('404s on a non-uuid id without touching auth or the database', async () => {
    const { GET } = await importRoute()

    await expect(GET(request, call(CANDIDATE_ID, 'not-a-uuid'))).rejects.toThrow('TEST_NOT_FOUND')
    expect(createClientMock).not.toHaveBeenCalled()
    expect(getCandidateCVMock).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in when there is no session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const { GET } = await importRoute()

    await expect(GET(request, call())).rejects.toThrow('TEST_REDIRECT:/sign-in')
    // Never reads the row for an unauthenticated caller.
    expect(getCandidateCVMock).not.toHaveBeenCalled()
  })

  it('404s and mints nothing when the row is missing or belongs to another tenant', async () => {
    // getCandidateCV runs under the RLS-scoped client, so a cross-tenant id is
    // indistinguishable from a missing one — that IS the tenancy barrier, and
    // the route must not leak which it was.
    getCandidateCVMock.mockResolvedValue({ ok: false, code: 'not_found' })
    const { GET } = await importRoute()

    await expect(GET(request, call())).rejects.toThrow('TEST_NOT_FOUND')
    expect(createSignedUrlMock).not.toHaveBeenCalled()
    expect(recordExportAuditMock).not.toHaveBeenCalled()
  })

  it('404s when the path candidate id is not the row owner', async () => {
    const { GET } = await importRoute()
    const otherCandidate = '99999999-9999-4999-8999-999999999999'

    await expect(GET(request, call(otherCandidate))).rejects.toThrow('TEST_NOT_FOUND')
    expect(createSignedUrlMock).not.toHaveBeenCalled()
    expect(recordExportAuditMock).not.toHaveBeenCalled()
  })

  it('404s for an upload-incomplete row — the server mirror of the disabled control', async () => {
    getCandidateCVMock.mockResolvedValue({
      ok: true,
      data: cvRow({ parse_error: CV_UPLOAD_INCOMPLETE_MESSAGE }),
    })
    const { GET } = await importRoute()

    await expect(GET(request, call())).rejects.toThrow('TEST_NOT_FOUND')
    expect(createSignedUrlMock).not.toHaveBeenCalled()
    expect(recordExportAuditMock).not.toHaveBeenCalled()
  })

  it('404s when the row has no storage object at all', async () => {
    getCandidateCVMock.mockResolvedValue({ ok: true, data: cvRow({ storage_path: null }) })
    const { GET } = await importRoute()

    await expect(GET(request, call())).rejects.toThrow('TEST_NOT_FOUND')
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it('502s on a failed sign, captures NO PII, and files no audit row', async () => {
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { name: 'StorageApiError', message: `denied for ${STORAGE_PATH}` },
    })
    const { GET } = await importRoute()

    const response = await GET(request, call())
    expect(response.status).toBe(502)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toMatch(/open this file/i)

    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    // PII PIN: storage_path embeds a slugified candidate name. Nothing in the
    // captured event — message, tags, or extras — may contain it.
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0], (_k, v) =>
      v instanceof Error ? { message: v.message, name: v.name } : v,
    )
    expect(serialised).not.toContain(STORAGE_PATH)
    expect(serialised).not.toContain('dana-okafor')
    expect(serialised).toContain('createSignedUrl')

    // A URL that was never released must never produce an `export` row.
    expect(recordExportAuditMock).not.toHaveBeenCalled()
  })

  it('302s to the signed URL with no-store', async () => {
    const { GET } = await importRoute()

    const response = await GET(request, call())
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(SIGNED_URL)
    // The Location header carries a live credential — it must not be cached.
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(createSignedUrlMock).toHaveBeenCalledWith(STORAGE_PATH, 60)
  })

  it('files the export audit row against the CANDIDATE, ids only, before responding', async () => {
    const order: string[] = []
    createSignedUrlMock.mockImplementation(async () => {
      order.push('sign')
      return { data: { signedUrl: SIGNED_URL }, error: null }
    })
    let auditSettled = false
    recordExportAuditMock.mockImplementation(async () => {
      order.push('audit')
      await Promise.resolve()
      auditSettled = true
    })
    const { GET } = await importRoute()

    const response = await GET(request, call())

    // The row is filed only once a URL exists, and the handler AWAITS it — so
    // by the time the redirect is returned, the write has already resolved.
    // Release and delivery are the same response, which is precisely the
    // guarantee the old server-action design could not make.
    expect(order).toEqual(['sign', 'audit'])
    expect(auditSettled).toBe(true)
    expect(response.status).toBe(302)

    const [, entityType, entityId, metadata] = recordExportAuditMock.mock.calls[0] ?? []
    // Filed against the candidate (not the cv row) so the access shows up in
    // that candidate's history via audit_log_org_entity_idx.
    expect(entityType).toBe('candidate')
    expect(entityId).toBe(CANDIDATE_ID)
    expect(metadata).toEqual({ candidate_cv_id: CV_ID, version: 3 })
    // Metadata carries ids + an integer version ONLY.
    expect(JSON.stringify(metadata)).not.toContain('dana-okafor')
  })
})
