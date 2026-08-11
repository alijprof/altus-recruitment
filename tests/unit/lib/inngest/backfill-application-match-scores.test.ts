/**
 * @vitest-environment node
 *
 * Phase 7 Plan 07-06 — backfillApplicationMatchScores.
 *
 * THE DESIGN RULE under test: this sweep writes NO scoring logic. It only
 * selects unscored, job-bearing applications and fans out to
 * enqueueApplicationMatchScore — exactly the single fire-point add-to-job
 * and promote-shortlist-to-application already use (SF-3). Every guard
 * (tenant boundary, empty-profile skip, idempotency, spend ceiling, AI cap)
 * lives inside score-application-match and is asserted by ITS OWN test
 * suite, not duplicated here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    INNGEST_EVENT_KEY: 'test',
    INNGEST_SIGNING_KEY: 'test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
  },
}))

const { enqueueApplicationMatchScoreMock, createServiceClientMock } = vi.hoisted(() => ({
  enqueueApplicationMatchScoreMock: vi.fn(),
  createServiceClientMock: vi.fn(),
}))

vi.mock('@/lib/inngest/enqueue-match-score', () => ({
  enqueueApplicationMatchScore: enqueueApplicationMatchScoreMock,
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: createServiceClientMock,
}))

import * as Sentry from '@sentry/nextjs'

import { backfillApplicationMatchScores } from '@/lib/inngest/functions/backfill-application-match-scores'

type ApplicationRow = {
  id: string
  organization_id: string
  candidate_id: string
  job_id: string
}

type AppQueryCalls = {
  not: Array<[string, string, unknown]>
  eq: Array<[string, unknown]>
  order: Array<[string, { ascending: boolean }]>
  limit: number[]
}

type ApplicationsQueryResult = { data: ApplicationRow[]; error: null }
type ApplicationsQueryBuilder = Promise<ApplicationsQueryResult> & {
  select: (cols: string) => ApplicationsQueryBuilder
  not: (col: string, op: string, val: unknown) => ApplicationsQueryBuilder
  order: (col: string, opts: { ascending: boolean }) => ApplicationsQueryBuilder
  limit: (n: number) => ApplicationsQueryBuilder
  eq: (col: string, val: unknown) => ApplicationsQueryBuilder
}

// Mirrors the fluent `supabase.from('applications').select().not().order()
// .limit()[.eq()]` chain used by the sweep. Every method mutates `calls` so
// tests can assert exactly which filters were applied, and the object is
// itself a real Promise (via Object.assign) so `await query` resolves
// without a hand-rolled `.then`.
function makeApplicationsBuilder(rows: ApplicationRow[]): {
  builder: ApplicationsQueryBuilder
  calls: AppQueryCalls
} {
  const calls: AppQueryCalls = { not: [], eq: [], order: [], limit: [] }

  const select = (_cols: string): ApplicationsQueryBuilder => builder
  const not = (col: string, op: string, val: unknown): ApplicationsQueryBuilder => {
    calls.not.push([col, op, val])
    return builder
  }
  const order = (col: string, opts: { ascending: boolean }): ApplicationsQueryBuilder => {
    calls.order.push([col, opts])
    return builder
  }
  const limit = (n: number): ApplicationsQueryBuilder => {
    calls.limit.push(n)
    return builder
  }
  const eq = (col: string, val: unknown): ApplicationsQueryBuilder => {
    calls.eq.push([col, val])
    return builder
  }

  const builder: ApplicationsQueryBuilder = Object.assign(
    Promise.resolve<ApplicationsQueryResult>({ data: rows, error: null }),
    { select, not, order, limit, eq },
  )

  return { builder, calls }
}

type ScoredPairRow = { candidate_id: string; job_id: string }

// Mirrors `supabase.from('ai_summaries').select().eq('kind', ...).in(...).in(...)`.
function makeAiSummariesBuilder(scoredPairs: ScoredPairRow[]) {
  return {
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        in: (_col1: string, _vals1: unknown[]) => ({
          in: (_col2: string, _vals2: unknown[]) =>
            Promise.resolve({ data: scoredPairs, error: null }),
        }),
      }),
    }),
  }
}

function makeStep() {
  return { run: async (_name: string, fn: () => unknown) => fn() }
}

const ORG = 'org-1'

beforeEach(() => {
  enqueueApplicationMatchScoreMock.mockReset()
  enqueueApplicationMatchScoreMock.mockResolvedValue(undefined)
  createServiceClientMock.mockReset()
  vi.mocked(Sentry.captureException).mockClear()
  vi.mocked(Sentry.captureMessage).mockClear()
  vi.mocked(Sentry.addBreadcrumb).mockClear()
})

function invoke(eventData: Record<string, unknown>): Promise<unknown> {
  const handler = backfillApplicationMatchScores as unknown as {
    fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown>
  }
  if (typeof handler.fn !== 'function') {
    throw new Error('Inngest function shape changed — expected `.fn` handler.')
  }
  return handler.fn({ event: { data: eventData }, step: makeStep() })
}

function stubClient(appBuilder: ApplicationsQueryBuilder, aiSummaries: ReturnType<typeof makeAiSummariesBuilder>) {
  createServiceClientMock.mockReturnValue({
    from: (table: string) => (table === 'applications' ? appBuilder : aiSummaries),
  })
}

describe('backfillApplicationMatchScores', () => {
  it('filters float applications (job_id null) out of the DB selection', async () => {
    const { builder, calls } = makeApplicationsBuilder([
      { id: 'app-1', organization_id: ORG, candidate_id: 'cand-1', job_id: 'job-1' },
    ])
    stubClient(builder, makeAiSummariesBuilder([]))

    await invoke({})

    expect(calls.not).toContainEqual(['job_id', 'is', null])
  })

  it('skips an application whose (candidate_id, job_id) pair already has ANY ai_summaries row', async () => {
    const { builder } = makeApplicationsBuilder([
      { id: 'app-1', organization_id: ORG, candidate_id: 'cand-scored', job_id: 'job-1' },
      { id: 'app-2', organization_id: ORG, candidate_id: 'cand-unscored', job_id: 'job-2' },
    ])
    stubClient(builder, makeAiSummariesBuilder([{ candidate_id: 'cand-scored', job_id: 'job-1' }]))

    const result = await invoke({})

    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(1)
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'cand-unscored', jobId: 'job-2' }),
    )
    expect(result).toMatchObject({ enqueued: 1, skippedAlreadyScored: 1 })
  })

  it('enqueues remaining applications oldest-first, one enqueueApplicationMatchScore call each', async () => {
    const rows: ApplicationRow[] = [
      { id: 'app-old', organization_id: ORG, candidate_id: 'cand-a', job_id: 'job-a' },
      { id: 'app-new', organization_id: ORG, candidate_id: 'cand-b', job_id: 'job-b' },
    ]
    const { builder, calls } = makeApplicationsBuilder(rows)
    stubClient(builder, makeAiSummariesBuilder([]))

    await invoke({})

    expect(calls.order).toContainEqual(['created_at', { ascending: true }])
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(2)
    expect(enqueueApplicationMatchScoreMock.mock.calls[0]?.[0]).toMatchObject({
      applicationId: 'app-old',
    })
    expect(enqueueApplicationMatchScoreMock.mock.calls[1]?.[0]).toMatchObject({
      applicationId: 'app-new',
    })
  })

  it('stops at the row cap and reports truncated rather than silently truncating', async () => {
    const rows: ApplicationRow[] = Array.from({ length: 500 }, (_, i) => ({
      id: `app-${i}`,
      organization_id: ORG,
      candidate_id: `cand-${i}`,
      job_id: `job-${i}`,
    }))
    const { builder } = makeApplicationsBuilder(rows)
    stubClient(builder, makeAiSummariesBuilder([]))

    const result = await invoke({})

    expect(result).toMatchObject({ truncated: true, scanned: 500, enqueued: 500 })
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('row cap'),
      expect.objectContaining({ level: 'warning' }),
    )
  })

  it('scopes the sweep to organization_id when the event payload carries one', async () => {
    const { builder, calls } = makeApplicationsBuilder([
      { id: 'app-1', organization_id: ORG, candidate_id: 'cand-1', job_id: 'job-1' },
    ])
    stubClient(builder, makeAiSummariesBuilder([]))

    await invoke({ organization_id: ORG })

    expect(calls.eq).toContainEqual(['organization_id', ORG])
  })

  it('sweeps all orgs when the event payload carries no organization_id', async () => {
    const { builder, calls } = makeApplicationsBuilder([
      { id: 'app-1', organization_id: ORG, candidate_id: 'cand-1', job_id: 'job-1' },
    ])
    stubClient(builder, makeAiSummariesBuilder([]))

    await invoke({})

    expect(calls.eq.some(([col]) => col === 'organization_id')).toBe(false)
  })

  it('does not abort the sweep when a single row throws', async () => {
    const rows: ApplicationRow[] = [
      { id: 'app-bad', organization_id: ORG, candidate_id: 'cand-bad', job_id: 'job-bad' },
      { id: 'app-good', organization_id: ORG, candidate_id: 'cand-good', job_id: 'job-good' },
    ]
    const { builder } = makeApplicationsBuilder(rows)
    stubClient(builder, makeAiSummariesBuilder([]))

    enqueueApplicationMatchScoreMock.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    const result = await invoke({})

    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ enqueued: 1, errored: 1 })
  })
})
