import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// spec_drafts helpers (Plan 03-02 Task B.3).
//
// All writes go through here so the upload action, review page, and Inngest
// functions share one shape. organization_id is filled by the
// spec_drafts_set_org BEFORE INSERT trigger — never pass it from the
// authenticated caller; service-role callers MUST pass it explicitly.
// ---------------------------------------------------------------------------

export type SpecDraftRow = Tables<'spec_drafts'>
export type SpecDraftStatus = Enums<'spec_draft_status'>

type ListSpecDraftsArgs = {
  status?: SpecDraftStatus | SpecDraftStatus[]
  ownerId?: string
  includeDeleted?: boolean
  limit?: number
}

/**
 * List drafts for the authenticated tenant. By default excludes soft-deleted
 * rows (rejected drafts under their 30-day vacuum window).
 */
export async function listSpecDrafts(
  supabase: SupabaseClient<Database>,
  args: ListSpecDraftsArgs = {},
): Promise<DbResult<SpecDraftRow[]>> {
  let query = supabase
    .from('spec_drafts')
    .select('*')
    .order('created_at', { ascending: false })

  if (args.status) {
    if (Array.isArray(args.status)) {
      query = query.in('status', args.status)
    } else {
      query = query.eq('status', args.status)
    }
  }
  if (args.ownerId) {
    query = query.eq('created_by', args.ownerId)
  }
  if (!args.includeDeleted) {
    query = query.is('deleted_at', null)
  }
  if (args.limit) {
    query = query.limit(args.limit)
  }

  const { data, error } = await query
  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'listSpecDrafts' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? [] }
}

/**
 * Fetch a single draft by id. Used by the review page + status poller.
 */
export async function getSpecDraft(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<DbResult<SpecDraftRow>> {
  const { data, error } = await supabase
    .from('spec_drafts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getSpecDraft' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}

export type CreateSpecDraftInput = {
  createdBy: string
  companyId?: string | null
  audioMimeType?: string | null
  audioDurationSeconds?: number | null
  status?: SpecDraftStatus
  // Service-role callers must pass org explicitly (the trigger reads
  // current_organization_id() which returns NULL under service-role).
  organizationId?: string
}

/**
 * Insert a spec_drafts row at status='pending'. Returns the new id +
 * resolved organization_id (set by the trigger for session callers).
 */
export async function createSpecDraft(
  supabase: SupabaseClient<Database>,
  input: CreateSpecDraftInput,
): Promise<DbResult<Pick<SpecDraftRow, 'id' | 'organization_id'>>> {
  // reason: TablesInsert<'spec_drafts'> declares organization_id as required
  // (optional in the runtime trigger). The pattern matches candidate-cvs.ts
  // line 87–100.
  const payload = {
    created_by: input.createdBy,
    company_id: input.companyId ?? null,
    audio_mime_type: input.audioMimeType ?? null,
    audio_duration_seconds: input.audioDurationSeconds ?? null,
    status: input.status ?? 'pending',
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
  } as unknown as TablesInsert<'spec_drafts'>

  const { data, error } = await supabase
    .from('spec_drafts')
    .insert(payload)
    .select('id, organization_id')
    .single()
  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'createSpecDraft' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Patch storage path / mime / duration on a draft after the Storage upload
 * succeeds. The action creates the row first to get an id, uploads using
 * `${org}/${user}/${id}.${ext}`, then writes the path here.
 */
export async function updateSpecDraftAudioPath(
  supabase: SupabaseClient<Database>,
  args: { id: string; storagePath: string; mimeType: string },
): Promise<DbResult<{ id: string }>> {
  const patch: TablesUpdate<'spec_drafts'> = {
    audio_storage_path: args.storagePath,
    audio_mime_type: args.mimeType,
  }
  const { error } = await supabase
    .from('spec_drafts')
    .update(patch)
    .eq('id', args.id)
    .select('id')
    .single()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateSpecDraftAudioPath' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: args.id } }
}

/**
 * Persist the recruiter-edited structured JD back to the row at approval
 * time. The Inngest createJobFromSpec function reads this on its trigger.
 */
export async function updateSpecDraftStructuredData(
  supabase: SupabaseClient<Database>,
  args: { id: string; structuredData: unknown },
): Promise<DbResult<{ id: string }>> {
  const patch = {
    structured_data: args.structuredData,
  } as unknown as TablesUpdate<'spec_drafts'>
  const { error } = await supabase
    .from('spec_drafts')
    .update(patch)
    .eq('id', args.id)
    .select('id')
    .single()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateSpecDraftStructuredData' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: args.id } }
}

/**
 * Mark a draft as approved: set status, approved_at, and (optionally) the
 * id of the jobs row it created. Used by approveSpecDraftAction +
 * createJobFromSpec Inngest function.
 */
export async function markSpecDraftApproved(
  supabase: SupabaseClient<Database>,
  args: { id: string; createdJobId?: string | null },
): Promise<DbResult<{ id: string }>> {
  const patch: TablesUpdate<'spec_drafts'> = {
    status: 'approved',
    approved_at: new Date().toISOString(),
  }
  if (args.createdJobId !== undefined) {
    patch.created_job_id = args.createdJobId
  }
  const { error } = await supabase
    .from('spec_drafts')
    .update(patch)
    .eq('id', args.id)
    .select('id')
    .single()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'markSpecDraftApproved' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: args.id } }
}

/**
 * Reject a draft (D3-30): soft-delete via `deleted_at = now()`. The
 * spec-draft-cleanup-sweep cron hard-deletes after 30 days.
 */
export async function markSpecDraftRejected(
  supabase: SupabaseClient<Database>,
  args: { id: string },
): Promise<DbResult<{ id: string }>> {
  const nowIso = new Date().toISOString()
  const patch: TablesUpdate<'spec_drafts'> = {
    status: 'rejected',
    rejected_at: nowIso,
    deleted_at: nowIso,
  }
  const { error } = await supabase
    .from('spec_drafts')
    .update(patch)
    .eq('id', args.id)
    .select('id')
    .single()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'markSpecDraftRejected' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: { id: args.id } }
}
