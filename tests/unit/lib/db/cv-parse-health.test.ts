/**
 * @vitest-environment node
 *
 * getCvParseHealth — review 2026-08-04 H2.
 *
 * The dashboard's amber "CV parsing needs attention" card has no dismiss
 * affordance, so the ONLY way it can ever go away is for the count to reach
 * zero. Before this fix it counted every 'failed' candidate_cvs row the org
 * had ever produced, with no time bound and no awareness that candidate_cvs
 * is versioned — so a CV that failed and was then successfully re-uploaded
 * alarmed the live customer forever, and every abandoned apply-form upload
 * (which the new reconciler converts to 'failed') incremented it permanently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}))

import { getCvParseHealth } from '@/lib/db/dashboard'

type Response = { data: unknown; error: unknown; count?: number }

type RecordedQuery = { table: string; filters: Array<[string, unknown]> }

/**
 * Minimal PostgREST-shaped double. Each `.from()` consumes the next queued
 * response; every filter call is recorded so the tests can assert the query
 * itself (the time bound is only observable there).
 */
function fakeClient(responses: Response[]) {
  const queries: RecordedQuery[] = []
  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, filters: [] }
      queries.push(record)
      const response = responses.shift() ?? { data: [], error: null, count: 0 }
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          record.filters.push([method, args])
          return builder
        }
      }
      builder.then = (resolve: (r: Response) => unknown) => Promise.resolve(response).then(resolve)
      return builder
    },
  }
  // reason: the helper takes a fully-typed SupabaseClient<Database>; this
  // double implements only the handful of builder methods it actually calls.
  return { client: client as never, queries }
}

beforeEach(() => captureException.mockReset())

describe('getCvParseHealth', () => {
  it('bounds the failed scan to a 14-day window', async () => {
    const { client, queries } = fakeClient([
      { data: [], error: null },
      { data: [], error: null, count: 0 },
    ])
    await getCvParseHealth(client)

    const failedQuery = queries[0]
    const gte = failedQuery?.filters.find(([m]) => m === 'gte')
    expect(gte).toBeDefined()
    const [, args] = gte as [string, unknown[]]
    expect(args[0]).toBe('created_at')
    const cutoff = new Date(String(args[1])).getTime()
    const fourteenDays = 14 * 24 * 60 * 60 * 1000
    expect(Date.now() - cutoff).toBeGreaterThan(fourteenDays - 60_000)
    expect(Date.now() - cutoff).toBeLessThan(fourteenDays + 60_000)
  })

  it('ignores a failure that a newer CV version has superseded', async () => {
    const { client } = fakeClient([
      // failed scan: v1 failed for cand-1
      { data: [{ id: 'cv-1', candidate_id: 'cand-1', version: 1 }], error: null },
      // stale pending: none
      { data: [], error: null, count: 0 },
      // version lookup: cand-1 is now on v2 (the successful re-upload)
      {
        data: [
          { candidate_id: 'cand-1', version: 2 },
          { candidate_id: 'cand-1', version: 1 },
        ],
        error: null,
      },
    ])

    const health = await getCvParseHealth(client)
    expect(health.failed).toBe(0)
    expect(health.stalePending).toBe(0)
    expect(health.candidates).toEqual([])
  })

  it('still counts a failure that IS the candidate’s current CV', async () => {
    const { client } = fakeClient([
      { data: [{ id: 'cv-2', candidate_id: 'cand-1', version: 2 }], error: null },
      { data: [], error: null, count: 0 },
      {
        data: [
          { candidate_id: 'cand-1', version: 2 },
          { candidate_id: 'cand-1', version: 1 },
        ],
        error: null,
      },
      { data: [{ id: 'cand-1', full_name: 'Test Candidate' }], error: null },
    ])

    const health = await getCvParseHealth(client)
    expect(health.failed).toBe(1)
    expect(health.candidates).toEqual([{ id: 'cand-1', fullName: 'Test Candidate' }])
  })

  it('counts one candidate once even with several current-version failures', async () => {
    // Same candidate cannot have two rows at the same version in practice
    // (the (candidate_id, version) unique constraint), but the count must be
    // over distinct candidates so it agrees with the list of names rendered
    // beneath it.
    const { client } = fakeClient([
      {
        data: [
          { id: 'cv-3', candidate_id: 'cand-1', version: 3 },
          { id: 'cv-9', candidate_id: 'cand-2', version: 1 },
        ],
        error: null,
      },
      { data: [], error: null, count: 0 },
      {
        data: [
          { candidate_id: 'cand-1', version: 3 },
          { candidate_id: 'cand-2', version: 1 },
        ],
        error: null,
      },
      {
        data: [
          { id: 'cand-1', full_name: 'One' },
          { id: 'cand-2', full_name: 'Two' },
        ],
        error: null,
      },
    ])

    const health = await getCvParseHealth(client)
    expect(health.failed).toBe(2)
    expect(health.candidates).toHaveLength(2)
  })

  it('reports zero (so the widget unmounts) when nothing is outstanding', async () => {
    const { client } = fakeClient([
      { data: [], error: null },
      { data: [], error: null, count: 0 },
    ])
    const health = await getCvParseHealth(client)
    expect(health.failed + health.stalePending).toBe(0)
  })

  it('degrades to the unfiltered failures rather than crashing when the version lookup errors', async () => {
    const { client } = fakeClient([
      { data: [{ id: 'cv-1', candidate_id: 'cand-1', version: 1 }], error: null },
      { data: [], error: null, count: 0 },
      { data: null, error: { message: 'boom' } },
      { data: [{ id: 'cand-1', full_name: 'Test Candidate' }], error: null },
    ])

    const health = await getCvParseHealth(client)
    expect(health.failed).toBe(1)
    expect(captureException).toHaveBeenCalled()
  })
})
