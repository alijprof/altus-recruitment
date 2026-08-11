import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { enqueueApplicationMatchScore } from '@/lib/inngest/enqueue-match-score'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// backfill-application-match-scores — Phase 7 Plan 07-06 (D-04 backfill
// half). Steele Charles feedback session 2026-08-11: auto-scoring on
// application-create shipped 4 August, so seven of their ten applications
// predate it and render no match badge — reading as "the AI does not work"
// on the screens the recruiter uses daily.
//
// THE DESIGN RULE FOR THIS FILE: NO scoring logic. `score-application-match`
// already carries every guard a backfill needs, and duplicating any of them
// here would create a second place for them to drift. This function does
// exactly one thing: select unscored, job-bearing applications and call
// `enqueueApplicationMatchScore` once per row — the SAME single fire-point
// used by add-to-job and promote-shortlist-to-application. It never invokes
// the Sonnet match-scoring call, the AI budget-cap check, the version-exact
// cache lookup, or the empty-profile predicate; every one of those
// decisions belongs to score-application-match.
//
// Triggered ONLY by the event `application/backfill-scores` — no cron. This
// is a deliberate one-off the founder starts from /admin, so spend never
// happens on a schedule nobody asked for. When `organization_id` is present
// on the event payload the sweep is scoped to that org; absent, it sweeps
// every org (D-04: the backfill covers ALL orgs by default).
//
// Modeled structurally on reconcile-cv-parses.ts (the reference multi-tenant
// sweep in this codebase): createServiceClient() inside the step.run, a hard
// row cap, per-row try/catch so one bad row never aborts the sweep, and
// PII-free Sentry (ids and counts only).
//
// Guards ALREADY enforced inside score-application-match (do not
// re-implement here):
//   * tenant boundary re-check of BOTH parents against the claimed org,
//     before any spend
//   * empty-profile skip via the shared isProfileEffectivelyEmpty
//   * idempotency: version-exact cached-summary lookup short-circuits with
//     `skipped: 'cached'` and zero spend
//   * month-to-date spend ceiling (env.MAX_MONTHLY_MATCH_SPEND_PENCE)
//   * CapExceededError handling on the org AI budget
//   * the ai_summaries unique constraint as the concurrent-double-fire
//     backstop
//
// `timeouts.start`/`timeouts.finish` mirror plan 07-05's treatment of the
// other concurrency-1 sweeps, so this backfill can never become the next
// thing that wedges the Inngest queue.
// ---------------------------------------------------------------------------

const BACKFILL_ROW_CAP = 500

// Existence-check chunk size for the ai_summaries pre-filter query below —
// mirrors listLatestMatchScoresForPairs's ID_CHUNK (src/lib/db/ai-summaries.ts)
// so a large candidate-id list can never risk a 414 from the edge.
const ID_CHUNK = 100

type BackfillEventData = {
  organization_id?: string
}

function isBackfillEventData(data: unknown): data is BackfillEventData {
  return typeof data === 'object' && data !== null
}

type UnscoredApplicationRow = {
  id: string
  organization_id: string
  candidate_id: string
  job_id: string
}

type ExistingSummaryPairRow = {
  candidate_id: string | null
  job_id: string | null
}

/**
 * COARSE "any summary exists for this pair" pre-filter — NOT a version-exact
 * one. D-04 says no auto-rescore loops beyond what exists, so a pair that
 * already has a score — even a stale-version one — must be left alone here.
 * The version-exact decision stays where it already lives, inside the
 * scorer's own cache lookup, which is the second and authoritative guard.
 * A read failure on a chunk fails OPEN (the pair is
 * treated as unscored): the downstream hour-bucketed dedup id and the
 * ai_summaries unique constraint make a redundant enqueue harmless, so this
 * pre-filter is purely a spend-avoidance optimisation, never a security
 * boundary.
 */
async function fetchAlreadyScoredPairs(
  supabase: SupabaseClient<Database>,
  rows: UnscoredApplicationRow[],
): Promise<Set<string>> {
  const scored = new Set<string>()
  const candidateIds = Array.from(new Set(rows.map((r) => r.candidate_id)))
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id)))
  if (candidateIds.length === 0 || jobIds.length === 0) return scored

  for (let i = 0; i < candidateIds.length; i += ID_CHUNK) {
    const candidateIdChunk = candidateIds.slice(i, i + ID_CHUNK)
    const { data, error } = await supabase
      .from('ai_summaries')
      .select('candidate_id, job_id')
      .eq('kind', 'match_score')
      .in('candidate_id', candidateIdChunk)
      .in('job_id', jobIds)
    if (error) {
      Sentry.captureException(error, {
        tags: {
          layer: 'inngest',
          function: 'backfill-application-match-scores',
          subop: 'existing-pairs-select',
        },
      })
      continue
    }
    for (const row of (data ?? []) as ExistingSummaryPairRow[]) {
      if (row.candidate_id && row.job_id) {
        scored.add(`${row.candidate_id}:${row.job_id}`)
      }
    }
  }
  return scored
}

export const backfillApplicationMatchScores = inngest.createFunction(
  {
    id: 'backfill-application-match-scores',
    triggers: [{ event: 'application/backfill-scores' }],
    concurrency: { limit: 1 },
    retries: 1,
    // Mirrors plan 07-05's timeout treatment on the other concurrency-1
    // sweeps (reconcile-cv-parses, embed-batch) — a wedged run must be
    // cancelled rather than blocking the queue for days.
    timeouts: { start: '5m', finish: '10m' },
    onFailure: async ({ error }) => {
      Sentry.captureException(
        formatErrorForSentry(error, 'backfill-application-match-scores onFailure:'),
        {
          tags: {
            layer: 'inngest',
            function: 'backfill-application-match-scores',
            handler: 'onFailure',
          },
        },
      )
    },
  },
  async ({ event, step }) => {
    const eventData = isBackfillEventData(event.data) ? event.data : {}
    const scopeOrgId =
      typeof eventData.organization_id === 'string' && eventData.organization_id.length > 0
        ? eventData.organization_id
        : null

    return await step.run('sweep', async () => {
      const supabase = createServiceClient()

      let query = supabase
        .from('applications')
        .select('id, organization_id, candidate_id, job_id')
        // Float applications (job_id null by design) have nothing to score
        // against and are never enqueued.
        .not('job_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(BACKFILL_ROW_CAP)

      if (scopeOrgId) {
        query = query.eq('organization_id', scopeOrgId)
      }

      const { data: rawRows, error } = await query
      if (error) {
        Sentry.captureException(error, {
          tags: {
            layer: 'inngest',
            function: 'backfill-application-match-scores',
            subop: 'applications-select',
          },
        })
        return { enqueued: 0, skippedAlreadyScored: 0, errored: 0, scanned: 0, truncated: false }
      }
      // job_id is guaranteed non-null by the `.not('job_id', 'is', null)`
      // filter above; the generated Row type still carries `string | null`.
      const rows = (rawRows ?? []) as UnscoredApplicationRow[]

      const truncated = rows.length === BACKFILL_ROW_CAP
      if (truncated) {
        // Mirror the STUCK_EVENT_SWEEP_CAP treatment in stripe-reconcile.ts
        // — a truncation can never lie by omission.
        Sentry.captureMessage('backfill-application-match-scores: row cap reached', {
          level: 'warning',
          tags: {
            layer: 'inngest',
            function: 'backfill-application-match-scores',
            subop: 'row-cap',
          },
          extra: { row_cap: BACKFILL_ROW_CAP, scoped_org: scopeOrgId != null },
        })
      }

      const alreadyScoredPairs = await fetchAlreadyScoredPairs(supabase, rows)

      let enqueued = 0
      let skippedAlreadyScored = 0
      let errored = 0

      for (const row of rows) {
        const pairKey = `${row.candidate_id}:${row.job_id}`
        if (alreadyScoredPairs.has(pairKey)) {
          skippedAlreadyScored++
          continue
        }
        try {
          await enqueueApplicationMatchScore({
            organizationId: row.organization_id,
            applicationId: row.id,
            candidateId: row.candidate_id,
            jobId: row.job_id,
            userId: null,
          })
          enqueued++
        } catch (rowErr) {
          // enqueueApplicationMatchScore is documented never to throw; this
          // catch is defence in depth so a future change to that contract
          // can never abort the sweep for every remaining row.
          errored++
          Sentry.captureException(
            formatErrorForSentry(rowErr, 'backfill-application-match-scores row:'),
            {
              tags: {
                layer: 'inngest',
                function: 'backfill-application-match-scores',
                subop: 'enqueue-row',
              },
            },
          )
        }
      }

      // Ids and counts only — no PII (CLAUDE.md).
      Sentry.addBreadcrumb({
        category: 'inngest',
        message: 'backfill-application-match-scores: sweep complete',
        level: 'info',
        data: { scanned: rows.length, enqueued, skippedAlreadyScored, errored, truncated },
      })

      return { enqueued, skippedAlreadyScored, errored, scanned: rows.length, truncated }
    })
  },
)
