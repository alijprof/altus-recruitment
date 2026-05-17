import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Shape extensions for columns / functions added by migrations 20260517215938
// and 20260517215939 (this plan). `pnpm db:types` regen after `supabase db
// push` will fold these into the generated Database type and these locally-
// declared shapes become redundant. They exist now so this file can be
// authored before the regen runs.
//
// reason: the generated database.ts in HEAD predates Plan 1's migrations.
// Once the user runs `pnpm exec supabase db push && pnpm db:types`, replace
// any `as unknown as ...` casts in this file with the generated equivalents.
// ---------------------------------------------------------------------------

type CandidateWithLastContact = Tables<'candidates'> & {
  last_contacted_at: string | null
}

export type CandidateListRow = Pick<
  CandidateWithLastContact,
  | 'id'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'location'
  | 'current_role_title'
  | 'current_company'
  | 'market_status'
  | 'source'
  | 'last_contacted_at'
  | 'created_at'
>

export type SortKey = 'last_contacted_at' | 'full_name' | 'market_status' | 'created_at'
export type SortDir = 'asc' | 'desc'

export type ListCandidatesArgs = {
  q?: string
  sort: SortKey
  dir: SortDir
  offset: number
  limit: number
}

export type ListCandidatesData = {
  rows: CandidateListRow[]
  total: number
}

// Columns shared by both list paths (plain + rpc) — keep tight so the table
// renderer's prop type stays small.
const LIST_SELECT_COLUMNS =
  'id, full_name, email, phone, location, current_role_title, current_company, market_status, source, last_contacted_at, created_at'

/**
 * List candidates for the current tenant with optional pg_trgm-ranked search,
 * sort, and offset pagination.
 *
 * D-16: this helper MUST NOT call record_audit(). Audit-on-list is deferred to
 * Phase 2 because list views are high-cardinality and would dwarf detail-view
 * audit traffic. See CONTEXT.md decision D-16.
 */
export async function listCandidates(
  supabase: SupabaseClient<Database>,
  args: ListCandidatesArgs,
): Promise<DbResult<ListCandidatesData>> {
  const { q, sort, dir, offset, limit } = args

  if (q && q.trim().length >= 2) {
    // Trigram search path — defers to the search_candidates RPC. Note: the
    // RPC has its own ordering (similarity desc, then full_name asc) and
    // ignores `sort`/`dir` from the caller. This is intentional — search
    // results are most useful ranked by relevance. Sort headers should be
    // disabled in the UI while a query is active (UI-SPEC §1).
    // reason: search_candidates is added by 20260517215939_search_candidates_rpc.sql
    // which is not in the generated types yet.
    const supabaseUntyped = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: Array<CandidateListRow & { similarity: number; total_count: number }> | null
        error: unknown
      }>
    }
    const { data, error } = await supabaseUntyped.rpc('search_candidates', {
      p_query: q.trim(),
      p_limit: limit,
      p_offset: offset,
    })
    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'db', helper: 'listCandidates', branch: 'search' },
      })
      return { ok: false, code: 'internal' }
    }
    const rows = (data ?? []).map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      location: r.location,
      current_role_title: r.current_role_title,
      current_company: r.current_company,
      market_status: r.market_status,
      source: r.source,
      last_contacted_at: r.last_contacted_at,
      created_at: r.created_at,
    }))
    const total = data && data.length > 0 ? Number(data[0]?.total_count ?? 0) : 0
    return { ok: true, data: { rows, total } }
  }

  // Plain list path — sort + paginate via PostgREST.
  // reason: last_contacted_at column is added by 20260517215938 migration;
  // existing generated types are missing it on the row shape returned here.
  const orderColumn = sort
  const { data, error, count } = await supabase
    .from('candidates')
    .select(LIST_SELECT_COLUMNS, { count: 'exact' })
    .order(orderColumn, { ascending: dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true }) // deterministic tie-breaker for pagination
    .range(offset, offset + limit - 1)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listCandidates', branch: 'plain' },
    })
    return { ok: false, code: 'internal' }
  }

  return {
    ok: true,
    data: {
      rows: (data ?? []) as unknown as CandidateListRow[],
      total: count ?? 0,
    },
  }
}

/**
 * Fetch a single candidate by id for the detail page.
 *
 * D-16 / CAND-06: writes an audit_log row (`action = 'view'`) on success. The
 * audit call is best-effort — if it fails we log to Sentry but still return
 * the candidate so the page renders. We never block a detail view on audit
 * write failures (otherwise a transient DB hiccup blacks out the whole UI).
 */
export async function getCandidate(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<DbResult<CandidateWithLastContact>> {
  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getCandidate' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }

  // D-16 / CAND-06: audit every detail-view read. Detail-view audits ONLY.
  // List/search reads must not call this — see listCandidates above.
  try {
    const { error: auditError } = await supabase.rpc('record_audit', {
      p_action: 'view',
      p_entity_type: 'candidate',
      p_entity_id: id,
    })
    if (auditError) {
      Sentry.captureException(auditError, {
        tags: { layer: 'db', helper: 'getCandidate', subop: 'record_audit' },
      })
    }
  } catch (err) {
    // Defensive: never let an audit-write failure prevent the page from
    // rendering. Sentry capture below; the user still sees their candidate.
    Sentry.captureException(err, {
      tags: { layer: 'db', helper: 'getCandidate', subop: 'record_audit' },
    })
  }

  return { ok: true, data: data as unknown as CandidateWithLastContact }
}

export type CreateCandidateInput = {
  full_name: string
  email?: string | null
  phone?: string | null
  location?: string | null
  current_role_title?: string | null
  current_company?: string | null
  market_status: Enums<'market_status'>
  source: Enums<'candidate_source'>
  consent_basis: Enums<'consent_basis'>
  consent_at: string
  consent_text_version: string
}

/**
 * Insert a candidate. `organization_id` is set by the set_organization_id
 * trigger from the session context — never pass it from caller code.
 */
export async function createCandidate(
  supabase: SupabaseClient<Database>,
  input: CreateCandidateInput,
): Promise<DbResult<{ id: string }>> {
  // organization_id is intentionally omitted — the BEFORE INSERT trigger
  // `candidates_set_org` (phase1_domain_schema.sql:399-400) resolves it from
  // auth.uid()'s current_organization_id(). Passing it manually would be a
  // defence-in-depth anti-pattern (CLAUDE.md "Never use service role key in
  // client-side code" applies in spirit: trust RLS + triggers).
  // reason: TablesInsert<'candidates'> requires organization_id at the type
  // level even though the trigger fills it. Cast through unknown narrows the
  // payload to exactly what we actually send.
  const payload = {
    full_name: input.full_name,
    email: input.email || null,
    phone: input.phone || null,
    location: input.location || null,
    current_role_title: input.current_role_title || null,
    current_company: input.current_company || null,
    market_status: input.market_status,
    source: input.source,
    consent_basis: input.consent_basis,
    consent_at: input.consent_at,
    consent_text_version: input.consent_text_version,
  } as unknown as TablesInsert<'candidates'>

  const { data, error } = await supabase
    .from('candidates')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createCandidate' } })
    // 23505 = unique violation. The candidates table has no UNIQUE constraint
    // on email in Phase 1 so this should never fire, but we map it for future-
    // proofing.
    const pgErr = error as { code?: string }
    if (pgErr.code === '23505') return { ok: false, code: 'conflict' as never }
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: { id: data.id } }
}

export type UpdateCandidateInput = Partial<{
  full_name: string
  email: string | null
  phone: string | null
  location: string | null
  current_role_title: string | null
  current_company: string | null
  market_status: Enums<'market_status'>
  source: Enums<'candidate_source'>
  last_contacted_at: string | null
}>

/**
 * Update a candidate. Caller-supplied id + patch only — never pass
 * organization_id (RLS update policy enforces same-org).
 */
export async function updateCandidate(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: UpdateCandidateInput,
): Promise<DbResult<{ id: string }>> {
  // reason: last_contacted_at is added by 20260517215938; not yet in TablesUpdate type.
  const updatePayload = patch as unknown as TablesUpdate<'candidates'>
  const { error } = await supabase
    .from('candidates')
    .update(updatePayload)
    .eq('id', id)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateCandidate' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id } }
}

export type CandidateActivityRow = Pick<
  Tables<'activities'>,
  'id' | 'kind' | 'body' | 'occurred_at' | 'actor_user_id' | 'metadata'
> & {
  actor?: { full_name: string | null; email: string | null } | null
}

/**
 * List activities logged against a candidate, newest first. Joins the actor's
 * profile (name + email) for timeline rendering.
 */
export async function listCandidateActivities(
  supabase: SupabaseClient<Database>,
  candidateId: string,
  limit = 50,
): Promise<DbResult<CandidateActivityRow[]>> {
  const { data, error } = await supabase
    .from('activities')
    .select('id, kind, body, occurred_at, actor_user_id, metadata, actor:users!actor_user_id(full_name, email)')
    .eq('entity_type', 'candidate')
    .eq('entity_id', candidateId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'listCandidateActivities' },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: (data ?? []) as unknown as CandidateActivityRow[] }
}
