import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// job_ads helpers (Plan 03-04 Task D.2).
//
// Pattern per src/lib/db/ai-summaries.ts: cast the supabase client to a
// hand-shaped table client until `pnpm db:types` is regenerated against the
// cloud schema with the new migration (20260520020702_phase3_job_ads.sql).
//
// organization_id is filled by the `job_ads_set_org` BEFORE INSERT trigger —
// the insert payload MUST NOT include organization_id. The
// `job_ads_verify_same_org_check` trigger asserts the parent job belongs to
// the same org, so cross-tenant inserts always raise.
//
// D3-33: a job has multiple ads (no dedup) — every save is a new row, and
// listJobAdsForJob returns them newest-first.
// ---------------------------------------------------------------------------

export type JobAdRow = {
  id: string
  organization_id: string
  job_id: string
  created_by: string | null
  body_markdown: string
  inclusivity_score: number | null
  inclusivity_suggestions: unknown | null
  inclusivity_dimensions: unknown | null
  model: string
  cost_pence: number
  created_at: string
  updated_at: string
}

export type CreateJobAdInput = {
  job_id: string
  body_markdown: string
  inclusivity_score?: number | null
  // jsonb columns — typed loosely here; the wrapper writes the shape from
  // src/lib/ai/ad-generate.ts (InclusivitySuggestion[] / InclusivityDimensions).
  inclusivity_suggestions?: unknown | null
  inclusivity_dimensions?: unknown | null
  model: string
  cost_pence: number
  created_by?: string | null
}

type JobAdsTableClient = {
  from: (table: 'job_ads') => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{ data: JobAdRow[] | null; error: unknown }>
      }
    }
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>
      }
    }
  }
}

function asJobAdsClient(supabase: SupabaseClient<Database>): JobAdsTableClient {
  return supabase as unknown as JobAdsTableClient
}

/**
 * Insert a new job_ads row. Per the migration, `organization_id` is filled
 * by the `job_ads_set_org` BEFORE INSERT trigger — callers MUST NOT pass it.
 * The cross-tenant FK guard then asserts the parent job belongs to the same
 * org as the auto-filled organization_id.
 *
 * D3-33: multiple ads per job — no upsert / dedup logic here.
 */
export async function createJobAd(
  supabase: SupabaseClient<Database>,
  input: CreateJobAdInput,
): Promise<DbResult<{ id: string }>> {
  const payload: Record<string, unknown> = {
    job_id: input.job_id,
    body_markdown: input.body_markdown,
    inclusivity_score: input.inclusivity_score ?? null,
    inclusivity_suggestions: input.inclusivity_suggestions ?? null,
    inclusivity_dimensions: input.inclusivity_dimensions ?? null,
    model: input.model,
    cost_pence: input.cost_pence,
  }
  if (input.created_by !== undefined) {
    payload.created_by = input.created_by
  }

  const { data, error } = await asJobAdsClient(supabase)
    .from('job_ads')
    .insert(payload)
    .select('id')
    .single()

  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'createJobAd' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * List all ads for a given job, newest first. Backs the "Saved ads" section
 * on the job detail page. RLS scopes to the caller's org; the `.eq('job_id')`
 * filter narrows to the row's parent.
 */
export async function listJobAdsForJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<DbResult<JobAdRow[]>> {
  const { data, error } = await asJobAdsClient(supabase)
    .from('job_ads')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listJobAdsForJob' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}
