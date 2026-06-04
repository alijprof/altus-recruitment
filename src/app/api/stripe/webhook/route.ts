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

import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'

import { assertStripe, stripe } from '@/lib/stripe/client'
import { PLANS, PLAN_PRICE_IDS } from '@/lib/stripe/plans'
import type { PlanKey } from '@/lib/stripe/plans'
import { upsertSubscriptionFromStripe } from '@/lib/db/subscriptions'
import { createServiceClient } from '@/lib/supabase/service'
import { sendTrialEndingEmail, sendPaymentFailedEmail } from '@/lib/email/billing-emails'
import { env } from '@/lib/env'

// Reverse-map from Stripe price ID → PlanKey.
// Built at module load time from PLAN_PRICE_IDS so it stays in sync
// with the single source of truth.
function buildPriceIdToPlanKey(): Map<string, PlanKey> {
  const map = new Map<string, PlanKey>()
  for (const [key, priceId] of Object.entries(PLAN_PRICE_IDS)) {
    if (priceId) {
      map.set(priceId, key as PlanKey)
    }
  }
  return map
}

// Derive planKey from a subscription object's first price ID.
function derivePlanKey(subscription: Stripe.Subscription): PlanKey {
  const priceIdMap = buildPriceIdToPlanKey()
  const priceId = subscription.items.data[0]?.price.id ?? ''
  return priceIdMap.get(priceId) ?? 'pro' // fallback to pro if unknown
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
  } catch (err) {
    // Do NOT leak error detail in the response — just 400.
    Sentry.captureMessage('stripe_webhook_signature_failed', {
      level: 'warning',
      tags: { layer: 'stripe', handler: 'webhook' },
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // SECURITY INVARIANT 4: idempotency — insert BEFORE processing.
  // stripe_webhook_events has a unique index on stripe_event_id.
  const { error: insertErr, data: insertedRow } = await serviceClient
    .from('stripe_webhook_events')
    .insert({ stripe_event_id: event.id, event_type: event.type })
    .select('stripe_event_id')
    .maybeSingle()

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate event — already processed. Idempotent short-circuit.
      return NextResponse.json({ received: true })
    }
    // Any other insert failure — log and 500 so Stripe retries.
    Sentry.captureException(insertErr, {
      tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // insertedRow null means the unique-conflict path; belt-and-braces.
  if (!insertedRow) {
    return NextResponse.json({ received: true })
  }

  // Process the event. Errors here are logged but we still return 200 to
  // prevent Stripe from retrying an event we've already de-duped.
  try {
    await handleStripeEvent(event, serviceClient)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'stripe', handler: 'webhook', event_type: event.type },
    })
    // Still return 200 — the idempotency row is in place; a retry would be a
    // no-op for processing anyway. We rely on the Sentry alert for manual
    // investigation.
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
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id,
        )
        await upsertFromSubscription(serviceClient, subscription, orgId)
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
      await upsertFromSubscription(serviceClient, subscription, orgId)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const orgId = extractOrgId(subscription)
      if (!orgId) break

      const planKey = derivePlanKey(subscription)
      await upsertSubscriptionFromStripe(serviceClient, {
        organizationId: orgId,
        stripeCustomerId:
          typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id,
        planKey,
        planSeats: PLANS[planKey].seats,
        status: 'cancelled',
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null,
        currentPeriodEnd: getCurrentPeriodEnd(subscription),
      })
      break
    }

    case 'customer.subscription.trial_will_end': {
      const subscription = event.data.object as Stripe.Subscription
      const orgId = extractOrgId(subscription)
      if (!orgId) break
      // Best-effort email — fire-and-forget is intentional here.
      // The actual trial end is handled by the subscription.updated event.
      void sendTrialEndingEmail({ organizationId: orgId, trialEnd: subscription.trial_end })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const orgId = invoice.metadata?.organization_id ?? null
      if (!orgId) break

      // Retrieve the subscription from the invoice's parent (Stripe v22 API).
      // invoice.parent.subscription_details.subscription holds the ID.
      const subscriptionId =
        invoice.parent?.type === 'subscription_details'
          ? (invoice.parent.subscription_details?.subscription ?? null)
          : null

      if (subscriptionId) {
        const s = assertStripe()
        const subscriptionIdStr =
          typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
        const subscription = await s.subscriptions.retrieve(subscriptionIdStr)
        const planKey = derivePlanKey(subscription)
        await upsertSubscriptionFromStripe(serviceClient, {
          organizationId: orgId,
          stripeCustomerId:
            typeof subscription.customer === 'string'
              ? subscription.customer
              : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
          planKey,
          planSeats: PLANS[planKey].seats,
          status: 'past_due',
          trialEnd: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null,
          currentPeriodEnd: getCurrentPeriodEnd(subscription),
        })
      }

      // Best-effort payment-failed email.
      void sendPaymentFailedEmail({ organizationId: orgId })
      break
    }

    default:
      // Unhandled event type — no-op. Return 200 so Stripe doesn't retry.
      break
  }
}

// Map Stripe subscription status to our SubscriptionStatus enum.
function mapStripeStatus(stripeStatus: string): string {
  const statusMap: Record<string, string> = {
    trialing: 'trialing',
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled', // Stripe uses 'canceled' (US spelling)
    unpaid: 'past_due',
    incomplete: 'none',
    incomplete_expired: 'none',
    paused: 'none',
  }
  return statusMap[stripeStatus] ?? 'none'
}

// current_period_end is on each SubscriptionItem in Stripe v22, not on the
// Subscription itself. Use the first item's value (single-price subscriptions).
function getCurrentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const itemEnd = subscription.items.data[0]?.current_period_end
  return itemEnd ? new Date(itemEnd * 1000).toISOString() : null
}

// Common helper: derive all fields from a Stripe Subscription object and upsert.
async function upsertFromSubscription(
  serviceClient: ReturnType<typeof createServiceClient>,
  subscription: Stripe.Subscription,
  orgId: string,
): Promise<void> {
  const planKey = derivePlanKey(subscription)
  const planSeats = PLANS[planKey].seats
  const status = mapStripeStatus(subscription.status)

  await upsertSubscriptionFromStripe(serviceClient, {
    organizationId: orgId,
    stripeCustomerId:
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    planKey,
    planSeats,
    status,
    trialEnd: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
    currentPeriodEnd: getCurrentPeriodEnd(subscription),
  })
}
