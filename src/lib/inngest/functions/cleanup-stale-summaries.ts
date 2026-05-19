import * as Sentry from '@sentry/nextjs'

import { deleteStaleMatchSummaries } from '@/lib/db/ai-summaries'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// cleanup-stale-summaries — Plan 2 Task 2.3.
//
// Weekly cron (Monday 04:00 BST) sweep of stale `match_score` rows in
// `ai_summaries`. A row is stale when either the candidate or the job
// embedding_version has advanced past the cached row's recorded version.
//
// Correctness doesn't depend on the sweep — `getMatchSummary` filters on
// the version columns so stale rows are simply ignored on reads. The
// sweep keeps storage bounded.
//
// concurrency.limit = 1 because the sweep is global (no per-org payload).
// retries = 1 because stale rows are idempotently harmless until the
// next weekly run.
// ---------------------------------------------------------------------------

export const cleanupStaleSummaries = inngest.createFunction(
  {
    id: 'cleanup-stale-summaries',
    triggers: [{ cron: 'TZ=Europe/London 0 4 * * 1' }],
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ error }) => {
      Sentry.captureException(
        formatErrorForSentry(error, 'cleanup-stale-summaries onFailure:'),
        {
          tags: {
            layer: 'inngest',
            function: 'cleanup-stale-summaries',
            handler: 'onFailure',
          },
        },
      )
    },
  },
  async ({ step }) => {
    return await step.run('delete-stale', async () => {
      const supabase = createServiceClient()
      const result = await deleteStaleMatchSummaries(supabase)
      if (!result.ok) {
        throw new Error(`deleteStaleMatchSummaries: ${result.code}`)
      }
      Sentry.addBreadcrumb({
        category: 'inngest',
        message: `cleanup-stale-summaries: deleted ${result.data.deleted} rows`,
        level: 'info',
      })
      return { deleted: result.data.deleted }
    })
  },
)
