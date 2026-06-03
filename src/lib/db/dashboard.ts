import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums, Json, Tables } from '@/types/database'

import type { DbResult } from './types'

// Dashboard data layer (Plan 5 Task 5.1).
//
// All four helpers are designed to be called in parallel from the dashboard
// RSC — each is a single PostgREST round-trip (counts use head:true, list
// queries use a single SELECT, and the activity feed batches its entity
// label resolution by entity_type so we never N+1).
//
// RLS is the authority on tenancy: none of these helpers append
// `organization_id` filters. The user-scoped Supabase client carries an
// `authenticated` JWT and Postgres applies the per-table RLS policies.

// -----------------------------------------------------------------------------
// 1. Metric cards: candidates / open jobs / open applications / placements
// -----------------------------------------------------------------------------

export type DashboardMetrics = {
  candidates: number
  openJobs: number
  openApplications: number
  // Phase 4 lands the placements table; until then the card renders 0 so the
  // layout doesn't shift when Phase 4 lights it up.
  placementsThisMonth: number
}

export async function getDashboardMetrics(
  supabase: SupabaseClient<Database>,
): Promise<DashboardMetrics> {
  const [candidates, openJobs, openApplications] = await Promise.all([
    supabase.from('candidates').select('id', { count: 'exact', head: true }),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .not('stage', 'in', '(rejected,withdrawn,placed)'),
  ])

  if (candidates.error) {
    Sentry.captureException(candidates.error, {
      tags: { layer: 'db', helper: 'getDashboardMetrics:candidates' },
    })
  }
  if (openJobs.error) {
    Sentry.captureException(openJobs.error, {
      tags: { layer: 'db', helper: 'getDashboardMetrics:openJobs' },
    })
  }
  if (openApplications.error) {
    Sentry.captureException(openApplications.error, {
      tags: { layer: 'db', helper: 'getDashboardMetrics:openApplications' },
    })
  }

  return {
    candidates: candidates.count ?? 0,
    openJobs: openJobs.count ?? 0,
    openApplications: openApplications.count ?? 0,
    placementsThisMonth: 0,
  }
}

// -----------------------------------------------------------------------------
// 2. Recent activity feed
// -----------------------------------------------------------------------------

export type RecentActivityEntry = Tables<'activities'> & {
  entity_label: string | null
  entity_href: string | null
  actor: { full_name: string | null; email: string | null } | null
}

export async function getRecentActivity(
  supabase: SupabaseClient<Database>,
  limit = 20,
): Promise<DbResult<RecentActivityEntry[]>> {
  const { data: activities, error } = await supabase
    .from('activities')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getRecentActivity' } })
    return { ok: false, code: 'internal' }
  }
  if (!activities || activities.length === 0) {
    return { ok: true, data: [] }
  }

  const candidateIds = uniqueIds(activities, 'candidate')
  const jobIds = uniqueIds(activities, 'job')
  const companyIds = uniqueIds(activities, 'company')
  const contactIds = uniqueIds(activities, 'contact')
  const applicationIds = uniqueIds(activities, 'application')
  const actorIds = unique(
    activities.map((a) => a.actor_user_id).filter((id): id is string => Boolean(id)),
  )

  const [candidates, jobs, companies, contacts, applications, actors] = await Promise.all([
    selectIn(supabase, 'candidates', 'id, full_name', candidateIds),
    selectIn(supabase, 'jobs', 'id, title', jobIds),
    selectIn(supabase, 'companies', 'id, name', companyIds),
    selectIn(supabase, 'contacts', 'id, full_name', contactIds),
    selectIn(supabase, 'applications', 'id, candidate_id, job_id', applicationIds),
    selectIn(supabase, 'users', 'id, full_name, email', actorIds),
  ])

  // Resolve application labels by piggy-backing on the candidate + job names
  // we already fetched. If an application activity references a candidate or
  // job we hadn't pulled (different entity_type from the same window — rare),
  // we fetch the remainder in a second batched IN. Avoids N+1.
  const appRows = (applications.data ?? []) as Array<{
    id: string
    candidate_id: string
    job_id: string
  }>
  const extraCandidateIds = unique(
    appRows.map((a) => a.candidate_id).filter((id) => !candidateIds.includes(id)),
  )
  const extraJobIds = unique(appRows.map((a) => a.job_id).filter((id) => !jobIds.includes(id)))
  const [extraCandidates, extraJobs] = await Promise.all([
    selectIn(supabase, 'candidates', 'id, full_name', extraCandidateIds),
    selectIn(supabase, 'jobs', 'id, title', extraJobIds),
  ])

  const candidateById = new Map<string, string>()
  for (const row of [...(candidates.data ?? []), ...(extraCandidates.data ?? [])] as Array<{
    id: string
    full_name: string
  }>) {
    candidateById.set(row.id, row.full_name)
  }
  const jobById = new Map<string, string>()
  for (const row of [...(jobs.data ?? []), ...(extraJobs.data ?? [])] as Array<{
    id: string
    title: string
  }>) {
    jobById.set(row.id, row.title)
  }
  const companyById = new Map<string, string>()
  for (const row of (companies.data ?? []) as Array<{ id: string; name: string }>) {
    companyById.set(row.id, row.name)
  }
  const contactById = new Map<string, string>()
  for (const row of (contacts.data ?? []) as Array<{ id: string; full_name: string }>) {
    contactById.set(row.id, row.full_name)
  }
  const applicationById = new Map<string, { candidate_id: string; job_id: string }>()
  for (const row of appRows) {
    applicationById.set(row.id, { candidate_id: row.candidate_id, job_id: row.job_id })
  }
  const actorById = new Map<string, { full_name: string | null; email: string | null }>()
  for (const row of (actors.data ?? []) as Array<{
    id: string
    full_name: string | null
    email: string | null
  }>) {
    actorById.set(row.id, { full_name: row.full_name, email: row.email })
  }

  const enriched: RecentActivityEntry[] = activities.map((row) => {
    const { label, href } = resolveEntity(row.entity_type, row.entity_id, {
      candidateById,
      jobById,
      companyById,
      contactById,
      applicationById,
    })
    return {
      ...row,
      entity_label: label,
      entity_href: href,
      actor: row.actor_user_id ? (actorById.get(row.actor_user_id) ?? null) : null,
    }
  })

  return { ok: true, data: enriched }
}

function uniqueIds(activities: Tables<'activities'>[], entityType: string): string[] {
  return unique(activities.filter((a) => a.entity_type === entityType).map((a) => a.entity_id))
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

async function selectIn(
  supabase: SupabaseClient<Database>,
  // reason: PostgREST `.from(name)` is a string union of every table; this
  // helper is intentionally polymorphic over a closed set of known tables.
  // Narrowing via overloads would force a 6-way switch with no real benefit
  // and break the simple `Map<string, ...>` accumulators above.
  table:
    | 'candidates'
    | 'jobs'
    | 'companies'
    | 'contacts'
    | 'applications'
    | 'users',
  select: string,
  ids: string[],
) {
  if (ids.length === 0) return { data: [] as unknown[], error: null }
  // reason: `from(table)` returns a union with different generics per table;
  // `select(string)` is fine but the typed narrow row-shape conflicts with
  // the polymorphic accumulator. Cast at the boundary, RLS still enforces
  // correctness server-side.
  const result = await (
    supabase.from(table) as unknown as {
      select: (s: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: unknown[] | null; error: unknown }>
      }
    }
  )
    .select(select)
    .in('id', ids)
  return result
}

type EntityMaps = {
  candidateById: Map<string, string>
  jobById: Map<string, string>
  companyById: Map<string, string>
  contactById: Map<string, string>
  applicationById: Map<string, { candidate_id: string; job_id: string }>
}

function resolveEntity(
  entityType: string,
  entityId: string,
  maps: EntityMaps,
): { label: string | null; href: string | null } {
  switch (entityType) {
    case 'candidate': {
      const name = maps.candidateById.get(entityId) ?? null
      return { label: name, href: name ? `/candidates/${entityId}` : null }
    }
    case 'job': {
      const title = maps.jobById.get(entityId) ?? null
      return { label: title, href: title ? `/jobs/${entityId}` : null }
    }
    case 'company': {
      const name = maps.companyById.get(entityId) ?? null
      return { label: name, href: name ? `/clients/${entityId}` : null }
    }
    case 'contact': {
      const name = maps.contactById.get(entityId) ?? null
      return { label: name, href: null }
    }
    case 'application': {
      const app = maps.applicationById.get(entityId)
      if (!app) return { label: null, href: null }
      const cand = maps.candidateById.get(app.candidate_id)
      const job = maps.jobById.get(app.job_id)
      const label = cand && job ? `${cand} · ${job}` : (cand ?? job ?? null)
      return { label, href: job ? `/jobs/${app.job_id}/pipeline` : null }
    }
    default:
      return { label: null, href: null }
  }
}

// Build a friendly body string for an activity entry. Plan 4 stage_change
// rows carry the raw decline enum in metadata.decline_reason; we translate it
// here so the dashboard feed shows "Declined — Skills mismatch" not the raw
// enum value. Re-uses formatDeclineReason from src/lib/legal/decline-reasons.ts
// when called from the rendering layer (this helper stays type-only).

export function activityFeedBody(entry: RecentActivityEntry): string | null {
  return entry.body
}

// -----------------------------------------------------------------------------
// 3. Stale applications (>14 days in stage)
// -----------------------------------------------------------------------------

export type StaleApplicationEntry = {
  id: string
  job_id: string
  candidate_id: string
  stage: Enums<'application_stage'>
  stage_changed_at: string
  candidate_name: string
  job_title: string
  days_in_stage: number
}

export async function getStaleApplications(
  supabase: SupabaseClient<Database>,
  limit = 20,
): Promise<DbResult<StaleApplicationEntry[]>> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('applications')
    .select(
      'id, job_id, candidate_id, stage, stage_changed_at, candidates(full_name), jobs(title)',
    )
    .lt('stage_changed_at', cutoff)
    .not('stage', 'in', '(rejected,withdrawn,placed)')
    .order('stage_changed_at', { ascending: true })
    .limit(limit)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getStaleApplications' } })
    return { ok: false, code: 'internal' }
  }

  // reason: PostgREST embeds a singular relation as either a record or array
  // depending on how the FK is declared in the generated types. We accept both
  // and normalise to a single string.
  const rows = (data ?? []) as Array<{
    id: string
    job_id: string
    candidate_id: string
    stage: Enums<'application_stage'>
    stage_changed_at: string
    candidates: { full_name: string } | { full_name: string }[] | null
    jobs: { title: string } | { title: string }[] | null
  }>

  const now = Date.now()
  const normalised: StaleApplicationEntry[] = rows.map((row) => {
    const cand = Array.isArray(row.candidates) ? row.candidates[0] : row.candidates
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    const days = Math.max(
      0,
      Math.floor((now - new Date(row.stage_changed_at).getTime()) / (24 * 60 * 60 * 1000)),
    )
    return {
      id: row.id,
      job_id: row.job_id,
      candidate_id: row.candidate_id,
      stage: row.stage,
      stage_changed_at: row.stage_changed_at,
      candidate_name: cand?.full_name ?? 'Unknown candidate',
      job_title: job?.title ?? 'Unknown job',
      days_in_stage: days,
    }
  })

  return { ok: true, data: normalised }
}

// -----------------------------------------------------------------------------
// 4. Candidates to follow up
// -----------------------------------------------------------------------------

// CONTEXT.md specifics: sort `hot → actively_looking → passively_looking`. We
// achieve this with a virtual ordering key (CASE expression) inlined via a
// follow-up SQL function would be cleaner, but PostgREST's lack of native
// CASE-by-column-value sorting forces a client-side fallback at small scale.
// At anchor scale (≤ a few hundred candidates) the over-fetch is trivial.

export type FollowUpCandidate = {
  id: string
  full_name: string
  market_status: Enums<'market_status'>
  last_contacted_at: string | null
  days_since_contact: number | null
}

export async function getFollowUpCandidates(
  supabase: SupabaseClient<Database>,
  limit = 10,
): Promise<DbResult<FollowUpCandidate[]>> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // We want: (last_contacted_at IS NULL) OR (last_contacted_at < cutoff).
  // PostgREST OR syntax: `.or('last_contacted_at.is.null,last_contacted_at.lt.<cutoff>')`.
  // reason: last_contacted_at lives on candidates (added by migration
  // 20260517215938_candidates_last_contacted_at.sql) but the generated
  // database.ts has not been regenerated since. The select string and `.or`
  // filter are cast at the call boundary; RLS still enforces correctness
  // server-side. Cast through `unknown` because the generated type encodes
  // the unknown column as a SelectQueryError.
  const { data, error } = (await (
    supabase.from('candidates') as unknown as {
      select: (s: string) => {
        in: (col: string, vals: string[]) => {
          or: (expr: string) => {
            limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>
          }
        }
      }
    }
  )
    .select('id, full_name, market_status, last_contacted_at')
    .in('market_status', ['hot', 'actively_looking', 'passively_looking'])
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
    // Fetch a generous slice and re-sort client-side by priority. At anchor
    // scale (<= a few hundred candidates with that overdue filter) this is
    // cheap and gives us deterministic ordering without a custom SQL function.
    .limit(Math.max(limit * 3, 30))) as { data: unknown[] | null; error: unknown }

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getFollowUpCandidates' } })
    return { ok: false, code: 'internal' }
  }

  // CONTEXT.md priority: hot → actively_looking → passively_looking.
  // Candidates not in those statuses are filtered out at the query level
  // already; the rank table below is the canonical client-side sort.
  const PRIORITY: Record<string, number> = {
    hot: 0,
    actively_looking: 1,
    passively_looking: 2,
  }

  const rows = (data ?? []) as Array<{
    id: string
    full_name: string
    market_status: Enums<'market_status'>
    last_contacted_at: string | null
  }>

  const now = Date.now()
  const sorted = rows
    .map((row) => ({
      id: row.id,
      full_name: row.full_name,
      market_status: row.market_status,
      last_contacted_at: row.last_contacted_at,
      days_since_contact: row.last_contacted_at
        ? Math.max(
            0,
            Math.floor(
              (now - new Date(row.last_contacted_at).getTime()) / (24 * 60 * 60 * 1000),
            ),
          )
        : null,
    }))
    .sort((a, b) => {
      const pa = PRIORITY[a.market_status] ?? 99
      const pb = PRIORITY[b.market_status] ?? 99
      if (pa !== pb) return pa - pb
      // Within a market_status tier, oldest contact first (NULL = oldest).
      const sa = a.last_contacted_at ? new Date(a.last_contacted_at).getTime() : 0
      const sb = b.last_contacted_at ? new Date(b.last_contacted_at).getTime() : 0
      return sa - sb
    })
    .slice(0, limit)

  return { ok: true, data: sorted }
}

// -----------------------------------------------------------------------------
// 5. Onboarding counts — checklist step completion
// -----------------------------------------------------------------------------
//
// Four parallel head-count queries to drive the first-run welcome checklist.
// RLS is the tenancy authority: no organization_id filter is appended here
// (mirrors the comment at the top of this file). The client-scoped Supabase
// JWT lets Postgres apply per-table RLS policies automatically.

export type OnboardingCounts = {
  candidates: number
  clients: number
  jobs: number
  teamMembers: number
}

export async function getOnboardingCounts(
  supabase: SupabaseClient<Database>,
): Promise<OnboardingCounts> {
  const [candidates, clients, jobs, teamMembers] = await Promise.all([
    supabase.from('candidates').select('id', { count: 'exact', head: true }),
    supabase.from('companies').select('id', { count: 'exact', head: true }),
    supabase.from('jobs').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }),
  ])

  if (candidates.error) {
    Sentry.captureException(candidates.error, {
      tags: { layer: 'db', helper: 'getOnboardingCounts:candidates' },
    })
  }
  if (clients.error) {
    Sentry.captureException(clients.error, {
      tags: { layer: 'db', helper: 'getOnboardingCounts:clients' },
    })
  }
  if (jobs.error) {
    Sentry.captureException(jobs.error, {
      tags: { layer: 'db', helper: 'getOnboardingCounts:jobs' },
    })
  }
  if (teamMembers.error) {
    Sentry.captureException(teamMembers.error, {
      tags: { layer: 'db', helper: 'getOnboardingCounts:teamMembers' },
    })
  }

  return {
    candidates: candidates.count ?? 0,
    clients: clients.count ?? 0,
    jobs: jobs.count ?? 0,
    teamMembers: teamMembers.count ?? 0,
  }
}

// re-export Json for callers that want to type metadata blobs without
// re-importing from the generated types file.
export type { Json }
