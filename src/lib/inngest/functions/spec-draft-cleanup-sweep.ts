import * as Sentry from '@sentry/nextjs'

import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// spec-draft-cleanup-sweep — Plan 03-02 Task B.4.
//
// Per D3-30: rejected spec drafts are soft-deleted (deleted_at = now()).
// This nightly sweep hard-deletes rows whose deleted_at is older than 30
// days, so the recruiter's "I changed my mind" undo window stays bounded.
//
// Staggered 30 minutes after spec-audio-retention-sweep so the audio file
// (if any) is removed first; then this sweep clears the row.
//
// Pattern per PATTERNS §2 (cleanup-stale-summaries.ts shape).
// ---------------------------------------------------------------------------

const VACUUM_DAYS = 30

export const specDraftCleanupSweep = inngest.createFunction(
  {
    id: 'spec-draft-cleanup-sweep',
    triggers: [{ cron: 'TZ=Europe/London 30 3 * * *' }],
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ error }) => {
      Sentry.captureException(
        formatErrorForSentry(error, 'spec-draft-cleanup-sweep onFailure:'),
        {
          tags: {
            phase: 'p3',
            layer: 'inngest',
            function: 'spec-draft-cleanup-sweep',
            handler: 'onFailure',
          },
        },
      )
    },
  },
  async ({ step }) => {
    Sentry.captureMessage('phase3:spec-draft-cleanup:heartbeat', {
      level: 'info',
      tags: {
        phase: 'p3',
        layer: 'inngest',
        function: 'spec-draft-cleanup-sweep',
      },
    })

    return await step.run('hard-delete', async () => {
      const supabase = createServiceClient()
      const cutoff = new Date(Date.now() - VACUUM_DAYS * 24 * 60 * 60 * 1000).toISOString()

      // Use the .lt('deleted_at', cutoff) filter with a select first so we
      // know how many we hit (and can log a per-tenant breakdown later).
      // Single hard-delete is acceptable at expected volumes (anchor ~120
      // spec calls/year; rejection rate single-digit %).
      const { data: removed, error } = await supabase
        .from('spec_drafts')
        .delete()
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null)
        .select('id')

      if (error) {
        throw new Error(`spec-draft-cleanup:${error.message}`)
      }

      const deleted = removed?.length ?? 0
      Sentry.addBreadcrumb({
        category: 'inngest',
        message: `spec-draft-cleanup: hard-deleted ${deleted} rows`,
        level: 'info',
      })
      return { deleted }
    })
  },
)
