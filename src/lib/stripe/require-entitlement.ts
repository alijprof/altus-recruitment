import 'server-only'

// ---------------------------------------------------------------------------
// require-entitlement — the single server-side entitlement GATE for mutations.
//
// Policy (AUTHORITATIVE — must match src/app/(app)/layout.tsx EXACTLY):
//   entitled ⟺ getEntitlement(orgId).status ∈ {'trialing', 'active'}
//
// There is NO carve-out for status 'none': the layout already gates 'none'
// card-first, so a legitimately-onboarding org is 'trialing' (entitled) by the
// time it can reach any action. Grandfathered comp orgs are status 'active'
// (null stripe ids) → entitled. `getEntitlement` already honours
// trial_end_override (admin trial extensions) — reusing it means this gate
// inherits that logic identically.
//
// Use this at the top of every MUTATING server action (after input validation)
// and in the authed /api/linkedin/ingest route (after bearer auth, before any
// write/enqueue). It is intentionally a separate, fail-CLOSED gate — see
// requireEntitledOrg's error posture below.
// ---------------------------------------------------------------------------

import * as Sentry from '@sentry/nextjs'

import { getProfile } from '@/lib/db/profiles'
import { getEntitlement } from '@/lib/stripe/entitlement'
import { createClient } from '@/lib/supabase/server'
import type { EntitlementStatus } from '@/types/billing'

// The only statuses that count as entitled. Mirrors the layout's check.
export const ENTITLED_STATUSES = ['trialing', 'active'] as const

export type EntitledStatus = (typeof ENTITLED_STATUSES)[number]

// True iff the given subscription status grants full access. Pure + sync so it
// can be reused by checkCap (cap-enforcement) without re-resolving the org.
export function isEntitledStatus(status: EntitlementStatus['status']): boolean {
  return (ENTITLED_STATUSES as readonly string[]).includes(status)
}

// User-facing message returned by gated actions when an org is not entitled.
export const ENTITLEMENT_BLOCKED_MESSAGE =
  'Your subscription is inactive. Please update your billing in Settings → Billing to continue.'

// ---------------------------------------------------------------------------
// isOrgEntitled — the lightweight predicate for callers that already hold a
// trusted orgId (the public apply form, the LinkedIn ingest route). Reuses
// getEntitlement so status semantics (incl. trial_end_override) are identical.
//
// Fails CLOSED on a thrown error (returns false) but captures to Sentry: a
// mutation/AI-spend gate that errors must not silently grant access. Burning
// nothing is the safe outcome (a blocked action is recoverable; spent AI keys
// are not).
// ---------------------------------------------------------------------------
export async function isOrgEntitled(orgId: string): Promise<boolean> {
  try {
    const entitlement = await getEntitlement(orgId)
    return isEntitledStatus(entitlement.status)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'billing', helper: 'isOrgEntitled', step: 'getEntitlement', organization_id: orgId },
    })
    // Fail CLOSED — see the doc block above.
    return false
  }
}

// ---------------------------------------------------------------------------
// EntitlementGate — the result of requireEntitledOrg.
//   ok:true  → caller may proceed; userId/orgId/status are resolved.
//   ok:false → caller MUST bail; `reason` distinguishes auth vs billing.
// ---------------------------------------------------------------------------
export type EntitlementGate =
  | { ok: true; userId: string; orgId: string; status: EntitlementStatus['status'] }
  | { ok: false; reason: 'unauthenticated' | 'not_entitled'; status?: EntitlementStatus['status'] }

// ---------------------------------------------------------------------------
// requireEntitledOrg — the gate for cookie-authenticated server actions.
//
// Resolves the calling user → org → entitlement. Returns ok:true only when the
// org's status is entitled. On any thrown error during resolution it FAILS
// CLOSED (returns not_entitled) but captures to Sentry. This deliberately
// differs from checkCap (which fails OPEN on a transient DB error): a blocked
// mutation is fully recoverable once billing resolves, whereas wrongly granting
// a mutation/AI spend to a lapsed org is not.
// ---------------------------------------------------------------------------
export async function requireEntitledOrg(): Promise<EntitlementGate> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { ok: false, reason: 'unauthenticated' }
    }

    const profile = await getProfile(supabase, user.id)
    if (!profile.ok) {
      // No profile row → treat as unauthenticated (cannot resolve an org).
      return { ok: false, reason: 'unauthenticated' }
    }
    const orgId = profile.data.organization_id

    const entitlement = await getEntitlement(orgId)
    if (!isEntitledStatus(entitlement.status)) {
      return { ok: false, reason: 'not_entitled', status: entitlement.status }
    }

    return { ok: true, userId: user.id, orgId, status: entitlement.status }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'billing', helper: 'requireEntitledOrg', step: 'resolve' },
    })
    // Fail CLOSED — burning nothing is the safe outcome for a gate error.
    return { ok: false, reason: 'not_entitled' }
  }
}
