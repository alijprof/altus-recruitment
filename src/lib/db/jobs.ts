import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Sort + filter shapes (server-side; URL search params drive these — D-14).
// ---------------------------------------------------------------------------

export type JobListSort = 'created_at' | 'title' | 'status'
export type ListDir = 'asc' | 'desc'
export type JobStatusFilter = Enums<'job_status'> | 'all'

export type ListJobsArgs = {
  q?: string
  sort?: JobListSort
  dir?: ListDir
  page?: number
  pageSize?: number
  statusFilter?: JobStatusFilter
}

export type JobListRow = Pick<
  Tables<'jobs'>,
  | 'id'
  | 'title'
  | 'status'
  | 'job_type'
  | 'hiring_context'
  | 'location'
  | 'salary_min'
  | 'salary_max'
  | 'currency'
  | 'company_id'
  | 'owner_user_id'
  | 'created_at'
> & {
  company_name: string | null
}

export type ListJobsResult = {
  rows: JobListRow[]
  total: number
  page: number
  pageSize: number
}

// ---------------------------------------------------------------------------
// Shared select shapes — keep tight so the table renderer's prop type is
// small. We join `companies(id, name)` everywhere we need the client name.
// ---------------------------------------------------------------------------

const LIST_SELECT_COLUMNS =
  'id, title, status, job_type, hiring_context, location, salary_min, salary_max, currency, company_id, owner_user_id, created_at, companies(id, name)'

type JoinedJobRow = Tables<'jobs'> & {
  companies: { id: string; name: string } | null
}

function shapeListRow(row: JoinedJobRow): JobListRow {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    job_type: row.job_type,
    hiring_context: row.hiring_context,
    location: row.location,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    currency: row.currency,
    company_id: row.company_id,
    owner_user_id: row.owner_user_id,
    created_at: row.created_at,
    company_name: row.companies?.name ?? null,
  }
}

/**
 * List jobs for the current tenant with optional title-trgm-style search,
 * sort, status filter, and offset pagination.
 *
 * D-15 defaults: sort = created_at DESC, statusFilter = 'open'.
 *
 * NOTE: there is no `search_jobs` RPC in Phase 1 — we keep the keyword path
 * inline via PostgREST `ilike` because Phase 1 jobs volumes are small. If
 * this gets hot in Phase 2, add a `search_jobs` RPC mirroring search_clients.
 */
export async function listJobs(
  supabase: SupabaseClient<Database>,
  args: ListJobsArgs = {},
): Promise<DbResult<ListJobsResult>> {
  const page = Math.max(1, args.page ?? 1)
  const pageSize = Math.max(1, Math.min(100, args.pageSize ?? 25))
  const offset = (page - 1) * pageSize
  const sort: JobListSort = args.sort ?? 'created_at'
  const dir: ListDir = args.dir ?? 'desc'
  const statusFilter: JobStatusFilter = args.statusFilter ?? 'open'
  const q = args.q?.trim()

  let query = supabase
    .from('jobs')
    .select(LIST_SELECT_COLUMNS, { count: 'exact' })

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  if (q && q.length >= 2) {
    query = query.ilike('title', `%${q}%`)
  }

  const { data, error, count } = await query
    .order(sort, { ascending: dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listJobs' } })
    return { ok: false, code: 'internal' }
  }

  const rows = ((data ?? []) as unknown as JoinedJobRow[]).map(shapeListRow)
  return {
    ok: true,
    data: { rows, total: count ?? 0, page, pageSize },
  }
}

/**
 * Single-job fetch with company name joined. Used by /jobs/[id] page +
 * /jobs/[id]/pipeline page.
 */
export type JobWithCompany = Tables<'jobs'> & {
  company_name: string | null
}

export async function getJob(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<DbResult<JobWithCompany>> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, companies(id, name)')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getJob' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }

  const joined = data as unknown as Tables<'jobs'> & {
    companies: { id: string; name: string } | null
  }
  return {
    ok: true,
    data: { ...joined, company_name: joined.companies?.name ?? null },
  }
}

/**
 * Used by the Plan 3 Jobs tab on /clients/[id]. Plain select — no search,
 * default sort by created_at DESC. Plan 4 takes over this helper from the
 * inline implementation that lived in client detail page during Plan 3.
 */
/**
 * Lightweight options helper for filter dropdowns (e.g., the global
 * /pipeline filter Popover). Returns open jobs only — closed ones
 * shouldn't pollute the filter UI.
 */
export type JobOption = { id: string; title: string }

export async function listOpenJobOptions(
  supabase: SupabaseClient<Database>,
): Promise<DbResult<JobOption[]>> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('status', 'open')
    .order('title', { ascending: true })

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listOpenJobOptions' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

export type JobForCompanyRow = Pick<
  Tables<'jobs'>,
  'id' | 'title' | 'status' | 'job_type' | 'hiring_context' | 'created_at'
>

export async function listJobsForCompany(
  supabase: SupabaseClient<Database>,
  companyId: string,
): Promise<DbResult<JobForCompanyRow[]>> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, status, job_type, hiring_context, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listJobsForCompany' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export type CreateJobInput = {
  company_id: string
  title: string
  job_type: Enums<'job_type'>
  hiring_context: Enums<'hiring_context'>
  location?: string | null
  // Plan 04-06 / Task 2 — REPORT-02: jobs.sector scalar (distinct from sector_tags text[]).
  sector?: string | null
  salary_min?: number | null
  salary_max?: number | null
  description?: string | null
  owner_user_id?: string | null
  status?: Enums<'job_status'>
}

/**
 * Insert a job. `organization_id` is set by the set_organization_id BEFORE
 * INSERT trigger. The cross-tenant FK guard
 * (20260517204500_cross_tenant_fk_guards.sql `jobs_same_org_check`)
 * automatically validates that company_id resolves to the same org — if it
 * doesn't, the trigger raises and the insert fails. No application-level org
 * filtering required.
 */
export async function createJob(
  supabase: SupabaseClient<Database>,
  input: CreateJobInput,
): Promise<DbResult<Tables<'jobs'>>> {
  // reason: TablesInsert<'jobs'> requires organization_id at the type level
  // because the generated types don't know about the BEFORE INSERT trigger
  // that fills it. Cast at the boundary; RLS WITH CHECK still enforces
  // correctness server-side.
  const insertPayload = {
    company_id: input.company_id,
    title: input.title,
    job_type: input.job_type,
    hiring_context: input.hiring_context,
    location: input.location ?? null,
    // Plan 04-06 / Task 2 — REPORT-02: persist sector scalar (NOT sector_tags).
    sector: input.sector ?? null,
    salary_min: input.salary_min ?? null,
    salary_max: input.salary_max ?? null,
    description: input.description ?? null,
    owner_user_id: input.owner_user_id ?? null,
    // Default to 'open' so the job appears in the default-filter list right
    // away. Recruiters create a job because they want to start filling it.
    status: input.status ?? ('open' as Enums<'job_status'>),
  } as unknown as TablesInsert<'jobs'>

  const { data, error } = await supabase
    .from('jobs')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createJob' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

export type UpdateJobPatch = Partial<
  Pick<
    TablesUpdate<'jobs'>,
    | 'title'
    | 'job_type'
    | 'hiring_context'
    | 'status'
    | 'location'
    // Plan 04-06 / Task 2 — REPORT-02: sector scalar for time-to-fill-by-sector RPC.
    | 'sector'
    | 'salary_min'
    | 'salary_max'
    | 'description'
    | 'owner_user_id'
  >
>

// ---------------------------------------------------------------------------
// Embedding helpers — Plan 1 Task 1.1.
// ---------------------------------------------------------------------------

export type JobForEmbedding = Pick<
  Tables<'jobs'>,
  | 'id'
  | 'organization_id'
  | 'title'
  | 'location'
  | 'job_type'
  | 'hiring_context'
  | 'salary_min'
  | 'salary_max'
  | 'currency'
  | 'description'
  | 'embedding_version'
>

const JOB_EMBED_SELECT_COLUMNS =
  'id, organization_id, title, location, job_type, hiring_context, salary_min, salary_max, currency, description, embedding_version'

/**
 * Fetch exactly the columns that feed into `jobEmbeddingText` + the
 * embedding_version counter for monotonic increments. Returns `not_found`
 * if the row was deleted between event dispatch + step.run.
 */
export async function getJobForEmbedding(
  supabase: SupabaseClient<Database>,
  jobId: string,
): Promise<DbResult<JobForEmbedding>> {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_EMBED_SELECT_COLUMNS)
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getJobForEmbedding' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data: data as unknown as JobForEmbedding }
}

export type BumpJobEmbeddingArgs = {
  jobId: string
  embedding: number[]
  embeddingVersion: number
}

/**
 * Write a freshly computed embedding back to the job row. Same shape as
 * bumpCandidateEmbedding — increments embedding_version + stamps
 * embedded_at = now() in a single UPDATE.
 */
export async function bumpJobEmbedding(
  supabase: SupabaseClient<Database>,
  args: BumpJobEmbeddingArgs,
): Promise<DbResult<{ id: string; embedding_version: number }>> {
  // reason: job_embedding is typed `unknown` in the generated Database type
  // (halfvec has no native TS shape). number[] is the canonical Voyage
  // output; supabase-js serialises it through PostgREST.
  const patch = {
    job_embedding: args.embedding,
    embedding_version: args.embeddingVersion,
    embedded_at: new Date().toISOString(),
  } as unknown as TablesUpdate<'jobs'>

  const { error } = await supabase
    .from('jobs')
    .update(patch)
    .eq('id', args.jobId)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'bumpJobEmbedding' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: args.jobId, embedding_version: args.embeddingVersion } }
}

export async function updateJob(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: UpdateJobPatch,
): Promise<DbResult<Tables<'jobs'>>> {
  const { data, error } = await supabase
    .from('jobs')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateJob' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}
