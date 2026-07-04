import 'server-only'

// ---------------------------------------------------------------------------
// subscription-sync — pure mapping helpers between Stripe subscription objects
// and our subscriptions table, shared by the webhook handler
// (src/app/api/stripe/webhook/route.ts) and the daily reconciliation cron
// (src/lib/inngest/functions/stripe-reconcile.ts). Extracted so the two paths
// can never drift on status/plan mapping (audit MAJOR-6).
//
// No Stripe API calls and no DB access here — inputs are already-fetched
// Stripe objects; callers own I/O.
// ---------------------------------------------------------------------------

import type Stripe from 'stripe'

import { PLANS, PLAN_PRICE_IDS } from '@/lib/stripe/plans'
import type { PlanKey } from '@/lib/stripe/plans'

// Reverse-map from Stripe price ID → PlanKey.
// Built per call from PLAN_PRICE_IDS so it stays in sync with the single
// source of truth (env-derived; empty ids are skipped).
export function buildPriceIdToPlanKey(): Map<string, PlanKey> {
  const map = new Map<string, PlanKey>()
  for (const [key, priceId] of Object.entries(PLAN_PRICE_IDS)) {
    if (priceId) {
      map.set(priceId, key as PlanKey)
    }
  }
  return map
}

// Derive planKey from a subscription object's first price ID.
// Returns null when the price ID is not one of our known plan prices — callers
// MUST NOT default to a paid plan (that silently over-grants entitlements when
// a price is rotated or a legacy/dashboard price is used); they surface the
// anomaly to Sentry and skip the write instead.
export function derivePlanKey(subscription: Stripe.Subscription): PlanKey | null {
  const priceIdMap = buildPriceIdToPlanKey()
  const priceId = subscription.items.data[0]?.price.id ?? ''
  return priceIdMap.get(priceId) ?? null
}

// Single source of truth for plan seat counts, tolerant of the cancelled
// 'none' pseudo-plan (which carries 0 seats and no entitlement).
export function seatsForPlan(planKey: PlanKey | 'none'): number {
  return planKey === 'none' ? 0 : PLANS[planKey].seats
}

// Map Stripe subscription status to our SubscriptionStatus enum.
export function mapStripeStatus(stripeStatus: string): string {
  const statusMap: Record<string, string> = {
    trialing: 'trialing',
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled', // Stripe uses 'canceled' (US spelling)
    unpaid: 'past_due',
    incomplete: 'none',
    incomplete_expired: 'none',
    paused: 'past_due', // show "update payment", not trial cards, on the paywall
  }
  return statusMap[stripeStatus] ?? 'none'
}

// current_period_end is on each SubscriptionItem in Stripe v22, not on the
// Subscription itself. Use the first item's value (single-price subscriptions).
export function getCurrentPeriodEnd(subscription: Stripe.Subscription): string | null {
  const itemEnd = subscription.items.data[0]?.current_period_end
  return itemEnd ? new Date(itemEnd * 1000).toISOString() : null
}

// Stripe customer field can be an id string or an expanded object.
export function getCustomerId(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id
}

export function getTrialEndIso(subscription: Stripe.Subscription): string | null {
  return subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
}
