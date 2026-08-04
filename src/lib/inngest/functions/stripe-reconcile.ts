import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'

import { upsertSubscriptionFromStripe } from '@/lib/db/subscriptions'
import { sendResendEmail } from '@/lib/email/resend'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { diffStripeAgainstLocal, snapshotFromStripeSubscription } from '@/lib/stripe/reconcile'
import type { LocalSubscriptionRow, StripeSubSnapshot } from '@/lib/stripe/reconcile'
import { assertStripe, stripe } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/service'

// Duplicated (not imported) from src/app/api/stripe/webhook/route.ts —
// that file is a Next.js route handler (`export const runtime = 'nodejs'`)
// and importing it here would pull route-handler bundling concerns into
// the Inngest function graph. Same contract: true when a PostgREST error
// indicates the referenced column doesn't exist yet ('PGRST204' schema-
// cache write miss, or '42703' Postgres undefined_column). Audit §4.10.
function isMissingColumnError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === 'PGRST204' || code === '42703'
}

type StuckWebhookEventRow = {
  stripe_event_id: string
  event_type: string | null
  status: string | null
  created_at: string
}

type StuckSweepQuery = {
  gt: (col: string, val: string) => StuckSweepQuery
  lt: (col: string, val: string) => StuckSweepQuery
  order: (col: string, opts: { ascending: boolean }) => StuckSweepQuery
  limit: (n: number) => StuckSweepQuery
} & PromiseLike<{ data: StuckWebhookEventRow[] | null; error: unknown }>

type StripeWebhookEventsSweepClient = {
  from: (table: 'stripe_webhook_events') => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => StuckSweepQuery
    }
  }
}

// ---------------------------------------------------------------------------
// stripe-reconcile — daily Stripe ↔ local subscriptions reconciliation
// (audit MAJOR-6).
//
// Webhooks are the primary sync path; this cron is the safety net for when
// they silently break (rotated secret, changed URL, Stripe outage): it lists
// every Stripe subscription, diffs against the local subscriptions table
// (pure logic in @/lib/stripe/reconcile), executes repairs through the same
// guarded upsert the webhook uses (comp rows stay protected), and ALERTS on
// any divergence — Sentry always, plus an email to RESEND_FEEDBACK_RECIPIENT
// when configured. A day with zero divergence is silent except the heartbeat.
//
// Runs at 05:00 London — after the 03:00 retention sweeps, before the workday.
// Repairs are idempotent upserts, so retries/re-runs are safe.
// ---------------------------------------------------------------------------

// Page cap: 20 × 100 = 2,000 subscriptions — far beyond current scale. If we
// ever hit it, stripeListComplete=false disables the absence-based repair and
// the anomaly email says so.
const MAX_PAGES = 20
const PAGE_SIZE = 100

// Upper bound on the stuck-webhook-event sweep (review 2026-08-04 L8). Far
// beyond any plausible real incident; if it ever truncates, `truncated: true`
// rides along in the Sentry payload rather than the count silently lying.
const STUCK_EVENT_SWEEP_CAP = 500

export const stripeReconcile = inngest.createFunction(
  {
    id: 'stripe-reconcile',
    triggers: [{ cron: 'TZ=Europe/London 0 5 * * *' }],
    concurrency: { limit: 1 },
    retries: 1,
    onFailure: async ({ error }) => {
      Sentry.captureException(formatErrorForSentry(error, 'stripe-reconcile onFailure:'), {
        tags: {
          phase: 'p5',
          layer: 'inngest',
          function: 'stripe-reconcile',
          handler: 'onFailure',
        },
      })
    },
  },
  async ({ step }) => {
    // Graceful degradation — no Stripe key (dev/CI) → nothing to reconcile.
    if (!stripe) {
      return { skipped: 'stripe_not_configured' }
    }

    // Heartbeat — fires every run so an external Sentry Crons monitor can
    // detect the cron itself going missing (the failure mode of MAJOR-6 was
    // precisely "the safety net silently isn't running").
    Sentry.captureMessage('phase5:stripe-reconcile:heartbeat', {
      level: 'info',
      tags: { phase: 'p5', layer: 'inngest', function: 'stripe-reconcile' },
    })

    return await step.run('reconcile', async () => {
      const s = assertStripe()

      // Freshness watermark (review batch3 finding 9): any local row written
      // AFTER this instant may reflect a webhook that raced the run — the
      // Stripe snapshot below could be older than that write, so repairs
      // against such rows are skipped and left for tomorrow's run.
      const listStartIso = new Date().toISOString()

      // 1. List EVERY Stripe subscription (status 'all' includes canceled).
      const snapshots: StripeSubSnapshot[] = []
      let startingAfter: string | undefined
      let stripeListComplete = false
      for (let page = 0; page < MAX_PAGES; page++) {
        const batch: Stripe.ApiList<Stripe.Subscription> = await s.subscriptions.list({
          status: 'all',
          limit: PAGE_SIZE,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        })
        for (const sub of batch.data) {
          snapshots.push(snapshotFromStripeSubscription(sub))
        }
        if (!batch.has_more) {
          stripeListComplete = true
          break
        }
        startingAfter = batch.data[batch.data.length - 1]?.id
        if (!startingAfter) break
      }

      // 2. Load every local subscription row — PAGINATED. PostgREST silently
      // caps any single response at max_rows (1000) regardless of .limit(),
      // and a truncated local view would mislabel healthy orgs as
      // missing_local_row every day (review batch3 finding 7).
      const serviceClient = createServiceClient()
      const LOCAL_PAGE = 1000
      const localRows: LocalSubscriptionRow[] = []
      // <= MAX_PAGES: the extra iteration exists so a table of EXACTLY
      // MAX_PAGES*LOCAL_PAGE rows (whose last page is full) can prove itself
      // complete with an empty fetch instead of false-positively throwing
      // (review batch3 round2 finding 7).
      for (let page = 0; page <= MAX_PAGES; page++) {
        const from = page * LOCAL_PAGE
        const { data, error: localErr } = await serviceClient
          .from('subscriptions')
          .select(
            'organization_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_seats, status, trial_end, current_period_end',
          )
          .order('organization_id', { ascending: true })
          .range(from, from + LOCAL_PAGE - 1)
        if (localErr) {
          throw new Error(`stripe-reconcile: local read failed: ${localErr.message}`)
        }
        if (page === MAX_PAGES && data && data.length > 0) {
          // A partial local view cannot be reconciled safely — bail loudly.
          throw new Error(
            `stripe-reconcile: local subscriptions exceed ${MAX_PAGES * LOCAL_PAGE} rows — raise the page cap`,
          )
        }
        localRows.push(...(data ?? []))
        if (!data || data.length < LOCAL_PAGE) break
      }

      // 3. Diff (pure) …
      const { repairs, anomalies } = diffStripeAgainstLocal({
        stripeSubs: snapshots,
        localRows,
        stripeListComplete,
      })

      // 4. … and repair through the SAME guarded upsert the webhook uses —
      // comp/invoice-billed rows keep their MAJOR-5 protection. Each repair
      // first re-reads the row: if it was written after listStartIso (a
      // webhook landed mid-run) or its existence changed since the diff, the
      // repair is SKIPPED — the fresher write is newer truth than our
      // snapshot, and tomorrow's run re-verifies (review batch3 finding 9).
      const repairFailures: string[] = []
      const skippedFresh: string[] = []
      let appliedCount = 0
      for (const repair of repairs) {
        const { data: freshRow, error: freshErr } = await serviceClient
          .from('subscriptions')
          .select('organization_id, updated_at')
          .eq('organization_id', repair.organizationId)
          .maybeSingle()
        if (freshErr) {
          repairFailures.push(`${repair.organizationId} (${repair.reason}): freshness read failed`)
          continue
        }
        if (repair.reason === 'missing_local_row') {
          if (freshRow) {
            skippedFresh.push(`${repair.organizationId}: row appeared mid-run`)
            continue
          }
        } else {
          if (!freshRow) {
            skippedFresh.push(`${repair.organizationId}: row vanished mid-run`)
            continue
          }
          // Epoch comparison — DB timestamps use '+00:00' offsets, the
          // watermark ends in 'Z'; lexicographic comparison would misorder.
          if (new Date(freshRow.updated_at).getTime() > new Date(listStartIso).getTime()) {
            skippedFresh.push(`${repair.organizationId}: row updated mid-run (webhook won)`)
            continue
          }
        }
        // trustCurrentState: the cron's input IS current Stripe truth, so the
        // upsert's stale-sub downgrade heuristic must not refuse a legitimate
        // drift repair to a different sub id (round3). The comp-row protection
        // still applies. A guard no-op returns noop:true → NOT counted as
        // applied, so the divergence email can't falsely report a repair that
        // didn't land (round3 silent-fail).
        const result = await upsertSubscriptionFromStripe(serviceClient, repair.input, {
          trustCurrentState: true,
        })
        if (!result.ok) {
          repairFailures.push(`${repair.organizationId} (${repair.reason}): ${result.code}`)
        } else if (result.noop) {
          repairFailures.push(`${repair.organizationId} (${repair.reason}): refused by comp guard`)
        } else {
          appliedCount++
        }
      }

      // 5. Alert on a REAL divergence — a repair actually applied, an anomaly
      // needing a human, or a repair failure. A run whose only planned repairs
      // were all skipped by the freshness check is benign (a webhook won
      // mid-run and already wrote the truth) and must NOT alarm, or the
      // divergence email trains the founder to ignore it (review batch3 final
      // finding 4).
      if (appliedCount > 0 || anomalies.length > 0 || repairFailures.length > 0) {
        const summaryLines = [
          `Stripe reconciliation ${new Date().toISOString()}`,
          `Repairs applied: ${appliedCount} (of ${repairs.length} planned)`,
          ...repairs.map((r) => `  - [${r.reason}] ${r.detail}`),
          ...(skippedFresh.length > 0
            ? [
                `Skipped (row changed mid-run): ${skippedFresh.length}`,
                ...skippedFresh.map((f) => `  - ${f}`),
              ]
            : []),
          `Anomalies (need a human): ${anomalies.length}`,
          ...anomalies.map((a) => `  - [${a.kind}] ${a.detail}`),
          ...(repairFailures.length > 0
            ? [
                `Repair FAILURES: ${repairFailures.length}`,
                ...repairFailures.map((f) => `  - ${f}`),
              ]
            : []),
          ...(stripeListComplete ? [] : ['WARNING: Stripe listing was incomplete (page cap).']),
        ]
        const summary = summaryLines.join('\n')

        // No PII here by construction: org ids, sub ids, statuses only.
        Sentry.captureMessage('stripe_reconcile_divergence', {
          level: 'error',
          tags: { phase: 'p5', layer: 'inngest', function: 'stripe-reconcile' },
          extra: {
            repairs: repairs.length,
            anomalies: anomalies.length,
            failures: repairFailures.length,
            summary,
          },
        })

        if (env.RESEND_FEEDBACK_RECIPIENT) {
          try {
            await sendResendEmail({
              to: env.RESEND_FEEDBACK_RECIPIENT,
              subject: `Altus: Stripe reconciliation found ${repairs.length + anomalies.length} divergence(s)`,
              text: summary,
            })
          } catch {
            // best-effort — Sentry already has the divergence
          }
        }
      }

      // 6. Stuck-webhook-event sweep (audit §4.10, Steele Charles feature
      // review 2026-07-31 Batch 2 Task 3). A 'received' or 'error' row
      // older than an hour means Stripe's retries haven't resolved it — a
      // signing-key rotation, a code bug in a specific event-type handler,
      // or a stuck queue. Loud is the deliverable here (standing "no
      // safety net" handover item); we do NOT attempt to auto-reprocess.
      //
      // Review 2026-08-04 H3 — this used to raise a Sentry `error` on EVERY
      // daily run, forever, for any row that ever got stuck: the webhook
      // route deliberately returns 200 when only the final 'processed' stamp
      // fails (the work IS done), leaving a permanent 'received' row; and a
      // genuine 'error' row keeps alarming long after Stripe stops retrying
      // (~3 days). The channel the founder must trust for real billing
      // incidents was being trained into noise. Two bounds:
      //   * a 7-day upper age, so resolved-but-unstamped rows age out;
      //   * severity 'warning' by default, escalating to 'error' only when
      //     the problem is actively GROWING (a stuck row appeared in the last
      //     24h) — which is the run-over-run signal that needs a human today.
      let stuckEventsCount = 0
      {
        const sweepClient = serviceClient as unknown as StripeWebhookEventsSweepClient
        const now = Date.now()
        const oneHourAgoIso = new Date(now - 60 * 60 * 1000).toISOString()
        const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
        const oneDayAgoMs = now - 24 * 60 * 60 * 1000
        const { data: stuckRows, error: stuckErr } = await sweepClient
          .from('stripe_webhook_events')
          .select('stripe_event_id, event_type, status, created_at')
          .in('status', ['received', 'error'])
          .lt('created_at', oneHourAgoIso)
          .gt('created_at', sevenDaysAgoIso)
          // L8: the sweep had no bound at all, so stuckEventsCount silently
          // capped at whatever PostgREST's db-max-rows returned. An explicit
          // cap makes the truncation deliberate and visible in the payload.
          .order('created_at', { ascending: false })
          .limit(STUCK_EVENT_SWEEP_CAP)

        if (stuckErr) {
          if (!isMissingColumnError(stuckErr)) {
            Sentry.captureException(stuckErr, {
              tags: {
                phase: 'p5',
                layer: 'inngest',
                function: 'stripe-reconcile',
                subop: 'stuck-events',
              },
            })
          }
          // isMissingColumnError → skip silently; the status migration
          // (20260804130100_stripe_webhook_event_status.sql) isn't
          // applied yet.
        } else if (stuckRows && stuckRows.length > 0) {
          // Only ever alerts when rows actually EXIST — a clean run is silent
          // apart from the heartbeat.
          stuckEventsCount = stuckRows.length
          const freshCount = stuckRows.filter(
            (r) => new Date(r.created_at).getTime() >= oneDayAgoMs,
          ).length
          // Stripe event ids are not PII — event BODIES would be, but we
          // only log ids, types, statuses and counts here.
          Sentry.captureMessage(`stripe_webhook_events_stuck (${stuckEventsCount})`, {
            level: freshCount > 0 ? 'error' : 'warning',
            tags: {
              phase: 'p5',
              layer: 'inngest',
              function: 'stripe-reconcile',
              subop: 'stuck-events',
              growing: freshCount > 0 ? 'yes' : 'no',
            },
            extra: {
              count: stuckEventsCount,
              new_in_last_24h: freshCount,
              window: '1h to 7d old',
              truncated: stuckEventsCount === STUCK_EVENT_SWEEP_CAP,
              sample_event_ids: stuckRows.slice(0, 5).map((r) => r.stripe_event_id),
            },
          })
        }
      }

      Sentry.addBreadcrumb({
        category: 'inngest',
        message: `stripe-reconcile: ${snapshots.length} Stripe subs, ${localRows.length} local rows, ${appliedCount}/${repairs.length} repairs applied, ${anomalies.length} anomalies, ${stuckEventsCount} stuck webhook events`,
        level: 'info',
      })

      return {
        stripeSubs: snapshots.length,
        localRows: localRows.length,
        repairsPlanned: repairs.length,
        repairsApplied: appliedCount,
        skippedFresh: skippedFresh.length,
        anomalies: anomalies.length,
        repairFailures: repairFailures.length,
        stuckWebhookEvents: stuckEventsCount,
        stripeListComplete,
      }
    })
  },
)
