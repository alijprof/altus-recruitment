'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { getProfile } from '@/lib/db/profiles'
import {
  createSpecDraft,
  updateSpecDraftAudioPath,
} from '@/lib/db/spec-drafts'
import { inngest } from '@/lib/inngest/client'
import { createClient } from '@/lib/supabase/server'

export type SubmitSpecCallResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// submitSpecCallAction — Plan 03-02 Task B.3.
//
// Validation order matters: cheapest first. Mime + size are checked before
// we touch Storage so a clearly-broken request never spends a write quota.
// Mirrors uploadCVAction's shape from src/app/(app)/candidates/[id]/actions.ts
// lines 110–240.
// ---------------------------------------------------------------------------

// D3-06: 100 MiB upper bound. Audio compression varies — a 60-min phone
// recording at AAC ~64kbps is ~30 MiB; 100 MiB covers ~3-hour outliers
// and matches the bucket file_size_limit.
const MAX_AUDIO_BYTES = 100 * 1024 * 1024

const ACCEPTED_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
])

function extForMime(mime: string): string {
  switch (mime) {
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/wav':
      return 'wav'
    case 'audio/mp4':
      return 'm4a'
    default:
      return 'webm'
  }
}

const companyIdSchema = z
  .string()
  .uuid()
  .nullable()
  .optional()
  .transform((v) => v ?? null)

export async function submitSpecCallAction(
  formData: FormData,
): Promise<SubmitSpecCallResult> {
  const audioRaw = formData.get('audio')
  const companyRaw = formData.get('company_id')

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

  const companyParsed = companyIdSchema.safeParse(
    typeof companyRaw === 'string' && companyRaw.length > 0 ? companyRaw : null,
  )
  if (!companyParsed.success) {
    return { ok: false, error: 'Invalid client id.' }
  }
  const companyId = companyParsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }
  const organizationId = profileResult.data.organization_id

  // Create the draft row first to get a deterministic id for the storage
  // path. RLS-via-session, organization_id auto-filled by the trigger.
  const draftResult = await createSpecDraft(supabase, {
    createdBy: user.id,
    companyId,
    audioMimeType: audio.type,
  })
  if (!draftResult.ok) {
    return { ok: false, error: 'Could not create draft. Please try again.' }
  }
  const draftId = draftResult.data.id

  // Storage path: <org>/<user>/<draft>.<ext>. The Inngest function's HARD
  // RULE 4 boundary check asserts startsWith(`${org}/`) — having org at
  // index [1] of foldername(name) also satisfies the Storage RLS policy.
  const storagePath = `${organizationId}/${user.id}/${draftId}.${extForMime(audio.type)}`

  const { error: uploadErr } = await supabase.storage
    .from('spec-audio')
    .upload(storagePath, audio, { contentType: audio.type, upsert: false })
  if (uploadErr) {
    // Mark draft failed so /spec/[id] shows a friendly error instead of
    // sitting at "pending" forever. We intentionally ignore errors from
    // this update — at worst the row stays pending and the recruiter
    // retries.
    await supabase
      .from('spec_drafts')
      .update({ status: 'failed', parse_error: 'Upload failed. Try again.' })
      .eq('id', draftId)
    Sentry.captureException(new Error(`storage-upload:${uploadErr.message}`), {
      tags: { layer: 'action', helper: 'submitSpecCallAction', subop: 'storage-upload' },
    })
    return { ok: false, error: 'Storage upload failed. Please try again.' }
  }

  const pathResult = await updateSpecDraftAudioPath(supabase, {
    id: draftId,
    storagePath,
    mimeType: audio.type,
  })
  if (!pathResult.ok) {
    // Roll back the orphaned object so we don't pay for storage on a
    // draft we can't track.
    await supabase.storage.from('spec-audio').remove([storagePath])
    return { ok: false, error: 'Could not record audio path. Try again.' }
  }

  // Dispatch the spec/uploaded event. Same Sentry-on-failure + flip-to-
  // failed pattern as uploadCVAction lines 206–236.
  try {
    await inngest.send({
      name: 'spec/uploaded',
      data: {
        organization_id: organizationId,
        spec_draft_id: draftId,
        storage_path: storagePath,
        mime_type: audio.type,
        user_id: user.id,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send failed`), {
      tags: {
        phase: 'p3',
        layer: 'action',
        helper: 'submitSpecCallAction',
        subop: 'inngest.send',
        spec_draft_id: draftId,
      },
    })
    await supabase
      .from('spec_drafts')
      .update({
        status: 'failed',
        parse_error: 'Could not queue transcription. Try again.',
      })
      .eq('id', draftId)
    return { ok: false, error: 'Could not queue transcription. Try again.' }
  }

  revalidatePath('/spec')
  return { ok: true, draftId }
}
