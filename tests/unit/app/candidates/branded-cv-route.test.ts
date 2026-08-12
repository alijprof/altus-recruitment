/**
 * @vitest-environment node
 *
 * `GET /candidates/[id]/branded-cv` — the branded-PDF delivery route
 * (BCV-05, Plan 08-08). A near-clone of
 * tests/unit/app/candidates/cv-file-route.test.ts (D-01, Plan 07-01;
 * production rework 2026-08-11) — same mocks, same structure, same
 * assertion style, ported for the single path segment and the by-candidate
 * lookup.
 *
 * Coverage (the seven behaviours pinned by 08-08-PLAN.md Task 1):
 *   1. a non-uuid `id` segment 404s without touching auth or the database
 *   2. an unauthenticated request redirects to /sign-in
 *   3. a missing row, a cross-tenant candidate id, and a missing table all
 *      404 identically and mint nothing (no existence oracle)
 *   4. a failed sign returns 502, captures a PII-FREE Sentry event, files no
 *      audit row
 *   5. the happy path 302s to the signed URL with cache-control: no-store
 *   6. recordExportAudit is awaited BEFORE the response is constructed —
 *      ordering, not just occurrence
 *   7. the route never calls requireEntitledOrg (statically pinned — this
 *      route does not import it at all, mirroring cv-file/[cvId]/route.ts)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const getBrandedCvForCandidateMock = vi.fn()
vi.mock('@/lib/db/candidate-branded-cvs', () => ({
  getBrandedCvForCandidate: (...args: unknown[]) => getBrandedCvForCandidateMock(...args),
}))

const recordExportAuditMock = vi.fn()
vi.mock('@/lib/db/audit', () => ({
  recordExportAudit: (...args: unknown[]) => recordExportAuditMock(...args),
}))

async function importRoute() {
  return await import('@/app/(app)/candidates/[id]/branded-cv/route')
}

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111'
const BRANDED_CV_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
// Branded-CV storage paths never embed a candidate name (unlike CV-upload
// paths) — org id + candidate id + a fresh uuid only — but the 502 test still
// pins that the raw path never reaches Sentry, as a defence-in-depth check.
const STORAGE_PATH = `${ORG_ID}/${CANDIDATE_ID}/branded-cv-44444444-4444-4444-8444-444444444444.pdf`
const SIGNED_URL = 'https://storage.example.test/object/sign/cvs/branded.pdf?token=abc123'
const GENERATED_AT = '2026-08-12T10:00:00Z'

function brandedCvRow() {
  return {
    id: BRANDED_CV_ID,
    organization_id: ORG_ID,
    candidate_id: CANDIDATE_ID,
    storage_path: STORAGE_PATH,
    file_size_bytes: 12345,
    generated_by: 'user-1',
    generated_at: GENERATED_AT,
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
  }
}

function call(candidateId = CANDIDATE_ID) {
  return { params: Promise.resolve({ id: candidateId }) }
}

const request = new Request('https://app.test/candidates/x/branded-cv')

beforeEach(() => {
  captureExceptionMock.mockReset()
  createClientMock.mockClear()
  storageFromMock.mockClear()
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  getBrandedCvForCandidateMock.mockReset()
  getBrandedCvForCandidateMock.mockResolvedValue({ ok: true, data: brandedCvRow() })
  createSignedUrlMock.mockReset()
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: SIGNED_URL }, error: null })
  recordExportAuditMock.mockReset()
  recordExportAuditMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.resetModules()
})

describe('GET /candidates/[id]/branded-cv', () => {
  it('404s on a non-uuid id without touching auth or the database', async () => {
    const { GET } = await importRoute()

    await expect(GET(request, call('not-a-uuid'))).rejects.toThrow('TEST_NOT_FOUND')
    expect(createClientMock).not.toHaveBeenCalled()
    expect(getBrandedCvForCandidateMock).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in when there is no session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const { GET } = await importRoute()

    await expect(GET(request, call())).rejects.toThrow('TEST_REDIRECT:/sign-in')
    // Never reads the row for an unauthenticated caller.
    expect(getBrandedCvForCandidateMock).not.toHaveBeenCalled()
  })

  it('404s and mints nothing when the row is missing, cross-tenant, or the table does not exist', async () => {
    // getBrandedCvForCandidate runs under the RLS-scoped client and folds a
    // missing table into the same not_found code as a missing/cross-tenant
    // row — the route must not distinguish any of the three.
    getBrandedCvForCandidateMock.mockResolvedValue({ ok: false, code: 'not_found' })
    const { GET } = await importRoute()

    await expect(GET(request, call())).rejects.toThrow('TEST_NOT_FOUND')
    expect(createSignedUrlMock).not.toHaveBeenCalled()
    expect(recordExportAuditMock).not.toHaveBeenCalled()
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
    // PII PIN: nothing in the captured event — message, tags, or extras —
    // may contain the storage path.
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0], (_k, v) =>
      v instanceof Error ? { message: v.message, name: v.name } : v,
    )
    expect(serialised).not.toContain(STORAGE_PATH)
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

  it('files the export audit row against the CANDIDATE, ids + timestamp only, before responding', async () => {
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

    // The row is filed only once a URL exists, and the handler AWAITS it —
    // so by the time the redirect is returned, the write has already
    // resolved. Release and delivery are the same response.
    expect(order).toEqual(['sign', 'audit'])
    expect(auditSettled).toBe(true)
    expect(response.status).toBe(302)

    const [, entityType, entityId, metadata] = recordExportAuditMock.mock.calls[0] ?? []
    expect(entityType).toBe('candidate')
    expect(entityId).toBe(CANDIDATE_ID)
    expect(metadata).toEqual({
      candidate_branded_cv_id: BRANDED_CV_ID,
      generated_at: GENERATED_AT,
    })
    // Metadata carries ids + an ISO timestamp ONLY — never the storage path.
    expect(JSON.stringify(metadata)).not.toContain(STORAGE_PATH)
  })

  it('never calls requireEntitledOrg — reading your own document is not billing-gated', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(app)/candidates/[id]/branded-cv/route.ts'),
      'utf-8',
    )
    expect(source).not.toMatch(/requireEntitledOrg/)
  })
})
