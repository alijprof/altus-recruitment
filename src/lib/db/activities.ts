import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesInsert } from '@/types/database'

import type { DbResult } from './types'

// `Json` from the generated Database type is a recursive union — passing a
// plain `Record<string, unknown>` doesn't structurally match it. We accept the
// narrower app-side type and cast at the boundary.
type ActivityMetadata = Record<string, unknown>

export type ActivityEntityType = 'candidate' | 'company' | 'contact' | 'job' | 'application'
export type ActivityKind = Database['public']['Enums']['activity_kind']

export type CreateActivityInput = {
  kind: ActivityKind
  entity_type: ActivityEntityType
  entity_id: string
  body?: string | null
  occurred_at?: string
  metadata?: ActivityMetadata
  actor_user_id?: string | null
}

export type ListActivitiesArgs = {
  entityType: ActivityEntityType
  entityId: string
  limit?: number
}

export async function listActivities(
  supabase: SupabaseClient<Database>,
  args: ListActivitiesArgs,
): Promise<DbResult<Tables<'activities'>[]>> {
  const limit = Math.max(1, Math.min(200, args.limit ?? 50))
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('entity_type', args.entityType)
    .eq('entity_id', args.entityId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listActivities' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

export async function createActivity(
  supabase: SupabaseClient<Database>,
  input: CreateActivityInput,
): Promise<DbResult<Tables<'activities'>>> {
  // organization_id is populated by the set_organization_id() trigger.
  // last_contacted_at propagation for company/contact entities is handled
  // server-side by the bump_last_contacted_at trigger (Plan 3 Task 3.1).
  // Plan 1 may also patch candidates.last_contacted_at directly when the
  // candidate branch is added — both code paths coexist without conflict.
  // reason: server-side trigger populates organization_id and the recursive
  // Json type doesn't structurally match Record<string, unknown> — cast at
  // the boundary, RLS WITH CHECK still enforces correctness server-side.
  const insertPayload = {
    kind: input.kind,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    body: input.body ?? null,
    actor_user_id: input.actor_user_id ?? null,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  } as unknown as TablesInsert<'activities'>

  const { data, error } = await supabase
    .from('activities')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createActivity' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}
