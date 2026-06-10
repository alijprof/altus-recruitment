'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { getProfile } from '@/lib/db/profiles'
import { applyVoiceNoteFields, getVoiceNote } from '@/lib/db/voice-notes'
import { inngest } from '@/lib/inngest/client'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// submitVoiceNoteAction — Plan 04-02 Task 3.
//
// Mirrors submitSpecCallAction (src/app/(app)/spec/new/actions.ts) with
// entity names substituted:
//   spec-audio bucket → voice-note-audio
//   spec_drafts table → voice_notes
//   spec_draft_id → voice_note_id
//   spec/uploaded event → voice-note/uploaded
//   company_id param → candidate_id (required, uuid)
//
// MIME allow-list and size cap are copied verbatim from the spec action.
// Storage path follows the same convention for HARD RULE 4 compatibility:
//   <org_id>/<user_id>/<voice_note_id>.<ext>
// ---------------------------------------------------------------------------

export type SubmitVoiceNoteResult =
  | { ok: true; voiceNoteId: string }
  | { ok: false; error: string }

// 100 MiB upper bound — same as spec calls. Covers a ~60-min voice note
// at typical mobile audio encoding quality.
const MAX_AUDIO_BYTES = 100 * 1024 * 1024

// Browsers and recorder apps report audio MIME types inconsistently.
// Accept all the common variants — same set as spec actions.
const ACCEPTED_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
])

function extForMime(mime: string): string {
  switch (mime) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
    case 'audio/aac':
      return 'm4a'
    default:
      return 'webm'
  }
}

// candidate_id must be a valid UUID — validates on the server before any DB
// write so a malformed id can't reach Postgres.
const candidateIdSchema = z.string().uuid()

export async function submitVoiceNoteAction(
  formData: FormData,
): Promise<SubmitVoiceNoteResult> {
  const audioRaw = formData.get('audio')
  const candidateRaw = formData.get('candidate_id')

  if (!(audioRaw instanceof File) || audioRaw.size === 0) {
    return { ok: false, error: 'Choose an audio file before uploading.' }
  }
  const audio = audioRaw

  if (!ACCEPTED_AUDIO_MIME.has(audio.type)) {
    return {
      ok: false,
      error: 'Unsupported audio format. Use MP3, M4A, WAV, or WebM.',
    }
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: 'That file is over 100 MiB. Please split or compress before uploading.',
    }
  }

  const candidateParsed = candidateIdSchema.safeParse(candidateRaw)
  if (!candidateParsed.success) {
    return { ok: false, error: 'Invalid candidate id.' }
  }
  const candidateId = candidateParsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }
  const organizationId = profileResult.data.organization_id

  // Insert the voice_notes row first to obtain a deterministic id for the
  // storage path. RLS scopes the insert to the current tenant.
  const { data: insertData, error: insertErr } = await supabase
    .from('voice_notes')
    .insert({
      organization_id: organizationId,
      candidate_id: candidateId,
      created_by: user.id,
      status: 'pending',
      audio_mime_type: audio.type,
    })
    .select('id')
    .single()

  if (insertErr || !insertData) {
    Sentry.captureException(new Error(`voice-note-insert:${insertErr?.message ?? 'no-data'}`), {
      tags: { phase: 'p4', layer: 'action', helper: 'submitVoiceNoteAction', subop: 'insert' },
    })
    return { ok: false, error: 'Could not create voice note. Please try again.' }
  }
  const voiceNoteId = insertData.id

  // Storage path: <org>/<user>/<voice_note_id>.<ext>
  // HARD RULE 4 compatibility: the Inngest function asserts startsWith(`${org}/`)
  // before any service-role download — this convention satisfies that check.
  const storagePath = `${organizationId}/${user.id}/${voiceNoteId}.${extForMime(audio.type)}`

  const { error: uploadErr } = await supabase.storage
    .from('voice-note-audio')
    .upload(storagePath, audio, { contentType: audio.type, upsert: false })

  if (uploadErr) {
    // Mark as failed so the UI doesn't sit at "pending" forever.
    await supabase
      .from('voice_notes')
      .update({ status: 'failed', parse_error: 'Upload failed. Try again.' })
      .eq('id', voiceNoteId)
    Sentry.captureException(new Error(`storage-upload:${uploadErr.message}`), {
      tags: { phase: 'p4', layer: 'action', helper: 'submitVoiceNoteAction', subop: 'storage-upload' },
    })
    return { ok: false, error: 'Storage upload failed. Please try again.' }
  }

  // Write the storage path back to the row now that the upload succeeded.
  const { error: pathErr } = await supabase
    .from('voice_notes')
    .update({ audio_storage_path: storagePath })
    .eq('id', voiceNoteId)

  if (pathErr) {
    // Roll back the orphaned object so we don't pay for storage on an
    // un-trackable voice note.
    await supabase.storage.from('voice-note-audio').remove([storagePath])
    return { ok: false, error: 'Could not record audio path. Try again.' }
  }

  // Dispatch the voice-note/uploaded event to trigger the Inngest pipeline.
  try {
    await inngest.send({
      name: 'voice-note/uploaded',
      data: {
        organization_id: organizationId,
        voice_note_id: voiceNoteId,
        storage_path: storagePath,
        mime_type: audio.type,
        user_id: user.id,
        candidate_id: candidateId,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send failed`), {
      tags: {
        phase: 'p4',
        layer: 'action',
        helper: 'submitVoiceNoteAction',
        subop: 'inngest.send',
        voice_note_id: voiceNoteId,
      },
    })
    await supabase
      .from('voice_notes')
      .update({ status: 'failed', parse_error: 'Could not queue transcription. Try again.' })
      .eq('id', voiceNoteId)
    return { ok: false, error: 'Could not queue transcription. Try again.' }
  }

  return { ok: true, voiceNoteId }
}

// ---------------------------------------------------------------------------
// applyVoiceNoteAction — Plan 04-03 Task 1.
//
// Applies the recruiter-approved subset of proposed field changes to the
// candidate row. Security architecture (T-04-18, T-04-19, T-04-20):
//
//   T-04-18: approvedFields items are validated against a Zod enum of EXACTLY
//            the 4 D4-05 allowlist scalars. Off-list items REJECT the whole
//            request (not silently dropped — Research §Pitfall 3).
//   T-04-19: org assertion — voice_notes row's organization_id MUST match the
//            caller's org before any write.
//   T-04-20: notes is append-only — applyVoiceNoteFields reads-then-
//            concatenates; it never replaces.
// ---------------------------------------------------------------------------

// D4-05 scalar allowlist as a Zod enum — this is the server-side gate.
// Client checkbox state is UNTRUSTED; we validate every item here regardless
// of what the form sent.
const ALLOWED_FIELD_SCHEMA = z.enum([
  'current_role_title',
  'current_company',
  'market_status',
  'seniority_level',
])

const applyVoiceNoteSchema = z.object({
  voiceNoteId: z.string().uuid('Invalid voice note id.'),
  candidateId: z.string().uuid('Invalid candidate id.'),
  // Each item MUST be in the D4-05 allowlist — off-list → reject the request.
  approvedFields: z.array(ALLOWED_FIELD_SCHEMA),
  approveNote: z.boolean(),
  approveActivity: z.boolean(),
})

export type ApplyVoiceNoteInput = z.infer<typeof applyVoiceNoteSchema>
export type ActionResult = { ok: true } | { ok: false; error: string }

export async function applyVoiceNoteAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = applyVoiceNoteSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid request.'
    return { ok: false, error: first }
  }
  const { voiceNoteId, candidateId, approvedFields, approveNote, approveActivity } = parsed.data

  // Require at least some approval intent — disallow a no-op apply call.
  if (approvedFields.length === 0 && !approveNote && !approveActivity) {
    return { ok: false, error: 'Select at least one change to apply.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }
  const organizationId = profileResult.data.organization_id

  // Load the voice_notes row and assert org ownership + status guard.
  // T-04-19: cross-tenant prevention — the voice note MUST belong to the
  // caller's org before we write anything to the candidate.
  const vnResult = await getVoiceNote(supabase, voiceNoteId)
  if (!vnResult.ok) {
    return vnResult.code === 'not_found'
      ? { ok: false, error: 'Voice note not found.' }
      : { ok: false, error: 'Could not load voice note.' }
  }
  const voiceNote = vnResult.data

  if (voiceNote.organization_id !== organizationId) {
    // Log attempt as a potential tampering signal — do not expose details.
    Sentry.captureException(new Error('applyVoiceNoteAction: cross-tenant org assertion failed'), {
      tags: {
        phase: 'p4',
        layer: 'action',
        helper: 'applyVoiceNoteAction',
        voice_note_id: voiceNoteId,
      },
    })
    return { ok: false, error: 'Voice note not found.' }
  }

  if (voiceNote.status !== 'ready_for_review') {
    return {
      ok: false,
      error: 'This voice note is not ready for review. Please refresh and try again.',
    }
  }

  // Parse structured_data into the proposal shape. The Inngest pipeline
  // writes a conformant VoiceNoteProposal here — treat the Json field as
  // unknown and validate the shape we need.
  const proposalRaw = voiceNote.structured_data
  if (!proposalRaw || typeof proposalRaw !== 'object') {
    return { ok: false, error: 'Voice note proposal is missing. Cannot apply changes.' }
  }
  // reason: structured_data is Json (recursive union); we validated presence
  // and object type above. The Inngest pipeline writes a known-shape object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proposal = proposalRaw as any

  if (!Array.isArray(proposal.proposed_field_changes)) {
    return { ok: false, error: 'Voice note proposal is malformed. Cannot apply changes.' }
  }

  const result = await applyVoiceNoteFields(supabase, {
    voiceNoteId,
    candidateId,
    organizationId,
    approvedFields,
    approveNote,
    approveActivity,
    actorUserId: user.id,
    proposal,
  })

  if (!result.ok) {
    return { ok: false, error: 'Could not apply changes. Please try again.' }
  }

  revalidatePath(`/candidates/${candidateId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// rejectVoiceNoteAction — Plan 04-03 Task 1.
//
// Discards the proposal but preserves the transcript and audio_storage_path.
// The voice note record is retained for audit purposes (status = 'rejected').
// ---------------------------------------------------------------------------

const rejectVoiceNoteSchema = z.object({
  voiceNoteId: z.string().uuid('Invalid voice note id.'),
  candidateId: z.string().uuid('Invalid candidate id.'),
})

export type RejectVoiceNoteInput = z.infer<typeof rejectVoiceNoteSchema>

export async function rejectVoiceNoteAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = rejectVoiceNoteSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid request.'
    return { ok: false, error: first }
  }
  const { voiceNoteId, candidateId } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }
  const organizationId = profileResult.data.organization_id

  // Org assertion — same as apply.
  const vnResult = await getVoiceNote(supabase, voiceNoteId)
  if (!vnResult.ok) {
    return vnResult.code === 'not_found'
      ? { ok: false, error: 'Voice note not found.' }
      : { ok: false, error: 'Could not load voice note.' }
  }
  if (vnResult.data.organization_id !== organizationId) {
    return { ok: false, error: 'Voice note not found.' }
  }

  // Update status to 'rejected'. transcript + audio_storage_path are
  // intentionally NOT touched — the recruiter may still want to reference
  // the transcript manually even after rejection.
  const { error: updateErr } = await supabase
    .from('voice_notes')
    .update({ status: 'rejected' })
    .eq('id', voiceNoteId)
    .eq('organization_id', organizationId)

  if (updateErr) {
    Sentry.captureException(updateErr, {
      tags: {
        phase: 'p4',
        layer: 'action',
        helper: 'rejectVoiceNoteAction',
        voice_note_id: voiceNoteId,
      },
    })
    return { ok: false, error: 'Could not reject voice note. Please try again.' }
  }

  revalidatePath(`/candidates/${candidateId}`)
  return { ok: true }
}
