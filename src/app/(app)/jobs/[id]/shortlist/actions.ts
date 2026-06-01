'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import type { Enums, TablesInsert } from '@/types/database'

// ---------------------------------------------------------------------------
// Add to shortlist (per-job working set, application_type='shortlist').
//
// Mirrors addCandidateToJobAction (jobs/[id]/actions.ts) — Zod safeParse →
// createClient → auth.getUser → DB insert → revalidate. The set_organization_id
// BEFORE INSERT trigger fills organization_id from the session context; we do
// NOT pass it explicitly (mirrors createApplication in db/applications.ts).
//
// The applications_job_id_required_unless_float CHECK constraint enforces
// (shortlist => job_id NOT NULL) at the DB layer; this action couldn't write
// a malformed shortlist row even if the client tried.
//
// One-way semantics (D3-16): shortlist rows promote to standard via
// convertShortlistToApplicationAction (candidates/[id]/shortlist-actions.ts).
// There is no inverse — once promoted, a row cannot be demoted to shortlist.
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid()

const addToShortlistSchema = z.object({
  jobId: idSchema,
  candidateId: idSchema,
})

export type AddToShortlistResult =
  | { ok: true; applicationId: string }
  | { ok: false; formError: string }

export async function addToShortlistAction(
  rawInput: unknown,
): Promise<AddToShortlistResult> {
  const parsed = addToShortlistSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid candidate or job id.' }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, formError: 'Not signed in.' }
  }

  // reason: TablesInsert<'applications'> still types organization_id as
  // required at the type level — the BEFORE INSERT _set_org trigger fills
  // it from the session. Cast through unknown to satisfy the type while
  // keeping the runtime path correct (same pattern as createApplication).
  const payload = {
    job_id: parsed.data.jobId,
    candidate_id: parsed.data.candidateId,
    application_type: 'shortlist' as Enums<'application_type'>,
    // Attribute the shortlisting to the recruiter who added it so buyer-value
    // recruiter rollups (coalesce(owner_user_id, created_by)) credit them
    // explicitly (M-6b).
    owner_user_id: userData.user.id,
  } as unknown as TablesInsert<'applications'>

  const { data, error } = await supabase
    .from('applications')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'action', helper: 'addToShortlistAction' },
    })
    // 23505 = unique violation — candidate already on this shortlist for
    // this job. Surface a friendly message; otherwise generic.
    const pgErr = error as { code?: string }
    if (pgErr.code === '23505') {
      return {
        ok: false,
        formError: 'This candidate is already on the shortlist for this job.',
      }
    }
    return { ok: false, formError: 'Could not add to shortlist.' }
  }

  revalidatePath(`/jobs/${parsed.data.jobId}`)
  revalidatePath(`/jobs/${parsed.data.jobId}/shortlist`)
  revalidatePath(`/jobs/${parsed.data.jobId}/pipeline`)
  // D3-17 invariant: the pipeline kanban filter excludes shortlist rows,
  // so the pipeline view won't change — but revalidate anyway in case
  // the recruiter has both surfaces open simultaneously.
  return { ok: true, applicationId: data.id }
}

// ---------------------------------------------------------------------------
// Remove from shortlist (delete row) — the recruiter may decide a candidate
// shouldn't actually be on the shortlist. NOT the same as promoting (see
// candidates/[id]/shortlist-actions.ts). Hard delete because the shortlist row
// itself is a working-set entry with no historical value — but the removal is
// recorded to the candidate timeline so the decision stays auditable (M-6c).
// ---------------------------------------------------------------------------

const removeFromShortlistSchema = z.object({
  applicationId: idSchema,
  jobId: idSchema,
})

export type RemoveFromShortlistResult =
  | { ok: true }
  | { ok: false; error: string }

export async function removeFromShortlistAction(
  rawInput: unknown,
): Promise<RemoveFromShortlistResult> {
  const parsed = removeFromShortlistSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.' }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Not signed in.' }
  }

  // Defensive read so we don't accidentally hard-delete a standard or float
  // row if the UI calls this action with a wrong id. RLS scopes the read to
  // the caller's org.
  const { data: row, error: readErr } = await supabase
    .from('applications')
    .select('id, application_type, job_id, candidate_id')
    .eq('id', parsed.data.applicationId)
    .maybeSingle()
  if (readErr || !row) {
    return { ok: false, error: 'Not found.' }
  }
  if (row.application_type !== 'shortlist') {
    return { ok: false, error: 'Only shortlist rows can be removed here.' }
  }

  const { error: delErr } = await supabase
    .from('applications')
    .delete()
    .eq('id', parsed.data.applicationId)
  if (delErr) {
    Sentry.captureException(delErr, {
      tags: { layer: 'action', helper: 'removeFromShortlistAction' },
    })
    return { ok: false, error: 'Could not remove from shortlist.' }
  }

  // Audit-ready by default (M-6c): the row is gone, but log the removal to the
  // candidate timeline so the recruiter's decision stays traceable. The
  // _set_org trigger fills organization_id from the session. Best-effort — the
  // removal already committed, so a failed audit insert must not fail the call.
  const audit = {
    kind: 'note',
    body: 'Removed from shortlist',
    actor_user_id: userData.user.id,
    entity_type: 'candidate',
    entity_id: row.candidate_id,
    metadata: {
      action: 'remove_from_shortlist',
      job_id: row.job_id,
      candidate_id: row.candidate_id,
      removed_application_id: parsed.data.applicationId,
    },
  } as unknown as TablesInsert<'activities'>
  const { error: auditErr } = await supabase.from('activities').insert(audit)
  if (auditErr) {
    Sentry.captureException(auditErr, {
      tags: { layer: 'action', helper: 'removeFromShortlistAction', step: 'audit' },
    })
  }

  revalidatePath(`/jobs/${parsed.data.jobId}`)
  revalidatePath(`/jobs/${parsed.data.jobId}/shortlist`)
  revalidatePath(`/candidates/${row.candidate_id}`)
  return { ok: true }
}
