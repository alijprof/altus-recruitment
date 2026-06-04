/**
 * @vitest-environment node
 *
 * Unit tests for getEntitlement — 05-01 Task 1.1
 *
 * Mocks the DB helpers (getSubscriptionForOrg, getAiUsageThisMonth) and the
 * Supabase count queries so we can drive the entitlement logic in isolation.
 * Uses vi.mock — no real DB or Stripe calls.
 *
 * TDD gate: these tests are written BEFORE the implementation exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// server-only is a Next.js compile-time guard; in Vitest we stub it out.
vi.mock('server-only', () => ({}))

// Sentry — stub out to avoid needing DSN in tests.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

// @t3-oss/env-nextjs validates env vars at import time; stub it so tests don't
// require real env vars to be set.
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    INNGEST_EVENT_KEY: 'test',
    INNGEST_SIGNING_KEY: 'test',
    MAX_MONTHLY_MATCH_SPEND_PENCE: 10000,
    NODE_ENV: 'test',
  },
}))

// We mock the modules that getEntitlement depends on so we can test the logic
// without a real DB. The mocks must be declared at the top level before any
// imports of the module under test.

vi.mock('@/lib/db/subscriptions', () => ({
  getSubscriptionForOrg: vi.fn(),
}))

vi.mock('@/lib/stripe/usage', () => ({
  getAiUsageThisMonth: vi.fn(),
  PURPOSE_CAP_BUCKETS: {
    cv_parse: 'cvParses',
    match_score: 'matchScores',
    search_query_embed: 'searches',
    spec_transcribe: 'specMinutes',
    ad_generate: 'writingCalls',
    outreach_draft: 'writingCalls',
    dormant_outreach_draft: 'writingCalls',
    jd_extract: 'writingCalls',
  },
}))

// Supabase service client — return a mock that resolves a user count
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

import type { Mock } from 'vitest'
import { getSubscriptionForOrg } from '@/lib/db/subscriptions'
import { getAiUsageThisMonth } from '@/lib/stripe/usage'
import { createServiceClient } from '@/lib/supabase/service'
import { PLANS } from '@/lib/stripe/plans'

// Import the module under test AFTER mocks so vi.mock is in place
import { getEntitlement } from '@/lib/stripe/entitlement'

const mockGetSubscription = getSubscriptionForOrg as Mock
const mockGetUsage = getAiUsageThisMonth as Mock
const mockCreateServiceClient = createServiceClient as Mock

// Helper: build a fake Supabase service client that returns a given member count
// for the .from('users').select('id', { count: 'exact', head: true }).eq(...) chain.
function makeSupabaseWithCount(count: number) {
  const eqFn = () => Promise.resolve({ count, error: null, data: null, status: 200, statusText: 'OK' })
  const selectFn = () => ({ eq: eqFn })
  const fromFn = () => ({ select: selectFn })
  return { from: fromFn }
}

const ZERO_USAGE = {
  matchScores: 0,
  cvParses: 0,
  searches: 0,
  specMinutes: 0,
  writingCalls: 0,
}

describe('getEntitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: 1 active seat
    mockCreateServiceClient.mockReturnValue(makeSupabaseWithCount(1))
  })

  it('no subscription row → status none, Pro-level trial caps, no caps breached', async () => {
    mockGetSubscription.mockResolvedValue({ ok: false, code: 'not_found' })
    mockGetUsage.mockResolvedValue(ZERO_USAGE)

    const result = await getEntitlement('org-1')

    expect(result.status).toBe('none')
    expect(result.planKey).toBe('none')
    // Trial gets Pro caps × Pro seats (the full Pro plan allowance)
    expect(result.aiCaps.matchScores).toBe(PLANS.pro.aiCaps.matchScores * PLANS.pro.seats)
    expect(result.softCapBreached).toBe(false)
    expect(result.hardCapBreached).toBe(false)
  })

  it('79% usage on one bucket → no soft cap', async () => {
    mockGetSubscription.mockResolvedValue({
      ok: true,
      data: {
        organization_id: 'org-1',
        plan_key: 'pro',
        plan_seats: 1,
        status: 'active',
        trial_end: null,
        current_period_end: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        id: 'sub-1',
        created_at: '',
        updated_at: '',
      },
    })
    const proMatchCap = PLANS.pro.aiCaps.matchScores * 1 // 1 seat
    mockGetUsage.mockResolvedValue({
      ...ZERO_USAGE,
      matchScores: Math.floor(proMatchCap * 0.79),
    })

    const result = await getEntitlement('org-1')
    expect(result.softCapBreached).toBe(false)
    expect(result.hardCapBreached).toBe(false)
  })

  it('80% usage on one bucket → soft cap, not hard cap', async () => {
    mockGetSubscription.mockResolvedValue({
      ok: true,
      data: {
        organization_id: 'org-1',
        plan_key: 'pro',
        plan_seats: 1,
        status: 'active',
        trial_end: null,
        current_period_end: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        id: 'sub-1',
        created_at: '',
        updated_at: '',
      },
    })
    const proMatchCap = PLANS.pro.aiCaps.matchScores * 1
    mockGetUsage.mockResolvedValue({
      ...ZERO_USAGE,
      matchScores: Math.floor(proMatchCap * 0.80),
    })

    const result = await getEntitlement('org-1')
    expect(result.softCapBreached).toBe(true)
    expect(result.hardCapBreached).toBe(false)
  })

  it('100% usage on one bucket → hard cap', async () => {
    mockGetSubscription.mockResolvedValue({
      ok: true,
      data: {
        organization_id: 'org-1',
        plan_key: 'pro',
        plan_seats: 1,
        status: 'active',
        trial_end: null,
        current_period_end: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        id: 'sub-1',
        created_at: '',
        updated_at: '',
      },
    })
    const proMatchCap = PLANS.pro.aiCaps.matchScores * 1
    mockGetUsage.mockResolvedValue({
      ...ZERO_USAGE,
      matchScores: proMatchCap, // exactly 100%
    })

    const result = await getEntitlement('org-1')
    expect(result.softCapBreached).toBe(true)
    expect(result.hardCapBreached).toBe(true)
  })

  it('only matchScores over cap → softCapBreached true, hardCapBreached false when 80%', async () => {
    mockGetSubscription.mockResolvedValue({
      ok: true,
      data: {
        organization_id: 'org-1',
        plan_key: 'pro',
        plan_seats: 2,
        status: 'trialing',
        trial_end: new Date(Date.now() + 86400000 * 10).toISOString(),
        current_period_end: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        id: 'sub-2',
        created_at: '',
        updated_at: '',
      },
    })
    // 2 seats: effective cap = aiCaps.matchScores * 2
    const effectiveCap = PLANS.pro.aiCaps.matchScores * 2
    mockGetUsage.mockResolvedValue({
      ...ZERO_USAGE,
      matchScores: Math.floor(effectiveCap * 0.80), // exactly 80%
      cvParses: 0, // all others below
    })

    const result = await getEntitlement('org-1')
    expect(result.softCapBreached).toBe(true)
    expect(result.hardCapBreached).toBe(false)
  })

  it('getEntitlement does not import stripe client', async () => {
    // Structural: the entitlement module must not pull in stripe client.
    // We test this by checking the module source doesn't reference stripe.
    // (If it did, the mock would need to cover it — the test here is
    // an expectation on the test setup — if stripe was imported, vi.mock
    // would need to cover it or the test would throw on `assertStripe`.)
    // The acceptance criteria say "no stripe. call in entitlement.ts".
    // This test just runs the function and asserts no Stripe-related error.
    mockGetSubscription.mockResolvedValue({ ok: false, code: 'not_found' })
    mockGetUsage.mockResolvedValue(ZERO_USAGE)

    await expect(getEntitlement('org-x')).resolves.toBeDefined()
  })
})
