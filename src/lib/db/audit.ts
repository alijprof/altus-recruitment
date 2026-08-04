import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// Never-throw audit writers — Steele Charles feature review 2026-07-31
// Batch 2 Task 2 Step A/C. Extracted from the try/catch shape already used
// at src/lib/db/candidates.ts:286-303 (getCandidate's detail-view audit) so
// search, view and export audits all go through the same helper instead of
// re-implementing the "never fail the page over an audit write" contract
// three times.
// ---------------------------------------------------------------------------

// audit_log.entity_id is `uuid NOT NULL` with no FK constraint — a search
// has no entity to attach the row to, so we use the nil UUID. The
// convention already exists in this codebase (see
// supabase/migrations/20260601000000_buyer_value_rpc_fixes.sql:45,128) and
// is safe here for the same reason: no foreign key enforces entity_id.
export const NIL_UUID = '00000000-0000-0000-0000-000000000000'

type RecordAuditClient = {
  rpc: (
    fn: 'record_audit',
    args: {
      p_action: string
      p_entity_type: string
      p_entity_id: string
      p_metadata?: Record<string, unknown>
    },
  ) => Promise<{ data: unknown; error: unknown }>
}

/**
 * Write a `view` audit row via the `record_audit` RPC (security-definer,
 * resolves org + actor from the caller's session). NEVER throws and NEVER
 * returns a rejected promise — a failed audit write must not break page
 * rendering. Mirrors getCandidate's inline try/catch verbatim.
 */
export async function recordViewAudit(
  supabase: SupabaseClient<Database>,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const client = supabase as unknown as RecordAuditClient
    const { error } = await client.rpc('record_audit', {
      p_action: 'view',
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_metadata: metadata,
    })
    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'db', helper: 'recordViewAudit', subop: 'record_audit' },
      })
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'db', helper: 'recordViewAudit', subop: 'record_audit' },
    })
  }
}

/**
 * Thin wrapper for search audits — `search` has no entity row, so it always
 * uses the nil UUID + `entity_type: 'search'`. Metadata carries
 * `{ mode, semantic_ok, result_count, surface }` — NEVER the raw query
 * string (PII: candidate/skill search terms are recruiter-entered but can
 * still leak client/candidate identity).
 */
export async function recordSearchAudit(
  supabase: SupabaseClient<Database>,
  metadata: Record<string, unknown>,
): Promise<void> {
  return recordViewAudit(supabase, 'search', NIL_UUID, metadata)
}

type ServiceAuditClient = {
  from: (table: 'audit_log') => {
    insert: (row: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  }
}

/**
 * Service-role audit write for the super-admin cross-org export path
 * (src/app/admin/[orgId]/export/route.ts). `record_audit` cannot be used
 * there — it is `authenticated`-only and resolves the org from the
 * CALLER's session, so a super-admin exporting another org would file the
 * row against their own org, not the org being exported. This writes
 * directly into `public.audit_log` with the service client (bypasses RLS
 * by design — the caller has already gated on requireSuperAdmin()).
 *
 * Best-effort: NEVER throws. A failed audit write must not block the
 * download.
 */
export async function recordServiceAudit(
  serviceClient: SupabaseClient<Database>,
  args: {
    organizationId: string
    actorUserId: string
    action: string
    entityType: string
    entityId: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const client = serviceClient as unknown as ServiceAuditClient
    const { error } = await client.from('audit_log').insert({
      organization_id: args.organizationId,
      actor_user_id: args.actorUserId,
      action: args.action,
      entity_type: args.entityType,
      entity_id: args.entityId,
      metadata: args.metadata ?? {},
    })
    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'db', helper: 'recordServiceAudit' },
      })
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'db', helper: 'recordServiceAudit' },
    })
  }
}
