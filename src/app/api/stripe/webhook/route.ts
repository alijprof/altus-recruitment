// Stripe webhook handler — 05-01 Task 1.2
//
// SECURITY INVARIANTS (verified by the acceptance criteria grep):
//   1. `export const runtime = 'nodejs'` — required for raw-body access.
//   2. `await request.text()` — reads raw body BEFORE any parse so the
//      Stripe HMAC signature covers the exact bytes Stripe sent.
//   3. `stripe.webhooks.constructEvent` — verifies the signature; on throw
//      returns 400, never leaking error detail.
//   4. Idempotency: INSERT into `stripe_webhook_events` BEFORE processing;
//      short-circuit on duplicate (unique constraint on stripe_event_id).
//
// Lifecycle events handled:
//   checkout.session.completed → upsert subscription (first-time checkout)
//   customer.subscription.created → upsert subscription
//   customer.subscription.updated → upsert subscription (plan change / renewal)
//   customer.subscription.deleted → status 'cancelled'
//   customer.subscription.trial_will_end → queue trial-ending email
//   invoice.payment_failed → status 'past_due' + queue payment-failed email
//
// PII discipline: NEVER log customer email to Sentry. Only org-id + event-type.

export const runtime = 'nodejs'

import { NextResponse, after } from 'next/server'
import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'

import { assertStripe, stripe } from '@/lib/stripe/client'
import { PLANS } from '@/lib/stripe/plans'
import type { PlanKey } from '@/lib/stripe/plans'
import { upsertSubscriptionFromStripe } from '@/lib/db/subscriptions'
import {
  derivePlanKey,
  getCurrentPeriodEnd,
  getCustomerId,
  getTrialEndIso,
  mapStripeStatus,
  seatsForPlan,
} from '@/lib/stripe/subscription-sync'
import { createServiceClient } from '@/lib/supabase/service'
import { sendTrialEndingEmail, sendPaymentFailedEmail } from '@/lib/email/billing-emails'
import { env } from '@/lib/env'

// Surface an unknown-price anomaly without leaking PII.
function reportUnknownPrice(
  subscription: Stripe.Subscription,
  orgId: string,
  eventType: string,
): void {
  Sentry.captureMessage('stripe_webhook_unknown_price', {
    level: 'error',
    tags: { layer: 'stripe', handler: 'webhook', event_type: eventType, org_id: orgId },
    extra: {
      price_id: subscription.items.data[0]?.price.id ?? 'none',
      subscription_id: subscription.id,
    },
  })
}

// Extract organization_id from subscription or session metadata.
function extractOrgId(obj: Stripe.Subscription | Stripe.Checkout.Session): string | null {
  return obj.metadata?.organization_id ?? null
}

export async function POST(request: Request): Promise<NextResponse> {
  // Graceful degradation.
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Billing not configured' }, { status: 503 })
  }

  // SECURITY INVARIANT 2: raw body BEFORE any parse.
  const body = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''

  // SECURITY INVARIANT 3: HMAC signature verification.
  let event: Stripe.Event
  try {
    event = assertStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)
  } catch {
    // Do NOT leak error detail in the response — just 400.
    Sentry.captureMessage('stripe_webhook_signature_failed', {
      level: 'warning',
      tags: { layer: 'stripe', handler: 'webhook' },
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // SECURITY INVARIANT 4: idempotency — record COMPLETION, not receipt.
  // The stripe_webhook_events ledger holds only events we have FINISHED
  // processing. We pre-check it to short-circuit true replays, process the
  // event, and record the row ONLY after success. If processing throws we do
  // NOT record the event and return a non-2xx so Stripe re-delivers and the
  // retry actually re-drives processing (previously the row was inserted
  // before processing, so a single transient failure de-duped the event away
  // forever — a paid customer could end up with no subscription row).
  const { data: alreadyProcessed, error: seenErr } = await serviceClient
    .from('stripe_webhook_events')
    .select('stripe_event_id')
    .eq('stripe_event_id', event.id)
    .maybeSingle()

  if (seenErr) {
    Sentry.captureException(seenErr, {
      tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (alreadyProcessed) {
    // Already processed to completion — idempotent replay.
    return NextResponse.json({ received: true })
  }

  try {
    await handleStripeEvent(event, serviceClient)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
    })
    // Do NOT record the event — return 500 so Stripe retries and re-drives it.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  // Processing succeeded — record completion. ignoreDuplicates covers the rare
  // concurrent-duplicate delivery (both pass the pre-check); the handlers are
  // idempotent upserts, so a double-process is harmless.
  const { error: recordErr } = await serviceClient
    .from('stripe_webhook_events')
    .upsert(
      { stripe_event_id: event.id, event_type: event.type },
      { onConflict: 'stripe_event_id', ignoreDuplicates: true },
    )

  if (recordErr) {
    // Processing already succeeded; failing to record only risks a harmless
    // idempotent reprocess on a future retry. Log and still return 200.
    Sentry.captureException(recordErr, {
      tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
    })
  }

  return NextResponse.json({ received: true })
}

async function handleStripeEvent(
  event: Stripe.Event,
  // reason: SupabaseClient<Database> type imported through createServiceClient
  // return value which is inferred correctly at the call site.
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      // Only handle subscription checkouts.
      if (session.mode !== 'subscription') break

      const orgId = extractOrgId(session)
      if (!orgId) {
        Sentry.captureMessage('stripe_webhook: checkout.session.completed missing org_id', {
          level: 'warning',
          tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
        })
        break
      }

      // Retrieve the subscription from the session to get the full details.
      if (session.subscription) {
        const s = assertStripe()
        const subscription = await s.subscriptions.retrieve(
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id,
        )
        // Checkout-originated: a genuine self-serve subscription may replace a
        // comp/invoice-billed row (the org is converting to paid) — but ONLY
        // while the retrieved subscription is actually LIVE. retrieve() returns
        // CURRENT state, not event-time state: a delayed retry of this event
        // after the founder cancelled the sub and comped the org would
        // otherwise clobber the live comp with 'cancelled' (review batch3
        // round2 finding 1).
        const retrievedStatus = mapStripeStatus(subscription.status)
        await upsertFromSubscription(serviceClient, subscription, orgId, {
          allowOverrideComp: retrievedStatus === 'active' || retrievedStatus === 'trialing',
          eventCreatedAtIso: new Date(event.created * 1000).toISOString(),
        })
      }
      break
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const orgId = extractOrgId(subscription)
      if (!orgId) {
        Sentry.captureMessage(`stripe_webhook: ${event.type} missing org_id`, {
          level: 'warning',
          tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
        })
        break
      }
      await upsertFromSubscription(serviceClient, subscription, orgId, {
        // Lets the comp guard refuse a delayed pre-cancellation 'active'
        // event that would otherwise clobber a comp granted after it.
        eventCreatedAtIso: new Date(event.created * 1000).toISOString(),
      })
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const orgId = extractOrgId(subscription)
      if (!orgId) break

      // Cancelled subscriptions carry no entitlement regardless of plan, so an
      // unknown price here is harmless — fall back to the 'none' pseudo-plan.
      const planKey: PlanKey | 'none' = derivePlanKey(subscription) ?? 'none'
      const result = await upsertSubscriptionFromStripe(serviceClient, {
        organizationId: orgId,
        stripeCustomerId: getCustomerId(subscription),
        stripeSubscriptionId: subscription.id,
        planKey,
        planSeats: seatsForPlan(planKey),
        status: 'cancelled',
        trialEnd: getTrialEndIso(subscription),
        currentPeriodEnd: getCurrentPeriodEnd(subscription),
      })
      if (!result.ok) throw new Error(`subscription upsert failed (deleted): ${result.code}`)
      break
    }

    case 'customer.subscription.trial_will_end': {
      const subscription = event.data.object as Stripe.Subscription
      const orgId = extractOrgId(subscription)
      if (!orgId) break
      // Run AFTER the response is sent (audit min-67 + review finding 4).
      // Fire-and-forget (void) risks the send being dropped on a serverless
      // freeze; awaiting inline risks a hung Resend call (no AbortSignal)
      // blocking the handler to the function timeout → 500 → Stripe retry +
      // double-send. after() keeps the function alive for the send without
      // delaying or failing the response. The trial end itself is handled by
      // the subscription.updated event.
      after(async () => {
        try {
          await sendTrialEndingEmail({ organizationId: orgId, trialEnd: subscription.trial_end })
        } catch {
          // best-effort — the send never throws; guard defensively
        }
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice

      // Resolve the subscription id from the invoice parent (Stripe v22 API).
      const subscriptionId =
        invoice.parent?.type === 'subscription_details'
          ? (invoice.parent.subscription_details?.subscription ?? null)
          : null
      if (!subscriptionId) break

      const s = assertStripe()
      const subscriptionIdStr =
        typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
      const subscription = await s.subscriptions.retrieve(subscriptionIdStr)

      // IMPORTANT: invoice.metadata.organization_id is NEVER populated — Stripe
      // does not copy subscription/customer metadata onto invoice objects. The
      // org id lives on the subscription's own metadata (set by checkout via
      // subscription_data.metadata). Reading invoice.metadata here previously
      // made this entire handler dead — past_due flip + dunning never fired.
      const orgId = extractOrgId(subscription)
      if (!orgId) {
        Sentry.captureMessage(
          'stripe_webhook: invoice.payment_failed missing org_id on subscription',
          {
            level: 'warning',
            tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
          },
        )
        break
      }

      // Dunning email fires for any resolved org whose renewal payment failed,
      // independent of plan resolution below. Run it AFTER the response (audit
      // min-67 + review finding 4) so a hung Resend call can't delay the
      // past_due downgrade below or 500 the webhook, and a serverless freeze
      // can't silently drop it.
      after(async () => {
        try {
          await sendPaymentFailedEmail({ organizationId: orgId })
        } catch {
          // best-effort
        }
      })

      const planKey = derivePlanKey(subscription)
      if (!planKey) {
        reportUnknownPrice(subscription, orgId, event.type)
        break
      }

      const result = await upsertSubscriptionFromStripe(serviceClient, {
        organizationId: orgId,
        stripeCustomerId: getCustomerId(subscription),
        stripeSubscriptionId: subscription.id,
        planKey,
        planSeats: PLANS[planKey].seats,
        status: 'past_due',
        trialEnd: getTrialEndIso(subscription),
        currentPeriodEnd: getCurrentPeriodEnd(subscription),
      })
      if (!result.ok) throw new Error(`subscription upsert failed (payment_failed): ${result.code}`)
      break
    }

    default:
      // Unhandled event type — no-op. Return 200 so Stripe doesn't retry.
      break
  }
}

// Common helper: derive all fields from a Stripe Subscription object and upsert.
// Status/plan mapping lives in @/lib/stripe/subscription-sync (shared with the
// daily reconciliation cron — audit MAJOR-6).
async function upsertFromSubscription(
  serviceClient: ReturnType<typeof createServiceClient>,
  subscription: Stripe.Subscription,
  orgId: string,
  // Only the checkout.session.completed path passes allowOverrideComp — every
  // other lifecycle caller (created/updated) leaves it false so a comp/
  // invoice-billed row can't be clobbered by a stale event (audit MAJOR-5).
  options?: { allowOverrideComp?: boolean; eventCreatedAtIso?: string },
): Promise<void> {
  const planKey = derivePlanKey(subscription)
  if (!planKey) {
    // Unknown price — surface and SKIP rather than silently over-grant Pro.
    reportUnknownPrice(subscription, orgId, 'subscription.upsert')
    return
  }
  const planSeats = PLANS[planKey].seats
  const status = mapStripeStatus(subscription.status)

  const result = await upsertSubscriptionFromStripe(
    serviceClient,
    {
      organizationId: orgId,
      stripeCustomerId: getCustomerId(subscription),
      stripeSubscriptionId: subscription.id,
      planKey,
      planSeats,
      status,
      trialEnd: getTrialEndIso(subscription),
      currentPeriodEnd: getCurrentPeriodEnd(subscription),
    },
    {
      allowOverrideComp: options?.allowOverrideComp ?? false,
      eventCreatedAtIso: options?.eventCreatedAtIso,
    },
  )
  // H1: propagate a failed DB write so the webhook returns 500 and Stripe
  // retries — previously the {ok:false} was ignored and the write was lost.
  if (!result.ok) throw new Error(`subscription upsert failed: ${result.code}`)
}
