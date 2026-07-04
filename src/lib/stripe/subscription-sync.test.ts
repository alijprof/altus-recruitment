/**
 * @vitest-environment node
 *
 * Unit tests for subscription-sync — the Stripe↔local mapping helpers shared
 * by the webhook handler and the daily reconciliation cron (audit MAJOR-6).
 * The mapping matrix here is a drift-guard: if a Stripe status is ever mapped
 * differently (or a new one silently falls through to 'none'), a paying org
 * can be paywalled or a dead org stays entitled.
 */

import { describe, it, expect, vi } from 'vitest'
import type Stripe from 'stripe'

vi.mock('server-only', () => ({}))

// PLAN_PRICE_IDS reads process.env at module load; mock the plans module so
// derivePlanKey has a deterministic price map.
vi.mock('@/lib/stripe/plans', () => ({
  PLANS: {
    starter: { seats: 3 },
    pro: { seats: 8 },
    scale: { seats: 99 },
  },
  PLAN_PRICE_IDS: {
    starter: 'price_starter_test',
    pro: 'price_pro_test',
    scale: '', // deliberately unconfigured — must NOT enter the reverse map
  },
}))

import {
  buildPriceIdToPlanKey,
  derivePlanKey,
  getCurrentPeriodEnd,
  getCustomerId,
  getTrialEndIso,
  mapStripeStatus,
  seatsForPlan,
} from '@/lib/stripe/subscription-sync'

// Minimal Stripe.Subscription shape for the helpers under test.
function makeSub(overrides: {
  priceId?: string
  customer?: string | { id: string }
  trialEnd?: number | null
  currentPeriodEnd?: number | null
}): Stripe.Subscription {
  return {
    id: 'sub_test',
    customer: overrides.customer ?? 'cus_test',
    trial_end: overrides.trialEnd ?? null,
    items: {
      data: [
        {
          price: { id: overrides.priceId ?? 'price_pro_test' },
          current_period_end: overrides.currentPeriodEnd ?? null,
        },
      ],
    },
    // reason: only the fields the helpers read are provided; the cast keeps
    // the fixture small instead of fabricating the full 60-field object.
  } as unknown as Stripe.Subscription
}

describe('mapStripeStatus', () => {
  it.each([
    ['trialing', 'trialing'],
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['canceled', 'cancelled'], // US → UK spelling
    ['unpaid', 'past_due'],
    ['incomplete', 'none'],
    ['incomplete_expired', 'none'],
    ['paused', 'past_due'],
  ])('maps Stripe %s → %s', (stripeStatus, ours) => {
    expect(mapStripeStatus(stripeStatus)).toBe(ours)
  })

  it('unknown/future Stripe statuses fall back to none (never entitled)', () => {
    expect(mapStripeStatus('some_future_status')).toBe('none')
    expect(mapStripeStatus('')).toBe('none')
  })
})

describe('derivePlanKey / buildPriceIdToPlanKey', () => {
  it('maps a known price id to its plan', () => {
    expect(derivePlanKey(makeSub({ priceId: 'price_pro_test' }))).toBe('pro')
    expect(derivePlanKey(makeSub({ priceId: 'price_starter_test' }))).toBe('starter')
  })

  it('returns null for an unknown price id — callers must skip, not default', () => {
    expect(derivePlanKey(makeSub({ priceId: 'price_rogue' }))).toBeNull()
  })

  it('an unconfigured (empty) price id never enters the reverse map', () => {
    // scale's price id is '' in the mock — an empty-price sub must not match it.
    const map = buildPriceIdToPlanKey()
    expect(map.has('')).toBe(false)
    const sub = makeSub({})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: fixture surgery on a cast object
    ;(sub.items.data[0] as any).price.id = ''
    expect(derivePlanKey(sub)).toBeNull()
  })
})

describe('seatsForPlan', () => {
  it('returns plan seats, and 0 for the none pseudo-plan', () => {
    expect(seatsForPlan('pro')).toBe(8)
    expect(seatsForPlan('starter')).toBe(3)
    expect(seatsForPlan('none')).toBe(0)
  })
})

describe('field extractors', () => {
  it('getCustomerId handles both string and expanded-object customers', () => {
    expect(getCustomerId(makeSub({ customer: 'cus_abc' }))).toBe('cus_abc')
    expect(getCustomerId(makeSub({ customer: { id: 'cus_xyz' } }))).toBe('cus_xyz')
  })

  it('getTrialEndIso converts epoch seconds and passes null through', () => {
    expect(getTrialEndIso(makeSub({ trialEnd: 1751500800 }))).toBe(
      new Date(1751500800 * 1000).toISOString(),
    )
    expect(getTrialEndIso(makeSub({ trialEnd: null }))).toBeNull()
  })

  it('getCurrentPeriodEnd reads the first item and passes null through', () => {
    expect(getCurrentPeriodEnd(makeSub({ currentPeriodEnd: 1751500800 }))).toBe(
      new Date(1751500800 * 1000).toISOString(),
    )
    expect(getCurrentPeriodEnd(makeSub({ currentPeriodEnd: null }))).toBeNull()
  })
})
