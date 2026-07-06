import 'server-only'

// ---------------------------------------------------------------------------
// reconcile — pure diff between Stripe's subscription state and our local
// subscriptions table (audit MAJOR-6: "no Stripe reconciliation; a webhook
// outage silently freezes billing in both directions").
//
// The two directions this closes:
//   (a) checkout completed + paid in Stripe, but the local row was never
//       written (webhook outage) → the customer is paywalled AFTER paying.
//       → repair 'missing_local_row' / 'drift' writes the Stripe truth.
//   (b) trial/subscription ended in Stripe, but the local row still says
//       entitled → the org keeps burning founder-paid AI for free.
//       → repair 'drift' / 'stale_local_sub' downgrades to the Stripe truth.
//
// This module is PURE (no I/O) so the decision matrix is unit-testable. The
// Inngest cron (src/lib/inngest/functions/stripe-reconcile.ts) owns listing
// Stripe, loading local rows, executing repairs, and alerting.
//
// CONSERVATISM RULES (each prevents a specific foot-gun):
//   - Comp/invoice-billed rows (null stripe_subscription_id + live status) are
//     never downgraded — a dead Stripe sub alongside a comp row is the normal
//     churned-then-comped shape, not drift.
//   - An unknown price on a LIVE Stripe sub is an anomaly, not a repair — we
//     never guess a plan (same rule as the webhook's derivePlanKey contract).
//   - 'stale_local_sub' (local live row whose sub vanished from Stripe) fires
//     only when the Stripe listing completed AND the sub id appears in no
//     snapshot at all — a sub with lost org metadata must alert, not cancel a
//     paying customer.
// ---------------------------------------------------------------------------

import type Stripe from 'stripe'

import type { SubscriptionRow, UpsertSubscriptionInput } from '@/lib/db/subscriptions'
import { isEntitledSubscriptionStatus, isLiveSubscriptionStatus } from '@/lib/db/subscriptions'
import type { PlanKey } from '@/lib/stripe/plans'
import {
  derivePlanKey,
  getCurrentPeriodEnd,
  getCustomerId,
  getTrialEndIso,
  mapStripeStatus,
  seatsForPlan,
} from '@/lib/stripe/subscription-sync'

// Minimal, JSON-serializable view of a Stripe subscription — everything the
// diff needs, nothing more (Inngest step outputs must be serializable).
export type StripeSubSnapshot = {
  subscriptionId: string
  customerId: string | null
  organizationId: string | null // metadata.organization_id; null = lost metadata
  mappedStatus: string // OUR enum, via mapStripeStatus
  planKey: PlanKey | null // null = unknown price id
  trialEnd: string | null
  currentPeriodEnd: string | null
}

export function snapshotFromStripeSubscription(sub: Stripe.Subscription): StripeSubSnapshot {
  return {
    subscriptionId: sub.id,
    customerId: getCustomerId(sub),
    organizationId: sub.metadata?.organization_id ?? null,
    mappedStatus: mapStripeStatus(sub.status),
    planKey: derivePlanKey(sub),
    trialEnd: getTrialEndIso(sub),
    currentPeriodEnd: getCurrentPeriodEnd(sub),
  }
}

export type LocalSubscriptionRow = Pick<
  SubscriptionRow,
  | 'organization_id'
  | 'stripe_customer_id'
  | 'stripe_subscription_id'
  | 'plan_key'
  | 'plan_seats'
  | 'status'
  | 'trial_end'
  | 'current_period_end'
>

export type ReconcileRepair = {
  organizationId: string
  reason: 'missing_local_row' | 'drift' | 'stale_local_sub'
  detail: string
  input: UpsertSubscriptionInput
}

export type ReconcileAnomaly = {
  kind:
    | 'missing_org_metadata'
    | 'multiple_live_subscriptions'
    | 'unknown_price'
    | 'comp_row_conflict'
    | 'incomplete_listing'
  detail: string
}

export type ReconcileDiff = {
  repairs: ReconcileRepair[]
  anomalies: ReconcileAnomaly[]
}

// Comp/invoice-billed row: entitled WITHOUT a Stripe subscription (the /admin
// Manual-access grant or a grandfathering seed).
function isCompRow(row: LocalSubscriptionRow): boolean {
  return row.stripe_subscription_id === null && isLiveSubscriptionStatus(row.status)
}

// Normalize an ISO-ish timestamp for comparison (DB returns '+00:00' offsets,
// Stripe-derived strings end in 'Z'; both must compare equal).
function toEpoch(value: string | null): number | null {
  if (value === null) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function timestampsDiffer(a: string | null, b: string | null): boolean {
  return toEpoch(a) !== toEpoch(b)
}

// Pick the canonical Stripe sub for an org that has several: a live one wins;
// among dead ones, the one the local row already points at wins (least
// surprising repair); ties break on subscription id for determinism.
function pickCanonical(
  subs: StripeSubSnapshot[],
  localSubId: string | null,
): { canonical: StripeSubSnapshot; multipleLive: boolean } {
  const sorted = [...subs].sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId))
  const live = sorted.filter((s) => isLiveSubscriptionStatus(s.mappedStatus))
  if (live.length > 0) {
    return { canonical: live[0]!, multipleLive: live.length > 1 }
  }
  const matchingLocal = sorted.find((s) => s.subscriptionId === localSubId)
  return { canonical: matchingLocal ?? sorted[0]!, multipleLive: false }
}

export function diffStripeAgainstLocal(args: {
  stripeSubs: StripeSubSnapshot[]
  localRows: LocalSubscriptionRow[]
  // False when Stripe pagination hit the page cap or errored part-way — the
  // absence-based 'stale_local_sub' repair is then unsafe and is skipped.
  stripeListComplete: boolean
}): ReconcileDiff {
  const repairs: ReconcileRepair[] = []
  const anomalies: ReconcileAnomaly[] = []

  const localByOrg = new Map<string, LocalSubscriptionRow>()
  for (const row of args.localRows) {
    localByOrg.set(row.organization_id, row)
  }

  // Every sub id Stripe returned, regardless of metadata — guards the
  // stale_local_sub direction against metadata loss.
  const allStripeSubIds = new Set<string>()
  const subsByOrg = new Map<string, StripeSubSnapshot[]>()
  const deadMetadataless: StripeSubSnapshot[] = []
  for (const sub of args.stripeSubs) {
    allStripeSubIds.add(sub.subscriptionId)
    if (sub.organizationId === null) {
      // A LIVE metadata-less sub is always an anomaly. A dead one is usually
      // just noise (alerting on it daily forever would train the founder to
      // ignore the divergence email — review batch3 finding 10) — EXCEPT when
      // a live local row still points at it, which is checked after the local
      // rows are indexed below (review batch3 round2 finding 3).
      if (isLiveSubscriptionStatus(sub.mappedStatus)) {
        anomalies.push({
          kind: 'missing_org_metadata',
          detail: `Stripe subscription ${sub.subscriptionId} (status ${sub.mappedStatus}) has no organization_id metadata — cannot reconcile it.`,
        })
      } else {
        deadMetadataless.push(sub)
      }
      continue
    }
    const list = subsByOrg.get(sub.organizationId) ?? []
    list.push(sub)
    subsByOrg.set(sub.organizationId, list)
  }

  for (const [orgId, subs] of subsByOrg) {
    const local = localByOrg.get(orgId) ?? null
    const { canonical, multipleLive } = pickCanonical(subs, local?.stripe_subscription_id ?? null)

    if (multipleLive) {
      anomalies.push({
        kind: 'multiple_live_subscriptions',
        detail: `Org ${orgId} has ${subs.filter((s) => isLiveSubscriptionStatus(s.mappedStatus)).length} LIVE Stripe subscriptions (${subs.map((s) => s.subscriptionId).join(', ')}) — likely a double-subscribe; cancel the extra in Stripe.`,
      })
      // Don't auto-repair against an ambiguous canonical — founder must pick.
      continue
    }

    const canonicalIsLive = isLiveSubscriptionStatus(canonical.mappedStatus)

    // Unknown price on a live sub: never guess a plan. Dead subs fall back to
    // the 'none' pseudo-plan (no entitlement either way) like the webhook's
    // subscription.deleted handler.
    let planKey: string
    let planSeats: number
    if (canonical.planKey !== null) {
      planKey = canonical.planKey
      planSeats = seatsForPlan(canonical.planKey)
    } else if (!canonicalIsLive) {
      planKey = 'none'
      planSeats = 0
    } else {
      anomalies.push({
        kind: 'unknown_price',
        detail: `Org ${orgId}: live Stripe subscription ${canonical.subscriptionId} uses an unknown price id — plan cannot be derived; fix PLAN_PRICE_IDS or the subscription.`,
      })
      continue
    }

    const desired: UpsertSubscriptionInput = {
      organizationId: orgId,
      stripeCustomerId: canonical.customerId,
      stripeSubscriptionId: canonical.subscriptionId,
      planKey,
      planSeats,
      status: canonical.mappedStatus,
      trialEnd: canonical.trialEnd,
      currentPeriodEnd: canonical.currentPeriodEnd,
    }

    if (!local) {
      if (canonicalIsLive) {
        // Direction (a): paid in Stripe, invisible locally → customer is
        // paywalled after paying. THE case this cron exists for.
        repairs.push({
          organizationId: orgId,
          reason: 'missing_local_row',
          detail: `Stripe subscription ${canonical.subscriptionId} is ${canonical.mappedStatus} but the org has no local subscription row.`,
          input: desired,
        })
      }
      // Dead Stripe sub + no local row: nothing to grant or revoke — skip.
      continue
    }

    if (isCompRow(local)) {
      if (canonical.mappedStatus === 'active') {
        // Genuinely PAYING in Stripe while comped locally → Stripe truth wins
        // (mirrors the MAJOR-5 guard's incomingIsGenuinePaid carve-out).
        // 'active' only: a trialing sub is NOT evidence of payment, and
        // auto-converting a permanent comp into a 14-day trial would paywall
        // an invoice-billed customer when the trial lapses (review batch3
        // finding 3) — that case is surfaced below instead.
        repairs.push({
          organizationId: orgId,
          reason: 'drift',
          detail: `Org is comped locally but has a genuine active Stripe subscription ${canonical.subscriptionId} — converting to Stripe billing.`,
          input: desired,
        })
      } else if (canonicalIsLive) {
        // trialing/past_due against a comp row: never auto-resolve — surface
        // for a human decision instead of silently converting or no-opping.
        anomalies.push({
          kind: 'comp_row_conflict',
          detail: `Org ${orgId} is comped locally but Stripe subscription ${canonical.subscriptionId} is ${canonical.mappedStatus} — resolve manually (cancel in Stripe or drop the comp).`,
        })
      }
      // Dead Stripe sub + comp row = normal churned-then-comped shape. Skip.
      continue
    }

    const differs =
      local.status !== desired.status ||
      local.plan_key !== desired.planKey ||
      local.plan_seats !== desired.planSeats ||
      local.stripe_subscription_id !== desired.stripeSubscriptionId ||
      local.stripe_customer_id !== desired.stripeCustomerId ||
      timestampsDiffer(local.trial_end, desired.trialEnd) ||
      timestampsDiffer(local.current_period_end, desired.currentPeriodEnd)

    if (differs) {
      // With an INCOMPLETE Stripe listing, `canonical` may be a dead/past_due
      // sub while the org's live sub sits on an unfetched page — a drift repair
      // would then paywall a currently-ENTITLED org (review batch3 final
      // finding 2 + round5 finding 2: past_due counts as "live" so the earlier
      // isLiveSubscriptionStatus test let an active→past_due downgrade through).
      // Gate on ENTITLEMENT: skip any repair that moves an entitled org
      // (active/trialing) to a non-entitled status while the listing is
      // incomplete; let a future complete run handle it. A missed downgrade is
      // the safe direction (mild, self-heals) — a wrong one paywalls a payer.
      // The incomplete listing itself is surfaced as an anomaly below so this
      // skip is never silent.
      const wouldPaywallEntitledOrg =
        !args.stripeListComplete &&
        isEntitledSubscriptionStatus(local.status) &&
        !isEntitledSubscriptionStatus(desired.status)
      if (!wouldPaywallEntitledOrg) {
        repairs.push({
          organizationId: orgId,
          reason: 'drift',
          detail: `Local row (status ${local.status}, plan ${local.plan_key}) diverges from Stripe subscription ${canonical.subscriptionId} (status ${desired.status}, plan ${desired.planKey}).`,
          input: desired,
        })
      }
    }
  }

  // A dead metadata-less sub becomes reportable when a live LOCAL row still
  // points at it: the per-org loop never saw it (no org id), the absence loop
  // below skips the row (the sub id IS in the listing), so this anomaly is
  // the ONLY signal that the org's entitlement is stuck on a subscription
  // Stripe has already killed (review batch3 round2 finding 3).
  for (const sub of deadMetadataless) {
    const stuckRow = args.localRows.find(
      (row) =>
        row.stripe_subscription_id === sub.subscriptionId && isLiveSubscriptionStatus(row.status),
    )
    if (stuckRow) {
      anomalies.push({
        kind: 'missing_org_metadata',
        detail: `Stripe subscription ${sub.subscriptionId} is ${sub.mappedStatus} with no organization_id metadata, but org ${stuckRow.organization_id}'s local row is still ${stuckRow.status} on it — fix the metadata or the local row manually.`,
      })
    }
  }

  // Direction (b) absence case: local row claims a LIVE Stripe subscription
  // that Stripe no longer returns at all.
  if (args.stripeListComplete) {
    for (const row of args.localRows) {
      if (row.stripe_subscription_id === null) continue // comp/none rows — out of scope
      if (!isLiveSubscriptionStatus(row.status)) continue // already downgraded
      if (allStripeSubIds.has(row.stripe_subscription_id)) continue // seen above
      // The per-org loop already decided this org's end-state from its known
      // Stripe subs — emitting a second, conflicting 'cancelled' repair here
      // would clobber that repair on execution (review batch3 finding 2:
      // local points at vanished sub_A while Stripe has live sub_B).
      if (subsByOrg.has(row.organization_id)) continue
      repairs.push({
        organizationId: row.organization_id,
        reason: 'stale_local_sub',
        detail: `Local row says ${row.status} on Stripe subscription ${row.stripe_subscription_id}, but Stripe no longer has that subscription — downgrading to cancelled.`,
        input: {
          organizationId: row.organization_id,
          stripeCustomerId: row.stripe_customer_id,
          stripeSubscriptionId: row.stripe_subscription_id,
          planKey: row.plan_key,
          planSeats: row.plan_seats,
          status: 'cancelled',
          trialEnd: row.trial_end,
          currentPeriodEnd: row.current_period_end,
        },
      })
    }
  }

  // An INCOMPLETE Stripe listing is itself an operational anomaly (review
  // batch3 round5 finding 1). It disables the absence-based stale_local_sub
  // repair AND the entitled-org downgrade repair above, so without this the
  // founder would get NO signal that reconciliation was partial and real
  // divergences went unhandled — the anomaly guarantees the daily alert fires
  // and tells them to raise the page cap.
  if (!args.stripeListComplete) {
    anomalies.push({
      kind: 'incomplete_listing',
      detail:
        'Stripe subscription listing exceeded the page cap — reconciliation was PARTIAL. Downgrade repairs were skipped to avoid paywalling a live org on incomplete data; raise MAX_PAGES in stripe-reconcile and re-run.',
    })
  }

  return { repairs, anomalies }
}
