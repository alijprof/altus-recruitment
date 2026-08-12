/**
 * @vitest-environment node
 *
 * `generateBrandedCvAction` (08-07 Task 2) — the on-demand, zero-AI branded
 * CV generation Server Action (BCV-01, BCV-06, BCV-07).
 *
 * Coverage:
 *   - a non-uuid candidate id is rejected before any auth or database work
 *   - NEVER calls requireEntitledOrg — this action is deliberately UNGATED
 *     by billing state (founder decision 2026-08-12); auth + RLS are the
 *     only gates
 *   - an unauthenticated caller gets "Not signed in." and writes nothing
 *   - a cross-tenant / unknown candidate id resolves to "Candidate not
 *     found." (the RLS-scoped read IS the tenancy barrier), no Storage write
 *   - happy path calls, in exact order: candidate read -> org read -> logo
 *     download (only when logo_storage_path is set) -> render -> Storage
 *     upload of the NEW path -> row upsert
 *   - a regeneration passes the previous storage path to storage.remove
 *     exactly once, only AFTER the row update succeeded
 *   - a failed Storage upload returns a friendly error, no upsert, no remove
 *   - a failed row upsert removes the just-uploaded object (no orphan)
 *   - a failed logo download degrades to a logo-less render
 *   - a missing table returns a plain "not available yet" message
 *   - zero AI/HTTP calls: no @/lib/ai import, no inngest.send, no fetch
 *   - Sentry captures contain no PII
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

const getUserMock = vi.fn()
const candidateMaybeSingleMock = vi.fn()
const uploadMock = vi.fn()
const removeMock = vi.fn()
const fromMock = vi.fn((table: string) => {
  if (table === 'candidates') {
    return {
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: candidateMaybeSingleMock,
        }),
      }),
    }
  }
  throw new Error(`unexpected table in test stub: ${table}`)
})
const storageFromMock = vi.fn((_bucket: string) => ({ upload: uploadMock, remove: removeMock }))
const createClientMock = vi.fn(async () => ({
  auth: { getUser: getUserMock },
  from: fromMock,
  storage: { from: storageFromMock },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const getProfileMock = vi.fn()
vi.mock('@/lib/db/profiles', () => ({ getProfile: (...a: unknown[]) => getProfileMock(...a) }))

const getOrganizationMock = vi.fn()
vi.mock('@/lib/db/organizations', () => ({
  getOrganization: (...a: unknown[]) => getOrganizationMock(...a),
}))

const downloadOrgLogoMock = vi.fn()
vi.mock('@/lib/branding/org-logo', () => ({
  downloadOrgLogo: (...a: unknown[]) => downloadOrgLogoMock(...a),
}))

const toBrandedCvDataMock = vi.fn()
vi.mock('@/lib/pdf/branded-cv-data', () => ({
  toBrandedCvData: (...a: unknown[]) => toBrandedCvDataMock(...a),
  BRANDED_CV_FREE_TEXT_WARNING: 'Contact fields are removed automatically.',
}))

const renderBrandedCvMock = vi.fn()
vi.mock('@/lib/pdf/branded-cv-document', () => ({
  renderBrandedCv: (...a: unknown[]) => renderBrandedCvMock(...a),
}))

const upsertBrandedCvMock = vi.fn()
vi.mock('@/lib/db/candidate-branded-cvs', () => ({
  upsertBrandedCv: (...a: unknown[]) => upsertBrandedCvMock(...a),
}))

const createActivityMock = vi.fn()
vi.mock('@/lib/db/activities', () => ({
  createActivity: (...a: unknown[]) => createActivityMock(...a),
}))

const requireEntitledOrgMock = vi.fn()
vi.mock('@/lib/stripe/require-entitlement', () => ({
  requireEntitledOrg: (...a: unknown[]) => requireEntitledOrgMock(...a),
  ENTITLEMENT_BLOCKED_MESSAGE: 'This action is unavailable — billing setup incomplete.',
}))

const inngestSendMock = vi.fn()
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: (...a: unknown[]) => inngestSendMock(...a) },
}))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

vi.mock('@/lib/cv/file-signature', () => ({ assertUploadableCV: vi.fn() }))
vi.mock('@/lib/cv/parse-messages', () => ({
  isUnretryableParseFailure: vi.fn(() => false),
  isUploadIncomplete: vi.fn(() => false),
}))
vi.mock('@/lib/db/candidate-cvs', () => ({
  createCandidateCV: vi.fn(),
  getCandidateCV: vi.fn(),
  markCandidateFieldsFromCV: vi.fn(),
  nextCVVersion: vi.fn(),
  updateCandidateCVParse: vi.fn(),
}))

async function importAction() {
  return await import('@/app/(app)/candidates/[id]/actions')
}

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

function candidateRow() {
  return {
    id: CANDIDATE_ID,
    organization_id: ORG_ID,
    full_name: 'Dana Okafor',
    email: 'dana@example.test',
    phone: '+44 7700 900000',
  }
}

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: 'Steele Charles',
    slug: 'steele-charles',
    logo_url: null,
    logo_storage_path: `${ORG_ID}/logo-abc.png`,
    apply_form_enabled: true,
    stripe_customer_id: null,
    brand_primary: '#1a6b50',
    brand_secondary: '#0f4a37',
    ...overrides,
  }
}

let order: string[]

beforeEach(() => {
  order = []
  captureExceptionMock.mockReset()
  createClientMock.mockClear()
  fromMock.mockClear()
  storageFromMock.mockClear()

  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } })

  candidateMaybeSingleMock.mockReset()
  candidateMaybeSingleMock.mockImplementation(async () => {
    order.push('candidate-read')
    return { data: candidateRow(), error: null }
  })

  getProfileMock.mockReset()
  getProfileMock.mockResolvedValue({
    ok: true,
    data: { organization_id: ORG_ID, role: 'recruiter', full_name: null, email: null },
  })

  getOrganizationMock.mockReset()
  getOrganizationMock.mockImplementation(async () => {
    order.push('org-read')
    return { ok: true, data: orgRow() }
  })

  downloadOrgLogoMock.mockReset()
  downloadOrgLogoMock.mockImplementation(async () => {
    order.push('logo-download')
    return { data: new Uint8Array([1, 2, 3]), format: 'png' }
  })

  toBrandedCvDataMock.mockReset()
  toBrandedCvDataMock.mockReturnValue({ fullName: 'Dana Okafor' })

  renderBrandedCvMock.mockReset()
  renderBrandedCvMock.mockImplementation(async () => {
    order.push('render')
    return Buffer.from('pdf-bytes')
  })

  uploadMock.mockReset()
  uploadMock.mockImplementation(async () => {
    order.push('upload')
    return { error: null }
  })

  removeMock.mockReset()
  removeMock.mockImplementation(async () => {
    order.push('remove')
    return { error: null }
  })

  upsertBrandedCvMock.mockReset()
  upsertBrandedCvMock.mockImplementation(async () => {
    order.push('upsert')
    return {
      ok: true,
      data: {
        row: {
          id: 'branded-1',
          organization_id: ORG_ID,
          candidate_id: CANDIDATE_ID,
          storage_path: 'new-path.pdf',
          file_size_bytes: 10,
          generated_by: USER_ID,
          generated_at: '2026-08-12T10:00:00Z',
          created_at: '2026-08-12T10:00:00Z',
          updated_at: '2026-08-12T10:00:00Z',
        },
        previousStoragePath: null,
      },
    }
  })

  createActivityMock.mockReset()
  createActivityMock.mockResolvedValue({ ok: true, data: {} })

  requireEntitledOrgMock.mockReset()
  requireEntitledOrgMock.mockResolvedValue({ ok: true })

  inngestSendMock.mockReset()
  revalidatePathMock.mockReset()

  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  // T-08-39 / founder decision 2026-08-12: this action must NEVER gate on
  // entitlement, on ANY path this test file exercises.
  expect(requireEntitledOrgMock).not.toHaveBeenCalled()
  // BCV-07: zero AI/HTTP calls, ever.
  expect(inngestSendMock).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('generateBrandedCvAction', () => {
  it('rejects a non-uuid candidate id before any auth or database work', async () => {
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: 'not-a-uuid' })
    expect(result).toEqual({ ok: false, error: 'Invalid candidate id.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('never calls requireEntitledOrg on the happy path (redundant with the afterEach pin, kept explicit)', async () => {
    const { generateBrandedCvAction } = await importAction()
    await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(requireEntitledOrgMock).not.toHaveBeenCalled()
  })

  it('returns "Not signed in." and writes nothing for an unauthenticated caller', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result).toEqual({ ok: false, error: 'Not signed in.' })
    expect(candidateMaybeSingleMock).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('returns "Candidate not found." for a cross-tenant / unknown candidate id, with no Storage write', async () => {
    candidateMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result).toEqual({ ok: false, error: 'Candidate not found.' })
    expect(uploadMock).not.toHaveBeenCalled()
    expect(upsertBrandedCvMock).not.toHaveBeenCalled()
  })

  it('happy path: calls candidate read -> org read -> logo download -> render -> upload -> upsert, in that exact order', async () => {
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result).toEqual({ ok: true })
    expect(order).toEqual(['candidate-read', 'org-read', 'logo-download', 'render', 'upload', 'upsert'])
    // No previous copy on this candidate — nothing to remove.
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('skips the logo download entirely when the org has no logo_storage_path', async () => {
    getOrganizationMock.mockImplementation(async () => {
      order.push('org-read')
      return { ok: true, data: orgRow({ logo_storage_path: null }) }
    })
    const { generateBrandedCvAction } = await importAction()
    await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(downloadOrgLogoMock).not.toHaveBeenCalled()
    expect(order).toEqual(['candidate-read', 'org-read', 'render', 'upload', 'upsert'])
  })

  it('regeneration: passes the previous storage path to storage.remove exactly once, only AFTER the row update succeeded', async () => {
    upsertBrandedCvMock.mockImplementation(async () => {
      order.push('upsert')
      return {
        ok: true,
        data: {
          row: {
            id: 'branded-1',
            organization_id: ORG_ID,
            candidate_id: CANDIDATE_ID,
            storage_path: 'new-path.pdf',
            file_size_bytes: 10,
            generated_by: USER_ID,
            generated_at: '2026-08-12T10:00:00Z',
            created_at: '2026-08-01T10:00:00Z',
            updated_at: '2026-08-12T10:00:00Z',
          },
          previousStoragePath: 'old-path.pdf',
        },
      }
    })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result).toEqual({ ok: true })
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(['old-path.pdf'])
    expect(order.indexOf('upsert')).toBeLessThan(order.indexOf('remove'))
  })

  it('a failed Storage upload returns a friendly error and leaves the existing row and object untouched', async () => {
    uploadMock.mockImplementation(async () => {
      order.push('upload')
      return { error: { name: 'StorageApiError', message: 'upload failed' } }
    })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toMatch(/StorageApiError|stack|Error:/i)
    expect(upsertBrandedCvMock).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('a failed row upsert removes the just-uploaded object (no orphan) and returns an error', async () => {
    upsertBrandedCvMock.mockResolvedValue({
      ok: false,
      code: 'internal',
      detail: '23505 (candidate_branded_cvs.update: storage_path)',
    })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result.ok).toBe(false)
    expect(removeMock).toHaveBeenCalledTimes(1)
    const [removedPaths] = removeMock.mock.calls[0] as [string[]]
    expect(removedPaths[0]).toMatch(new RegExp(`^${ORG_ID}/${CANDIDATE_ID}/branded-cv-.+\\.pdf$`))
  })

  it('a failed logo download degrades to a logo-less render rather than failing generation', async () => {
    downloadOrgLogoMock.mockImplementation(async () => {
      order.push('logo-download')
      return null
    })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result).toEqual({ ok: true })
    const [, branding] = renderBrandedCvMock.mock.calls[0] as [unknown, { logo: unknown }]
    expect(branding.logo).toBeNull()
  })

  it('returns a plain "not available yet" message when the table is missing, not a stack trace', async () => {
    upsertBrandedCvMock.mockResolvedValue({
      ok: false,
      code: 'internal',
      detail: '42P01 (candidate_branded_cvs.select)',
    })
    const { generateBrandedCvAction } = await importAction()
    const result = await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(result).toEqual({ ok: false, error: 'Branded CVs aren’t available yet.' })
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('captures no PII in Sentry on a failed upload — error name, fixed subop and ids only', async () => {
    uploadMock.mockImplementation(async () => {
      order.push('upload')
      return { error: { name: 'StorageApiError', message: 'denied for dana-okafor-cv.pdf' } }
    })
    const { generateBrandedCvAction } = await importAction()
    await generateBrandedCvAction({ candidateId: CANDIDATE_ID })
    expect(captureExceptionMock).toHaveBeenCalledTimes(1)
    const serialised = JSON.stringify(captureExceptionMock.mock.calls[0], (_k, v) =>
      v instanceof Error ? { message: v.message, name: v.name } : v,
    )
    expect(serialised).not.toContain('dana')
    expect(serialised).not.toContain('Okafor')
    expect(serialised).not.toContain('dana@example.test')
    expect(serialised).not.toContain('+44 7700 900000')
    const [, ctx] = captureExceptionMock.mock.calls[0] as [unknown, { tags?: Record<string, unknown> }]
    expect(ctx?.tags).toMatchObject({ layer: 'server-action', action: 'generateBrandedCvAction' })
  })

  it('imports no @/lib/ai module — zero AI spend, statically pinned', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/(app)/candidates/[id]/actions.ts'),
      'utf-8',
    )
    // Matches an actual import specifier only (`from '@/lib/ai...'`), not
    // prose mentioning the path in a comment.
    expect(source).not.toMatch(/from ['"]@\/lib\/ai/)
  })
})
