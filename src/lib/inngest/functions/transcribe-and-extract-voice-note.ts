import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { recompressToOpus } from '@/lib/ai/ffmpeg'
import { extractVoiceNoteUpdates } from '@/lib/ai/voice-note-extract'
import { transcribe } from '@/lib/ai/whisper'
import { markVoiceNoteFailed } from '@/lib/db/voice-notes'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// transcribe-and-extract-voice-note — Plan 04-02 Task 2.
//
// Pipeline: download audio → ffmpeg recompress → Whisper transcribe →
// Sonnet extract (D4-05 allowlist) → persist proposal.
//
// Mirrors transcribe-and-structure-spec.ts structure verbatim with entity
// names substituted for voice notes.
//
// Concurrency: { limit: 3, key: event.data.user_id } — max 3 voice notes
// in flight per recruiter so a burst of recordings can't monopolise Whisper.
//
// HARD RULE 4 (tenant boundary): storage_path MUST start with
// `${organization_id}/` before ANY service-role download. The service-role
// client BYPASSES RLS — this check is the only thing standing between a
// forged event payload and a cross-tenant byte read.
//
// WR-02 pattern: audio buffer never crosses a step boundary — collapse
// download → recompress → transcribe into a single step.
// ---------------------------------------------------------------------------

const FAILED_USER_MESSAGE =
  'Transcription failed. Try uploading again, or contact support.'

type VoiceNoteUploadedEventData = {
  organization_id: string
  voice_note_id: string
  storage_path: string
  mime_type: string
  user_id: string | null
  candidate_id: string
}

function asEventData(value: unknown): VoiceNoteUploadedEventData {
  // reason: Inngest typings are deliberately wide. We trust the payload
  // because submitVoiceNoteAction is the only producer; HARD RULE 4
  // checks below catch any forgery before service-role access.
  return value as VoiceNoteUploadedEventData
}

export const transcribeAndExtractVoiceNote = inngest.createFunction(
  {
    id: 'transcribe-and-extract-voice-note',
    triggers: [{ event: 'voice-note/uploaded' }],
    // Max 3 voice notes concurrently per recruiter — same cap as spec calls.
    // Inngest derives the lock key from the event payload so chained uploads
    // from the same recruiter queue rather than starve other tenants.
    concurrency: { limit: 3, key: 'event.data.user_id' },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const original = asEventData(event.data.event.data)
      const status = readStatus(error)
      Sentry.captureException(
        new Error(`${error.name}: ${status} (onFailure handler)`),
        {
          tags: {
            phase: 'p4',
            layer: 'inngest',
            function: 'transcribe-and-extract-voice-note',
            handler: 'onFailure',
            voice_note_id: original.voice_note_id,
          },
        },
      )
      await markVoiceNoteFailed({
        voiceNoteId: original.voice_note_id,
        organizationId: original.organization_id,
        userMessage: FAILED_USER_MESSAGE,
      })
    },
  },
  async ({ event, step }) => {
    const data = asEventData(event.data)
    const { organization_id, voice_note_id, storage_path, user_id } = data

    // -------------------------------------------------------------------------
    // HARD RULE 4 — tenant boundary check.
    //
    // The service-role client BYPASSES RLS. The only thing standing between
    // a forged event payload and a cross-tenant Storage read is this check.
    // Storage path convention (set in submitVoiceNoteAction):
    //   <org_id>/<user_id>/<voice_note_id>.<ext>
    // Fire NonRetriableError BEFORE Inngest spends an attempt on it.
    // -------------------------------------------------------------------------
    if (!storage_path.startsWith(`${organization_id}/`)) {
      throw new NonRetriableError('cross-tenant-storage-path')
    }

    try {
      await step.run('mark-transcribing', async () => {
        const supabase = createServiceClient()
        await supabase
          .from('voice_notes')
          .update({ status: 'transcribing' })
          .eq('id', voice_note_id)
          .eq('organization_id', organization_id)
      })

      // WR-02 fix: collapse download → recompress → transcribe into a
      // single Inngest step so the audio buffer never crosses a step boundary.
      // Inngest step outputs are JSON and capped at ~1 MB — a 30s voice note
      // base64-encoded can exceed that. Trade step-level retry granularity
      // for correctness at realistic file sizes.
      // Step output: { transcriptText, durationSeconds, whisperCostPence }
      const {
        transcriptText,
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
            .from('voice-note-audio')
            .download(storage_path)
          if (error || !blob) {
            throw new NonRetriableError(
              `storage-download:${error?.message ?? 'no-data'}`,
            )
          }
          const ab = await blob.arrayBuffer()
          const compressed = await recompressToOpus(Buffer.from(ab), {
            bitrate: '32k',
            channels: 1,
          })
          const transcript = await transcribe({
            organizationId: organization_id,
            userId: user_id,
            purpose: 'voice_note_transcribe',
            audioBuffer: compressed,
            // After recompress the container is WebM/Opus — match it.
            mimeType: 'audio/webm',
          })
          return {
            transcriptText: transcript.text ?? '',
            durationSeconds: transcript.durationSeconds,
            whisperCostPence: transcript.costPence,
          }
        },
      )

      const proposal = await step.run('sonnet-extract', async () => {
        const result = await extractVoiceNoteUpdates({
          organizationId: organization_id,
          userId: user_id,
          transcript: transcriptText,
        })
        return result.proposal
      })

      await step.run('persist-proposal', async () => {
        const supabase = createServiceClient()
        // Defence in depth — re-read the row's organization_id and assert
        // it matches the event payload. A forged event whose voice_note_id
        // points at another tenant's row would fail here even if it somehow
        // slipped past the storage_path check.
        const { data: row, error: readErr } = await supabase
          .from('voice_notes')
          .select('organization_id')
          .eq('id', voice_note_id)
          .maybeSingle()
        if (readErr) {
          throw new Error(`persist-proposal read: ${readErr.message}`)
        }
        if (!row || row.organization_id !== organization_id) {
          throw new NonRetriableError('cross-tenant-voice-note')
        }
        const { error: updErr } = await supabase
          .from('voice_notes')
          .update({
            transcript: transcriptText,
            structured_data: proposal,
            status: 'ready_for_review',
            audio_duration_seconds: durationSeconds,
            parse_error: null,
          })
          .eq('id', voice_note_id)
          .eq('organization_id', organization_id)
        if (updErr) {
          throw new Error(`persist-proposal update: ${updErr.message}`)
        }
        void whisperCostPence // logged to ai_usage by the transcribe wrapper
      })
    } catch (err) {
      // NEVER pass raw err to Sentry — wrap to name+status only so SDK errors
      // that echo prompts can't bypass the global beforeSend PII scrub.
      const name = err instanceof Error ? err.name : 'UnknownError'
      const status = readStatus(err)
      Sentry.captureException(new Error(`${name}: ${status}`), {
        tags: {
          phase: 'p4',
          layer: 'inngest',
          function: 'transcribe-and-extract-voice-note',
          voice_note_id,
        },
      })
      // NonRetriableError paths above handle their own markVoiceNoteFailed calls.
      // For unexpected throws, ensure the UI shows a retry button.
      if (!(err instanceof NonRetriableError)) {
        await markVoiceNoteFailed({
          voiceNoteId: voice_note_id,
          organizationId: organization_id,
          userMessage: FAILED_USER_MESSAGE,
        })
      }
      throw err
    }
  },
)
