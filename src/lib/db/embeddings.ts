import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Hybrid-search RPC helpers. Wraps `match_candidates` and `match_jobs` (RRF
// over pgvector cosine + pg_trgm trigram). Plan 1 wires these into
// listCandidates / search UI; Plan 2's precompute Inngest function uses
// getTopCandidatesByVector for the "top-N by similarity to this job" path.
//
// All helpers follow the canonical shape established in
// src/lib/db/candidate-cvs.ts: DbResult<T>, Sentry capture with
// `layer: 'db'` tag, RLS does the tenant gating (security invoker on the
// RPCs).
// ---------------------------------------------------------------------------

export type HybridCandidateRow = {
  id: string
  full_name: string
  current_role_title: string | null
  current_company: string | null
  location: string | null
  market_status: Enums<'market_status'>
  cosine_similarity: number
  trigram_similarity: number
  rrf_score: number
}

export type HybridJobRow = {
  id: string
  title: string
  location: string | null
  job_type: Enums<'job_type'>
  status: Enums<'job_status'>
  salary_min: number | null
  salary_max: number | null
  currency: string
  company_id: string
  cosine_similarity: number
  trigram_similarity: number
  rrf_score: number
}

// reason: pending regen — Plan 0 Task 0.4 adds `match_candidates` and
// `match_jobs` RPCs. Until `pnpm db:types` is run against the cloud
// schema, the generated Database type doesn't include them, so we cast
// the supabase client at the .rpc() call site. Casts will disappear once
// the user runs `supabase gen types --linked` after pushing the
// migrations.
type RpcClient = SupabaseClient<Database> & {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>
}

const HYBRID_DEFAULT_MATCH_COUNT = 25
const HYBRID_DEFAULT_MIN_COSINE = 0.5

export type HybridSearchArgs = {
  queryText: string
  queryEmbedding: number[]
  matchCount?: number
  minCosineSimilarity?: number
}

/**
 * RRF-blended candidate search. Returns up to `matchCount` rows ordered by
 * `rrf_score` desc. Empty result is a valid outcome (no candidates above
 * the cosine threshold AND no trigram matches > 0.3) — caller distinguishes
 * empty from error via `result.ok && result.data.length === 0`.
 */
export async function hybridSearchCandidates(
  supabase: SupabaseClient<Database>,
  args: HybridSearchArgs,
): Promise<DbResult<HybridCandidateRow[]>> {
  const client = supabase as RpcClient
  const { data, error } = await client.rpc('match_candidates', {
    p_query_text: args.queryText,
    p_query_embedding: args.queryEmbedding,
    p_match_count: args.matchCount ?? HYBRID_DEFAULT_MATCH_COUNT,
    p_min_cosine_similarity: args.minCosineSimilarity ?? HYBRID_DEFAULT_MIN_COSINE,
  })
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'hybridSearchCandidates' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: (data as HybridCandidateRow[] | null) ?? [] }
}

/**
 * RRF-blended job search. Same shape as hybridSearchCandidates but against
 * the jobs table; trigram path is `jobs.title` only (D2-04 + RESEARCH
 * §A.4).
 */
export async function hybridSearchJobs(
  supabase: SupabaseClient<Database>,
  args: HybridSearchArgs,
): Promise<DbResult<HybridJobRow[]>> {
  const client = supabase as RpcClient
  const { data, error } = await client.rpc('match_jobs', {
    p_query_text: args.queryText,
    p_query_embedding: args.queryEmbedding,
    p_match_count: args.matchCount ?? HYBRID_DEFAULT_MATCH_COUNT,
    p_min_cosine_similarity: args.minCosineSimilarity ?? HYBRID_DEFAULT_MIN_COSINE,
  })
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'hybridSearchJobs' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: (data as HybridJobRow[] | null) ?? [] }
}

/**
 * Count candidates in the current tenant whose embedding is null. Used by
 * the /search page nudge ("N candidates haven't been embedded yet") and by
 * /settings/integrations to decide whether to surface the Backfill button.
 *
 * RLS scopes this to the current org naturally.
 */
export async function countCandidatesWithoutEmbedding(
  supabase: SupabaseClient<Database>,
): Promise<DbResult<number>> {
  const { count, error } = await supabase
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .is('candidate_embedding', null)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'countCandidatesWithoutEmbedding' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: count ?? 0 }
}

/**
 * Top-N candidates by vector similarity to a specific job's embedding.
 * Used by Plan 2's precompute Inngest function for batch match scoring.
 *
 * Implementation note: this calls `match_candidates` with an empty query
 * text and minCosineSimilarity = 0. The trigram path returns no rows
 * (empty text doesn't match), so the result is degenerate vector-only
 * ranking. If the job has no embedding yet, returns an empty list (the
 * caller should re-queue once the embed sweep populates the embedding).
 */
export async function getTopCandidatesByVector(
  supabase: SupabaseClient<Database>,
  args: { jobEmbedding: number[]; limit?: number },
): Promise<DbResult<HybridCandidateRow[]>> {
  // Empty job embedding (job hasn't been embedded yet) → no work to do.
  if (args.jobEmbedding.length === 0) {
    return { ok: true, data: [] }
  }
  return hybridSearchCandidates(supabase, {
    queryText: '',
    queryEmbedding: args.jobEmbedding,
    matchCount: args.limit ?? 10,
    minCosineSimilarity: 0,
  })
}

// ---------------------------------------------------------------------------
// Plan 2 Task 2.1 — embedding-version readers used by the match cache key.
//
// The cached `ai_summaries.candidate_embedding_version` and
// `job_embedding_version` columns are part of the unique key. To do a cache
// lookup, both the precompute Inngest function and the on-demand explain
// action need the CURRENT version from the source rows. These helpers
// return `0` when the column is NULL (a candidate / job that has never
// been embedded) so callers don't have to handle the nullable themselves.
// ---------------------------------------------------------------------------

/**
 * Read `candidates.embedding_version` for a single id. Returns `0` if the
 * candidate has never been embedded (the NULL case). `not_found` when the
 * row doesn't exist — caller should treat as "candidate gone, skip".
 */
export async function getCandidateEmbeddingVersion(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<DbResult<number>> {
  const { data, error } = await supabase
    .from('candidates')
    .select('embedding_version')
    .eq('id', candidateId)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getCandidateEmbeddingVersion' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data: data.embedding_version ?? 0 }
}

/**
 * Bulk variant — returns a Map of `candidateId → embedding_version` for
 * the supplied ids. Missing ids (deleted candidates) map to `0`. Used by
 * Plan 2's matches page to evaluate cache-staleness for the top-10
 * candidates in a single round-trip.
 */
export async function listCandidateEmbeddingVersionsByIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<DbResult<Map<string, number>>> {
  if (ids.length === 0) return { ok: true, data: new Map() }
  const { data, error } = await supabase
    .from('candidates')
    .select('id, embedding_version')
    .in('id', ids)
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listCandidateEmbeddingVersionsByIds' },
    })
    return { ok: false, code: 'internal' }
  }
  const out = new Map<string, number>()
  for (const row of data ?? []) {
    out.set(row.id, row.embedding_version ?? 0)
  }
  return { ok: true, data: out }
}

/**
 * Read `jobs.embedding_version` for a single id. Same semantics as
 * `getCandidateEmbeddingVersion`.
 */
export async function getJobEmbeddingVersion(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<DbResult<number>> {
  const { data, error } = await supabase
    .from('jobs')
    .select('embedding_version')
    .eq('id', jobId)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getJobEmbeddingVersion' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data: data.embedding_version ?? 0 }
}

/**
 * Plan 1 Task 1.3 — top candidates for a job by vector similarity, reading
 * the job's embedding server-side via the `match_candidates_for_job` RPC.
 *
 * Returns an empty array when the job has no embedding yet (caller should
 * surface a "not yet indexed" banner and wait for the embed sweep).
 *
 * reason: match_candidates_for_job is added by migration 20260519111500
 * which is not in the generated types yet (the user must run
 * `pnpm db:types` after pushing). The cast at the .rpc() boundary follows
 * the same pattern as hybridSearchCandidates above and disappears once the
 * generated types catch up.
 */
export async function getTopCandidatesForJob(
  supabase: SupabaseClient<Database>,
  args: { jobId: string; limit?: number },
): Promise<DbResult<HybridCandidateRow[]>> {
  const client = supabase as RpcClient
  const { data, error } = await client.rpc('match_candidates_for_job', {
    p_job_id: args.jobId,
    p_match_count: args.limit ?? 10,
  })
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getTopCandidatesForJob' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: (data as HybridCandidateRow[] | null) ?? [] }
}
