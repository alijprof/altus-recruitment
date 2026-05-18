import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// Dormancy window in milliseconds — UI-SPEC §5 + CLIENT-01.
const DORMANT_AFTER_MS = 60 * 24 * 60 * 60 * 1000

export type ClientListSort = 'name' | 'last_contacted_at' | 'similarity'
export type ListDir = 'asc' | 'desc'

export type ClientRow = Tables<'companies'> & {
  active_jobs_count: number
  dormant: boolean
}

export type ListClientsArgs = {
  q?: string
  sort?: ClientListSort
  dir?: ListDir
  page?: number
  pageSize?: number
}

export type ListClientsResult = {
  rows: ClientRow[]
  total: number
  page: number
  pageSize: number
}

// Shape of the search_clients RPC return — typed manually because the cloud
// migrations introducing the function may not be applied at type-gen time.
type SearchClientsRow = Tables<'companies'> & {
  similarity: number
  total_count: number
}

function isDormant(lastContactedAt: string | null): boolean {
  // Never-contacted ≠ dormant. A brand-new client should not render Dormant
  // on its first save. Dormant means "we had contact but it's gone stale".
  if (!lastContactedAt) return false
  return Date.now() - new Date(lastContactedAt).getTime() > DORMANT_AFTER_MS
}

export async function listClients(
  supabase: SupabaseClient<Database>,
  args: ListClientsArgs = {},
): Promise<DbResult<ListClientsResult>> {
  const page = Math.max(1, args.page ?? 1)
  const pageSize = Math.max(1, Math.min(100, args.pageSize ?? 25))
  const offset = (page - 1) * pageSize
  const sort: ClientListSort = args.sort ?? 'last_contacted_at'
  const dir: ListDir = args.dir ?? 'desc'
  const q = args.q?.trim()

  // Search branch — pg_trgm via RPC.
  if (q && q.length >= 2) {
    // The RPC is declared in 20260517215958_search_clients_rpc.sql but the
    // generated Database type may not include it yet; cast via unknown.
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: SearchClientsRow[] | null; error: unknown }>
    )('search_clients', {
      p_query: q,
      p_threshold: 0.2,
      p_sort: sort === 'similarity' ? 'similarity' : sort,
      p_dir: dir,
      p_offset: offset,
      p_limit: pageSize,
    })

    if (error) {
      Sentry.captureException(error, { tags: { layer: 'db', helper: 'listClients.search' } })
      return { ok: false, code: 'internal' }
    }

    const rawRows = data ?? []
    const total = rawRows[0]?.total_count ?? 0

    const enriched = await enrichWithActiveJobs(supabase, rawRows)
    if (!enriched.ok) return enriched

    return {
      ok: true,
      data: { rows: enriched.data, total: Number(total), page, pageSize },
    }
  }

  // No query → plain select with sort + pagination.
  // `similarity` is not a real column so map it back to last_contacted_at.
  const orderColumn: 'name' | 'last_contacted_at' =
    sort === 'name' ? 'name' : 'last_contacted_at'

  const { data, error, count } = await supabase
    .from('companies')
    .select('*', { count: 'exact' })
    .order(orderColumn, { ascending: dir === 'asc', nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listClients' } })
    return { ok: false, code: 'internal' }
  }

  const enriched = await enrichWithActiveJobs(supabase, data ?? [])
  if (!enriched.ok) return enriched

  return {
    ok: true,
    data: { rows: enriched.data, total: count ?? 0, page, pageSize },
  }
}

// Helper: fetch open-job counts for a list of companies in one round trip.
// Cleaner than per-row subqueries and avoids N+1.
async function enrichWithActiveJobs(
  supabase: SupabaseClient<Database>,
  rows: Tables<'companies'>[],
): Promise<DbResult<ClientRow[]>> {
  if (rows.length === 0) return { ok: true, data: [] }

  const ids = rows.map((r) => r.id)
  const { data, error } = await supabase
    .from('jobs')
    .select('company_id')
    .in('company_id', ids)
    .eq('status', 'open')

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'enrichWithActiveJobs' } })
    return { ok: false, code: 'internal' }
  }

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1)
  }

  return {
    ok: true,
    data: rows.map((r) => ({
      ...r,
      active_jobs_count: counts.get(r.id) ?? 0,
      dormant: isDormant(r.last_contacted_at),
    })),
  }
}

export async function getClient(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<DbResult<ClientRow>> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getClient' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }

  const enriched = await enrichWithActiveJobs(supabase, [data])
  if (!enriched.ok) return enriched
  const row = enriched.data[0]
  if (!row) return { ok: false, code: 'not_found' }
  return { ok: true, data: row }
}

export type CreateClientInput = Pick<
  TablesInsert<'companies'>,
  'name' | 'industry' | 'website' | 'notes'
>

export async function createClient(
  supabase: SupabaseClient<Database>,
  input: CreateClientInput,
): Promise<DbResult<Tables<'companies'>>> {
  // organization_id is filled by the set_organization_id() BEFORE INSERT
  // trigger; the generated types still mark it required, so we cast.
  // reason: server-side trigger populates organization_id; RLS WITH CHECK
  // enforces correctness — type system can't see that contract.
  const insertPayload = {
    name: input.name,
    industry: input.industry ?? null,
    website: input.website ?? null,
    notes: input.notes ?? null,
  } as TablesInsert<'companies'>

  const { data, error } = await supabase
    .from('companies')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createClient' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

export type UpdateClientPatch = Pick<
  TablesUpdate<'companies'>,
  'name' | 'industry' | 'website' | 'notes'
>

export async function updateClient(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: UpdateClientPatch,
): Promise<DbResult<Tables<'companies'>>> {
  const { data, error } = await supabase
    .from('companies')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'updateClient' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

// Shape returned by the client_activity_timeline view — typed manually because
// the cloud migrations adding the view may not be reflected in generated types
// yet. The columns mirror the SQL view definition in
// 20260517215956_client_activity_view.sql.
export type ClientTimelineEntry = {
  id: string
  organization_id: string
  kind: Database['public']['Enums']['activity_kind']
  body: string | null
  actor_user_id: string | null
  occurred_at: string
  metadata: Record<string, unknown>
  entity_type: 'company' | 'contact' | 'job' | 'candidate' | 'application'
  entity_id: string
  client_id: string
  entity_label: string | null
  // Review fix H3: surfaced by the LEFT JOIN on public.users added by
  // migration 20260518211530. Null when actor_user_id is null (system
  // entries) or when the user row has been deleted.
  actor_full_name: string | null
  actor_email: string | null
}

export async function getClientTimeline(
  supabase: SupabaseClient<Database>,
  clientId: string,
  limit = 50,
): Promise<DbResult<ClientTimelineEntry[]>> {
  // The view isn't in generated types yet; bypass the table-name union check.
  const { data, error } = await (
    supabase.from as unknown as (
      table: string,
    ) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => {
            limit: (
              n: number,
            ) => Promise<{ data: ClientTimelineEntry[] | null; error: unknown }>
          }
        }
      }
    }
  )('client_activity_timeline')
    .select('*')
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getClientTimeline' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

export { isDormant }
