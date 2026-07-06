import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Subscription row type. All columns are present in the regenerated database.ts
// from Phase 5 Wave-0 Task 0.4 — no cast boundary needed here.
// ---------------------------------------------------------------------------
export type SubscriptionRow = Tables<'subscriptions'>

// ---------------------------------------------------------------------------
// Liveness (audit min-22). A Stripe subscription only "occupies" an org's
// billing when it is in a live status — a churned row (cancelled/none) with a
// leftover stripe_subscription_id must NOT block admin comp, revoke, or org
// erasure, and must not 409 a fresh checkout. Test liveness, never bare
// stripe_subscription_id presence.
// ---------------------------------------------------------------------------
export const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const

export function isLiveSubscriptionStatus(status: string): boolean {
  return (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
}

// TRIAL-EXPIRY BACKSTOP (audit MAJOR-6). A `trialing` row whose trial_end is
// more than this grace window in the past means the trial-end webhook never
// arrived (rotated secret / changed URL / Stripe outage). Stripe retries
// webhooks for up to 3 days, so a 3-day grace lets a recovered outage self-heal
// via the retried event before the backstop bites. Shared by getEntitlement
// (which gates such a row as not-entitled) and the checkout 409 guard (which
// must NOT treat a backstop-expired trial as a live subscription — otherwise a
// locked-out org can't self-serve re-subscribe; review batch3 final finding 1).
export const TRIAL_EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000

export function isTrialBackstopExpired(
  status: string,
  trialEnd: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (status !== 'trialing' || !trialEnd) return false
  const trialEndMs = new Date(trialEnd).getTime()
  return Number.isFinite(trialEndMs) && nowMs - trialEndMs > TRIAL_EXPIRY_GRACE_MS
}

// True iff the row represents a LIVE Stripe-billed subscription (real Stripe
// subscription id AND a live status). Comp/invoice-billed rows (null sub id)
// and churned Stripe rows (cancelled/none) both return false.
export function hasLiveStripeSubscription(
  row: Pick<SubscriptionRow, 'stripe_subscription_id' | 'status'> | null | undefined,
): boolean {
  if (!row) return false
  return row.stripe_subscription_id !== null && isLiveSubscriptionStatus(row.status)
}

// ---------------------------------------------------------------------------
// getSubscriptionForOrg — reads the subscriptions table by organization_id.
//
// Returns not_found when no row exists (org has not subscribed yet).
// Callers synthesise a 'none' default in that case (see getEntitlement).
//
// SECURITY: the subscriptions table has SELECT policies scoped to the org;
// the passed client is either the RLS-scoped server client (billing page) or
// the service-role client (webhook). Both are safe here — the service-role
// client is tenant-boundary-checked by the caller before this read.
// ---------------------------------------------------------------------------
export async function getSubscriptionForOrg(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<DbResult<SubscriptionRow>> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'id, organization_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_seats, status, trial_end, current_period_end, created_at, updated_at',
    )
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getSubscriptionForOrg' },
    })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// upsertSubscriptionFromStripe — called only by the Stripe webhook handler
// (Task 1.2). Uses the service-role client (subscriptions has no write policy
// for the authenticated role — by design; only webhooks write here).
//
// Upserts on organization_id (the unique FK). Callers derive planKey from the
// reverse-map of PLAN_PRICE_IDS.
// ---------------------------------------------------------------------------
export type UpsertSubscriptionInput = {
  organizationId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  planKey: string
  planSeats: number
  status: string
  trialEnd: string | null
  currentPeriodEnd: string | null
}

export type UpsertSubscriptionOptions = {
  // When false (default), a Stripe lifecycle event is NOT allowed to overwrite a
  // comped / invoice-billed row (stripe_subscription_id IS NULL + entitled
  // status). Only a checkout-originated event — the org converting to self-serve
  // paid, which brings a real subscription id — passes true. See the comp-row
  // guard below (audit MAJOR-5).
  allowOverrideComp?: boolean
  // Stripe event.created (ISO), passed by the webhook. When present, a
  // genuine-paid override of a comp row is refused if the EVENT predates the
  // comp row's last write — a delayed first delivery of a pre-cancellation
  // 'active' event must not clobber a comp granted after that state was
  // already dead (review batch3 finding 8). Callers whose input reflects
  // CURRENT Stripe truth (the reconciliation cron's live listing) omit it.
  eventCreatedAtIso?: string
  // Set by the reconciliation cron only. Its input is authoritative CURRENT
  // Stripe state (it just listed Stripe), so the stale-sub DOWNGRADE heuristic
  // — which refuses a downgrade whose sub id differs from the live row's, on
  // the assumption it is a delayed webhook about an old sub — must NOT apply
  // to it (review batch3 round3: that heuristic silently blocks + mis-counts
  // legitimate cron drift repairs). The comp-row protection still applies.
  trustCurrentState?: boolean
}

export async function upsertSubscriptionFromStripe(
  serviceClient: SupabaseClient<Database>,
  input: UpsertSubscriptionInput,
  options?: UpsertSubscriptionOptions,
): Promise<DbResult<SubscriptionRow>> {
  // COMP-ROW PROTECTION (audit MAJOR-5). A comped / invoice-billed org has a
  // subscriptions row with stripe_subscription_id IS NULL and an entitled status
  // (set by the /admin Manual-access grant or a grandfathering seed — see the
  // manual-invoice-billing flow). A Stripe lifecycle event carrying that org's
  // metadata_organization_id — e.g. a stale event from a subscription that was
  // cancelled in Stripe AFTER the org moved to invoice billing, or an
  // out-of-order delete — must NEVER flip that comp row to cancelled/past_due
  // and lock the paying customer out. The upsert is last-write-wins, so we
  // guard here.
  //
  // We read the existing row ONCE and evaluate two protections. The first
  // (staleness) applies to EVERY caller including checkout-originated ones; the
  // second (comp-vs-downgrade) applies only when the caller has not opted into
  // overriding a comp.
  const existing = await getSubscriptionForOrg(serviceClient, input.organizationId)

  // Fail CLOSED on a transient read error (review finding 2). If we can't read
  // the current row we can't rule out that it's a comp/invoice-billed row, so
  // we must not risk the last-write-wins upsert clobbering it. Returning
  // internal makes the webhook 500 → Stripe re-delivers → the retry re-reads
  // cleanly. 'not_found' is a definite "no row yet" and is safe to proceed on.
  if (!existing.ok && existing.code !== 'not_found') {
    return { ok: false, code: 'internal' }
  }

  const isLiveComp =
    existing.ok &&
    existing.data.stripe_subscription_id === null &&
    existing.data.status !== 'cancelled' &&
    existing.data.status !== 'none'

  // STALENESS-vs-COMP guard (review batch3 finding 8 + round2/round3 finding 1).
  // A Stripe event minted BEFORE the comp row was written carries pre-comp state
  // — e.g. the org's original checkout that started a trial, whose delivery was
  // delayed and retried days later AFTER the founder comped the org. Such an
  // event must NEVER overwrite the comp, and this holds even for a
  // checkout-originated event (allowOverrideComp): a delayed retry of an OLD
  // checkout is exactly a stale event. A GENUINE new conversion (the org clicks
  // "start subscription" while already comped) has event.created AFTER the comp
  // row's updated_at and is NOT refused here. The subscriptions updated_at
  // trigger bumps on every write, so comparing against it is sound;
  // unparsable/missing timestamps fall back to allowing (checkout always passes
  // a timestamp, so the only omitting caller is the reconcile cron, whose input
  // already reflects current Stripe truth).
  if (isLiveComp && existing.ok && options?.eventCreatedAtIso) {
    const eventMs = new Date(options.eventCreatedAtIso).getTime()
    const compWrittenMs = new Date(existing.data.updated_at).getTime()
    if (Number.isFinite(eventMs) && Number.isFinite(compWrittenMs) && eventMs < compWrittenMs) {
      Sentry.captureMessage('stripe_webhook: refused stale event over comp/invoice-billed row', {
        level: 'warning',
        tags: {
          layer: 'db',
          helper: 'upsertSubscriptionFromStripe',
          org_id: input.organizationId,
          incoming_status: input.status,
        },
      })
      // Preserve the comp row. Return it as success so the webhook records the
      // event as processed and does not retry. noop:true so a caller that
      // counts writes (the reconcile cron) does not treat this as applied.
      return { ok: true, data: existing.data, noop: true }
    }
  }

  if (!options?.allowOverrideComp) {
    // STALE-SUB DOWNGRADE GUARD (review batch3 round2 finding 2). A downgrade
    // event (cancelled/past_due/none) must be about the subscription the row
    // currently tracks: a delayed deleted/payment_failed event for OLD sub_A
    // must not clobber a row that is currently LIVE on sub_B (the org
    // re-subscribed). Only fires when the existing row is live (nothing to
    // protect otherwise — round3) and NOT for the reconcile cron, whose input
    // is authoritative current Stripe state (round3: the heuristic wrongly
    // blocks + mis-counts legitimate cron drift repairs). Upgrades with a new
    // sub id are legitimate re-subscribes and pass through.
    const incomingIsDowngrade = input.status !== 'active' && input.status !== 'trialing'
    if (
      !options?.trustCurrentState &&
      incomingIsDowngrade &&
      existing.ok &&
      isLiveSubscriptionStatus(existing.data.status) &&
      existing.data.stripe_subscription_id !== null &&
      input.stripeSubscriptionId !== null &&
      existing.data.stripe_subscription_id !== input.stripeSubscriptionId
    ) {
      Sentry.captureMessage(
        'stripe_webhook: refused downgrade from a different (stale) subscription',
        {
          level: 'warning',
          tags: {
            layer: 'db',
            helper: 'upsertSubscriptionFromStripe',
            org_id: input.organizationId,
            incoming_status: input.status,
          },
        },
      )
      return { ok: true, data: existing.data, noop: true }
    }

    // A GENUINE new paid subscription — a real Stripe subscription id with an
    // 'active' status — is allowed to replace a comp even outside Checkout
    // (review finding 3: an org comped via /admin can later be moved onto a real
    // Stripe subscription through the Dashboard/API). 'active' ONLY: a trialing
    // sub is not evidence of payment, and letting it through would auto-convert
    // a permanent comp into a 14-day trial that lapses into the paywall (review
    // batch3 round2 finding 0). A genuine checkout-originated trial converts via
    // allowOverrideComp instead. Only a DOWNGRADE (cancelled/past_due, or a null
    // sub id) or a trial targeting a comp row is refused here.
    const incomingIsGenuinePaid = input.stripeSubscriptionId !== null && input.status === 'active'

    if (isLiveComp && !incomingIsGenuinePaid) {
      Sentry.captureMessage('stripe_webhook: refused to overwrite comp/invoice-billed row', {
        level: 'warning',
        tags: {
          layer: 'db',
          helper: 'upsertSubscriptionFromStripe',
          org_id: input.organizationId,
          incoming_status: input.status,
        },
      })
      // Preserve the comp row. Return it as success so the webhook records the
      // event as processed and does not retry. noop:true so a write-counting
      // caller (the reconcile cron) does not treat this as applied.
      return { ok: true, data: existing.data, noop: true }
    }
  }

  const now = new Date().toISOString()

  // reason: TablesInsert<'subscriptions'> includes all live columns from the
  // Wave-0 migration. The service-role client bypasses RLS; this is the
  // authoritative write path from Stripe webhook events only.
  const payload = {
    organization_id: input.organizationId,
    stripe_customer_id: input.stripeCustomerId,
    stripe_subscription_id: input.stripeSubscriptionId,
    plan_key: input.planKey,
    plan_seats: input.planSeats,
    status: input.status,
    trial_end: input.trialEnd,
    current_period_end: input.currentPeriodEnd,
    updated_at: now,
  }

  const { data, error } = await serviceClient
    .from('subscriptions')
    .upsert(payload, { onConflict: 'organization_id' })
    .select(
      'id, organization_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_seats, status, trial_end, current_period_end, created_at, updated_at',
    )
    .single()

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'upsertSubscriptionFromStripe' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}
