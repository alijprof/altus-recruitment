import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums, Tables, TablesInsert } from '@/types/database'

import {
  PIPELINE_STAGES,
  type ApplicationStage,
  type GroupedByStage,
  type PipelineCardData,
  type PipelineStage,
} from './pipeline-stages'
import type { DbResult } from './types'

// Re-export so existing server-side callers (server actions, RSC pages) can
// keep importing from '@/lib/db/applications'. Client components MUST import
// from '@/lib/db/pipeline-stages' directly to avoid pulling the 'server-only'
// boundary into the client bundle.
export {
  PIPELINE_STAGES,
  type ApplicationStage,
  type GroupedByStage,
  type PipelineCardData,
  type PipelineStage,
}

// Shape returned by the join — typed locally because PostgREST nested
// selects come back loosely typed when joined-tables aren't fully
// recognised by the generated Database type yet.
type JoinedApplicationRow = Tables<'applications'> & {
  candidates: {
    id: string
    full_name: string
    current_role_title: string | null
    current_company: string | null
  } | null
  jobs?: {
    id: string
    title: string
  } | null
}

// Review fix H2: include decline_reason so ApplicationsList can render the
// reason chip beside terminal-stage badges. Previously selected nowhere,
// so the conditional in applications-list.tsx was always false and the
// reason never displayed.
const APP_WITH_CANDIDATE_SELECT =
  'id, candidate_id, job_id, stage, stage_changed_at, decline_reason, organization_id, candidates(id, full_name, current_role_title, current_company)'

const APP_WITH_CANDIDATE_AND_JOB_SELECT =
  'id, candidate_id, job_id, stage, stage_changed_at, decline_reason, organization_id, candidates(id, full_name, current_role_title, current_company), jobs(id, title)'

const MS_PER_DAY = 86_400_000

function daysSince(iso: string, now: number = Date.now()): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / MS_PER_DAY))
}

function shapeCard(row: JoinedApplicationRow, now: number): PipelineCardData {
  return {
    id: row.id,
    candidate_id: row.candidate_id,
    candidate_name: row.candidates?.full_name ?? 'Unknown',
    current_role_title: row.candidates?.current_role_title ?? null,
    current_company: row.candidates?.current_company ?? null,
    stage: row.stage,
    stage_changed_at: row.stage_changed_at,
    days_in_stage: daysSince(row.stage_changed_at, now),
    job_id: row.job_id,
    job_title: row.jobs?.title ?? null,
    // Review fix H2: surface decline_reason so the per-job ApplicationsList
    // can render "(Withdrew)" / "(Position filled)" beside terminal rows.
    decline_reason: row.decline_reason,
  }
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

/**
 * Flat list of applications for a single candidate — used by the candidate
 * detail page's applications section. Includes terminal stages so the
 * recruiter sees the full history. Joined with jobs (title + client).
 */
export async function listApplicationsForCandidate(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<DbResult<PipelineCardData[]>> {
  const { data, error } = await supabase
    .from('applications')
    .select(APP_WITH_CANDIDATE_AND_JOB_SELECT)
    .eq('candidate_id', candidateId)
    .order('stage_changed_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listApplicationsForCandidate' },
    })
    return { ok: false, code: 'internal' }
  }

  const now = Date.now()
  const rows = ((data ?? []) as unknown as JoinedApplicationRow[]).map((r) =>
    shapeCard(r, now),
  )
  return { ok: true, data: rows }
}

/**
 * Flat list of applications for a single job — used by /jobs/[id]/page.tsx
 * applications table. Includes terminal stages (rejected/withdrawn) so the
 * recruiter can see the history.
 */
export async function listApplicationsForJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<DbResult<PipelineCardData[]>> {
  // D3-17: shortlists and floats live in their own tabs (/jobs/[id]/shortlist,
  // /candidates/[id]/floats, /floats) and MUST NOT appear in the per-job
  // applications table or the pipeline kanban. This `.eq` is the invariant
  // — the kanban-side `listApplicationsByStage` delegates to this helper.
  const { data, error } = await supabase
    .from('applications')
    .select(APP_WITH_CANDIDATE_SELECT)
    .eq('job_id', jobId)
    .eq('application_type', 'standard')
    .order('stage_changed_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listApplicationsForJob' },
    })
    return { ok: false, code: 'internal' }
  }

  const now = Date.now()
  const rows = ((data ?? []) as unknown as JoinedApplicationRow[]).map((r) =>
    shapeCard(r, now),
  )
  return { ok: true, data: rows }
}

function emptyGrouping(): GroupedByStage {
  const out = {} as GroupedByStage
  for (const s of PIPELINE_STAGES) out[s] = []
  return out
}

function groupByStage(cards: PipelineCardData[]): GroupedByStage {
  const out = emptyGrouping()
  for (const c of cards) {
    // Drop terminal stages from the kanban grouping — those are triggered
    // by the Reject action and not rendered as columns. RESEARCH §21 / D-10.
    if (c.stage === 'rejected' || c.stage === 'withdrawn') continue
    const key = c.stage as PipelineStage
    if (key in out) out[key].push(c)
  }
  return out
}

/**
 * Applications grouped by stage for one job — consumed by the per-job
 * pipeline kanban (/jobs/[id]/pipeline). Terminal stages are excluded so
 * the kanban only shows live cards.
 */
export async function listApplicationsByStage(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<DbResult<GroupedByStage>> {
  const list = await listApplicationsForJob(supabase, jobId)
  if (!list.ok) return list
  return { ok: true, data: groupByStage(list.data) }
}

/**
 * Aggregated pipeline for /pipeline (D-12). URL search params drive the
 * three optional filters; absent filters mean "all open jobs in this org".
 */
export type AllApplicationsFilters = {
  ownerId?: string | null
  jobId?: string | null
  clientId?: string | null
}

export async function listAllApplicationsByStage(
  supabase: SupabaseClient<Database>,
  filters: AllApplicationsFilters = {},
): Promise<DbResult<GroupedByStage>> {
  // Only show cards attached to OPEN jobs by default — closed/cancelled
  // jobs shouldn't pollute the global board. The recruiter filter UI in
  // the page lets you override via URL params.
  // We do a two-step fetch: first the job ids matching the filters, then
  // the applications. Keeps the query simple and avoids juggling deeply
  // nested PostgREST filters across joins.
  let jobsQuery = supabase.from('jobs').select('id').eq('status', 'open')
  if (filters.jobId) {
    jobsQuery = jobsQuery.eq('id', filters.jobId)
  }
  if (filters.clientId) {
    jobsQuery = jobsQuery.eq('company_id', filters.clientId)
  }

  const { data: jobsData, error: jobsError } = await jobsQuery
  if (jobsError) {
    Sentry.captureException(jobsError, {
      tags: { layer: 'db', helper: 'listAllApplicationsByStage.jobs' },
    })
    return { ok: false, code: 'internal' }
  }
  const jobIds = (jobsData ?? []).map((j) => j.id)
  if (jobIds.length === 0) return { ok: true, data: emptyGrouping() }

  // D3-17: shortlists and floats live in their own tabs and MUST NOT appear
  // in the global pipeline kanban (/pipeline). This filter is the invariant.
  // The applications_pipeline-filter test asserts the `.eq` is present.
  let appsQuery = supabase
    .from('applications')
    .select(APP_WITH_CANDIDATE_AND_JOB_SELECT)
    .in('job_id', jobIds)
    .eq('application_type', 'standard')

  if (filters.ownerId) {
    appsQuery = appsQuery.eq('owner_user_id', filters.ownerId)
  }

  const { data, error } = await appsQuery.order('stage_changed_at', {
    ascending: false,
  })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listAllApplicationsByStage.apps' },
    })
    return { ok: false, code: 'internal' }
  }

  const now = Date.now()
  const cards = ((data ?? []) as unknown as JoinedApplicationRow[]).map((r) =>
    shapeCard(r, now),
  )
  return { ok: true, data: groupByStage(cards) }
}

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------

export type CreateApplicationInput = {
  jobId: string
  candidateId: string
  applicationType?: Enums<'application_type'>
}

/**
 * Add a candidate to a job (default stage = 'applied'). The cross-tenant FK
 * guard (applications_same_org_check) automatically validates that both
 * candidate_id and job_id belong to the same org — no manual org filter
 * needed. The unique constraint (candidate_id, job_id, application_type)
 * prevents duplicate applications for the same candidate on the same job
 * with the same type.
 */
export async function createApplication(
  supabase: SupabaseClient<Database>,
  input: CreateApplicationInput,
): Promise<DbResult<Tables<'applications'>>> {
  // reason: TablesInsert<'applications'> requires organization_id at the
  // type level; the BEFORE INSERT trigger fills it from the session context.
  const payload = {
    job_id: input.jobId,
    candidate_id: input.candidateId,
    application_type:
      input.applicationType ?? ('standard' as Enums<'application_type'>),
  } as unknown as TablesInsert<'applications'>

  const { data, error } = await supabase
    .from('applications')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'createApplication' },
    })
    // 23505 = unique violation (duplicate application).
    const pgErr = error as { code?: string }
    if (pgErr.code === '23505') {
      return { ok: false, code: 'internal' }
    }
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// move_application RPC wrapper. The actual UPDATE + activity INSERT happen
// atomically inside the Postgres function created by
// 20260518201900_move_application_function.sql. This helper is the only
// app-side entry point — callers (the server action) wrap it for error
// shaping. RLS still applies because the function is SECURITY INVOKER.
// ---------------------------------------------------------------------------

export type MoveApplicationArgs = {
  applicationId: string
  toStage: ApplicationStage
  declineReason?: Enums<'decline_reason'> | null
  declineNotes?: string | null
  actorUserId?: string | null
}

export async function moveApplication(
  supabase: SupabaseClient<Database>,
  args: MoveApplicationArgs,
): Promise<DbResult<{ applicationId: string }>> {
  // reason: move_application is added by 20260518201900_move_application_function.sql
  // and not yet in the generated Database['public']['Functions'] map. Cast
  // through unknown to avoid hand-rolling the entire RPC schema.
  const supabaseUntyped = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  }

  const { error } = await supabaseUntyped.rpc('move_application', {
    p_application_id: args.applicationId,
    p_to_stage: args.toStage,
    p_decline_reason: args.declineReason ?? null,
    p_decline_notes: args.declineNotes ?? null,
    p_actor_user_id: args.actorUserId ?? null,
  })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'moveApplication' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { applicationId: args.applicationId } }
}
