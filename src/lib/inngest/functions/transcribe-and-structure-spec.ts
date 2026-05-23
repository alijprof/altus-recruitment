import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { recompressToOpus } from '@/lib/ai/ffmpeg'
import { extractJdFromTranscript } from '@/lib/ai/jd-extract'
import { transcribe } from '@/lib/ai/whisper'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// transcribe-and-structure-spec — Plan 03-02 Task B.2.
//
// Pipeline: download audio → ffmpeg recompress → ffprobe duration → Whisper
// transcribe → Sonnet structure JD → persist draft. Single Inngest function
// chains all five steps so a recruiter sees status flip from `pending` →
// `transcribing` → `ready_for_review` in one place (CONTEXT D3-08).
//
// Concurrency: { limit: 3, key: event.data.user_id } per CONTEXT D3-34 —
// max 3 spec uploads in flight per recruiter so a chain of recordings can't
// monopolise the org's Whisper quota.
//
// On any final failure: onFailure handler marks spec_drafts.status='failed'
// with a friendly parse_error so /spec/[id]/review renders a retry button
// (mirror parse-cv.ts lines 100–122).
//
// HARD RULE 4 (tenant boundary): storage_path MUST start with
// `${organization_id}/` before ANY service-role download. The service-role
// client BYPASSES RLS — this check is the only thing standing between a
// forged event payload and a cross-tenant byte read.
// ---------------------------------------------------------------------------

const FAILED_USER_MESSAGE =
  'Transcription failed. Try uploading again, or contact support.'

// Defensive cap. The DB CHECK enforces ≤ 50 000 chars (D3-11) but we
// truncate here first so the UX surfaces a friendlier "truncated" hint
// rather than a generic DB error.
const MAX_TRANSCRIPT_CHARS = 50_000

// UI-cap on recording length. 60 minutes covers the longest realistic
// spec call. Anything longer is either a botched concatenation or a
// recorder left running; we fail the draft with a helpful message
// instead of paying Whisper to transcribe noise.
const MAX_DURATION_SECONDS = 3600

type SpecUploadedEventData = {
  organization_id: string
  spec_draft_id: string
  storage_path: string
  mime_type: string
  user_id: string | null
}

function asSpecUploadedData(value: unknown): SpecUploadedEventData {
  // reason: Inngest types are deliberately wide. We trust the payload
  // because submitSpecCallAction is the only producer; HARD RULE 4
  // checks below catch any forgery.
  return value as SpecUploadedEventData
}

async function markSpecFailed(args: {
  draftId: string
  organizationId: string
  userMessage: string
}) {
  try {
    const supabase = createServiceClient()
    await supabase
      .from('spec_drafts')
      .update({ status: 'failed', parse_error: args.userMessage })
      .eq('id', args.draftId)
      .eq('organization_id', args.organizationId)
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${name}: mark-spec-failed write failed`), {
      tags: {
        layer: 'inngest',
        function: 'transcribe-and-structure-spec',
        subop: 'mark-failed',
        spec_draft_id: args.draftId,
      },
    })
  }
}

export const transcribeAndStructureSpec = inngest.createFunction(
  {
    id: 'transcribe-and-structure-spec',
    triggers: [{ event: 'spec/uploaded' }],
    // D3-34: max 3 spec uploads concurrently per recruiter. Inngest derives
    // the lock key from the event payload so chained uploads from the same
    // recruiter queue rather than starve other tenants.
    concurrency: { limit: 3, key: 'event.data.user_id' },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const original = asSpecUploadedData(event.data.event.data)
      const status = readStatus(error)
      Sentry.captureException(
        new Error(`${error.name}: ${status} (onFailure handler)`),
        {
          tags: {
            phase: 'p3',
            layer: 'inngest',
            function: 'transcribe-and-structure-spec',
            handler: 'onFailure',
            spec_draft_id: original.spec_draft_id,
          },
        },
      )
      await markSpecFailed({
        draftId: original.spec_draft_id,
        organizationId: original.organization_id,
        userMessage: FAILED_USER_MESSAGE,
      })
    },
  },
  async ({ event, step }) => {
    const data = asSpecUploadedData(event.data)
    // mime_type is captured in the spec_drafts row at upload time; the
    // Inngest pipeline always re-encodes to WebM/Opus before calling
    // Whisper so we don't need the original mime here.
    const { organization_id, spec_draft_id, storage_path, user_id } = data

    // ---------------------------------------------------------------------
    // HARD RULE 4 — tenant boundary check.
    //
    // The service-role client BYPASSES RLS. The only thing standing between
    // a forged event payload and a cross-tenant Storage read is this check.
    // Storage path convention (set in submitSpecCallAction):
    //   <org_id>/<user_id>/<draft_id>.<ext>
    // Fire NonRetriableError BEFORE Inngest spends an attempt on it.
    // ---------------------------------------------------------------------
    if (!storage_path.startsWith(`${organization_id}/`)) {
      throw new NonRetriableError('cross-tenant-storage-path')
    }

    try {
      await step.run('mark-transcribing', async () => {
        const supabase = createServiceClient()
        // Explicit organization_id filter per HARD RULE 4 (defence in depth
        // for service-role writes).
        await supabase
          .from('spec_drafts')
          .update({ status: 'transcribing' })
          .eq('id', spec_draft_id)
          .eq('organization_id', organization_id)
      })

      // WR-02 fix: collapse download → recompress → probe → transcribe into a
      // single Inngest step so the audio buffer never crosses a step boundary.
      // Inngest step outputs are JSON and capped at ~1 MB on free tier — a
      // 100 MiB upload base64-encoded would exceed that by ~130×. We trade
      // step-level retry granularity (which the previous code didn't really
      // use — NonRetriableError on most failure paths) for correctness at
      // realistic file sizes. Step output is just `{ transcript, durationSeconds }`.
      const {
        transcriptText: rawTranscript,
        durationSeconds,
        whisperCostPence,
      } = await step.run(
        'process-audio',
        async (): Promise<{
          transcriptText: string
          durationSeconds: number
          whisperCostPence: number
        }> => {
          const supabase = createServiceClient()
          const { data: blob, error } = await supabase.storage
            .from('spec-audio')
            .download(storage_path)
          if (error || !blob) {
            throw new NonRetriableError(
              `storage-download:${error?.message ?? 'no-data'}`,
            )
          }
          const ab = await blob.arrayBuffer()
          const rawAudio = Buffer.from(ab)
          const compressed = await recompressToOpus(rawAudio, {
            bitrate: '32k',
            channels: 1,
          })
          // Whisper's verbose_json response carries the real audio duration —
          // we don't need ffprobe at all. fluent-ffmpeg's .ffprobe() on a
          // stream is unreliable on Vercel (ffprobe needs seekable input for
          // the moov atom; streams aren't seekable), so eliminating the
          // probe step removes a whole class of failures.
          const transcript = await transcribe({
            organizationId: organization_id,
            userId: user_id,
            purpose: 'spec_transcribe',
            audioBuffer: compressed,
            // After recompress the container is WebM/Opus — match it.
            mimeType: 'audio/webm',
          })
          if (transcript.durationSeconds <= 0) {
            return { transcriptText: '', durationSeconds: -1, whisperCostPence: 0 }
          }
          if (transcript.durationSeconds > MAX_DURATION_SECONDS) {
            return { transcriptText: '', durationSeconds: -2, whisperCostPence: 0 }
          }
          return {
            transcriptText: transcript.text ?? '',
            durationSeconds: transcript.durationSeconds,
            whisperCostPence: transcript.costPence,
          }
        },
      )

      if (durationSeconds === -1) {
        await markSpecFailed({
          draftId: spec_draft_id,
          organizationId: organization_id,
          userMessage: 'Could not read the audio file. Please re-upload.',
        })
        throw new NonRetriableError('spec-audio:no-duration')
      }
      if (durationSeconds === -2) {
        await markSpecFailed({
          draftId: spec_draft_id,
          organizationId: organization_id,
          userMessage:
            'Recording is over 60 minutes. Split into chunks and re-upload.',
        })
        throw new NonRetriableError('spec-audio:over-60-min')
      }

      const transcriptText = rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS)

      if (transcriptText.trim().length === 0) {
        await markSpecFailed({
          draftId: spec_draft_id,
          organizationId: organization_id,
          userMessage:
            'Transcription returned no text. The recording may be silent.',
        })
        throw new NonRetriableError('spec-audio:empty-transcript')
      }

      const jdDraft = await step.run('sonnet-structure-jd', async () => {
        return await extractJdFromTranscript(transcriptText, {
          organizationId: organization_id,
          userId: user_id,
        })
      })

      await step.run('persist-draft', async () => {
        const supabase = createServiceClient()
        // Defence in depth — re-read the row's organization_id and assert
        // it matches the event payload. A forged event whose draft_id
        // points at another tenant's row would fail here even if it
        // somehow slipped past the storage_path check.
        const { data: row, error: readErr } = await supabase
          .from('spec_drafts')
          .select('organization_id')
          .eq('id', spec_draft_id)
          .maybeSingle()
        if (readErr) {
          throw new Error(`persist-draft read: ${readErr.message}`)
        }
        if (!row || row.organization_id !== organization_id) {
          throw new NonRetriableError('cross-tenant-spec-draft')
        }
        const { error: updErr } = await supabase
          .from('spec_drafts')
          .update({
            transcript: transcriptText,
            structured_data: jdDraft,
            status: 'ready_for_review',
            whisper_cost_pence: whisperCostPence,
            sonnet_cost_pence: jdDraft.costPence,
            parse_error: null,
          })
          .eq('id', spec_draft_id)
          .eq('organization_id', organization_id)
        if (updErr) {
          throw new Error(`persist-draft update: ${updErr.message}`)
        }
      })
    } catch (err) {
      // VERIFICATION R4: never pass the raw err to Sentry. Wrap to
      // name + status only so SDK errors that echo prompts can't bypass
      // the global beforeSend PII scrub.
      const name = err instanceof Error ? err.name : 'UnknownError'
      const status = readStatus(err)
      Sentry.captureException(new Error(`${name}: ${status}`), {
        tags: {
          phase: 'p3',
          layer: 'inngest',
          function: 'transcribe-and-structure-spec',
          spec_draft_id,
        },
      })
      // NonRetriableError already marked the row failed via the dedicated
      // call paths above. For unexpected throws, ensure the UI shows a
      // retry button.
      if (!(err instanceof NonRetriableError)) {
        await markSpecFailed({
          draftId: spec_draft_id,
          organizationId: organization_id,
          userMessage: FAILED_USER_MESSAGE,
        })
      }
      throw err
    }
  },
)
