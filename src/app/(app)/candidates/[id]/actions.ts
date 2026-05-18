'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { createActivity } from '@/lib/db/activities'
import {
  createCandidateCV,
  getCandidateCV,
  markCandidateFieldsFromCV,
  nextCVVersion,
  updateCandidateCVParse,
} from '@/lib/db/candidate-cvs'
import { getProfile } from '@/lib/db/profiles'
import { inngest } from '@/lib/inngest/client'
import { createClient } from '@/lib/supabase/server'

export type ActionResult = { ok: true } | { ok: false; error: string }
export type UploadCVResult =
  | { ok: true; candidateCvId: string }
  | { ok: false; error: string }

// Activity kinds the in-page LogActivityForm can write. We intentionally don't
// expose `stage_change` or `system` here — those are written by the pipeline
// (Plan 4) and by background jobs respectively, not by the manual log form.
const LOG_ACTIVITY_KINDS = ['note', 'call', 'meeting'] as const

const logActivitySchema = z.object({
  candidateId: z.string().uuid('Invalid candidate id.'),
  kind: z.enum(LOG_ACTIVITY_KINDS),
  body: z
    .string()
    .trim()
    .min(1, 'Add a short note before saving.')
    .max(5000, 'That note is too long — keep it under 5,000 characters.'),
})

export type LogActivityInput = z.infer<typeof logActivitySchema>

export async function logActivityAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = logActivitySchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid activity.'
    return { ok: false, error: first }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // The middleware should have caught this; defensive check.
    return { ok: false, error: 'Not signed in.' }
  }

  // We use Plan 3's createActivity helper because it landed first and owns
  // src/lib/db/activities.ts (parallel-execution scope split). The bump of
  // candidates.last_contacted_at is handled by the
  // activities_bump_candidate_last_contacted Postgres trigger added in
  // migration 20260517215938.
  const result = await createActivity(supabase, {
    kind: parsed.data.kind,
    entity_type: 'candidate',
    entity_id: parsed.data.candidateId,
    body: parsed.data.body,
    actor_user_id: user.id,
  })

  if (!result.ok) {
    return { ok: false, error: 'Couldn’t save activity. Please try again.' }
  }

  // Revalidate the detail page so the timeline + last_contacted_at refresh.
  revalidatePath(`/candidates/${parsed.data.candidateId}`)
  revalidatePath('/candidates')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// CV upload (Plan 2).
//
// Validation order matters: cheapest first. Mime + size are checked before
// we touch Storage so a clearly-broken request never spends a write quota.
// ---------------------------------------------------------------------------

// VERIFICATION R9: practical cap. The Storage bucket allows 50 MiB but
// unpdf runs in-memory in the Inngest function — a 50 MiB scanned PDF
// could exhaust the runner. Most CVs are < 1 MiB; 10 MiB is plenty.
const MAX_CV_BYTES = 10 * 1024 * 1024

const ACCEPTED_CV_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function slugifyFilename(name: string): string {
  // Strip the extension first so the slug is just the readable name.
  const withoutExt = name.replace(/\.(pdf|docx)$/i, '')
  return (
    withoutExt
      .toLowerCase()
      // Path-traversal defence: anything not alphanumeric becomes a dash.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'cv'
  )
}

export async function uploadCVAction(formData: FormData): Promise<UploadCVResult> {
  const candidateIdRaw = formData.get('candidateId')
  const fileRaw = formData.get('file')

  const candidateId = typeof candidateIdRaw === 'string' ? candidateIdRaw : ''
  if (!candidateId || !z.string().uuid().safeParse(candidateId).success) {
    return { ok: false, error: 'Invalid candidate id.' }
  }

  if (!(fileRaw instanceof File) || fileRaw.size === 0) {
    return { ok: false, error: 'Choose a CV file before uploading.' }
  }
  const file = fileRaw

  if (!ACCEPTED_CV_MIME.has(file.type)) {
    return {
      ok: false,
      error: 'Only PDF and DOCX files are supported.',
    }
  }
  if (file.size > MAX_CV_BYTES) {
    return {
      ok: false,
      error: 'That file is over 10 MiB. Please upload a smaller CV.',
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }
  const organizationId = profileResult.data.organization_id

  // Compute version BEFORE upload — the (candidate_id, version) unique
  // constraint surfaces racing uploads as a 409 we can re-derive from.
  const versionResult = await nextCVVersion(supabase, candidateId)
  if (!versionResult.ok) {
    return { ok: false, error: 'Couldn’t compute CV version. Please try again.' }
  }
  const version = versionResult.data

  const ext = file.type === 'application/pdf' ? 'pdf' : 'docx'
  const cvUuid = crypto.randomUUID()
  const safeName = slugifyFilename(file.name)
  const storagePath = `${organizationId}/${candidateId}/${cvUuid}-${safeName}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('cvs')
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    return { ok: false, error: 'Storage upload failed. Please try again.' }
  }

  const cvRowResult = await createCandidateCV(supabase, {
    candidateId,
    storagePath,
    mimeType: file.type,
    fileSizeBytes: file.size,
    version,
    uploadedBy: user.id,
  })
  if (!cvRowResult.ok) {
    // Roll back the orphaned Storage object so we don't leak bytes.
    await supabase.storage.from('cvs').remove([storagePath])
    return { ok: false, error: 'Couldn’t record this CV. Please try again.' }
  }
  const candidateCvId = cvRowResult.data.id

  // Activity: CV uploaded (uses Plan 3's createActivity helper for
  // consistent shape + the activities_bump_candidate_last_contacted
  // trigger to refresh last_contacted_at).
  await createActivity(supabase, {
    kind: 'system',
    entity_type: 'candidate',
    entity_id: candidateId,
    body: 'CV uploaded',
    actor_user_id: user.id,
    metadata: { candidate_cv_id: candidateCvId, version },
  })

  // Dispatch the cv/uploaded event. Review fix H1: server actions are NOT
  // covered by Next's onRequestError instrumentation, and the Sentry
  // beforeSend filter only scrubs PII — it does not generate events. A
  // silent catch leaves the candidate_cvs row stuck at parsing_status =
  // 'pending' with no Retry button (Retry only appears for 'failed'),
  // so we explicitly:
  //   1. Capture a PII-safe Error to Sentry (mirrors R4: never the raw
  //      error — only err.name + a fixed subop label).
  //   2. Flip the row to 'failed' so the UI shows the Retry button.
  // We still return { ok: true, candidateCvId } because the upload + row
  // insert genuinely succeeded — the user's CV is safely in Storage and
  // the review panel will surface the failure as a retryable parse error.
  try {
    await inngest.send({
      name: 'cv/uploaded',
      data: {
        organization_id: organizationId,
        candidate_id: candidateId,
        candidate_cv_id: candidateCvId,
        storage_path: storagePath,
        mime_type: file.type,
        user_id: user.id,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send failed`), {
      tags: {
        layer: 'action',
        helper: 'uploadCVAction',
        subop: 'inngest.send',
        candidate_cv_id: candidateCvId,
      },
    })
    // Surface as 'failed' so the UI shows the Retry button. We intentionally
    // ignore any error from this update — at worst the row stays 'pending'
    // and the user re-uploads. Sentry already captured the dispatch failure.
    await updateCandidateCVParse(supabase, {
      id: candidateCvId,
      status: 'failed',
      parseError: 'Could not queue CV for parsing. Try again.',
    })
  }

  revalidatePath(`/candidates/${candidateId}`)
  return { ok: true, candidateCvId }
}

// ---------------------------------------------------------------------------
// Retry a failed parse (D-06). Sets the row back to 'pending' and re-sends
// the cv/uploaded event so Inngest runs the parser again from step 1.
// ---------------------------------------------------------------------------

const retryParseSchema = z.object({
  candidateCvId: z.string().uuid('Invalid CV id.'),
})

export type RetryParseInput = z.infer<typeof retryParseSchema>

export async function retryParseAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = retryParseSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid request.'
    return { ok: false, error: first }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const cvResult = await getCandidateCV(supabase, parsed.data.candidateCvId)
  if (!cvResult.ok) {
    return { ok: false, error: 'CV not found.' }
  }
  const cv = cvResult.data

  // Reset parsing state. Clearing parse_error explicitly so the UI flips
  // from the amber alert to the in-progress indicator immediately.
  const updateResult = await updateCandidateCVParse(supabase, {
    id: cv.id,
    status: 'pending',
    parseError: null,
  })
  if (!updateResult.ok) {
    return { ok: false, error: 'Couldn’t reset parsing state. Please try again.' }
  }

  // Review fix H1: same as uploadCVAction — empty catch left the row stuck
  // at 'pending' with no Retry button after a dispatch failure. Capture a
  // PII-safe Error to Sentry, then flip the row back to 'failed' so the
  // user sees the Retry button instead of an indefinite spinner. Surface
  // the failure to the caller so the toast in the review panel reflects
  // reality.
  try {
    await inngest.send({
      name: 'cv/uploaded',
      data: {
        organization_id: cv.organization_id,
        candidate_id: cv.candidate_id,
        candidate_cv_id: cv.id,
        storage_path: cv.storage_path,
        mime_type: cv.mime_type,
        user_id: user.id,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send failed`), {
      tags: {
        layer: 'action',
        helper: 'retryParseAction',
        subop: 'inngest.send',
        candidate_cv_id: cv.id,
      },
    })
    await updateCandidateCVParse(supabase, {
      id: cv.id,
      status: 'failed',
      parseError: 'Could not queue CV for parsing. Try again.',
    })
    return { ok: false, error: 'Couldn’t queue the CV for parsing. Please try again.' }
  }

  revalidatePath(`/candidates/${cv.candidate_id}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Accept all parsed CV fields onto the candidate row (D-08: empty-only).
// Used by the CV Review Panel's "Accept all" button.
// ---------------------------------------------------------------------------

const acceptCVFieldsSchema = z.object({
  candidateCvId: z.string().uuid('Invalid CV id.'),
})

export type AcceptCVFieldsInput = z.infer<typeof acceptCVFieldsSchema>
export type AcceptCVFieldsResult =
  | { ok: true; fieldsPopulated: string[] }
  | { ok: false; error: string }

type ExtractedDataForMerge = Parameters<typeof markCandidateFieldsFromCV>[1]['parsed']

export async function acceptCVFieldsAction(rawInput: unknown): Promise<AcceptCVFieldsResult> {
  const parsed = acceptCVFieldsSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid request.'
    return { ok: false, error: first }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const cvResult = await getCandidateCV(supabase, parsed.data.candidateCvId)
  if (!cvResult.ok) return { ok: false, error: 'CV not found.' }
  const cv = cvResult.data
  if (cv.parsing_status !== 'complete' || !cv.extracted_data) {
    return { ok: false, error: 'This CV hasn’t finished parsing yet.' }
  }

  // The Json type guarantees an object/array/scalar shape — assert at the
  // boundary and let the helper's runtime null/length checks gate writes.
  // reason: extracted_data is `Json | null` in the generated types; the
  // helper expects the ParsedCV subset shape we wrote to it in Task 2.2.
  const extracted = cv.extracted_data as unknown as ExtractedDataForMerge

  const mergeResult = await markCandidateFieldsFromCV(supabase, {
    candidateId: cv.candidate_id,
    parsed: extracted,
  })
  if (!mergeResult.ok) {
    return { ok: false, error: 'Couldn’t merge CV fields onto the candidate.' }
  }

  // UI-SPEC §Activity Type Labels — "CV parsed" → "CV extracted by AI".
  await createActivity(supabase, {
    kind: 'note',
    entity_type: 'candidate',
    entity_id: cv.candidate_id,
    body: 'CV extracted by AI',
    actor_user_id: user.id,
    metadata: {
      candidate_cv_id: cv.id,
      fields_populated: mergeResult.data.fieldsPopulated,
    },
  })

  revalidatePath(`/candidates/${cv.candidate_id}`)
  return { ok: true, fieldsPopulated: mergeResult.data.fieldsPopulated }
}
