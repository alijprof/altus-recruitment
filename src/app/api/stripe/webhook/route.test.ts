/**
 * @vitest-environment node
 *
 * Stripe webhook route tests (audit min-79 — "the money paths are untested").
 *
 * Covers the five contract cases:
 *   1. bad signature → 400, nothing processed, nothing recorded
 *   2. duplicate event → 200 no-op (no re-processing, no second ledger write)
 *   3. handler throw → 500, ledger stamped received then error, NEVER processed
 *   4. unknown price → skip the write (never guess a plan), still 200 + ledger
 *   5. customer.subscription.deleted → local row flipped to 'cancelled'
 * plus the comp-override contract: only checkout.session.completed passes
 * allowOverrideComp.
 *
 * Steele Charles feature review 2026-07-31 Batch 2 Task 3 (audit §4.10)
 * added a status ledger (SECURITY INVARIANT 4 revised): a 'received' or
 * 'error' row must NOT short-circuit — only 'processed' (or legacy NULL)
 * does. Additional cases below cover that contract plus the pre-migration
 * PGRST204 degradation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

// next/server: NextResponse.json → a minimal { status, json() } stand-in;
// after() runs its callback inline so email side-effects stay observable.
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
  after: (fn: () => unknown) => {
    void fn()
  },
}))

vi.mock('@/lib/env', () => ({
  env: {
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    NEXT_PUBLIC_SITE_URL: 'https://altusrecruit.com',
  },
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

const constructEvent = vi.fn()
const subscriptionsRetrieve = vi.fn()
vi.mock('@/lib/stripe/client', () => ({
  stripe: {}, // truthy → route does not 503
  assertStripe: () => ({
    webhooks: { constructEvent },
    subscriptions: { retrieve: subscriptionsRetrieve },
  }),
}))

vi.mock('@/lib/db/subscriptions', () => ({
  upsertSubscriptionFromStripe: vi.fn(),
}))

vi.mock('@/lib/email/billing-emails', () => ({
  sendTrialEndingEmail: vi.fn(async () => undefined),
  sendPaymentFailedEmail: vi.fn(async () => undefined),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { upsertSubscriptionFromStripe } from '@/lib/db/subscriptions'
import { createServiceClient } from '@/lib/supabase/service'

import { POST } from './route'

const mockUpsert = upsertSubscriptionFromStripe as Mock
const mockCreateServiceClient = createServiceClient as Mock

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Fake service client covering the two chains the route uses:
//   .from('stripe_webhook_events').select().eq().maybeSingle()  (seen check)
//   .from('stripe_webhook_events').upsert(...)                  (ledger write)
//
// `alreadyProcessed` models a row whose status is 'processed' (the only
// status that short-circuits). Pass `seenStatus` directly for the
// 'received' / 'error' non-short-circuit cases.
function makeServiceClient(opts?: { alreadyProcessed?: boolean; seenStatus?: string | null }) {
  const ledgerUpsert = vi.fn(
    async (_row: Record<string, unknown>, _upsertOpts?: unknown) => ({ error: null }),
  )
  const seenData = opts?.alreadyProcessed
    ? { stripe_event_id: 'evt_1', status: 'processed' }
    : opts?.seenStatus !== undefined
      ? { stripe_event_id: 'evt_1', status: opts.seenStatus }
      : null
  const maybeSingle = vi.fn(async () => ({ data: seenData, error: null }))
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      upsert: ledgerUpsert,
    })),
  }
  return { client, ledgerUpsert }
}

function makeStripeSubscription(overrides?: {
  priceId?: string
  status?: string
  orgId?: string | null
}) {
  return {
    id: 'sub_test',
    status: overrides?.status ?? 'active',
    customer: 'cus_test',
    trial_end: null,
    metadata:
      overrides?.orgId === null ? {} : { organization_id: overrides?.orgId ?? 'org-1' },
    items: {
      data: [
        {
          price: { id: overrides?.priceId ?? 'price_pro_test' },
          current_period_end: 1754006400,
        },
      ],
    },
  }
}

const EVENT_CREATED_EPOCH = 1751500000

function makeEvent(type: string, object: unknown) {
  return { id: 'evt_1', type, created: EVENT_CREATED_EPOCH, data: { object } }
}

function makeRequest(body = 'raw-body', signature: string | null = 'sig_valid') {
  const headers = new Headers()
  if (signature !== null) headers.set('stripe-signature', signature)
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsert.mockResolvedValue({ ok: true, data: {} })
})

// ---------------------------------------------------------------------------
// The five min-79 cases
// ---------------------------------------------------------------------------

describe('stripe webhook — signature', () => {
  it('bad signature → 400, no processing, no ledger write', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })

    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(ledgerUpsert).not.toHaveBeenCalled()
  })
})

describe('stripe webhook — idempotency ledger', () => {
  it('duplicate event → 200, handler NOT re-run, no second ledger write', async () => {
    const { client, ledgerUpsert } = makeServiceClient({ alreadyProcessed: true })
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSubscription()),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(ledgerUpsert).not.toHaveBeenCalled()
  })

  it('handler throw → 500, ledger stamped received then error, NEVER processed', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.deleted', makeStripeSubscription()),
    )
    mockUpsert.mockResolvedValue({ ok: false, code: 'internal' })

    const res = await POST(makeRequest())

    expect(res.status).toBe(500)
    expect(ledgerUpsert).toHaveBeenCalledTimes(2)
    const statuses = ledgerUpsert.mock.calls.map(
      (c) => (c[0] as { status?: string }).status,
    )
    expect(statuses).toEqual(['received', 'error'])
    expect(statuses).not.toContain('processed')
    const errorCall = ledgerUpsert.mock.calls[1]![0] as { error_detail?: string }
    expect(errorCall.error_detail).toBe('Error: customer.subscription.deleted')
  })

  it('successful processing stamps received then processed, with a processed_at', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSubscription()),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(ledgerUpsert).toHaveBeenCalledTimes(2)
    expect(ledgerUpsert.mock.calls[0]![0]).toMatchObject({
      stripe_event_id: 'evt_1',
      event_type: 'customer.subscription.updated',
      status: 'received',
    })
    const processedCall = ledgerUpsert.mock.calls[1]![0] as {
      status?: string
      processed_at?: string
      error_detail?: string | null
    }
    expect(processedCall.status).toBe('processed')
    expect(typeof processedCall.processed_at).toBe('string')
    expect(processedCall.error_detail).toBeNull()
  })

  it.each(['received', 'error'])(
    'a prior "%s" row does NOT short-circuit — the handler re-runs and returns 200',
    async (priorStatus) => {
      const { client, ledgerUpsert } = makeServiceClient({ seenStatus: priorStatus })
      mockCreateServiceClient.mockReturnValue(client)
      constructEvent.mockReturnValue(
        makeEvent('customer.subscription.updated', makeStripeSubscription()),
      )

      const res = await POST(makeRequest())

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledTimes(1) // handler DID run
      expect(ledgerUpsert).toHaveBeenCalled() // received (again) + processed stamps
    },
  )

  it('retries the processed stamp once after a transient error, then stops alarming', async () => {
    // Review 2026-08-04 H3: a single transient PostgREST blip on the final
    // stamp left the row at 'received' permanently (we return 200 because the
    // work IS done, so Stripe never re-drives it), which the daily reconcile
    // sweep then reported as stuck every day forever. One retry removes most
    // of that class.
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    const ledgerUpsert = vi
      .fn()
      .mockResolvedValueOnce({ error: null }) // 'received' stamp
      .mockResolvedValueOnce({ error: { code: '08006', message: 'connection blip' } })
      .mockResolvedValueOnce({ error: null }) // retry succeeds
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
        upsert: ledgerUpsert,
      })),
    }
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSubscription()),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(ledgerUpsert).toHaveBeenCalledTimes(3)
    expect(ledgerUpsert.mock.calls[2]![0]).toMatchObject({ status: 'processed' })
    // The retry landed, so there is nothing for a human to look at.
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('still returns 200 and reports once when both processed-stamp attempts fail', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    const transient = { code: '08006', message: 'connection blip' }
    const ledgerUpsert = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: transient })
      .mockResolvedValueOnce({ error: transient })
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
        upsert: ledgerUpsert,
      })),
    }
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSubscription()),
    )

    // 200 is correct: the subscription write already succeeded, so re-driving
    // it buys nothing (SECURITY INVARIANT 4 is about failed PROCESSING, which
    // still returns 500 — see the handler-throw case above).
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(ledgerUpsert).toHaveBeenCalledTimes(3)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('a PGRST204 (missing status column) degrades to the legacy shape and still returns 200', async () => {
    const PGRST204 = { code: 'PGRST204', message: 'column not found' }
    const maybeSingle = vi
      .fn()
      // 1st call: seen-check with the status column → missing-column error.
      .mockResolvedValueOnce({ data: null, error: PGRST204 })
      // 2nd call: legacy fallback select (stripe_event_id only) → no row found.
      .mockResolvedValueOnce({ data: null, error: null })
    const ledgerUpsert = vi
      .fn()
      // 1st upsert: up-front 'received' stamp → missing-column error, skipped silently.
      .mockResolvedValueOnce({ error: PGRST204 })
      // 2nd upsert: 'processed' stamp with new columns → missing-column error.
      .mockResolvedValueOnce({ error: PGRST204 })
      // 3rd upsert: legacy-shape retry → succeeds.
      .mockResolvedValueOnce({ error: null })
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
        upsert: ledgerUpsert,
      })),
    }
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSubscription()),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledTimes(1) // handler still ran
    expect(ledgerUpsert).toHaveBeenCalledTimes(3)
    expect(ledgerUpsert.mock.calls[2]![0]).toEqual({
      stripe_event_id: 'evt_1',
      event_type: 'customer.subscription.updated',
    })
    // Missing-column errors are expected pre-migration degradation, not faults.
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

describe('stripe webhook — event handling', () => {
  it('unknown price on subscription.updated → write SKIPPED, anomaly to Sentry, still 200', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent(
        'customer.subscription.updated',
        makeStripeSubscription({ priceId: 'price_rogue' }),
      ),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(mockUpsert).not.toHaveBeenCalled() // never guess a plan
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'stripe_webhook_unknown_price',
      expect.objectContaining({ level: 'error' }),
    )
    expect(ledgerUpsert).toHaveBeenCalled() // the event itself completed
  })

  it('customer.subscription.deleted → local row flipped to cancelled', async () => {
    const { client } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent(
        'customer.subscription.deleted',
        makeStripeSubscription({ status: 'canceled' }),
      ),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert.mock.calls[0]![1]).toMatchObject({
      organizationId: 'org-1',
      stripeSubscriptionId: 'sub_test',
      status: 'cancelled',
      planKey: 'pro',
    })
  })

  it('subscription.updated maps status via mapStripeStatus and does NOT allow comp override', async () => {
    const { client } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent(
        'customer.subscription.updated',
        makeStripeSubscription({ status: 'paused' }),
      ),
    )

    await POST(makeRequest())

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert.mock.calls[0]![1]).toMatchObject({ status: 'past_due' })
    expect(mockUpsert.mock.calls[0]![2]).toEqual({
      allowOverrideComp: false,
      // event.created must be forwarded so the comp guard can refuse stale
      // pre-cancellation events (batch3 finding 8).
      eventCreatedAtIso: new Date(EVENT_CREATED_EPOCH * 1000).toISOString(),
    })
  })

  it('checkout.session.completed with a LIVE retrieved sub DOES allow comp override', async () => {
    const { client } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    subscriptionsRetrieve.mockResolvedValue(makeStripeSubscription({ status: 'trialing' }))
    constructEvent.mockReturnValue(
      makeEvent('checkout.session.completed', {
        mode: 'subscription',
        subscription: 'sub_test',
        metadata: { organization_id: 'org-1' },
      }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(subscriptionsRetrieve).toHaveBeenCalledWith('sub_test')
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert.mock.calls[0]![1]).toMatchObject({ status: 'trialing' })
    expect(mockUpsert.mock.calls[0]![2]).toEqual({
      allowOverrideComp: true,
      eventCreatedAtIso: new Date(EVENT_CREATED_EPOCH * 1000).toISOString(),
    })
  })

  it('checkout.session.completed with a since-CANCELLED sub does NOT allow comp override (round2 finding 1)', async () => {
    // retrieve() returns CURRENT state: a delayed retry after the founder
    // cancelled the sub and comped the org must not clobber the comp row.
    const { client } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    subscriptionsRetrieve.mockResolvedValue(makeStripeSubscription({ status: 'canceled' }))
    constructEvent.mockReturnValue(
      makeEvent('checkout.session.completed', {
        mode: 'subscription',
        subscription: 'sub_test',
        metadata: { organization_id: 'org-1' },
      }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert.mock.calls[0]![2]).toMatchObject({ allowOverrideComp: false })
  })

  it('subscription event with no organization_id metadata → no write, still 200', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent(
        'customer.subscription.updated',
        makeStripeSubscription({ orgId: null }),
      ),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(ledgerUpsert).toHaveBeenCalled()
  })

  it('unhandled event types are acknowledged without side effects', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(makeEvent('invoice.paid', {}))

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(ledgerUpsert).toHaveBeenCalled()
  })
})
