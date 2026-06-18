'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
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

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
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
    // Attribute the float to the recruiter who created it (M-6b — mirrors the
    // shortlist add).
    owner_user_id: userData.user.id,
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

// ---------------------------------------------------------------------------
// updateFloatNoteAction — edit the latest note attached to a float.
//
// The page renders the most-recent note activity per application. Editing
// here means either updating that row in-place (if one exists) or inserting
// a new one (if the float was added without a note). Keeps the data shape
// the page already reads from — no migration required.
// ---------------------------------------------------------------------------

const updateNoteSchema = z.object({
  applicationId: idSchema,
  candidateId: idSchema,
  body: z.string().trim().max(2_000),
})

export type UpdateFloatNoteResult =
  | { ok: true }
  | { ok: false; formError: string }

export async function updateFloatNoteAction(
  rawInput: unknown,
): Promise<UpdateFloatNoteResult> {
  const parsed = updateNoteSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid note payload.' }
  }

  // Entitlement gate — block CRM mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, formError: 'Not signed in.' }
  }

  // Find the latest existing note for this float (RLS scopes to the org).
  const { data: existing, error: readErr } = await supabase
    .from('activities')
    .select('id')
    .eq('entity_type', 'application')
    .eq('entity_id', parsed.data.applicationId)
    .eq('kind', 'note')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (readErr) {
    Sentry.captureException(readErr, {
      tags: { layer: 'action', helper: 'updateFloatNoteAction', step: 'read' },
    })
    return { ok: false, formError: 'Could not load existing note.' }
  }

  const body = parsed.data.body.length > 0 ? parsed.data.body : null

  if (existing) {
    const { error: updErr } = await supabase
      .from('activities')
      .update({ body })
      .eq('id', existing.id)
    if (updErr) {
      Sentry.captureException(updErr, {
        tags: { layer: 'action', helper: 'updateFloatNoteAction', step: 'update' },
      })
      return { ok: false, formError: 'Could not update note.' }
    }
  } else if (body) {
    // No existing note — insert a fresh one. Mirrors the addFloat insert
    // shape so the page query keeps finding it the same way.
    const insert = {
      kind: 'note',
      body,
      actor_user_id: userData.user.id,
      entity_type: 'application',
      entity_id: parsed.data.applicationId,
      metadata: {
        candidate_id: parsed.data.candidateId,
        application_type: 'float',
      },
    } as unknown as TablesInsert<'activities'>
    const { error: insErr } = await supabase.from('activities').insert(insert)
    if (insErr) {
      Sentry.captureException(insErr, {
        tags: { layer: 'action', helper: 'updateFloatNoteAction', step: 'insert' },
      })
      return { ok: false, formError: 'Could not save note.' }
    }
  }
  // else: no existing row and empty body — nothing to do.

  revalidatePath(`/candidates/${parsed.data.candidateId}/floats`)
  return { ok: true }
}
