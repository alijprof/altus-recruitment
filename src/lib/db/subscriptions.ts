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

export async function upsertSubscriptionFromStripe(
  serviceClient: SupabaseClient<Database>,
  input: UpsertSubscriptionInput,
): Promise<DbResult<SubscriptionRow>> {
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
