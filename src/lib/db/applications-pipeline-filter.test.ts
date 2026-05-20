/**
 * @vitest-environment node
 *
 * Plan 03-03 / Task C.2 — D3-17 invariant test.
 *
 * Asserts that the per-job pipeline kanban data path (`listApplicationsByStage`)
 * and the global pipeline data path (`listAllApplicationsByStage`) include
 * a `.eq('application_type', 'standard')` filter so shortlist / float / spec
 * rows are EXCLUDED from the live pipeline view. Without this filter,
 * shortlist rows (added via the per-job "Shortlist" tab) would pollute the
 * kanban as soon as they exist — the whole point of the "working set"
 * concept is that shortlist rows do NOT appear in the formal pipeline until
 * promoted via `convertShortlistToApplicationAction`.
 *
 * This test asserts the FILTER CONTRACT against the Supabase chain — i.e.
 * `.eq('application_type', 'standard')` is called for the applications
 * query. The actual SQL is enforced by RLS + the helper; the kanban-side
 * mapping (groupByStage) is incidental here.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

import {
  listAllApplicationsByStage,
  listApplicationsByStage,
} from '@/lib/db/applications'

type FilterCall = { table: string; method: string; col?: string; val?: unknown }

/**
 * Build a Supabase mock client that records every `.eq` / `.in` / `.is`
 * call against the `applications` and `jobs` tables. Returns the
 * recorded filters and a configurable `data` payload.
 */
function buildClient(opts: {
  jobsRows?: Array<{ id: string }>
  appsRows?: unknown[]
}) {
  const filters: FilterCall[] = []
  const jobsRows = opts.jobsRows ?? [{ id: 'job-1' }]
  const appsRows = opts.appsRows ?? []

  function jobsChain() {
    const chain: {
      eq: (col: string, val: unknown) => typeof chain
      then: (
        resolve: (v: { data: unknown[]; error: null }) => void,
      ) => Promise<{ data: unknown[]; error: null }>
    } = {
      eq: (col, val) => {
        filters.push({ table: 'jobs', method: 'eq', col, val })
        return chain
      },
      // Treat the chain as awaitable.
      then: (resolve) => {
        const v = { data: jobsRows, error: null }
        resolve(v)
        return Promise.resolve(v)
      },
    }
    return chain
  }

  function appsChain() {
    const chain: {
      eq: (col: string, val: unknown) => typeof chain
      in: (col: string, vals: unknown[]) => typeof chain
      is: (col: string, val: unknown) => typeof chain
      order: (
        col: string,
        opts?: unknown,
      ) => Promise<{ data: unknown[]; error: null }>
    } = {
      eq: (col, val) => {
        filters.push({ table: 'applications', method: 'eq', col, val })
        return chain
      },
      in: (col, vals) => {
        filters.push({ table: 'applications', method: 'in', col, val: vals })
        return chain
      },
      is: (col, val) => {
        filters.push({ table: 'applications', method: 'is', col, val })
        return chain
      },
      order: () => Promise.resolve({ data: appsRows, error: null }),
    }
    return chain
  }

  const client = {
    from(table: string) {
      if (table === 'jobs') {
        return { select: () => jobsChain() }
      }
      return { select: () => appsChain() }
    },
  }

  return { client, filters }
}

describe('listApplicationsByStage (D3-17 pipeline filter)', () => {
  it('filters applications with application_type=standard', async () => {
    const { client, filters } = buildClient({ appsRows: [] })
    await listApplicationsByStage(client as never, 'job-1')

    const typeFilter = filters.find(
      (f) => f.table === 'applications' && f.col === 'application_type',
    )
    expect(typeFilter).toEqual({
      table: 'applications',
      method: 'eq',
      col: 'application_type',
      val: 'standard',
    })
  })

  it('filters by job_id alongside the application_type filter', async () => {
    const { client, filters } = buildClient({ appsRows: [] })
    await listApplicationsByStage(client as never, 'job-7')

    const jobFilter = filters.find(
      (f) => f.table === 'applications' && f.col === 'job_id',
    )
    expect(jobFilter).toEqual({
      table: 'applications',
      method: 'eq',
      col: 'job_id',
      val: 'job-7',
    })
  })
})

describe('listAllApplicationsByStage (D3-17 global pipeline filter)', () => {
  it('filters applications with application_type=standard', async () => {
    const { client, filters } = buildClient({
      jobsRows: [{ id: 'job-1' }],
      appsRows: [],
    })
    await listAllApplicationsByStage(client as never, {})

    const typeFilter = filters.find(
      (f) => f.table === 'applications' && f.col === 'application_type',
    )
    expect(typeFilter).toEqual({
      table: 'applications',
      method: 'eq',
      col: 'application_type',
      val: 'standard',
    })
  })

  it('applies ownerId narrowing alongside the standard-type filter', async () => {
    const { client, filters } = buildClient({
      jobsRows: [{ id: 'job-1' }],
      appsRows: [],
    })
    await listAllApplicationsByStage(client as never, { ownerId: 'user-1' })

    const ownerFilter = filters.find(
      (f) => f.table === 'applications' && f.col === 'owner_user_id',
    )
    expect(ownerFilter).toEqual({
      table: 'applications',
      method: 'eq',
      col: 'owner_user_id',
      val: 'user-1',
    })

    const typeFilter = filters.find(
      (f) => f.table === 'applications' && f.col === 'application_type',
    )
    expect(typeFilter?.val).toBe('standard')
  })
})
