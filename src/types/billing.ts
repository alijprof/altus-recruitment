// Billing type contracts for Phase 5.
//
// These are the shared types that 05-01 (entitlement engine) and 05-05
// (billing portal/admin) implement against. Keeping them here (not in
// src/lib/) means they can be imported by both server and client code
// without triggering 'server-only' import errors.

import type { PlanKey } from '@/lib/stripe/plans'

// Re-export so callers import from a single billing module.
export type { PlanKey }

// Mirrors the `status` CHECK constraint on the `subscriptions` table.
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'none'

// Per-seat/month AI usage caps for a plan tier.
// Keys align with `ai_usage.purpose` values for direct aggregation.
export type AiCaps = {
  matchScores: number
  cvParses: number
  searches: number
  specMinutes: number
  writingCalls: number
}

// Month-to-date AI usage aggregated from the `ai_usage` table.
// Same keys as AiCaps so they can be compared directly.
export type AiUsageAggregate = {
  matchScores: number
  cvParses: number
  searches: number
  specMinutes: number
  writingCalls: number
}

// The full entitlement status for an organisation, returned by the
// entitlement helper (implemented in 05-01). Consumed by:
//   - Middleware / route guards: check `status` + `hardCapBreached`
//   - AI call sites: check per-purpose cap before calling Claude/Voyage
//   - Billing UI: display plan, seat count, usage bars
export type EntitlementStatus = {
  // The active plan key, or 'none' if no active subscription.
  planKey: PlanKey | 'none'
  // Seats allowed under the current subscription.
  planSeats: number
  // Current active member count for the org (from the users table).
  activeSeats: number
  // Subscription lifecycle status.
  status: SubscriptionStatus
  // The AI caps for the current plan tier (all zeros when planKey='none').
  aiCaps: AiCaps
  // Actual AI usage this calendar month (from ai_usage table).
  aiUsageThisMonth: AiUsageAggregate
  // True when any cap dimension has crossed the 80% soft-cap threshold.
  // Triggers a once-per-bucket-per-month notification email (05-01 Task 1.4).
  softCapBreached: boolean
  // True when any cap dimension has hit 100%. AI features degrade gracefully.
  hardCapBreached: boolean
}
