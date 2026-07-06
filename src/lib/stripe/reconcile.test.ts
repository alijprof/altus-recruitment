/**
 * @vitest-environment node
 *
 * Unit tests for the pure Stripe↔local reconciliation diff (audit MAJOR-6).
 * The decision matrix here is the safety contract for the daily cron: which
 * divergences it repairs, which it only surfaces, and which it must leave
 * alone (comp rows, ambiguous multi-sub orgs, unknown prices, incomplete
 * listings).
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

vi.mock('@/lib/stripe/plans', () => ({
  PLANS: {
    starter: { seats: 3 },
    pro: { seats: 8 },
    scale: { seats: 99 },
  },
  PLAN_PRICE_IDS: {
    starter: 'price_starter_test',
    pro: 'price_pro_test',
    scale: 'price_scale_test',
  },
}))

import { diffStripeAgainstLocal } from '@/lib/stripe/reconcile'
import type { LocalSubscriptionRow, StripeSubSnapshot } from '@/lib/stripe/reconcile'

function snap(overrides: Partial<StripeSubSnapshot>): StripeSubSnapshot {
  return {
    subscriptionId: 'sub_1',
    customerId: 'cus_1',
    organizationId: 'org-1',
    mappedStatus: 'active',
    planKey: 'pro',
    trialEnd: null,
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function local(overrides: Partial<LocalSubscriptionRow>): LocalSubscriptionRow {
  return {
    organization_id: 'org-1',
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    plan_key: 'pro',
    plan_seats: 8,
    status: 'active',
    trial_end: null,
    current_period_end: '2026-08-01T00:00:00+00:00', // DB offset format
    ...overrides,
  }
}

describe('diffStripeAgainstLocal — in-sync states produce no work', () => {
  it('identical state (incl. +00:00 vs Z timestamp formats) → no repairs, no anomalies', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({})],
      localRows: [local({})],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toEqual([])
  })

  it('dead Stripe sub + churned local row → nothing to do', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'cancelled' })],
      localRows: [local({ status: 'cancelled' })],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toEqual([])
  })

  it('comp row with a dead Stripe sub (churned-then-comped) is left alone', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'cancelled' })],
      localRows: [local({ stripe_subscription_id: null, status: 'active' })],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toEqual([])
  })

  it('pure comp org (no Stripe presence at all) is out of scope', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [],
      localRows: [
        local({ stripe_subscription_id: null, stripe_customer_id: null, status: 'active' }),
      ],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toEqual([])
  })
})

describe('diffStripeAgainstLocal — direction (a): paid in Stripe, wrong/missing locally', () => {
  it('live Stripe sub with NO local row → missing_local_row repair (paywalled-after-paying)', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'trialing', trialEnd: '2026-07-18T00:00:00.000Z' })],
      localRows: [],
      stripeListComplete: true,
    })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({
      organizationId: 'org-1',
      reason: 'missing_local_row',
      input: {
        organizationId: 'org-1',
        stripeSubscriptionId: 'sub_1',
        planKey: 'pro',
        planSeats: 8,
        status: 'trialing',
        trialEnd: '2026-07-18T00:00:00.000Z',
      },
    })
  })

  it('dead Stripe sub with no local row → no repair (nothing to grant or revoke)', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'cancelled' })],
      localRows: [],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
  })

  it('status drift (Stripe active, local none) → drift repair to Stripe truth', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({})],
      localRows: [local({ status: 'none', stripe_subscription_id: null })],
      stripeListComplete: true,
    })
    // local row has null sub id + status 'none' → NOT a comp row → drift.
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({ reason: 'drift', input: { status: 'active' } })
  })

  it('plan drift (upgraded in Stripe) → drift repair with the new plan', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ planKey: 'scale' })],
      localRows: [local({})],
      stripeListComplete: true,
    })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]!.input.planKey).toBe('scale')
    expect(repairs[0]!.input.planSeats).toBe(99)
  })
})

describe('diffStripeAgainstLocal — direction (b): dead in Stripe, still entitled locally', () => {
  it('Stripe cancelled but local still active → drift repair downgrades', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'cancelled' })],
      localRows: [local({})],
      stripeListComplete: true,
    })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({ reason: 'drift', input: { status: 'cancelled' } })
  })

  it('local live row whose sub id Stripe no longer returns → stale_local_sub cancels it', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [],
      localRows: [local({ status: 'trialing' })],
      stripeListComplete: true,
    })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({
      reason: 'stale_local_sub',
      input: { status: 'cancelled', planKey: 'pro' }, // keeps the stored plan
    })
  })

  it('stale_local_sub is SKIPPED when the Stripe listing was incomplete', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [],
      localRows: [local({})],
      stripeListComplete: false,
    })
    expect(repairs).toEqual([])
  })

  it('a per-org DOWNGRADE drift is SKIPPED when the Stripe listing was incomplete (final finding 2)', () => {
    // canonical is a dead sub, but the org's live sub may sit on an unfetched
    // page — downgrading the live local row here would paywall a paying org.
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'cancelled' })],
      localRows: [local({ status: 'active' })],
      stripeListComplete: false,
    })
    expect(repairs).toEqual([])
  })

  it('an UPGRADE drift still applies under an incomplete listing (only downgrades are unsafe)', () => {
    // A fetched live sub is real; moving a non-live local row up to it is safe.
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'active' })],
      localRows: [local({ status: 'none' })],
      stripeListComplete: false,
    })
    expect(repairs.filter((r) => r.reason === 'drift')).toHaveLength(1)
    expect(repairs.find((r) => r.reason === 'drift')).toMatchObject({ input: { status: 'active' } })
  })

  it('an active→past_due downgrade is SKIPPED under an incomplete listing (round5 finding 2)', () => {
    // past_due is "live" but NOT entitled — the earlier live-status guard let
    // this through and paywalled a paying org. The entitlement-based guard
    // catches it.
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'past_due' })],
      localRows: [local({ status: 'active' })],
      stripeListComplete: false,
    })
    expect(repairs).toEqual([])
  })

  it('an incomplete listing ALWAYS raises an incomplete_listing anomaly (round5 finding 1)', () => {
    // Even a fully in-sync org must surface the incompleteness so the daily
    // alert fires and the founder knows reconciliation was partial.
    const { anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({})],
      localRows: [local({})],
      stripeListComplete: false,
    })
    expect(anomalies.some((a) => a.kind === 'incomplete_listing')).toBe(true)
  })

  it('a complete listing raises no incomplete_listing anomaly', () => {
    const { anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({})],
      localRows: [local({})],
      stripeListComplete: true,
    })
    expect(anomalies.some((a) => a.kind === 'incomplete_listing')).toBe(false)
  })

  it('stale_local_sub is SKIPPED when the sub id exists in Stripe under lost metadata', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ organizationId: null })], // same sub_1, metadata lost
      localRows: [local({})],
      stripeListComplete: true,
    })
    // Must NOT cancel a possibly-live paying customer; must surface instead.
    expect(repairs).toEqual([])
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]!.kind).toBe('missing_org_metadata')
  })
})

describe('diffStripeAgainstLocal — conservatism / anomalies', () => {
  it('unknown price on a LIVE sub → anomaly, never a guessed-plan repair', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ planKey: null })],
      localRows: [],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]!.kind).toBe('unknown_price')
  })

  it('unknown price on a DEAD sub → none pseudo-plan repair is allowed', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ planKey: null, mappedStatus: 'cancelled' })],
      localRows: [local({})], // local still thinks it's active
      stripeListComplete: true,
    })
    expect(anomalies).toEqual([])
    expect(repairs).toHaveLength(1)
    expect(repairs[0]!.input).toMatchObject({ status: 'cancelled', planKey: 'none', planSeats: 0 })
  })

  it('two LIVE subs for one org → anomaly (double-subscribe), NO auto-repair', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ subscriptionId: 'sub_a' }), snap({ subscriptionId: 'sub_b' })],
      localRows: [local({ stripe_subscription_id: 'sub_a' })],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]!.kind).toBe('multiple_live_subscriptions')
  })

  it('one live + one dead sub for an org → live wins, dead is ignored', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [
        snap({ subscriptionId: 'sub_old', mappedStatus: 'cancelled' }),
        snap({ subscriptionId: 'sub_new', mappedStatus: 'active' }),
      ],
      localRows: [local({ stripe_subscription_id: 'sub_old', status: 'cancelled' })],
      stripeListComplete: true,
    })
    expect(anomalies).toEqual([])
    expect(repairs).toHaveLength(1)
    expect(repairs[0]!.input).toMatchObject({ stripeSubscriptionId: 'sub_new', status: 'active' })
  })

  it('comp row + genuine active Stripe sub → drift repair (Stripe truth wins, MAJOR-5 carve-out)', () => {
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ subscriptionId: 'sub_paid' })],
      localRows: [
        local({
          stripe_subscription_id: null,
          status: 'active',
          plan_key: 'starter',
          plan_seats: 3,
        }),
      ],
      stripeListComplete: true,
    })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]!.input).toMatchObject({ stripeSubscriptionId: 'sub_paid', planKey: 'pro' })
  })

  it('comp row + past_due Stripe sub → comp_row_conflict anomaly, no repair', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'past_due' })],
      localRows: [local({ stripe_subscription_id: null, status: 'active' })],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]!.kind).toBe('comp_row_conflict')
  })

  it('comp row + merely-TRIALING Stripe sub → anomaly, never auto-converted (batch3 finding 3)', () => {
    // A trial is not evidence of payment: converting a permanent comp into a
    // 14-day trial would paywall an invoice-billed customer at trial end.
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ mappedStatus: 'trialing' })],
      localRows: [local({ stripe_subscription_id: null, status: 'active' })],
      stripeListComplete: true,
    })
    expect(repairs).toEqual([])
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]!.kind).toBe('comp_row_conflict')
  })

  it('one org never gets BOTH a drift repair and a stale_local_sub repair (batch3 finding 2)', () => {
    // Local points at vanished sub_A while Stripe has live sub_B: the per-org
    // loop repairs to sub_B; the absence loop must NOT then append a
    // 'cancelled' repair that would clobber it on execution.
    const { repairs } = diffStripeAgainstLocal({
      stripeSubs: [snap({ subscriptionId: 'sub_B' })],
      localRows: [local({ stripe_subscription_id: 'sub_A', status: 'active' })],
      stripeListComplete: true,
    })
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({
      reason: 'drift',
      input: { stripeSubscriptionId: 'sub_B', status: 'active' },
    })
  })

  it('a DEAD metadata-less sub with NO local reference raises no anomaly (finding 10 noise rule)', () => {
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ organizationId: null, mappedStatus: 'cancelled' })],
      localRows: [], // nothing points at it — pure legacy noise
      stripeListComplete: true,
    })
    expect(anomalies).toEqual([])
    expect(repairs).toEqual([])
  })

  it('a DEAD metadata-less sub that a LIVE local row still points at IS an anomaly (round2 finding 3)', () => {
    // The per-org loop can't see it (no org id) and the absence loop skips
    // the row (the sub id IS in the listing) — this anomaly is the only
    // signal that the org's entitlement is stuck on a dead subscription.
    const { repairs, anomalies } = diffStripeAgainstLocal({
      stripeSubs: [snap({ organizationId: null, mappedStatus: 'cancelled' })],
      localRows: [local({})], // live local row pointing at that same sub_1
      stripeListComplete: true,
    })
    expect(repairs).toEqual([]) // never auto-repair without org metadata
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]!.kind).toBe('missing_org_metadata')
    expect(anomalies[0]!.detail).toContain('org-1')
  })
})
