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
