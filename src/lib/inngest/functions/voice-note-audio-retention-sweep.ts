import * as Sentry from '@sentry/nextjs'

import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// voice-note-audio-retention-sweep — Plan 04-02 Task 2 (D4-06).
//
// Per D4-06: soft-delete the Storage audio object 30 days after the voice
// note was created. Cron runs nightly at 03:00 BST — same tick as the
// spec-audio-retention-sweep so both sweeps complete in the same nightly
// window.
//
// Retention anchors on created_at (not a status_changed_at column — voice
// notes don't have a bump-status trigger like spec_drafts). A voice note
// captured 30 days ago has had plenty of time for the recruiter to review;
// the audio is no longer needed regardless of review status.
//
// Idempotent: after Storage.remove() succeeds, set audio_storage_path=null
// + deleted_at=now() on the row. Subsequent runs skip rows with null path.
// deleted_at is the soft-delete marker for the voice_notes row itself — we
// do NOT hard-delete the row (the transcript + structured_data stay for
// audit purposes). This mirrors D3-30 / spec-audio-retention-sweep.ts.
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 30

export const voiceNoteAudioRetentionSweep = inngest.createFunction(
  {
    id: 'voice-note-audio-retention-sweep',
    triggers: [{ cron: 'TZ=Europe/London 0 3 * * *' }],
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ error }) => {
      Sentry.captureException(
        formatErrorForSentry(error, 'voice-note-audio-retention-sweep onFailure:'),
        {
          tags: {
            phase: 'p4',
            layer: 'inngest',
            function: 'voice-note-audio-retention-sweep',
            handler: 'onFailure',
          },
        },
      )
    },
  },
  async ({ step }) => {
    // Heartbeat for external Sentry Crons monitor — fires every run even
    // when 0 rows were eligible.
    Sentry.captureMessage('phase4:voice-note-audio-retention:heartbeat', {
      level: 'info',
      tags: {
        phase: 'p4',
        layer: 'inngest',
        function: 'voice-note-audio-retention-sweep',
      },
    })

    return await step.run('sweep', async () => {
      const supabase = createServiceClient()
      // 30 days back, anchored on created_at.
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

      const { data: rows, error: queryErr } = await supabase
        .from('voice_notes')
        .select('id, organization_id, audio_storage_path')
        .lt('created_at', cutoff)
        .not('audio_storage_path', 'is', null)
        .limit(500)

      if (queryErr) {
        throw new Error(`voice-note-audio-retention:query: ${queryErr.message}`)
      }
      if (!rows || rows.length === 0) {
        return { deleted: 0, considered: 0 }
      }

      let deletedCount = 0
      for (const row of rows) {
        if (!row.audio_storage_path) continue

        const { error: removeErr } = await supabase.storage
          .from('voice-note-audio')
          .remove([row.audio_storage_path])
        if (removeErr) {
          // Treat as soft failure — Sentry-capture but continue. The row
          // will be retried on the next nightly tick because the path is
          // still non-NULL (NULL-path idempotency anchor).
          Sentry.captureException(
            new Error(`storage-remove:${removeErr.name ?? 'UnknownError'}`),
            {
              tags: {
                phase: 'p4',
                layer: 'inngest',
                function: 'voice-note-audio-retention-sweep',
                subop: 'storage.remove',
                voice_note_id: row.id,
              },
            },
          )
          continue
        }

        // Idempotency anchor: NULL the path and set deleted_at so subsequent
        // sweeps skip this row even if the audio was already physically gone.
        // Scoped by id + organization_id for defence in depth (service-role
        // bypasses RLS; explicit org scope prevents cross-tenant writes).
        const { error: updErr } = await supabase
          .from('voice_notes')
          .update({
            audio_storage_path: null,
            deleted_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('organization_id', row.organization_id)
        if (updErr) {
          Sentry.captureException(new Error(`update-null-path:${updErr.message}`), {
            tags: {
              phase: 'p4',
              layer: 'inngest',
              function: 'voice-note-audio-retention-sweep',
              subop: 'update',
              voice_note_id: row.id,
            },
          })
          continue
        }
        deletedCount++
      }

      Sentry.addBreadcrumb({
        category: 'inngest',
        message: `voice-note-audio-retention: deleted ${deletedCount} of ${rows.length} eligible audio files`,
        level: 'info',
      })
      return { deleted: deletedCount, considered: rows.length }
    })
  },
)
