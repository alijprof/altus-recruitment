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
  // Optional: pass when calling from a service-role + no-session path (e.g.
  // the public apply form). The activities_set_org trigger uses
  // current_organization_id() which returns NULL under service-role and
  // raises. Authenticated callers leave this undefined.
  organization_id?: string
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

// ---------------------------------------------------------------------------
// Plan 4 Task 4.3 — Outlook email activity helpers (service-role caller).
// D2-18: subject -> body, snippet (<=200 chars) -> metadata.snippet.
// D2-19: orphan emails (no candidate / contact match) are NOT written.
// ---------------------------------------------------------------------------

export type CreateEmailActivityInput = {
  organizationId: string
  entityType: 'candidate' | 'contact'
  entityId: string
  subject: string
  snippet: string
  graphMessageId: string
  conversationId: string | null
  internetMessageId: string | null
  fromEmail: string
  toEmails: string[]
  direction: 'inbound' | 'outbound'
  occurredAt: string
  actorUserId: string | null
}

export async function createEmailActivity(
  supabase: SupabaseClient<Database>,
  input: CreateEmailActivityInput,
): Promise<DbResult<{ id: string }>> {
  const metadata: ActivityMetadata = {
    snippet: input.snippet.slice(0, 200),
    graph_message_id: input.graphMessageId,
    conversation_id: input.conversationId,
    internet_message_id: input.internetMessageId,
    from: input.fromEmail,
    to: input.toEmails,
    direction: input.direction,
  }
  // reason: service-role caller has no session, so the set_organization_id
  // trigger has no current_organization_id() to read. We pass org explicitly.
  // Json is a recursive type that doesn't structurally match
  // Record<string, unknown>; cast at the boundary.
  const insertPayload = {
    kind: 'email' as const,
    entity_type: input.entityType,
    entity_id: input.entityId,
    body: input.subject,
    actor_user_id: input.actorUserId,
    occurred_at: input.occurredAt,
    metadata,
    organization_id: input.organizationId,
  } as unknown as TablesInsert<'activities'>

  const { data, error } = await supabase
    .from('activities')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createEmailActivity' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Idempotency check — returns true when an activity row exists in the org
 * with `metadata->>internet_message_id = $internetMessageId`. We use the
 * RFC-5322 message id (stable across forwards/copies) rather than Graph's
 * per-mailbox `id` which changes across mailboxes for the same email.
 */
export async function emailActivityExists(
  supabase: SupabaseClient<Database>,
  args: { organizationId: string; internetMessageId: string },
): Promise<DbResult<boolean>> {
  const { data, error } = await supabase
    .from('activities')
    .select('id')
    .eq('organization_id', args.organizationId)
    .eq('kind', 'email')
    .filter('metadata->>internet_message_id', 'eq', args.internetMessageId)
    .limit(1)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'emailActivityExists' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: Boolean(data) }
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
    ...(input.organization_id ? { organization_id: input.organization_id } : {}),
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
