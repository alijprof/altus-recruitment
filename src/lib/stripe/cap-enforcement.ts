import 'server-only'

// AI-usage cap enforcement — 05-01 Task 1.4
//
// checkCap(orgId, purpose) is the central gate called by runWithLogging
// in src/lib/ai/claude.ts BEFORE every Anthropic API call.
//
// Modes:
//   'normal'  (<80%)  → call proceeds normally
//   'soft'    (80-99%) → call proceeds; soft-cap email fires once per bucket/month
//   'hard'    (≥100%) → call should NOT proceed for on-demand purposes
//
// For hard-capped on-demand purposes (match_score): the caller (runWithLogging
// / scoreCandidateForJob) throws CapExceededError → precompute-matches treats
// it the same as its existing spend-ceiling bail (Sentry warning, cached-only).
//
// For cv_parse hard cap: the caller queues/defers rather than throwing to the
// user — never blocks onboarding (D-08). The distinction is made by the caller
// based on the `mode` value; this helper just reports the cap state.
//
// Soft-cap email dedup: INSERT into ai_cap_notifications (UNIQUE on
// organization_id + bucket + notified_month). Email fires ONLY when the insert
// creates a new row (no conflict). This guarantees at-most-once per bucket per
// month even under high concurrency (the UNIQUE constraint is the lock).
//
// Overage: NOT a stored table. Derived from existing ai_usage rows + PLANS caps
// at query time in billing page / admin console. This is the committed design
// (see SUMMARY / 05-01 Task 1.4 accepted criteria).

import * as Sentry from '@sentry/nextjs'

import { getEntitlement } from '@/lib/stripe/entitlement'
import { isEntitledStatus } from '@/lib/stripe/require-entitlement'
import { PURPOSE_CAP_BUCKETS } from '@/lib/stripe/usage'
import { createServiceClient } from '@/lib/supabase/service'
import { sendCapWarningEmail } from '@/lib/email/billing-emails'
import type { AiUsageAggregate } from '@/types/billing'

// ---------------------------------------------------------------------------
// CapExceededError — typed error thrown by runWithLogging at hard cap.
// Callers pattern-match on `instanceof CapExceededError` to branch into
// cached-only or queue paths rather than surfacing a generic error.
// ---------------------------------------------------------------------------
export class CapExceededError extends Error {
  constructor(
    public readonly bucket: string,
    public readonly purpose: string,
    public readonly organizationId: string,
  ) {
    super(`AI cap exceeded for bucket '${bucket}' (purpose: ${purpose}, org: ${organizationId})`)
    this.name = 'CapExceededError'
  }
}

// ---------------------------------------------------------------------------
// checkCap result — returned by checkCap and consumed by runWithLogging.
// ---------------------------------------------------------------------------
export type CapCheckResult = {
  allow: boolean
  mode: 'normal' | 'soft' | 'hard'
  bucket: string
}

const SOFT_THRESHOLD = 0.8
const HARD_THRESHOLD = 1.0

// Current YYYY-MM string for the dedup ledger.
function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// checkCap — the public API.
//
// @param orgId   Organisation UUID.
// @param purpose ai_usage.purpose value (e.g. 'match_score', 'cv_parse').
// @returns       { allow, mode, bucket }
//
// Errors: fails OPEN (returns mode 'normal', allow true) on any DB/entitlement
// error. A billing misconfiguration should never block the AI stack.
// ---------------------------------------------------------------------------
export async function checkCap(orgId: string, purpose: string): Promise<CapCheckResult> {
  const bucket = PURPOSE_CAP_BUCKETS[purpose]

  // Unknown purpose → not capped. Allow.
  if (!bucket) {
    return { allow: true, mode: 'normal', bucket: purpose }
  }

  let entitlement
  try {
    entitlement = await getEntitlement(orgId)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'billing', helper: 'checkCap', step: 'getEntitlement', organization_id: orgId },
    })
    // Fail open — a billing error should not block AI features.
    return { allow: true, mode: 'normal', bucket }
  }

  // Entitlement gate (audit blocker 2). Fail-open-on-error (above) vs
  // fail-closed-on-definitive-status (here): a transient DB error must not
  // block a paying customer's AI, but a DEFINITIVE non-entitled status
  // (lapsed/cancelled/past_due/none) must deny — those orgs otherwise burn
  // paid AI keys to the monthly cap. Status entitled ⟺ {trialing, active}
  // (matches the layout + requireEntitledOrg exactly).
  if (!isEntitledStatus(entitlement.status)) {
    return { allow: false, mode: 'hard', bucket }
  }

  // GLOBAL / PER-ORG £ CEILING (handover cost guardrail). Hard backstop on
  // total month-to-date AI spend so a comped org — whose AI the founder pays
  // for on shared keys — cannot run unbounded cost. The per-org cap
  // (plan_overrides.monthly_spend_cap_pence) takes precedence when lower; a
  // generous global env backstop applies otherwise. Read from the entitlement
  // snapshot (computed by getSpendCeilingState, which fails open) so we don't
  // re-query the spend sum on every capped Claude call.
  if (entitlement.spendCeilingBreached) {
    return { allow: false, mode: 'hard', bucket }
  }

  const cap = entitlement.aiCaps[bucket as keyof AiUsageAggregate]
  const used = entitlement.aiUsageThisMonth[bucket as keyof AiUsageAggregate]

  // Zero cap → treat as normal (safety valve for misconfigured plans).
  if (cap <= 0) {
    return { allow: true, mode: 'normal', bucket }
  }

  const ratio = used / cap

  if (ratio >= HARD_THRESHOLD) {
    // Hard cap: deny.
    return { allow: false, mode: 'hard', bucket }
  }

  if (ratio >= SOFT_THRESHOLD) {
    // Soft cap: allow but fire the once-per-bucket-per-month email.
    void fireSoftCapEmail(orgId, bucket, Math.round(ratio * 100)).catch((err) => {
      Sentry.captureException(err, {
        tags: {
          layer: 'billing',
          helper: 'checkCap',
          step: 'softCap',
          organization_id: orgId,
          bucket,
        },
      })
    })
    return { allow: true, mode: 'soft', bucket }
  }

  return { allow: true, mode: 'normal', bucket }
}

// ---------------------------------------------------------------------------
// fireSoftCapEmail — insert into ai_cap_notifications (unique dedup) then
// fire the cap warning email only if the insert actually created a new row.
//
// The INSERT uses the service-role client (cap enforcement runs server-side
// in claude.ts and Inngest — no user session).
//
// NEVER call this inside an onAuthStateChange/subscriber callback (CLAUDE.md).
// ---------------------------------------------------------------------------
async function fireSoftCapEmail(
  organizationId: string,
  bucket: string,
  percentUsed: number,
): Promise<void> {
  const notifiedMonth = currentMonth()
  const serviceClient = createServiceClient()

  // Attempt idempotent insert. The UNIQUE (organization_id, bucket, notified_month)
  // constraint makes this atomic — only one concurrent winner inserts; others
  // get a 23505 unique violation which we treat as "already notified".
  const { data: inserted, error } = await serviceClient
    .from('ai_cap_notifications')
    .insert({ organization_id: organizationId, bucket, notified_month: notifiedMonth })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      // Already notified this month — skip.
      return
    }
    // Other DB error — log and skip. Do NOT throw (best-effort).
    Sentry.captureException(error, {
      tags: {
        layer: 'billing',
        helper: 'fireSoftCapEmail',
        organization_id: organizationId,
        bucket,
      },
    })
    return
  }

  // Only fire the email when the insert actually created a new row.
  if (!inserted) return

  // Best-effort email — sendCapWarningEmail never throws.
  await sendCapWarningEmail({ organizationId, bucket, percentUsed })
}
