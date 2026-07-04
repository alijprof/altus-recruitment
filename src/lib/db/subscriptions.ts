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
  // and lock the paying customer out. The upsert is last-write-wins, so we guard
  // here: unless the caller explicitly allows it (checkout-originated), a write
  // that would clobber a live comp row is skipped (no-op) and the comp row is
  // preserved and returned as success.
  if (!options?.allowOverrideComp) {
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

    // A GENUINE new paid subscription — a real Stripe subscription id with an
    // entitled status — is allowed to replace a comp even outside Checkout
    // (review finding 3: an org comped via /admin can later be moved onto a real
    // Stripe subscription through the Dashboard/API, whose created/updated
    // events carry a real sub id and an active/trialing status). Only a stale
    // DOWNGRADE (cancelled/past_due, or a null sub id) targeting a comp row is
    // refused — that is the MAJOR-5 lock-out we are guarding against.
    const incomingIsGenuinePaid =
      input.stripeSubscriptionId !== null &&
      (input.status === 'active' || input.status === 'trialing')

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
      // event as processed and does not retry.
      return { ok: true, data: existing.data }
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
