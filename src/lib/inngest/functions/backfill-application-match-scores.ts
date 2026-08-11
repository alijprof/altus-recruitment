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
// per-run cap, per-row try/catch so one bad row never aborts the sweep, and
// PII-free Sentry (ids and counts only). The cap is on ENQUEUES, with a
// separately bounded scan (WR-02) — capping the SCAN instead is what made a
// re-run a permanent no-op once the oldest page was fully scored.
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

// Per-run ENQUEUE cap — the real spend bound (~1p per enqueued
// application, so ~£5 a run). WR-02: this caps how many unscored rows the
// run fans out, NOT how many rows it is allowed to look at. Capping the
// SCAN was the bug: once the oldest 500 applications were all scored, every
// later run enqueued zero while newer unscored rows sat beyond the cap
// forever, and the "row cap reached" warning read as "there is more to do"
// on a sweep that was in fact permanently stuck.
const ENQUEUE_CAP = 500

// Scan budget. The sweep walks applications oldest-first, skipping ones that
// already have a score, until it has filled ENQUEUE_CAP or exhausted this
// budget — so a re-run naturally advances through the backlog as previously
// enqueued rows acquire summaries.
const SCAN_PAGE_SIZE = 500
const MAX_SCAN_PAGES = 20

// Row-chunk size for the ai_summaries pre-filter below. WR-01: BOTH `.in()`
// lists are bounded by this, not just one. Chunking by ROWS (rather than by
// unique candidate ids) means a chunk contributes at most this many ids to
// each list, so the worst-case query string is ~2 x 50 x ~45 chars ≈ 4.5 kB
// — comfortably under postgrest-js's 8,000-char `urlLengthLimit` and under
// typical edge/proxy URL limits. The previous code chunked `candidateIds` at
// 100 but passed `jobIds` whole, which at the 500-row cap meant up to 500
// uuids ≈ 18.5 kB in one URL.
const PAIR_LOOKUP_CHUNK_ROWS = 50

type BackfillEventData = {
  organization_id?: string
  // Optional resume point (ISO timestamp). A run that stops on its scan
  // budget reports `next_cursor`; re-sending the event with that value
  // continues from there instead of re-walking the scored prefix.
  created_after?: string
}

function isBackfillEventData(data: unknown): data is BackfillEventData {
  return typeof data === 'object' && data !== null
}

type UnscoredApplicationRow = {
  id: string
  organization_id: string
  candidate_id: string
  job_id: string
  created_at: string
}

type ExistingSummaryPairRow = {
  candidate_id: string | null
  job_id: string | null
}

function pairKey(row: { candidate_id: string; job_id: string }): string {
  return `${row.candidate_id}:${row.job_id}`
}

type ScoredPairLookup = {
  /** Pairs KNOWN to already carry a match_score summary. */
  scored: Set<string>
  /**
   * Pairs whose scored-ness could NOT be determined because the lookup
   * chunk errored. WR-01: these are skipped, never enqueued.
   */
  unknown: Set<string>
}

/**
 * COARSE "any summary exists for this pair" pre-filter — NOT a version-exact
 * one. D-04 says no auto-rescore loops beyond what exists, so a pair that
 * already has a score — even a stale-version one — must be left alone here.
 * The version-exact decision stays where it already lives, inside the
 * scorer's own cache lookup, which is the second and authoritative guard.
 *
 * WR-01 — a chunk read failure now fails CLOSED. It used to `continue`,
 * which left the chunk's pairs absent from the `scored` set and therefore
 * indistinguishable from genuinely-unscored ones: a single 414 or aborted
 * request turned the whole sweep into "nothing is scored, enqueue
 * everything". The downstream version-exact cache absorbs most of that, but
 * any pair whose embedding version has moved since it was scored buys a
 * fresh Sonnet call — across every org, from a button labelled "safe to run
 * more than once". Unknown now means skip: the sweep is idempotent and the
 * next run re-reads the same rows, so deferring costs nothing and
 * double-spending costs money.
 */
async function fetchAlreadyScoredPairs(
  supabase: SupabaseClient<Database>,
  rows: UnscoredApplicationRow[],
): Promise<ScoredPairLookup> {
  const scored = new Set<string>()
  const unknown = new Set<string>()

  for (let i = 0; i < rows.length; i += PAIR_LOOKUP_CHUNK_ROWS) {
    const chunk = rows.slice(i, i + PAIR_LOOKUP_CHUNK_ROWS)
    const candidateIds = Array.from(new Set(chunk.map((r) => r.candidate_id)))
    const jobIds = Array.from(new Set(chunk.map((r) => r.job_id)))
    if (candidateIds.length === 0 || jobIds.length === 0) continue

    const { data, error } = await supabase
      .from('ai_summaries')
      .select('candidate_id, job_id')
      .eq('kind', 'match_score')
      .in('candidate_id', candidateIds)
      .in('job_id', jobIds)

    if (error) {
      Sentry.captureException(error, {
        tags: {
          layer: 'inngest',
          function: 'backfill-application-match-scores',
          subop: 'existing-pairs-select',
        },
      })
      for (const row of chunk) unknown.add(pairKey(row))
      continue
    }

    // The chunk query is a cross-product of the two id lists, so it can
    // return pairs belonging to rows in a LATER chunk. Recording them is
    // correct and saves a lookup — they really are scored.
    for (const row of (data ?? []) as ExistingSummaryPairRow[]) {
      if (row.candidate_id && row.job_id) {
        scored.add(`${row.candidate_id}:${row.job_id}`)
      }
    }
  }
  return { scored, unknown }
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
    const startCursor =
      typeof eventData.created_after === 'string' && eventData.created_after.length > 0
        ? eventData.created_after
        : null

    return await step.run('sweep', async () => {
      const supabase = createServiceClient()

      let enqueued = 0
      let skippedAlreadyScored = 0
      let skippedUnknown = 0
      let errored = 0
      let scanned = 0
      let truncated = false
      let cursor: string | null = startCursor
      let nextCursor: string | null = null

      // Ids already visited in THIS run. The page cursor is `.gte` rather
      // than `.gt` so a group of applications sharing one created_at (every
      // row of a single bulk-import transaction gets the same now()) can
      // never be split across a page boundary and silently skipped; this set
      // is what stops the re-read from being processed twice.
      const seenApplicationIds = new Set<string>()

      // WR-02 — walk pages of applications oldest-first, skipping ones that
      // already carry a score, until ENQUEUE_CAP unscored rows have been
      // fanned out or the scan budget is spent. Because the cap is on
      // ENQUEUES and scored rows are skipped, each re-run advances: last
      // run's enqueues acquire summaries, so this run scans past them and
      // reaches rows that were previously beyond the cap. Newer applications
      // are therefore reachable, which they were not before.
      for (let page = 0; page < MAX_SCAN_PAGES; page++) {
        let query = supabase
          .from('applications')
          .select('id, organization_id, candidate_id, job_id, created_at')
          // Float applications (job_id null by design) have nothing to score
          // against and are never enqueued.
          .not('job_id', 'is', null)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(SCAN_PAGE_SIZE)

        if (scopeOrgId) {
          query = query.eq('organization_id', scopeOrgId)
        }
        if (cursor) {
          query = query.gte('created_at', cursor)
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
          // Fail closed and stop: a partial scan must not be reported as a
          // completed backlog.
          truncated = true
          nextCursor = cursor
          break
        }

        // job_id is guaranteed non-null by the `.not('job_id', 'is', null)`
        // filter above; the generated Row type still carries `string | null`.
        const pageRows = (rawRows ?? []) as UnscoredApplicationRow[]
        if (pageRows.length === 0) break

        const lastRow = pageRows[pageRows.length - 1]
        const freshRows = pageRows.filter((r) => !seenApplicationIds.has(r.id))
        for (const row of pageRows) seenApplicationIds.add(row.id)

        if (freshRows.length === 0) {
          // A whole page of already-seen rows means more than SCAN_PAGE_SIZE
          // applications share one created_at, so the cursor cannot advance.
          // Stop rather than spin; report it so it is never silent.
          Sentry.captureMessage(
            'backfill-application-match-scores: cursor could not advance past a created_at tie',
            {
              level: 'warning',
              tags: {
                layer: 'inngest',
                function: 'backfill-application-match-scores',
                subop: 'cursor-stall',
              },
              extra: { page_size: SCAN_PAGE_SIZE, scoped_org: scopeOrgId != null },
            },
          )
          truncated = true
          nextCursor = cursor
          break
        }

        scanned += freshRows.length
        const lookup = await fetchAlreadyScoredPairs(supabase, freshRows)

        let capReached = false
        for (const row of freshRows) {
          const key = pairKey(row)
          if (lookup.scored.has(key)) {
            skippedAlreadyScored++
            continue
          }
          if (lookup.unknown.has(key)) {
            // WR-01 fail-closed: scored-ness unknown, so do not spend. The
            // next run re-reads this row.
            skippedUnknown++
            continue
          }
          if (enqueued >= ENQUEUE_CAP) {
            capReached = true
            break
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
            // enqueueApplicationMatchScore is documented never to throw;
            // this catch is defence in depth so a future change to that
            // contract can never abort the sweep for every remaining row.
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

        if (capReached) {
          truncated = true
          nextCursor = cursor
          break
        }

        // Short page = end of the table for this scope.
        if (pageRows.length < SCAN_PAGE_SIZE) break

        cursor = lastRow?.created_at ?? cursor
        if (page === MAX_SCAN_PAGES - 1) {
          truncated = true
          nextCursor = cursor
        }
      }

      if (truncated) {
        // Mirror the STUCK_EVENT_SWEEP_CAP treatment in stripe-reconcile.ts
        // — a truncation can never lie by omission. Unlike the old "row cap
        // reached" warning, this one is TRUE: running the backfill again
        // now makes progress, and `next_cursor` can be passed back on the
        // event to resume without re-walking the scored prefix.
        Sentry.captureMessage(
          'backfill-application-match-scores: stopped early, more backlog remains',
          {
            level: 'warning',
            tags: {
              layer: 'inngest',
              function: 'backfill-application-match-scores',
              subop: 'row-cap',
            },
            extra: {
              enqueue_cap: ENQUEUE_CAP,
              scan_budget: SCAN_PAGE_SIZE * MAX_SCAN_PAGES,
              enqueued,
              scanned,
              next_cursor: nextCursor,
              scoped_org: scopeOrgId != null,
            },
          },
        )
      }

      if (skippedUnknown > 0) {
        // Deferred, not lost — but the founder should know the run was not
        // a complete pass.
        Sentry.captureMessage(
          'backfill-application-match-scores: skipped rows with undetermined scored-ness',
          {
            level: 'warning',
            tags: {
              layer: 'inngest',
              function: 'backfill-application-match-scores',
              subop: 'scored-lookup-failed',
            },
            extra: { skipped_unknown: skippedUnknown, scoped_org: scopeOrgId != null },
          },
        )
      }

      // Ids and counts only — no PII (CLAUDE.md).
      Sentry.addBreadcrumb({
        category: 'inngest',
        message: 'backfill-application-match-scores: sweep complete',
        level: 'info',
        data: { scanned, enqueued, skippedAlreadyScored, skippedUnknown, errored, truncated },
      })

      return {
        enqueued,
        skippedAlreadyScored,
        skippedUnknown,
        errored,
        scanned,
        truncated,
        nextCursor,
      }
    })
  },
)
