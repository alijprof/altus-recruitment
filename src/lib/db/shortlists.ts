import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums } from '@/types/database'

import type { DbResult } from './types'

// Joined-row shape returned by listShortlistForJob / listFloatsForCandidate /
// listAllFloats. Mirrors APP_WITH_CANDIDATE_AND_JOB_SELECT from applications.ts
// but enriched with email so the per-job Shortlist tab and per-candidate
// Floats list can render contact context without a second roundtrip.
const SHORTLIST_SELECT =
  'id, candidate_id, job_id, application_type, stage, stage_changed_at, owner_user_id, created_at, organization_id, ' +
  'candidates(id, full_name, current_role_title, current_company, email), ' +
  'jobs(id, title)'

export type ShortlistRow = {
  id: string
  candidate_id: string
  job_id: string | null
  application_type: Enums<'application_type'>
  stage: Enums<'application_stage'>
  stage_changed_at: string
  owner_user_id: string | null
  created_at: string
  organization_id: string
  candidate: {
    id: string
    full_name: string
    current_role_title: string | null
    current_company: string | null
    email: string | null
  } | null
  job: { id: string; title: string } | null
}

type JoinedRow = {
  id: string
  candidate_id: string
  job_id: string | null
  application_type: Enums<'application_type'>
  stage: Enums<'application_stage'>
  stage_changed_at: string
  owner_user_id: string | null
  created_at: string
  organization_id: string
  candidates: ShortlistRow['candidate']
  jobs: ShortlistRow['job']
}

function shapeRow(row: JoinedRow): ShortlistRow {
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    job_id: row.job_id,
    application_type: row.application_type,
    stage: row.stage,
    stage_changed_at: row.stage_changed_at,
    owner_user_id: row.owner_user_id,
    created_at: row.created_at,
    organization_id: row.organization_id,
    candidate: row.candidates,
    job: row.jobs,
  }
}

/**
 * Per-job shortlist tab data. Returns ONLY rows with
 * application_type='shortlist' attached to the given job. RLS scopes to the
 * caller's org; the `.eq('application_type', 'shortlist')` filter keeps
 * standard / float / spec rows out of the shortlist view (D3-16 / D3-17).
 */
export async function listShortlistForJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<DbResult<ShortlistRow[]>> {
  const { data, error } = await supabase
    .from('applications')
    .select(SHORTLIST_SELECT)
    .eq('job_id', jobId)
    .eq('application_type', 'shortlist')
    .order('created_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listShortlistForJob' },
    })
    return { ok: false, code: 'internal' }
  }
  const rows = ((data ?? []) as unknown as JoinedRow[]).map(shapeRow)
  return { ok: true, data: rows }
}

/**
 * Per-candidate floats list. Only rows with application_type='float' AND
 * job_id IS NULL (D3-18). The CHECK constraint
 * `applications_job_id_required_unless_float` is the authority on the
 * (type, job_id) invariant — this filter is the query-side mirror.
 */
export async function listFloatsForCandidate(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<DbResult<ShortlistRow[]>> {
  const { data, error } = await supabase
    .from('applications')
    .select(SHORTLIST_SELECT)
    .eq('candidate_id', candidateId)
    .eq('application_type', 'float')
    .is('job_id', null)
    .order('created_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listFloatsForCandidate' },
    })
    return { ok: false, code: 'internal' }
  }
  const rows = ((data ?? []) as unknown as JoinedRow[]).map(shapeRow)
  return { ok: true, data: rows }
}

/**
 * Org-wide floats list — backs /floats. RLS scopes to the caller's org. The
 * optional `ownerId` narrows to floats owned by a single user (the
 * D3-29 "mine only" toggle is a UI hint, not a security control).
 */
export async function listAllFloats(
  supabase: SupabaseClient<Database>,
  opts: { ownerId?: string | null } = {},
): Promise<DbResult<ShortlistRow[]>> {
  let query = supabase
    .from('applications')
    .select(SHORTLIST_SELECT)
    .eq('application_type', 'float')
    .is('job_id', null)

  if (opts.ownerId) {
    query = query.eq('owner_user_id', opts.ownerId)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listAllFloats' },
    })
    return { ok: false, code: 'internal' }
  }
  const rows = ((data ?? []) as unknown as JoinedRow[]).map(shapeRow)
  return { ok: true, data: rows }
}
