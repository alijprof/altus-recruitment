'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/types/database'

// ---------------------------------------------------------------------------
// convertShortlistToApplicationAction — promote a shortlist row to a formal
// application (D3-16: one-way; no demotion).
//
// Mirrors moveApplicationAction's auth + DB-update + revalidate shape. The
// defensive `application_type === 'shortlist'` check protects against an
// errant id (RLS already scopes the read to the caller's org; this just
// ensures we don't no-op on a standard row or accidentally re-stage a float).
//
// On promotion:
//   - application_type → 'standard'
//   - stage → 'applied'
//   - stage_changed_at → now()
//   - activities row inserted (kind='stage_change', entity='application',
//     metadata { from: 'shortlist', to: 'standard' }) for audit per D3-16
//     "audit trail expectation". The set_organization_id trigger on
//     activities fills org from the session context.
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid()

const convertSchema = z.object({
  applicationId: idSchema,
})

export type ConvertShortlistResult =
  | { ok: true; jobId: string; candidateId: string }
  | { ok: false; error: string }

export async function convertShortlistToApplicationAction(
  rawInput: unknown,
): Promise<ConvertShortlistResult> {
  const parsed = convertSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.' }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Not signed in.' }
  }

  // Read first: confirm the row exists, lives in the caller's org (RLS), is
  // a shortlist, and has both candidate_id + job_id populated (the CHECK
  // constraint enforces job_id NOT NULL for shortlist rows, but reading is
  // cheap defence in depth).
  const { data: app, error: readErr } = await supabase
    .from('applications')
    .select('id, application_type, job_id, candidate_id')
    .eq('id', parsed.data.applicationId)
    .maybeSingle()
  if (readErr || !app) {
    return { ok: false, error: 'Not found.' }
  }
  if (app.application_type !== 'shortlist') {
    return { ok: false, error: 'Only shortlist rows can be promoted.' }
  }
  if (!app.job_id) {
    // Should be impossible per the CHECK constraint, but guard anyway.
    return { ok: false, error: 'Shortlist row is missing a job. Cannot promote.' }
  }

  // Update — RLS still applies (security invoker on the table-level policy).
  const nowIso = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('applications')
    .update({
      application_type: 'standard',
      stage: 'applied',
      stage_changed_at: nowIso,
    })
    .eq('id', parsed.data.applicationId)

  if (updErr) {
    Sentry.captureException(updErr, {
      tags: { layer: 'action', helper: 'convertShortlistToApplicationAction' },
    })
    return { ok: false, error: 'Promotion failed.' }
  }

  // Activity log per D3-16. The activities table uses entity_type +
  // entity_id (see 20260518201900_move_application_function.sql for the
  // analogous insert) — NOT candidate_id / job_id columns. Carry both ids
  // in metadata so consumers (timeline component) can resolve quickly.
  // reason: TablesInsert<'activities'> requires organization_id at the
  // type level; the BEFORE INSERT _set_org trigger fills it from session.
  const activity = {
    kind: 'stage_change',
    body: 'Promoted from shortlist to application',
    actor_user_id: userData.user.id,
    entity_type: 'application',
    entity_id: parsed.data.applicationId,
    metadata: {
      from: 'shortlist',
      to: 'standard',
      candidate_id: app.candidate_id,
      job_id: app.job_id,
    },
  } as unknown as TablesInsert<'activities'>

  const { error: actErr } = await supabase.from('activities').insert(activity)
  if (actErr) {
    // Activity write failure is non-fatal — Sentry-capture and continue.
    // The promotion succeeded; missing the audit row is recoverable.
    Sentry.captureException(actErr, {
      tags: {
        layer: 'action',
        helper: 'convertShortlistToApplicationAction',
        step: 'activity-insert',
      },
    })
  }

  revalidatePath(`/jobs/${app.job_id}`)
  revalidatePath(`/jobs/${app.job_id}/pipeline`)
  revalidatePath(`/jobs/${app.job_id}/shortlist`)
  revalidatePath(`/candidates/${app.candidate_id}`)
  revalidatePath(`/pipeline`)
  return { ok: true, jobId: app.job_id, candidateId: app.candidate_id }
}
