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

      // 5. Alert on ANY divergence. Sentry is the always-on channel; email is
      // best-effort so a Resend outage can't fail the reconciliation itself.
      if (repairs.length > 0 || anomalies.length > 0 || repairFailures.length > 0) {
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

      Sentry.addBreadcrumb({
        category: 'inngest',
        message: `stripe-reconcile: ${snapshots.length} Stripe subs, ${localRows.length} local rows, ${appliedCount}/${repairs.length} repairs applied, ${anomalies.length} anomalies`,
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
        stripeListComplete,
      }
    })
  },
)
