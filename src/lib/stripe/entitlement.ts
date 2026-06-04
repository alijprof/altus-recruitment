import 'server-only'

// SECURITY NOTE: This module MUST NOT import '@/lib/stripe/client' or call any
// stripe.* method. Entitlement resolution is LOCAL-DB-ONLY by design (see Plan
// must_haves[3]). Calling Stripe at request time would add latency + a hard
// dependency on Stripe uptime to every page load. The acceptance tests check
// this invariant at source level.

import type { SupabaseClient } from '@supabase/supabase-js'

import { getSubscriptionForOrg } from '@/lib/db/subscriptions'
import { getAiUsageThisMonth } from '@/lib/stripe/usage'
import { PLANS } from '@/lib/stripe/plans'
import type { PlanKey } from '@/lib/stripe/plans'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/types/database'
import type { EntitlementStatus, AiCaps, AiUsageAggregate } from '@/types/billing'

// ---------------------------------------------------------------------------
// getEntitlement — the single entrypoint for billing-gated logic.
//
// Reads: subscriptions table (plan_key, plan_seats, status) + ai_usage
// (month-to-date counts per purpose). No Stripe API calls.
//
// Used by:
//   - Billing settings page (display plan/status/caps)
//   - Seat check in inviteMemberAction (planSeats, activeSeats)
//   - App layout banner (softCapBreached, hardCapBreached)
//   - cap-enforcement.ts (indirectly via checkCap)
//
// @param orgId  The organisation UUID.
// @param supabase  Optional: pass the caller's RLS-scoped client to avoid a
//   second createServiceClient call. When absent (e.g. from claude.ts which
//   has no session), a fresh service-role client is used.
// ---------------------------------------------------------------------------

const SOFT_CAP_THRESHOLD = 0.8 // 80%
const HARD_CAP_THRESHOLD = 1.0 // 100%

// Compute flags given caps and usage
function computeCapFlags(
  effectiveCaps: AiCaps,
  usage: AiUsageAggregate,
): { softCapBreached: boolean; hardCapBreached: boolean } {
  const buckets = Object.keys(effectiveCaps) as Array<keyof AiCaps>
  let softCapBreached = false
  let hardCapBreached = false

  for (const bucket of buckets) {
    const cap = effectiveCaps[bucket]
    const used = usage[bucket]
    if (cap <= 0) continue // ignore zero-cap buckets (shouldn't happen with valid plans)
    const ratio = used / cap
    if (ratio >= HARD_CAP_THRESHOLD) {
      hardCapBreached = true
      softCapBreached = true
    } else if (ratio >= SOFT_CAP_THRESHOLD) {
      softCapBreached = true
    }
  }

  return { softCapBreached, hardCapBreached }
}

// Multiply per-seat caps by planSeats to get the effective org cap
function effectiveCaps(planKey: PlanKey, planSeats: number): AiCaps {
  const planCaps = PLANS[planKey].aiCaps
  return {
    matchScores: planCaps.matchScores * planSeats,
    cvParses: planCaps.cvParses * planSeats,
    searches: planCaps.searches * planSeats,
    specMinutes: planCaps.specMinutes * planSeats,
    writingCalls: planCaps.writingCalls * planSeats,
  }
}

// Active seat count — number of users in the org from the public.users table.
// Uses the service-role client because this is called from both authenticated
// and background contexts (claude.ts cap checks run in Inngest).
async function countActiveSeats(serviceClient: SupabaseClient<Database>, orgId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)

  if (error || count === null) return 1 // fail open: assume at least one seat
  return count
}

export async function getEntitlement(
  orgId: string,
  // Allow callers to pass their existing RLS-scoped client for usage reads.
  // For the seat count + subscription we always use service-role.
  _supabase?: SupabaseClient<Database>,
): Promise<EntitlementStatus> {
  const serviceClient = createServiceClient()

  // Run subscription fetch, usage fetch, and seat count concurrently.
  const [subscriptionResult, aiUsageThisMonth, activeSeats] = await Promise.all([
    getSubscriptionForOrg(serviceClient, orgId),
    getAiUsageThisMonth(serviceClient, orgId),
    countActiveSeats(serviceClient, orgId),
  ])

  // No subscription row → treat as trial-not-started.
  // Trial users get Pro-level caps for 14 days (plan must_haves).
  if (!subscriptionResult.ok) {
    const trialCaps = effectiveCaps('pro', PLANS.pro.seats)
    const { softCapBreached, hardCapBreached } = computeCapFlags(trialCaps, aiUsageThisMonth)
    return {
      planKey: 'none',
      planSeats: PLANS.pro.seats,
      activeSeats,
      status: 'none',
      aiCaps: trialCaps,
      aiUsageThisMonth,
      softCapBreached,
      hardCapBreached,
    }
  }

  const sub = subscriptionResult.data

  // Validate plan_key is a known plan; fall back to 'pro' if the DB has an
  // unexpected value (defensive — the schema CHECK constraint normally prevents
  // this, but DB enum changes can lag code deploys).
  const planKey: PlanKey = (sub.plan_key as PlanKey) in PLANS
    ? (sub.plan_key as PlanKey)
    : 'pro'

  const planSeats = sub.plan_seats > 0 ? sub.plan_seats : PLANS[planKey].seats
  const caps = effectiveCaps(planKey, planSeats)
  const { softCapBreached, hardCapBreached } = computeCapFlags(caps, aiUsageThisMonth)

  return {
    planKey,
    planSeats,
    activeSeats,
    status: sub.status as EntitlementStatus['status'],
    aiCaps: caps,
    aiUsageThisMonth,
    softCapBreached,
    hardCapBreached,
  }
}
