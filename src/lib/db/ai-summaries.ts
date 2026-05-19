import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// ai_summaries cache helpers (D2-07). The table itself is created in
// migration 20260519092944_ai_summaries.sql; the row is keyed on
// (organization_id, kind, candidate_id, job_id, candidate_embedding_version,
// job_embedding_version). organization_id is filled by the
// ai_summaries_set_org BEFORE INSERT trigger — callers MUST NOT pass it
// (the cross-tenant FK guard would reject any caller-supplied org).
// ---------------------------------------------------------------------------

export type MatchSummaryContent = {
  score: number
  strengths: string[]
  gaps: string[]
  screening_questions: string[]
  confidence: 'high' | 'medium' | 'low'
}

// reason: pending regen — Plan 0 Task 0.3 adds the ai_summaries table.
// Until `pnpm db:types` is run against the cloud schema with the new
// migrations applied, `Tables<'ai_summaries'>` is unknown to the generated
// type. We declare a precise row shape here and cast at the .from(...)
// boundary. Remove this manual shape (and the casts below) once the
// regenerated types contain ai_summaries.
export type MatchSummaryRow = {
  id: string
  organization_id: string
  kind: string
  candidate_id: string | null
  job_id: string | null
  candidate_embedding_version: number | null
  job_embedding_version: number | null
  content: MatchSummaryContent
  model: string
  cost_pence: number
  created_at: string
  expires_at: string | null
}

// Cast helper to keep the supabase-js type inference unblocked until regen.
// The supabase-js builder is fluent and each chained method returns a self-
// like type that exposes the next-step set of methods. Modelling the exact
// state machine in TS is more cost than benefit pre-regen, so we use a
// recursive any-self shape: every chained method returns `Chain<T>` which
// itself has `eq`, `order`, `limit`, `maybeSingle`, etc. The result types
// are pinned on the terminal `maybeSingle` / `single` / `limit` calls.
type SelectChain<T> = {
  eq: (col: string, val: unknown) => SelectChain<T>
  order: (col: string, opts: { ascending: boolean }) => SelectChain<T>
  limit: (n: number) => Promise<{ data: T[] | null; error: unknown }>
  maybeSingle: () => Promise<{ data: T | null; error: unknown }>
  single: () => Promise<{ data: T | null; error: unknown }>
} & PromiseLike<{ data: T[] | null; error: unknown }>

type AiSummariesTableClient = {
  from: (table: 'ai_summaries') => {
    select: (cols: string) => SelectChain<MatchSummaryRow>
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>
      }
    }
  }
}

function asAiSummariesClient(supabase: SupabaseClient<Database>): AiSummariesTableClient {
  return supabase as unknown as AiSummariesTableClient
}

/**
 * Cache read keyed on the full identity tuple. Returns null on miss
 * (NOT `{ ok: false, code: 'not_found' }`) so callers can distinguish
 * cache-miss (do the Sonnet call) from real errors.
 */
export async function getMatchSummary(
  supabase: SupabaseClient<Database>,
  args: {
    candidateId: string
    jobId: string
    candidateEmbeddingVersion: number
    jobEmbeddingVersion: number
  },
): Promise<DbResult<MatchSummaryRow | null>> {
  const { data, error } = await asAiSummariesClient(supabase)
    .from('ai_summaries')
    .select('*')
    .eq('kind', 'match_score')
    .eq('candidate_id', args.candidateId)
    .eq('job_id', args.jobId)
    .eq('candidate_embedding_version', args.candidateEmbeddingVersion)
    .eq('job_embedding_version', args.jobEmbeddingVersion)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getMatchSummary' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? null }
}

/**
 * Insert (or replace) a match summary. Uses a plain insert — the unique
 * constraint on (organization_id, kind, candidate_id, job_id,
 * candidate_embedding_version, job_embedding_version) makes duplicate
 * inserts a no-op at the DB level. Caller should treat a unique-violation
 * error as "cache already populated by a concurrent worker" rather than a
 * real failure. Plan 2 wires this into the precompute Inngest function.
 */
export async function upsertMatchSummary(
  supabase: SupabaseClient<Database>,
  input: {
    candidateId: string
    jobId: string
    candidateEmbeddingVersion: number
    jobEmbeddingVersion: number
    content: MatchSummaryContent
    model: string
    costPence: number
  },
): Promise<DbResult<{ id: string }>> {
  const { data, error } = await asAiSummariesClient(supabase)
    .from('ai_summaries')
    .insert({
      kind: 'match_score',
      candidate_id: input.candidateId,
      job_id: input.jobId,
      candidate_embedding_version: input.candidateEmbeddingVersion,
      job_embedding_version: input.jobEmbeddingVersion,
      content: input.content,
      model: input.model,
      cost_pence: input.costPence,
    })
    .select('id')
    .single()
  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'upsertMatchSummary' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * All match summaries for a given job, ordered newest first. Used by Plan
 * 2's /jobs/[id]/matches page; the page fetches candidate basics separately
 * by id (RSC parallel fetches) so no join here.
 */
export async function listMatchSummariesForJob(
  supabase: SupabaseClient<Database>,
  args: { jobId: string; limit?: number },
): Promise<DbResult<MatchSummaryRow[]>> {
  const { data, error } = await asAiSummariesClient(supabase)
    .from('ai_summaries')
    .select('*')
    .eq('kind', 'match_score')
    .eq('job_id', args.jobId)
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 50)
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listMatchSummariesForJob' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

// ---------------------------------------------------------------------------
// Plan 2 Task 2.1 — cost-ceiling helper + Task 2.3 — sweep helper.
//
// `getOrgMatchSpendThisMonth` reads month-to-date `ai_usage.cost_pence`
// for `purpose='match_score'` in the caller-supplied org. The precompute
// Inngest function calls it BEFORE scoring; if the result exceeds
// `MAX_MONTHLY_MATCH_SPEND_PENCE` (env-or-default) it bails with a
// Sentry warning.
//
// `deleteStaleMatchSummaries` is called by the weekly
// `cleanup-stale-summaries` Inngest function. The SQL uses two correlated
// `EXISTS` subqueries against `candidates` / `jobs` so a row is removed
// the moment either embedding version drifts past it. RLS is enforced at
// the underlying tables — the service-role client is the canonical caller
// (Inngest sweep), and the `using` clauses on the EXISTS subqueries are
// implicit (service-role bypasses RLS by design here).
// ---------------------------------------------------------------------------

type AiUsageSpendClient = {
  from: (table: 'ai_usage') => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => {
          gte: (col: string, val: unknown) => Promise<{
            data: Array<{ cost_pence: number | null }> | null
            error: unknown
          }>
        }
      }
    }
  }
}

function asAiUsageClient(supabase: SupabaseClient<Database>): AiUsageSpendClient {
  return supabase as unknown as AiUsageSpendClient
}

/**
 * Sum of `cost_pence` from `ai_usage` rows in the given org with
 * `purpose='match_score'`, for the current calendar month (UTC, derived
 * from `date_trunc('month', now())`). Returns pence as a plain number.
 *
 * Implementation: PostgREST doesn't expose `sum()` aggregates without an
 * RPC, so we select cost_pence for the matching rows and sum client-side.
 * At anchor scale (~5k rows/month worst case) the round-trip is fine; at
 * SaaS scale this should become an RPC.
 */
export async function getOrgMatchSpendThisMonth(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<DbResult<number>> {
  // ISO timestamp at the first of the current month, UTC.
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()

  const { data, error } = await asAiUsageClient(supabase)
    .from('ai_usage')
    .select('cost_pence')
    .eq('organization_id', orgId)
    .eq('purpose', 'match_score')
    .gte('created_at', monthStart)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getOrgMatchSpendThisMonth' },
    })
    return { ok: false, code: 'internal' }
  }
  const sum = (data ?? []).reduce((acc, row) => acc + (row.cost_pence ?? 0), 0)
  return { ok: true, data: sum }
}

type StaleSweepClient = {
  from: (table: 'ai_summaries' | 'candidates' | 'jobs') => {
    select: (
      cols: string,
    ) => {
      eq: (col: string, val: unknown) => Promise<{
        data: Array<{ id: string; embedding_version: number | null }> | null
        error: unknown
      }>
    } & Promise<{
      data: Array<{
        id: string
        candidate_id: string | null
        job_id: string | null
        candidate_embedding_version: number | null
        job_embedding_version: number | null
      }> | null
      error: unknown
    }>
    delete: () => {
      in: (col: string, vals: string[]) => Promise<{
        data: unknown
        error: unknown
      }>
    }
  }
}

/**
 * Sweep stale `match_score` rows in `ai_summaries`. A row is stale when
 * either (a) the referenced candidate has a higher current
 * `embedding_version` than the cached `candidate_embedding_version`, OR
 * (b) the referenced job has a higher current `embedding_version` than
 * the cached `job_embedding_version`.
 *
 * Implemented entirely in JS (no new migration) per Plan 2's "no new
 * migrations" rule. The Inngest function is weekly so the round-trip cost
 * is acceptable at anchor scale (<1k summaries).
 *
 * Caller MUST be the service-role client (the weekly cleanup function);
 * authenticated callers would be RLS-bounded and produce per-tenant
 * sweeps which is not what we want for the global cron.
 */
export async function deleteStaleMatchSummaries(
  supabase: SupabaseClient<Database>,
): Promise<DbResult<{ deleted: number }>> {
  const client = supabase as unknown as StaleSweepClient

  // 1) Fetch all match_score rows with their version columns. Tiny payload
  //    per row (5 cols * ~UUID size). At anchor scale this is <1MB.
  const summariesRes = await client
    .from('ai_summaries')
    .select(
      'id, candidate_id, job_id, candidate_embedding_version, job_embedding_version',
    )
  // The first overload of select() returns a Promise directly when no .eq()
  // is chained. The cast layers above accept either shape.
  // reason: supabase-js builder shape is too dynamic to model precisely; the
  // shape we use here is well-tested at runtime.
  const summaries = (
    summariesRes as unknown as {
      data: Array<{
        id: string
        candidate_id: string | null
        job_id: string | null
        candidate_embedding_version: number | null
        job_embedding_version: number | null
      }> | null
      error: unknown
    }
  )
  if (summaries.error) {
    Sentry.captureException(summaries.error, {
      tags: { layer: 'db', helper: 'deleteStaleMatchSummaries', subop: 'read-summaries' },
    })
    return { ok: false, code: 'internal' }
  }
  const rows = summaries.data ?? []
  if (rows.length === 0) return { ok: true, data: { deleted: 0 } }

  // 2) Bulk fetch current embedding_version for every referenced candidate/job.
  const candidateIds = Array.from(
    new Set(rows.map((r) => r.candidate_id).filter((v): v is string => Boolean(v))),
  )
  const jobIds = Array.from(
    new Set(rows.map((r) => r.job_id).filter((v): v is string => Boolean(v))),
  )

  const versionsClient = supabase as unknown as {
    from: (table: 'candidates' | 'jobs') => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{
          data: Array<{ id: string; embedding_version: number | null }> | null
          error: unknown
        }>
      }
    }
  }

  const candidateVersions = new Map<string, number>()
  if (candidateIds.length > 0) {
    const { data, error } = await versionsClient
      .from('candidates')
      .select('id, embedding_version')
      .in('id', candidateIds)
    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'db', helper: 'deleteStaleMatchSummaries', subop: 'read-candidates' },
      })
      return { ok: false, code: 'internal' }
    }
    for (const row of data ?? []) {
      candidateVersions.set(row.id, row.embedding_version ?? 0)
    }
  }

  const jobVersions = new Map<string, number>()
  if (jobIds.length > 0) {
    const { data, error } = await versionsClient
      .from('jobs')
      .select('id, embedding_version')
      .in('id', jobIds)
    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'db', helper: 'deleteStaleMatchSummaries', subop: 'read-jobs' },
      })
      return { ok: false, code: 'internal' }
    }
    for (const row of data ?? []) {
      jobVersions.set(row.id, row.embedding_version ?? 0)
    }
  }

  // 3) Decide which summary rows are stale.
  const staleIds: string[] = []
  for (const row of rows) {
    const candStale =
      row.candidate_id != null &&
      (candidateVersions.get(row.candidate_id) ?? 0) > (row.candidate_embedding_version ?? 0)
    const jobStale =
      row.job_id != null &&
      (jobVersions.get(row.job_id) ?? 0) > (row.job_embedding_version ?? 0)
    if (candStale || jobStale) staleIds.push(row.id)
  }

  if (staleIds.length === 0) return { ok: true, data: { deleted: 0 } }

  // 4) Bulk delete by primary key.
  const { error: deleteError } = await client
    .from('ai_summaries')
    .delete()
    .in('id', staleIds)
  if (deleteError) {
    Sentry.captureException(deleteError, {
      tags: { layer: 'db', helper: 'deleteStaleMatchSummaries', subop: 'delete' },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: { deleted: staleIds.length } }
}
