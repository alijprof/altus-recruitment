/**
 * @vitest-environment node
 *
 * `deleteCandidateAction` — the candidate_branded_cvs GDPR erasure sweep
 * (BCV-06, Plan 08-08 Task 2). candidate deletion already captured
 * candidate_cvs + voice_notes storage paths before the delete_candidate RPC
 * (Phase-7-era code); this plan adds the SAME capture for the new
 * candidate_branded_cvs table.
 *
 * Deliberately NOT mocking @/lib/db/postgrest-errors: isMissingTableError is
 * a pure predicate, and running the real implementation is the point — a
 * mock would let this sweep drift from the exact code/PGRST-code pair the
 * predicate actually matches.
 *
 * Coverage:
 *   - the candidate_branded_cvs path-capture query runs BEFORE the
 *     delete_candidate RPC
 *   - its captured path is concatenated into the SAME `cvs`-bucket removal
 *     call as candidate_cvs paths (no new bucket argument)
 *   - a capture-query error (a real fault, not a missing table) is
 *     Sentry-reported code-only/no-PII, exactly like the existing two
 *     captures, and does NOT abort the delete
 *   - a candidate with no branded CV produces no extra Storage entry
 *   - a missing candidate_branded_cvs TABLE (42P01) is tolerated as "no
 *     branded CVs" — NOT a capture failure, no Sentry noise, delete still
 *     succeeds — so a pre-migration deploy never blocks a candidate delete
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CV_PATH = `${ORG_ID}/${CANDIDATE_ID}/cv-1.pdf`
const BRANDED_PATH = `${ORG_ID}/${CANDIDATE_ID}/branded-cv-1.pdf`

// A minimal thenable query-builder stub matching the chainable
// select/eq/not shape deleteCandidateAction actually calls, resolving to
// whatever the underlying mock currently returns — mirrors how the real
// PostgREST query builder is itself a thenable.
function makeQueryBuilder(resultPromise: Promise<{ data: unknown; error: unknown }>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    then: (
      onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => resultPromise.then(onFulfilled, onRejected),
  }
  return builder
}

const cvPathsMock = vi.fn()
const voiceAudioMock = vi.fn()
const brandedCvPathsMock = vi.fn()
const rpcMock = vi.fn()
const removeMock = vi.fn()

const fromMock = vi.fn((table: string) => {
  if (table === 'candidate_cvs') return makeQueryBuilder(cvPathsMock())
  if (table === 'voice_notes') return makeQueryBuilder(voiceAudioMock())
  if (table === 'candidate_branded_cvs') return makeQueryBuilder(brandedCvPathsMock())
  throw new Error(`unexpected table in test stub: ${table}`)
})
const storageFromMock = vi.fn((_bucket: string) => ({ remove: removeMock }))
const getUserMock = vi.fn()
const createClientMock = vi.fn(async () => ({
  auth: { getUser: getUserMock },
  from: fromMock,
  storage: { from: storageFromMock },
  rpc: rpcMock,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const requireEntitledOrgMock = vi.fn()
vi.mock('@/lib/stripe/require-entitlement', () => ({
  requireEntitledOrg: (...a: unknown[]) => requireEntitledOrgMock(...a),
  ENTITLEMENT_BLOCKED_MESSAGE: 'This action is unavailable — billing setup incomplete.',
}))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }))
// Not throwing here (unlike the redirect() mock in branded-cv-route.test.ts,
// which asserts the sentinel-throw contract for a route handler) — this is a
// Server Action, and deleteCandidateAction has nothing after its own
// redirect() call, so a non-throwing stub is sufficient to observe every
// side effect that ran before it.
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

// Every other candidates/[id]/actions.ts import, mocked only so the module
// loads — none of these are exercised by deleteCandidateAction itself.
vi.mock('@/lib/branding/org-logo', () => ({ downloadOrgLogo: vi.fn() }))
vi.mock('@/lib/cv/file-signature', () => ({ assertUploadableCV: vi.fn() }))
vi.mock('@/lib/cv/parse-messages', () => ({
  isUnretryableParseFailure: vi.fn(() => false),
  isUploadIncomplete: vi.fn(() => false),
}))
vi.mock('@/lib/db/activities', () => ({ createActivity: vi.fn() }))
vi.mock('@/lib/db/candidate-branded-cvs', () => ({ upsertBrandedCv: vi.fn() }))
vi.mock('@/lib/db/candidate-cvs', () => ({
  createCandidateCV: vi.fn(),
  getCandidateCV: vi.fn(),
  markCandidateFieldsFromCV: vi.fn(),
  nextCVVersion: vi.fn(),
  updateCandidateCVParse: vi.fn(),
}))
vi.mock('@/lib/db/organizations', () => ({ getOrganization: vi.fn() }))
vi.mock('@/lib/db/profiles', () => ({ getProfile: vi.fn() }))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }))
vi.mock('@/lib/pdf/branded-cv-data', () => ({
  toBrandedCvData: vi.fn(),
  BRANDED_CV_FREE_TEXT_WARNING: 'Contact fields are removed automatically.',
}))
vi.mock('@/lib/pdf/branded-cv-document', () => ({ renderBrandedCv: vi.fn() }))

async function importAction() {
  return await import('@/app/(app)/candidates/[id]/actions')
}

beforeEach(() => {
  captureExceptionMock.mockReset()
  fromMock.mockClear()
  storageFromMock.mockClear()
  removeMock.mockReset()
  removeMock.mockResolvedValue({ error: null })

  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } })

  requireEntitledOrgMock.mockReset()
  requireEntitledOrgMock.mockResolvedValue({ ok: true })

  cvPathsMock.mockReset()
  cvPathsMock.mockResolvedValue({ data: [{ storage_path: CV_PATH }], error: null })

  voiceAudioMock.mockReset()
  voiceAudioMock.mockResolvedValue({ data: [], error: null })

  brandedCvPathsMock.mockReset()
  brandedCvPathsMock.mockResolvedValue({ data: [{ storage_path: BRANDED_PATH }], error: null })

  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ error: null })

  revalidatePathMock.mockReset()
})

afterEach(() => {
  vi.resetModules()
})

describe('deleteCandidateAction — candidate_branded_cvs erasure sweep', () => {
  it('captures candidate_branded_cvs.storage_path BEFORE the delete_candidate RPC', async () => {
    const order: string[] = []
    brandedCvPathsMock.mockImplementation(async () => {
      order.push('branded-capture')
      return { data: [{ storage_path: BRANDED_PATH }], error: null }
    })
    rpcMock.mockImplementation(async () => {
      order.push('rpc')
      return { error: null }
    })
    const { deleteCandidateAction } = await importAction()

    await deleteCandidateAction({ candidateId: CANDIDATE_ID })

    expect(order).toEqual(['branded-capture', 'rpc'])
  })

  it('includes the captured branded-CV path in the SAME cvs-bucket removal call as the CV paths', async () => {
    const { deleteCandidateAction } = await importAction()

    await deleteCandidateAction({ candidateId: CANDIDATE_ID })

    expect(storageFromMock).toHaveBeenCalledWith('cvs')
    expect(removeMock).toHaveBeenCalledTimes(1)
    const [paths] = removeMock.mock.calls[0] as [string[]]
    expect(paths).toHaveLength(2)
    expect(paths).toEqual(expect.arrayContaining([CV_PATH, BRANDED_PATH]))
  })

  it('reports a genuine branded-CV capture-query error to Sentry (code-only, no PII) without aborting the delete', async () => {
    brandedCvPathsMock.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: "denied for dana-okafor's branded CV" },
    })
    const { deleteCandidateAction } = await importAction()

    await deleteCandidateAction({ candidateId: CANDIDATE_ID })

    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0], (_k, v) =>
      v instanceof Error ? { message: v.message, name: v.name } : v,
    )
    expect(serialised).not.toContain('dana-okafor')
    // The delete still proceeds — a capture failure never blocks erasure.
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('a candidate with no branded CV produces no extra Storage entry', async () => {
    brandedCvPathsMock.mockResolvedValue({ data: [], error: null })
    const { deleteCandidateAction } = await importAction()

    await deleteCandidateAction({ candidateId: CANDIDATE_ID })

    const [paths] = removeMock.mock.calls[0] as [string[]]
    expect(paths).toEqual([CV_PATH])
  })

  it('tolerates a missing candidate_branded_cvs table (42P01) as "no branded CVs" — not a capture failure', async () => {
    brandedCvPathsMock.mockResolvedValue({
      data: null,
      error: { code: '42P01', message: 'relation "candidate_branded_cvs" does not exist' },
    })
    const { deleteCandidateAction } = await importAction()

    await deleteCandidateAction({ candidateId: CANDIDATE_ID })

    // Expected pre-migration state — no Sentry noise on every candidate
    // delete against a database that hasn't been migrated yet.
    expect(captureExceptionMock).not.toHaveBeenCalled()
    const [paths] = removeMock.mock.calls[0] as [string[]]
    expect(paths).toEqual([CV_PATH])
  })

  it('tolerates a missing candidate_branded_cvs table via the PostgREST schema-cache code (PGRST205) identically', async () => {
    brandedCvPathsMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'candidate_branded_cvs'" },
    })
    const { deleteCandidateAction } = await importAction()

    await deleteCandidateAction({ candidateId: CANDIDATE_ID })

    expect(captureExceptionMock).not.toHaveBeenCalled()
  })
})
