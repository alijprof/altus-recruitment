import 'server-only'

// ---------------------------------------------------------------------------
// src/lib/admin/org-erasure.ts — Batch B item 6 helpers (GDPR Art.17 + export).
//
// SECURITY: every function here takes an ALREADY service-role client and an
// orgId. They DO NOT gate — the caller (admin action / route handler) MUST have
// passed requireSuperAdmin() first. The service-role client bypasses RLS, so
// the orgId argument is the only tenant boundary; callers pass a verified id.
//
// PII: never log row contents to Sentry — only counts / table names / org_id.
// ---------------------------------------------------------------------------

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

// The three private Storage buckets that namespace objects under <org_id>/…
export const ORG_STORAGE_BUCKETS = ['cvs', 'spec-audio', 'voice-note-audio'] as const

// Org-scoped tables included in a data export. All are filtered by
// organization_id except `organizations` itself (filtered by id). The collector
// SKIPS any table that errors (missing column/table) so the export is resilient
// to schema drift; child tables without an organization_id column are simply
// omitted. Internal global ledgers (e.g. stripe_webhook_events) are excluded by
// design — they carry no tenant data.
export const ORG_EXPORT_TABLES = [
  'organizations',
  'users',
  'companies',
  'contacts',
  'candidates',
  'candidate_cvs',
  'jobs',
  'applications',
  'activities',
  'spec_drafts',
  'job_ads',
  'voice_notes',
  'email_campaigns',
  'feedback',
  'org_invitations',
  'subscriptions',
  'ai_summaries',
  'outlook_credentials',
  'audit_log',
  'ai_usage',
] as const

const PAGE = 1000

// Loose cast for dynamic table access + storage (the typed client can't accept
// an arbitrary table-name string; mirrors the admin/queries.ts cast pattern).
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        range: (
          from: number,
          to: number,
        ) => Promise<{ data: Record<string, unknown>[] | null; error: { code?: string } | null }>
      }
    }
  }
}

// Recursively list every object path under `prefix` in a bucket. Supabase
// Storage `list` is one level deep and returns synthetic folder entries
// (id === null); we recurse into those and collect file paths only.
export async function listAllObjectPaths(
  client: SupabaseClient<Database>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const out: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    // Real layouts are <org>/<candidate|user>/<file> (2 levels). A generous
    // cap prevents call-stack exhaustion on a pathological structure without
    // ever triggering for genuine data.
    if (depth > 32) return
    let offset = 0
    for (;;) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(dir, { limit: 100, offset })
      if (error) throw error
      // Supabase returns synthetic folder entries with id === null alongside
      // file entries (id set). The generated FileObject type declares id as a
      // string, so cast to reflect the real folder-placeholder shape.
      const entries = (data ?? []) as Array<{ name: string; id: string | null }>
      for (const entry of entries) {
        const full = dir ? `${dir}/${entry.name}` : entry.name
        // Folders have a null id; files carry an id + metadata.
        if (entry.id === null) {
          await walk(full, depth + 1)
        } else {
          out.push(full)
        }
      }
      if (entries.length < 100) break
      offset += 100
    }
  }

  await walk(prefix, 0)
  return out
}

// Delete every Storage object under <orgId>/ across all three buckets.
// Throws on the first list/remove error so the caller can ABORT before
// touching the database (storage-first ordering keeps the DB intact on failure).
// Returns the count of objects removed.
export async function deleteAllOrgStorage(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  let total = 0
  for (const bucket of ORG_STORAGE_BUCKETS) {
    const paths = await listAllObjectPaths(client, bucket, orgId)
    for (let i = 0; i < paths.length; i += PAGE) {
      const batch = paths.slice(i, i + PAGE)
      const { data: removed, error } = await client.storage.from(bucket).remove(batch)
      if (error) throw error
      // Supabase remove() returns the objects it actually deleted. A short
      // result means a silent per-object failure within the batch — throw so
      // the caller ABORTS before any DB destruction (leaves storage retryable).
      const removedCount = removed?.length ?? 0
      if (removedCount < batch.length) {
        throw new Error(
          `storage remove incomplete in ${bucket}: ${removedCount}/${batch.length}`,
        )
      }
      total += batch.length
    }
  }
  return total
}

// Delete every Supabase AUTH user belonging to the org. Deleting the auth user
// cascades the public.users row (FK ON DELETE CASCADE) and nulls created_by on
// their authored rows (FK ON DELETE SET NULL — migration 20260625130000). This
// MUST run before the organizations row is deleted, because users.organization_id
// is ON DELETE RESTRICT (org delete is blocked while users exist).
export async function deleteOrgAuthUsers(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<{ deleted: number; failed: number }> {
  // Collect ALL user ids first (paginated past the PostgREST 1000-row cap) so a
  // >1000-member org is fully erased. An unpaginated fetch would delete only
  // the first 1000, leaving orphaned users that block the organizations delete
  // (users.organization_id is ON DELETE RESTRICT) — i.e. a never-converging,
  // storage-already-gone partial erase.
  const ids: string[] = []
  let from = 0
  for (;;) {
    const { data, error } = await client
      .from('users')
      .select('id')
      .eq('organization_id', orgId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = data ?? []
    for (const row of batch) ids.push(row.id)
    if (batch.length < PAGE) break
    from += PAGE
  }

  let deleted = 0
  let failed = 0
  for (const id of ids) {
    const { error: delErr } = await client.auth.admin.deleteUser(id)
    if (delErr) {
      failed += 1
      Sentry.captureException(delErr, {
        tags: { layer: 'admin', helper: 'deleteOrgAuthUsers', org_id: orgId },
      })
    } else {
      deleted += 1
    }
  }
  return { deleted, failed }
}

export type OrgExport = {
  tables: Record<string, Record<string, unknown>[]>
  storage: Record<string, { path: string }[]>
  // Tables omitted from the export and why (schema drift = expected; any other
  // reason = a real gap the operator must see). Surfaced in the export payload
  // so an incomplete export is never silent.
  skippedTables: { table: string; reason: string }[]
}

// Assemble a full JSON-able export of an org's data: every org-scoped table
// (paginated past the PostgREST 1000-row cap) plus a manifest of Storage object
// paths per bucket. Tables that error (missing column/table) are skipped so the
// export never hard-fails on schema drift.
export async function collectOrgExport(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgExport> {
  const loose = client as unknown as LooseClient
  const tables: Record<string, Record<string, unknown>[]> = {}
  const skippedTables: { table: string; reason: string }[] = []

  for (const table of ORG_EXPORT_TABLES) {
    const filterCol = table === 'organizations' ? 'id' : 'organization_id'
    const rows: Record<string, unknown>[] = []
    let from = 0
    let skipReason: string | null = null
    for (;;) {
      const { data, error } = await loose
        .from(table)
        .select('*')
        .eq(filterCol, orgId)
        .range(from, from + PAGE - 1)
      if (error) {
        const code = error.code ?? 'unknown'
        // 42P01/42703 = table/column genuinely absent (expected schema drift).
        // Anything else is a real gap (transient/permission) — record + log.
        const isSchemaDrift = code === '42P01' || code === '42703'
        skipReason = isSchemaDrift ? `not present (${code})` : `error ${code}`
        if (!isSchemaDrift) {
          Sentry.captureException(new Error(`export table ${table}: ${code}`), {
            tags: { layer: 'admin', helper: 'collectOrgExport', table },
          })
        }
        break
      }
      const batch = data ?? []
      rows.push(...batch)
      if (batch.length < PAGE) break
      from += PAGE
    }
    if (skipReason) {
      skippedTables.push({ table, reason: skipReason })
    } else {
      tables[table] = rows
    }
  }

  const storage: Record<string, { path: string }[]> = {}
  for (const bucket of ORG_STORAGE_BUCKETS) {
    try {
      const paths = await listAllObjectPaths(client, bucket, orgId)
      storage[bucket] = paths.map((path) => ({ path }))
    } catch (err) {
      Sentry.captureException(err, {
        tags: { layer: 'admin', helper: 'collectOrgExport', bucket },
      })
      storage[bucket] = []
    }
  }

  return { tables, storage, skippedTables }
}
