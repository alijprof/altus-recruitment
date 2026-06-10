'use server'

import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { getProfile } from '@/lib/db/profiles'
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
