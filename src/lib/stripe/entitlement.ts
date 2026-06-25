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
import { getSpendCeilingState } from '@/lib/stripe/spend-ceiling'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/types/database'
import type { EntitlementStatus, AiCaps, AiUsageAggregate } from '@/types/billing'

// ---------------------------------------------------------------------------
// PlanOverrideRow — shape of the plan_overrides table (05-05 migration).
//
// reason: plan_overrides is added by 20260604130000_phase5_admin_overrides.sql
// which has not been pushed yet at the time of writing (Wave 2 [BLOCKING] push).
// Until `pnpm db:types` is run post-push, the generated Database type does not
// include this table. We cast at the query boundary using the same pattern as
// src/lib/db/organizations.ts. Remove the cast after Task 5.3 regeneration.
// ---------------------------------------------------------------------------
type PlanOverrideRow = {
  organization_id: string
  trial_end_override: string | null
  cap_multiplier: number | null
  note: string | null
  updated_by: string | null
  updated_at: string
}

// Typed cast boundary for the plan_overrides table (pre-types-regeneration).
type PlanOverridesClient = {
  from: (table: 'plan_overrides') => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{
        data: PlanOverrideRow[] | null
        error: unknown
      }>
    }
  }
}

// Read the plan_override row for an org. Uses the passed client — can be either
// the org's RLS-scoped client (reads its own row via SELECT policy) or the
// service-role client (admin cross-org reads; bypasses RLS).
async function getPlanOverride(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<PlanOverrideRow | null> {
  const overrideClient = supabase as unknown as PlanOverridesClient

  const { data, error } = await overrideClient
    .from('plan_overrides')
    .select('organization_id, trial_end_override, cap_multiplier, note, updated_by, updated_at')
    .eq('organization_id', orgId)

  if (error) {
    // Fail open — if the table doesn't exist yet (pre-push), treat as no override.
    return null
  }

  const rows = data ?? []
  return rows[0] ?? null
}

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
// IMPORTANT: This always uses the service-role client internally, regardless of
// the `_supabase` argument. It is intentionally callable from both authenticated
// requests AND background contexts (Inngest cap-enforcement, claude.ts) that have
// no session client. Because RLS is bypassed by service-role, the org boundary is
// enforced solely by the `orgId` argument — callers MUST pass the correct,
// already-authorised org id. There is no RLS safety net here.
//
// @param orgId  The organisation UUID. This is the only org-isolation boundary.
// @param _supabase  Ignored. Kept to avoid call-site churn; do not rely on it.
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
  // Ignored — see the doc block above. This function always uses the
  // service-role client so it can run in background contexts without a session.
  // The param is retained only to avoid churning existing call sites.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _supabase?: SupabaseClient<Database>,
): Promise<EntitlementStatus> {
  const serviceClient = createServiceClient()

  // Run subscription fetch, usage fetch, seat count, and overrides concurrently.
  // plan_overrides is read via service-role (which bypasses RLS) so we can read
  // it alongside subscriptions without a separate RLS-scoped client.
  const [subscriptionResult, aiUsageThisMonth, activeSeats, override, spendState] =
    await Promise.all([
      getSubscriptionForOrg(serviceClient, orgId),
      getAiUsageThisMonth(serviceClient, orgId),
      countActiveSeats(serviceClient, orgId),
      // Fail-open: if the plan_overrides table doesn't exist yet (pre-push), returns null.
      getPlanOverride(serviceClient, orgId),
      // Fail-open: month-to-date £ spend vs the effective ceiling. Drives the
      // billing page spend card, the "AI budget reached" banner, and the
      // cap-enforcement £ backstop (which now reads spendState.breached).
      getSpendCeilingState(orgId),
    ])

  // cap_multiplier from the override row (1.0 = no change; null = no override).
  const capMultiplier = override?.cap_multiplier ?? 1.0

  // Applies cap_multiplier to all buckets in a cap set.
  function applyCapMultiplier(caps: AiCaps): AiCaps {
    if (capMultiplier === 1.0) return caps
    return {
      matchScores: Math.round(caps.matchScores * capMultiplier),
      cvParses: Math.round(caps.cvParses * capMultiplier),
      searches: Math.round(caps.searches * capMultiplier),
      specMinutes: Math.round(caps.specMinutes * capMultiplier),
      writingCalls: Math.round(caps.writingCalls * capMultiplier),
    }
  }

  // No subscription row → treat as trial-not-started.
  // Trial users get Pro-level caps for 14 days (plan must_haves).
  if (!subscriptionResult.ok) {
    const trialCaps = applyCapMultiplier(effectiveCaps('pro', PLANS.pro.seats))
    const { softCapBreached, hardCapBreached } = computeCapFlags(trialCaps, aiUsageThisMonth)
    return {
      planKey: 'none',
      planSeats: PLANS.pro.seats,
      activeSeats,
      status: 'none',
      trialEnd: null,
      currentPeriodEnd: null,
      aiCaps: trialCaps,
      aiUsageThisMonth,
      softCapBreached,
      hardCapBreached,
      // No subscription row → no Stripe customer.
      hasStripeCustomerId: false,
      monthlySpendThisMonthPence: spendState.spentPence,
      effectiveSpendCeilingPence: spendState.ceilingPence,
      spendCeilingBreached: spendState.breached,
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

  // Determine effective status, honouring trial_end_override.
  // If the subscription is trialing and trial_end_override is set to a future
  // date, the org retains trialing status even if trial_end has passed.
  let effectiveStatus = sub.status as EntitlementStatus['status']
  // Effective trial end mirrors effectiveStatus: defaults to the subscription's
  // trial_end, but is replaced by trial_end_override when the override applies.
  let trialEnd = sub.trial_end
  if (
    override?.trial_end_override &&
    (effectiveStatus === 'trialing' || effectiveStatus === 'none')
  ) {
    const overrideEnd = new Date(override.trial_end_override)
    if (overrideEnd > new Date()) {
      // Override extends the trial — treat as still trialing.
      effectiveStatus = 'trialing'
      trialEnd = override.trial_end_override
    }
  }

  const caps = applyCapMultiplier(effectiveCaps(planKey, planSeats))
  const { softCapBreached, hardCapBreached } = computeCapFlags(caps, aiUsageThisMonth)

  return {
    planKey,
    planSeats,
    activeSeats,
    status: effectiveStatus,
    trialEnd,
    currentPeriodEnd: sub.current_period_end,
    aiCaps: caps,
    aiUsageThisMonth,
    softCapBreached,
    hardCapBreached,
    // A real Stripe customer id means self-serve Stripe billing; a comped /
    // invoice-billed org has an active subscription with null stripe ids.
    hasStripeCustomerId: !!sub.stripe_customer_id,
    monthlySpendThisMonthPence: spendState.spentPence,
    effectiveSpendCeilingPence: spendState.ceilingPence,
    spendCeilingBreached: spendState.breached,
  }
}
