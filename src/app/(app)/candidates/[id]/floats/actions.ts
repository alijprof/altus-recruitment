'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import type { Enums, TablesInsert } from '@/types/database'

// ---------------------------------------------------------------------------
// addFloatAction — speculative submission (no job attached).
//
// D3-16 / D3-18: floats are applications with application_type='float' and
// job_id IS NULL. The `applications_job_id_required_unless_float` CHECK
// constraint enforces the (type, job_id) shape; the null-safe FK guard
// (20260520010420_*.sql) lets the insert pass without panicking on the
// otherwise-mandatory same-org check on job_id.
//
// The set_organization_id BEFORE INSERT trigger fills organization_id from
// session — we never pass it explicitly (mirrors createApplication + the
// shortlist action).
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid()

const addFloatSchema = z.object({
  candidateId: idSchema,
  note: z.string().trim().max(2_000).optional().nullable(),
})

export type AddFloatResult =
  | { ok: true; applicationId: string }
  | { ok: false; formError: string }

export async function addFloatAction(
  rawInput: unknown,
): Promise<AddFloatResult> {
  const parsed = addFloatSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid candidate id or note.' }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, formError: 'Not signed in.' }
  }

  // reason: TablesInsert<'applications'> types organization_id as required;
  // the _set_org trigger fills it. job_id intentionally NOT passed so the
  // CHECK constraint accepts the row.
  const payload = {
    candidate_id: parsed.data.candidateId,
    job_id: null,
    application_type: 'float' as Enums<'application_type'>,
    // stage defaults to 'applied' from the schema; floats don't progress
    // through stages but the column is NOT NULL, so we accept the default.
  } as unknown as TablesInsert<'applications'>

  const { data, error } = await supabase
    .from('applications')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'action', helper: 'addFloatAction' },
    })
    return { ok: false, formError: 'Could not add float.' }
  }

  // Optional recruiter note — logged as an activity so it shows up in the
  // candidate's timeline. Non-fatal if it fails; Sentry-capture and
  // continue so the float itself is still committed.
  if (parsed.data.note) {
    const activity = {
      kind: 'note',
      body: parsed.data.note,
      actor_user_id: userData.user.id,
      entity_type: 'application',
      entity_id: data.id,
      metadata: {
        candidate_id: parsed.data.candidateId,
        application_type: 'float',
      },
    } as unknown as TablesInsert<'activities'>
    const { error: noteErr } = await supabase.from('activities').insert(activity)
    if (noteErr) {
      Sentry.captureException(noteErr, {
        tags: { layer: 'action', helper: 'addFloatAction', step: 'note-insert' },
      })
    }
  }

  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath(`/candidates/${parsed.data.candidateId}/floats`)
  revalidatePath(`/floats`)
  return { ok: true, applicationId: data.id }
}
