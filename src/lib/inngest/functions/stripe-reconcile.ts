import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'

import { upsertSubscriptionFromStripe } from '@/lib/db/subscriptions'
import { sendResendEmail } from '@/lib/email/resend'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import {
  diffStripeAgainstLocal,
  snapshotFromStripeSubscription,
} from '@/lib/stripe/reconcile'
import type { StripeSubSnapshot } from '@/lib/stripe/reconcile'
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

      // 2. Load every local subscription row.
      const serviceClient = createServiceClient()
      const { data: localRows, error: localErr } = await serviceClient
        .from('subscriptions')
        .select(
          'organization_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_seats, status, trial_end, current_period_end',
        )
        .limit(2000)
      if (localErr) {
        throw new Error(`stripe-reconcile: local read failed: ${localErr.message}`)
      }

      // 3. Diff (pure) …
      const { repairs, anomalies } = diffStripeAgainstLocal({
        stripeSubs: snapshots,
        localRows: localRows ?? [],
        stripeListComplete,
      })

      // 4. … and repair through the SAME guarded upsert the webhook uses —
      // comp/invoice-billed rows keep their MAJOR-5 protection.
      const repairFailures: string[] = []
      for (const repair of repairs) {
        const result = await upsertSubscriptionFromStripe(serviceClient, repair.input)
        if (!result.ok) {
          repairFailures.push(`${repair.organizationId} (${repair.reason}): ${result.code}`)
        }
      }

      // 5. Alert on ANY divergence. Sentry is the always-on channel; email is
      // best-effort so a Resend outage can't fail the reconciliation itself.
      if (repairs.length > 0 || anomalies.length > 0 || repairFailures.length > 0) {
        const summaryLines = [
          `Stripe reconciliation ${new Date().toISOString()}`,
          `Repairs applied: ${repairs.length}`,
          ...repairs.map((r) => `  - [${r.reason}] ${r.detail}`),
          `Anomalies (need a human): ${anomalies.length}`,
          ...anomalies.map((a) => `  - [${a.kind}] ${a.detail}`),
          ...(repairFailures.length > 0
            ? [`Repair FAILURES: ${repairFailures.length}`, ...repairFailures.map((f) => `  - ${f}`)]
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
        message: `stripe-reconcile: ${snapshots.length} Stripe subs, ${localRows?.length ?? 0} local rows, ${repairs.length} repairs, ${anomalies.length} anomalies`,
        level: 'info',
      })

      return {
        stripeSubs: snapshots.length,
        localRows: localRows?.length ?? 0,
        repairs: repairs.length,
        anomalies: anomalies.length,
        repairFailures: repairFailures.length,
        stripeListComplete,
      }
    })
  },
)
