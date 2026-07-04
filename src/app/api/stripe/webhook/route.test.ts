/**
 * @vitest-environment node
 *
 * Stripe webhook route tests (audit min-79 — "the money paths are untested").
 *
 * Covers the five contract cases:
 *   1. bad signature → 400, nothing processed, nothing recorded
 *   2. duplicate event → 200 no-op (no re-processing, no second ledger write)
 *   3. handler throw → 500 AND no ledger write (Stripe must re-deliver)
 *   4. unknown price → skip the write (never guess a plan), still 200 + ledger
 *   5. customer.subscription.deleted → local row flipped to 'cancelled'
 * plus the comp-override contract: only checkout.session.completed passes
 * allowOverrideComp.
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
function makeServiceClient(opts?: { alreadyProcessed?: boolean }) {
  const ledgerUpsert = vi.fn(async () => ({ error: null }))
  const maybeSingle = vi.fn(async () => ({
    data: opts?.alreadyProcessed ? { stripe_event_id: 'evt_1' } : null,
    error: null,
  }))
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

  it('handler throw → 500 and NO ledger write, so Stripe re-delivers', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.deleted', makeStripeSubscription()),
    )
    mockUpsert.mockResolvedValue({ ok: false, code: 'internal' })

    const res = await POST(makeRequest())

    expect(res.status).toBe(500)
    expect(ledgerUpsert).not.toHaveBeenCalled()
  })

  it('successful processing records the event id in the ledger', async () => {
    const { client, ledgerUpsert } = makeServiceClient()
    mockCreateServiceClient.mockReturnValue(client)
    constructEvent.mockReturnValue(
      makeEvent('customer.subscription.updated', makeStripeSubscription()),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(ledgerUpsert).toHaveBeenCalledWith(
      { stripe_event_id: 'evt_1', event_type: 'customer.subscription.updated' },
      { onConflict: 'stripe_event_id', ignoreDuplicates: true },
    )
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
