/**
 * @vitest-environment node
 *
 * listLatestMatchScoresForPairs + upsertMatchSummary — SF-3 pair
 * enrichment and the 23505-is-benign fix (Steele Charles feature review
 * 2026-07-31 Batch 2 Task 1, Step 4a/4b).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}))

import { listLatestMatchScoresForPairs, upsertMatchSummary } from '@/lib/db/ai-summaries'

type QueryResult = { data: unknown[] | null; error: unknown }

// Hand-rolled chainable stub matching the fluent .eq/.in/.order shape used
// by listLatestMatchScoresForPairs. `onQuery` lets a test assert whether
// the terminal call (order, which triggers the round-trip) actually fired.
function selectClientReturning(result: QueryResult, onQuery: () => void) {
  const chain = {
    eq: () => chain,
    in: () => chain,
    order: () => {
      onQuery()
      return Promise.resolve(result)
    },
  }
  return {
    from: () => ({
      select: () => chain,
    }),
  }
}

type EnrichmentClientArg = Parameters<typeof listLatestMatchScoresForPairs>[0]

describe('listLatestMatchScoresForPairs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an empty map without issuing a query for an empty pairs list', async () => {
    const onQuery = vi.fn()
    const client = selectClientReturning({ data: [], error: null }, onQuery)
    const result = await listLatestMatchScoresForPairs(
      client as unknown as EnrichmentClientArg,
      [],
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.size).toBe(0)
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('keys results by candidateId:jobId and drops cross-product rows outside the requested pairs', async () => {
    const rows = [
      {
        candidate_id: 'cand-1',
        job_id: 'job-1',
        content: {
          score: 80,
          strengths: ['great fit'],
          gaps: [],
          screening_questions: [],
          confidence: 'high',
        },
        created_at: '2026-08-01T00:00:00Z',
      },
      // Cross-product row: cand-1 x job-2 was never requested. The two
      // separate .in() filters return this row from Postgres, but it must
      // be filtered out client-side.
      {
        candidate_id: 'cand-1',
        job_id: 'job-2',
        content: { score: 50, strengths: [], gaps: [], screening_questions: [], confidence: 'low' },
        created_at: '2026-08-01T00:00:00Z',
      },
    ]
    const client = selectClientReturning({ data: rows, error: null }, vi.fn())
    const result = await listLatestMatchScoresForPairs(client as unknown as EnrichmentClientArg, [
      { candidateId: 'cand-1', jobId: 'job-1' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.size).toBe(1)
      expect(result.data.get('cand-1:job-1')).toEqual({ score: 80, note: 'great fit' })
      expect(result.data.has('cand-1:job-2')).toBe(false)
    }
  })

  it('keeps only the newest row per pair when several exist', async () => {
    const rows = [
      {
        candidate_id: 'cand-1',
        job_id: 'job-1',
        content: {
          score: 90,
          strengths: ['newest'],
          gaps: [],
          screening_questions: [],
          confidence: 'high',
        },
        created_at: '2026-08-02T00:00:00Z',
      },
      {
        candidate_id: 'cand-1',
        job_id: 'job-1',
        content: {
          score: 40,
          strengths: ['stale'],
          gaps: [],
          screening_questions: [],
          confidence: 'low',
        },
        created_at: '2026-08-01T00:00:00Z',
      },
    ]
    // Rows arrive newest-first, matching the real query's
    // .order('created_at', { ascending: false }).
    const client = selectClientReturning({ data: rows, error: null }, vi.fn())
    const result = await listLatestMatchScoresForPairs(client as unknown as EnrichmentClientArg, [
      { candidateId: 'cand-1', jobId: 'job-1' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.get('cand-1:job-1')).toEqual({ score: 90, note: 'newest' })
    }
  })
})

type UpsertClientArg = Parameters<typeof upsertMatchSummary>[0]
const UPSERT_INPUT = {
  candidateId: 'cand-1',
  jobId: 'job-1',
  candidateEmbeddingVersion: 1,
  jobEmbeddingVersion: 1,
  content: {
    score: 80,
    strengths: ['x'],
    gaps: [],
    screening_questions: [],
    confidence: 'high' as const,
  },
  model: 'claude-sonnet-4-6',
  costPence: 1,
  organizationId: 'org-1',
}

function insertClientReturning(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => result,
        }),
      }),
    }),
  }
}

describe('upsertMatchSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps a 23505 unique violation to code "duplicate" and does NOT log to Sentry', async () => {
    const client = insertClientReturning({
      data: null,
      error: { code: '23505', message: 'dup' },
    })
    const result = await upsertMatchSummary(client as unknown as UpsertClientArg, UPSERT_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('duplicate')
    expect(captureException).not.toHaveBeenCalled()
  })

  it('maps a non-23505 error to "internal" and captures it to Sentry', async () => {
    const client = insertClientReturning({
      data: null,
      error: { code: '23503', message: 'fk' },
    })
    const result = await upsertMatchSummary(client as unknown as UpsertClientArg, UPSERT_INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('internal')
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('returns ok with the row id on success', async () => {
    const client = insertClientReturning({ data: { id: 'sum-1' }, error: null })
    const result = await upsertMatchSummary(client as unknown as UpsertClientArg, UPSERT_INPUT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({ id: 'sum-1' })
    expect(captureException).not.toHaveBeenCalled()
  })
})
