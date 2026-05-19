import * as Sentry from '@sentry/nextjs'

import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// spec-audio-retention-sweep — Plan 03-02 Task B.4.
//
// Per D3-10: delete the Storage object 30 days after the draft was approved
// or rejected. Cron runs nightly at 03:00 BST.
//
// Pattern per PATTERNS §9 (mirror cleanup-stale-summaries.ts shape +
// refresh-outlook-subscription.ts heartbeat).
//
// CRITICAL — Pitfall 10 (RESEARCH): the retention window MUST anchor on
// `status_changed_at`, NOT created_at. A draft can sit at
// status='ready_for_review' for months before the recruiter approves it —
// anchoring on created_at would delete the audio before the recruiter
// gets to review it.
//
// The query filters on `status in ('approved','rejected')` so the only
// rows considered are ones whose status_changed_at represents the
// approval/rejection moment (the bump_status_changed_at trigger keeps
// the column in sync with the status enum).
//
// Idempotent: after Storage.remove() succeeds, we NULL audio_storage_path
// on the row so a re-run of the sweep skips it.
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 30

export const specAudioRetentionSweep = inngest.createFunction(
  {
    id: 'spec-audio-retention-sweep',
    triggers: [{ cron: 'TZ=Europe/London 0 3 * * *' }],
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ error }) => {
      Sentry.captureException(
        formatErrorForSentry(error, 'spec-audio-retention-sweep onFailure:'),
        {
          tags: {
            phase: 'p3',
            layer: 'inngest',
            function: 'spec-audio-retention-sweep',
            handler: 'onFailure',
          },
        },
      )
    },
  },
  async ({ step }) => {
    // Heartbeat for external Sentry Crons monitor — fires every run even
    // when 0 rows were eligible.
    Sentry.captureMessage('phase3:spec-audio-retention:heartbeat', {
      level: 'info',
      tags: {
        phase: 'p3',
        layer: 'inngest',
        function: 'spec-audio-retention-sweep',
      },
    })

    return await step.run('sweep', async () => {
      const supabase = createServiceClient()
      // 30 days back, anchored on status_changed_at (Pitfall 10).
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

      const { data: rows, error: queryErr } = await supabase
        .from('spec_drafts')
        .select('id, organization_id, audio_storage_path')
        .in('status', ['approved', 'rejected'])
        .lt('status_changed_at', cutoff)
        .not('audio_storage_path', 'is', null)
        .limit(500)

      if (queryErr) {
        throw new Error(`spec-audio-retention:query: ${queryErr.message}`)
      }
      if (!rows || rows.length === 0) {
        return { deleted: 0 }
      }

      let deletedCount = 0
      for (const row of rows) {
        if (!row.audio_storage_path) continue
        const { error: removeErr } = await supabase.storage
          .from('spec-audio')
          .remove([row.audio_storage_path])
        if (removeErr) {
          // Treat as soft failure — Sentry-capture but continue. The row
          // will be retried on the next nightly tick because the path is
          // still non-NULL.
          Sentry.captureException(
            new Error(`storage-remove:${removeErr.name ?? 'UnknownError'}`),
            {
              tags: {
                phase: 'p3',
                layer: 'inngest',
                function: 'spec-audio-retention-sweep',
                subop: 'storage.remove',
                spec_draft_id: row.id,
              },
            },
          )
          continue
        }
        // Idempotency anchor: NULL the path so subsequent sweeps skip
        // this row even if the audio was already physically gone.
        const { error: updErr } = await supabase
          .from('spec_drafts')
          .update({ audio_storage_path: null })
          .eq('id', row.id)
          .eq('organization_id', row.organization_id)
        if (updErr) {
          Sentry.captureException(
            new Error(`update-null-path:${updErr.message}`),
            {
              tags: {
                phase: 'p3',
                layer: 'inngest',
                function: 'spec-audio-retention-sweep',
                subop: 'update',
                spec_draft_id: row.id,
              },
            },
          )
          continue
        }
        deletedCount++
      }

      Sentry.addBreadcrumb({
        category: 'inngest',
        message: `spec-audio-retention: deleted ${deletedCount} of ${rows.length} eligible audio files`,
        level: 'info',
      })
      return { deleted: deletedCount, considered: rows.length }
    })
  },
)
