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
 *
 * Review 2026-08-11 additions:
 *   WR-01 — BOTH `.in()` lists in the ai_summaries pre-filter are chunked
 *           (only the candidate list used to be), and a chunk read failure
 *           fails CLOSED (skip) instead of open (enqueue everything).
 *   WR-02 — the per-run cap is on ENQUEUES, with a separately bounded scan,
 *           so a re-run walks past already-scored rows and reaches newer
 *           applications instead of being a permanent no-op.
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
  created_at: string
}

type AppQueryCalls = {
  not: Array<[string, string, unknown]>
  eq: Array<[string, unknown]>
  gte: Array<[string, unknown]>
  order: Array<[string, { ascending: boolean }]>
  limit: number[]
  /** One entry per page request, recording the filters that page used. */
  pages: Array<{ gte: string | null; eq: unknown }>
}

type ApplicationsQueryResult = { data: ApplicationRow[] | null; error: unknown }

/**
 * Mirrors the fluent `supabase.from('applications').select().not().order()
 * .order().limit()[.eq()][.gte()]` chain used by the sweep. The sweep now
 * PAGES, so the builder is re-entrant: each awaited chain is one page, and
 * `pageFor` decides what that page returns given the filters applied to it.
 */
function makeApplicationsBuilder(
  pageFor: (filters: { gte: string | null; eq: unknown }) => ApplicationsQueryResult,
) {
  const calls: AppQueryCalls = { not: [], eq: [], gte: [], order: [], limit: [], pages: [] }

  function makeChain() {
    let gteValue: string | null = null
    let eqValue: unknown = undefined

    const chain: Record<string, unknown> = {}
    const self = () => chain as never

    chain.select = () => self()
    chain.not = (col: string, op: string, val: unknown) => {
      calls.not.push([col, op, val])
      return self()
    }
    chain.order = (col: string, opts: { ascending: boolean }) => {
      calls.order.push([col, opts])
      return self()
    }
    chain.limit = (n: number) => {
      calls.limit.push(n)
      return self()
    }
    chain.eq = (col: string, val: unknown) => {
      calls.eq.push([col, val])
      eqValue = val
      return self()
    }
    chain.gte = (col: string, val: string) => {
      calls.gte.push([col, val])
      gteValue = val
      return self()
    }
    // Awaiting the chain resolves the page.
    chain.then = (
      resolve: (v: ApplicationsQueryResult) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      try {
        const filters = { gte: gteValue, eq: eqValue }
        calls.pages.push(filters)
        return Promise.resolve(pageFor(filters)).then(resolve, reject)
      } catch (err) {
        return Promise.reject(err as Error).then(resolve, reject)
      }
    }

    return chain
  }

  return { from: () => makeChain(), calls }
}

/** A builder that returns one fixed page (the common single-page case). */
function makeSinglePageBuilder(rows: ApplicationRow[]) {
  const seenAny = { done: false }
  return makeApplicationsBuilder(() => {
    if (seenAny.done) return { data: [], error: null }
    seenAny.done = true
    return { data: rows, error: null }
  })
}

type ScoredPairRow = { candidate_id: string; job_id: string }

type AiSummariesStub = {
  builder: { select: (cols: string) => unknown }
  chunkCalls: Array<{ candidateIds: string[]; jobIds: string[] }>
}

/**
 * Mirrors `supabase.from('ai_summaries').select().eq('kind', ...).in(...)
 * .in(...)`, recording every chunk's id lists so the WR-01 chunking
 * assertions have something concrete to read.
 */
function makeAiSummariesBuilder(
  scoredPairs: ScoredPairRow[],
  opts: { errorOnChunk?: number } = {},
): AiSummariesStub {
  const chunkCalls: Array<{ candidateIds: string[]; jobIds: string[] }> = []
  const builder = {
    select: () => ({
      eq: () => ({
        in: (_col1: string, candidateIds: string[]) => ({
          in: (_col2: string, jobIds: string[]) => {
            const index = chunkCalls.length
            chunkCalls.push({ candidateIds, jobIds })
            if (opts.errorOnChunk === index) {
              return Promise.resolve({ data: null, error: { message: 'URL too long' } })
            }
            return Promise.resolve({ data: scoredPairs, error: null })
          },
        }),
      }),
    }),
  }
  return { builder, chunkCalls }
}

function makeStep() {
  return { run: async (_name: string, fn: () => unknown) => fn() }
}

const ORG = 'org-1'

function app(i: number, overrides: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: `app-${i}`,
    organization_id: ORG,
    candidate_id: `cand-${i}`,
    job_id: `job-${i}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  enqueueApplicationMatchScoreMock.mockReset()
  enqueueApplicationMatchScoreMock.mockResolvedValue(undefined)
  createServiceClientMock.mockReset()
  vi.mocked(Sentry.captureException).mockClear()
  vi.mocked(Sentry.captureMessage).mockClear()
  vi.mocked(Sentry.addBreadcrumb).mockClear()
})

type SweepResult = {
  enqueued: number
  skippedAlreadyScored: number
  skippedUnknown: number
  errored: number
  scanned: number
  truncated: boolean
  nextCursor: string | null
}

function invoke(eventData: Record<string, unknown>): Promise<SweepResult> {
  const handler = backfillApplicationMatchScores as unknown as {
    fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<SweepResult>
  }
  if (typeof handler.fn !== 'function') {
    throw new Error('Inngest function shape changed — expected `.fn` handler.')
  }
  return handler.fn({ event: { data: eventData }, step: makeStep() })
}

function stubClient(
  apps: { from: () => unknown; calls: AppQueryCalls },
  aiSummaries: AiSummariesStub,
) {
  createServiceClientMock.mockReturnValue({
    from: (table: string) => (table === 'applications' ? apps.from() : aiSummaries.builder),
  })
}

describe('backfillApplicationMatchScores', () => {
  it('filters float applications (job_id null) out of the DB selection', async () => {
    const apps = makeSinglePageBuilder([app(1)])
    stubClient(apps, makeAiSummariesBuilder([]))

    await invoke({})

    expect(apps.calls.not).toContainEqual(['job_id', 'is', null])
  })

  it('skips an application whose (candidate_id, job_id) pair already has ANY ai_summaries row', async () => {
    const apps = makeSinglePageBuilder([
      app(1, { candidate_id: 'cand-scored', job_id: 'job-1' }),
      app(2, { candidate_id: 'cand-unscored', job_id: 'job-2' }),
    ])
    stubClient(apps, makeAiSummariesBuilder([{ candidate_id: 'cand-scored', job_id: 'job-1' }]))

    const result = await invoke({})

    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(1)
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'cand-unscored', jobId: 'job-2' }),
    )
    expect(result).toMatchObject({ enqueued: 1, skippedAlreadyScored: 1 })
  })

  it('enqueues remaining applications oldest-first, one enqueueApplicationMatchScore call each', async () => {
    const apps = makeSinglePageBuilder([app(1, { id: 'app-old' }), app(2, { id: 'app-new' })])
    stubClient(apps, makeAiSummariesBuilder([]))

    await invoke({})

    expect(apps.calls.order).toContainEqual(['created_at', { ascending: true }])
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(2)
    expect(enqueueApplicationMatchScoreMock.mock.calls[0]?.[0]).toMatchObject({
      applicationId: 'app-old',
    })
    expect(enqueueApplicationMatchScoreMock.mock.calls[1]?.[0]).toMatchObject({
      applicationId: 'app-new',
    })
  })

  it('scopes the sweep to organization_id when the event payload carries one', async () => {
    const apps = makeSinglePageBuilder([app(1)])
    stubClient(apps, makeAiSummariesBuilder([]))

    await invoke({ organization_id: ORG })

    expect(apps.calls.eq).toContainEqual(['organization_id', ORG])
  })

  it('sweeps all orgs when the event payload carries no organization_id', async () => {
    const apps = makeSinglePageBuilder([app(1)])
    stubClient(apps, makeAiSummariesBuilder([]))

    await invoke({})

    expect(apps.calls.eq.some(([col]) => col === 'organization_id')).toBe(false)
  })

  it('does not abort the sweep when a single row throws', async () => {
    const apps = makeSinglePageBuilder([app(1, { id: 'app-bad' }), app(2, { id: 'app-good' })])
    stubClient(apps, makeAiSummariesBuilder([]))

    enqueueApplicationMatchScoreMock.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    const result = await invoke({})

    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ enqueued: 1, errored: 1 })
  })

  // --- WR-01 -------------------------------------------------------------

  it('chunks BOTH `.in()` lists in the scored-pair pre-filter, not just the candidate list', async () => {
    // 120 rows with distinct candidates AND distinct jobs — the shape that
    // previously put every job id into one URL.
    const rows = Array.from({ length: 120 }, (_, i) => app(i))
    const apps = makeSinglePageBuilder(rows)
    const ai = makeAiSummariesBuilder([])
    stubClient(apps, ai)

    await invoke({})

    expect(ai.chunkCalls.length).toBeGreaterThan(1)
    for (const chunk of ai.chunkCalls) {
      // The bug was an unbounded job list; both must be bounded now.
      expect(chunk.candidateIds.length).toBeLessThanOrEqual(50)
      expect(chunk.jobIds.length).toBeLessThanOrEqual(50)
    }
  })

  it('fails CLOSED when a scored-pair lookup chunk errors — skips, never double-spends', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => app(i))
    const apps = makeSinglePageBuilder(rows)
    // First chunk (50 rows) errors; second chunk (10 rows) succeeds.
    const ai = makeAiSummariesBuilder([], { errorOnChunk: 0 })
    stubClient(apps, ai)

    const result = await invoke({})

    // The 50 rows in the failed chunk must NOT be enqueued — that was the
    // fail-open path that bought duplicate Sonnet calls across every org.
    expect(result.skippedUnknown).toBe(50)
    expect(result.enqueued).toBe(10)
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(10)
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('undetermined scored-ness'),
      expect.objectContaining({ level: 'warning' }),
    )
  })

  // --- WR-02 -------------------------------------------------------------

  it('caps ENQUEUES at 500 and reports the stop honestly when more remains', async () => {
    const pageOne = Array.from({ length: 500 }, (_, i) => app(i))
    const pageTwo = [app(500, { id: 'app-501' })]

    let served = 0
    const apps = makeApplicationsBuilder(() => {
      served++
      if (served === 1) return { data: pageOne, error: null }
      if (served === 2) return { data: pageTwo, error: null }
      return { data: [], error: null }
    })
    stubClient(apps, makeAiSummariesBuilder([]))

    const result = await invoke({})

    expect(result).toMatchObject({ truncated: true, enqueued: 500 })
    // The 501st row must be deferred to the next run, not enqueued.
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledTimes(500)
    expect(enqueueApplicationMatchScoreMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'app-501' }),
    )
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('more backlog remains'),
      expect.objectContaining({ level: 'warning' }),
    )
  })

  it('reports truncated:false when the backlog is exactly drained', async () => {
    // Exactly ENQUEUE_CAP unscored rows and nothing after them. The old
    // "row cap reached" warning fired here and read as "there is more to
    // do" on a sweep that had in fact finished.
    const rows = Array.from({ length: 500 }, (_, i) => app(i))
    const apps = makeSinglePageBuilder(rows)
    stubClient(apps, makeAiSummariesBuilder([]))

    const result = await invoke({})

    expect(result).toMatchObject({ truncated: false, enqueued: 500 })
    expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('more backlog remains'),
      expect.anything(),
    )
  })

  it('walks PAST a full page of already-scored rows to reach newer unscored ones', async () => {
    // The exact stuck case: the oldest 500 applications are all scored. The
    // old sweep enqueued zero here, forever, and never saw app-500.
    const scoredPage = Array.from({ length: 500 }, (_, i) => app(i))
    const newerPage = [app(500, { id: 'app-newer', candidate_id: 'cand-new', job_id: 'job-new' })]

    let served = 0
    const apps = makeApplicationsBuilder(() => {
      served++
      if (served === 1) return { data: scoredPage, error: null }
      if (served === 2) return { data: newerPage, error: null }
      return { data: [], error: null }
    })
    stubClient(
      apps,
      makeAiSummariesBuilder(
        scoredPage.map((r) => ({ candidate_id: r.candidate_id, job_id: r.job_id })),
      ),
    )

    const result = await invoke({})

    expect(result.skippedAlreadyScored).toBe(500)
    expect(result.enqueued).toBe(1)
    expect(enqueueApplicationMatchScoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: 'app-newer' }),
    )
    // Page 2 must have carried a cursor derived from page 1's last row.
    expect(apps.calls.pages[1]?.gte).toBe(scoredPage[499]?.created_at)
  })

  it('resumes from a created_after cursor on the event payload', async () => {
    const apps = makeSinglePageBuilder([app(1)])
    stubClient(apps, makeAiSummariesBuilder([]))

    await invoke({ created_after: '2026-02-01T00:00:00.000Z' })

    expect(apps.calls.gte).toContainEqual(['created_at', '2026-02-01T00:00:00.000Z'])
  })

  it('stops instead of spinning when every row on a page shares one created_at', async () => {
    // A bulk import inserted more than a page of applications inside one
    // transaction, so every row carries the same now() and the cursor
    // cannot advance. The `.gte` cursor re-reads them; the seen-set makes
    // that a no-progress page rather than an infinite loop.
    const tied = Array.from({ length: 500 }, (_, i) =>
      app(i, { created_at: '2026-03-01T00:00:00.000Z' }),
    )
    const apps = makeApplicationsBuilder(() => ({ data: tied, error: null }))
    stubClient(
      apps,
      makeAiSummariesBuilder(tied.map((r) => ({ candidate_id: r.candidate_id, job_id: r.job_id }))),
    )

    const result = await invoke({})

    expect(result.truncated).toBe(true)
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('created_at tie'),
      expect.objectContaining({ level: 'warning' }),
    )
  })

  it('stops and reports truncated when the applications read errors mid-scan', async () => {
    let served = 0
    const apps = makeApplicationsBuilder(() => {
      served++
      if (served === 1) {
        return { data: Array.from({ length: 500 }, (_, i) => app(i)), error: null }
      }
      return { data: null, error: { message: 'connection reset' } }
    })
    stubClient(apps, makeAiSummariesBuilder([]))

    const result = await invoke({})

    // Page 1 filled the enqueue cap, so it stops there — but a read error on
    // a later page must equally never be reported as a completed backlog.
    expect(result.truncated).toBe(true)
  })
})
