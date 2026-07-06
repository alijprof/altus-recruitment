import 'server-only'

import * as Sentry from '@sentry/nextjs'

import { isLiveSubscriptionStatus } from '@/lib/db/subscriptions'
import { assertStripe, stripe } from '@/lib/stripe/client'
import { mapStripeStatus } from '@/lib/stripe/subscription-sync'

// ---------------------------------------------------------------------------
// findLiveStripeSubscription — verify against STRIPE (not the driftable local
// subscriptions.status column) whether any of the given Stripe customer ids
// currently has a LIVE subscription.
//
// Used by the admin comp-grant and org-erase guards. Both must not trust the
// local status column the reconciliation audit says can drift: a row can read
// 'cancelled' locally while Stripe is still actively billing (dropped/out-of-
// order webhook). Granting a comp or erasing such an org silently leaves a
// live paid subscription behind (batch3 findings 1 + 3).
//
// Auto-paginates — a live sub beyond the first page must still count. Stripe
// lists newest-first, so the 1000-row scan cap is a runaway guard, not an
// expected bound. Returns a discriminated result; callers decide the message
// and always fail CLOSED on anything but 'none'.
// ---------------------------------------------------------------------------
export type LiveStripeSubResult =
  | { status: 'none' } // no live sub (or no customer ids)
  | { status: 'live'; subscriptionId: string } // a live sub exists in Stripe
  | { status: 'unconfigured' } // has Stripe history but the client is not configured
  | { status: 'error' } // a Stripe call failed

export async function findLiveStripeSubscription(
  customerIds: Array<string | null | undefined>,
): Promise<LiveStripeSubResult> {
  const unique = [
    ...new Set(customerIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ]
  if (unique.length === 0) return { status: 'none' }
  // Has Stripe history but the client is unconfigured (e.g. key rotation) — the
  // caller must fail closed, not silently skip the check.
  if (!stripe) return { status: 'unconfigured' }

  try {
    const s = assertStripe()
    for (const customerId of unique) {
      let scanned = 0
      for await (const sub of s.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      })) {
        if (isLiveSubscriptionStatus(mapStripeStatus(sub.status))) {
          return { status: 'live', subscriptionId: sub.id }
        }
        if (++scanned >= 1000) break
      }
    }
    return { status: 'none' }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'stripe', helper: 'findLiveStripeSubscription' },
    })
    return { status: 'error' }
  }
}
