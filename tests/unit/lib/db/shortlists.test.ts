/**
 * @vitest-environment node
 *
 * Plan 03-03 / Task C.2 — DB helpers for shortlists + floats.
 *
 * Asserted invariants (D3-16 / D3-17 / D3-18):
 *   - listShortlistForJob filters on application_type='shortlist' AND
 *     job_id=<jobId>. It MUST NOT return standard / float / spec rows.
 *   - listFloatsForCandidate filters on application_type='float' AND
 *     candidate_id=<candidateId> AND job_id IS NULL. It MUST NOT return
 *     other application_types or rows with a job attached.
 *   - listAllFloats filters on application_type='float' AND job_id IS NULL
 *     across the whole org (RLS-scoped). Optional ownerId narrows to rows
 *     created by a single user.
 *   - Each helper returns DbResult<T> = `{ ok: true; data }` on success.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import {
  listAllFloats,
  listFloatsForCandidate,
  listShortlistForJob,
} from '@/lib/db/shortlists'

type FilterCall = { method: string; col?: string; val?: unknown }

function buildSelectStub(rows: unknown[] = []): {
  client: unknown
  filters: FilterCall[]
} {
  const filters: FilterCall[] = []
  type Chain = {
    select: (cols: string) => Chain
    eq: (col: string, val: unknown) => Chain
    is: (col: string, val: unknown) => Chain
    order: (col: string, opts?: unknown) => Promise<{ data: unknown[]; error: null }>
  }
  function chain(): Chain {
    const c: Chain = {
      select: () => c,
      eq: (col, val) => {
        filters.push({ method: 'eq', col, val })
        return c
      },
      is: (col, val) => {
        filters.push({ method: 'is', col, val })
        return c
      },
      order: () => Promise.resolve({ data: rows, error: null }),
    }
    return c
  }
  const client = {
    from: (_table: string) => chain(),
  }
  return { client, filters }
}

describe('listShortlistForJob (D3-16 / D3-17)', () => {
  it('filters on job_id AND application_type=shortlist', async () => {
    const { client, filters } = buildSelectStub([])
    await listShortlistForJob(client as never, 'job-1')

    const jobFilter = filters.find((f) => f.col === 'job_id')
    const typeFilter = filters.find((f) => f.col === 'application_type')

    expect(jobFilter).toEqual({ method: 'eq', col: 'job_id', val: 'job-1' })
    expect(typeFilter).toEqual({
      method: 'eq',
      col: 'application_type',
      val: 'shortlist',
    })
  })

  it('returns DbResult ok=true with the rows from supabase', async () => {
    const row = {
      id: 'app-1',
      application_type: 'shortlist',
      job_id: 'job-1',
      candidate_id: 'cand-1',
      stage: 'applied',
      stage_changed_at: '2026-05-19T10:00:00Z',
      created_at: '2026-05-19T10:00:00Z',
      organization_id: 'org-1',
      candidates: { id: 'cand-1', full_name: 'Alice', current_role_title: null, current_company: null, email: null },
    }
    const { client } = buildSelectStub([row])
    const r = await listShortlistForJob(client as never, 'job-1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toHaveLength(1)
  })
})

describe('listFloatsForCandidate (D3-16 / D3-18)', () => {
  it('filters on candidate_id AND application_type=float AND job_id IS NULL', async () => {
    const { client, filters } = buildSelectStub([])
    await listFloatsForCandidate(client as never, 'cand-1')

    const candFilter = filters.find((f) => f.col === 'candidate_id')
    const typeFilter = filters.find((f) => f.col === 'application_type')
    const jobIdFilter = filters.find((f) => f.col === 'job_id')

    expect(candFilter).toEqual({ method: 'eq', col: 'candidate_id', val: 'cand-1' })
    expect(typeFilter).toEqual({
      method: 'eq',
      col: 'application_type',
      val: 'float',
    })
    // Postgres-side: floats have job_id IS NULL. PostgREST's `.is(col, null)`
    // emits the right SQL — anything else (e.g. `.eq(col, null)`) would not.
    expect(jobIdFilter).toEqual({ method: 'is', col: 'job_id', val: null })
  })
})

describe('listAllFloats (org-wide list)', () => {
  it('filters on application_type=float AND job_id IS NULL', async () => {
    const { client, filters } = buildSelectStub([])
    await listAllFloats(client as never)

    const typeFilter = filters.find((f) => f.col === 'application_type')
    const jobIdFilter = filters.find((f) => f.col === 'job_id')
    const ownerFilter = filters.find((f) => f.col === 'owner_user_id')

    expect(typeFilter).toEqual({
      method: 'eq',
      col: 'application_type',
      val: 'float',
    })
    expect(jobIdFilter).toEqual({ method: 'is', col: 'job_id', val: null })
    // No ownerId passed — no owner_user_id filter applied.
    expect(ownerFilter).toBeUndefined()
  })

  it('adds owner_user_id filter when ownerId is passed', async () => {
    const { client, filters } = buildSelectStub([])
    await listAllFloats(client as never, { ownerId: 'user-1' })

    const ownerFilter = filters.find((f) => f.col === 'owner_user_id')
    expect(ownerFilter).toEqual({
      method: 'eq',
      col: 'owner_user_id',
      val: 'user-1',
    })
  })
})
