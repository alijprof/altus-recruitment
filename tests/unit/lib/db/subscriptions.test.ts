/**
 * @vitest-environment node
 *
 * Comp-row protection in upsertSubscriptionFromStripe (audit MAJOR-5).
 *
 * A comped / invoice-billed org has a subscriptions row with
 * stripe_subscription_id IS NULL and an entitled status. A Stripe lifecycle
 * event carrying that org's metadata must NOT be able to flip it to
 * cancelled/past_due and lock the paying customer out — only a
 * checkout-originated event (allowOverrideComp) may replace a comp row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

import { upsertSubscriptionFromStripe } from '@/lib/db/subscriptions'

type Row = Record<string, unknown> | null

function makeClient(existing: Row, opts?: { readError?: boolean }) {
  const state = { upsertCalls: 0 }
  const client = {
    from: () => ({
      // read path used by getSubscriptionForOrg: select().eq().maybeSingle()
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            opts?.readError
              ? { data: null, error: { message: 'transient db error' } }
              : { data: existing, error: null },
        }),
      }),
      // write path: upsert().select().single()
      upsert: () => {
        state.upsertCalls++
        return {
          select: () => ({
            single: async () => ({
              data: { organization_id: 'org-1', status: 'active', stripe_subscription_id: 'sub_new' },
              error: null,
            }),
          }),
        }
      },
    }),
  }
  return { client, state }
}

const INPUT = {
  organizationId: 'org-1',
  stripeCustomerId: 'cus_x',
  stripeSubscriptionId: 'sub_stale',
  planKey: 'pro',
  planSeats: 3,
  status: 'cancelled',
  trialEnd: null,
  currentPeriodEnd: null,
}

// reason: the tests only exercise the from()/select/upsert surface the helper
// touches; cast the structural mock to the expected client type.
type ClientArg = Parameters<typeof upsertSubscriptionFromStripe>[0]

describe('upsertSubscriptionFromStripe — comp-row protection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT overwrite a live comp row (null stripe id, active) from a lifecycle event', async () => {
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
    })
    const result = await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT)
    expect(state.upsertCalls).toBe(0)
    expect(result.ok).toBe(true)
    // The preserved comp row is returned, not the incoming cancelled payload.
    if (result.ok) expect(result.data.status).toBe('active')
  })

  it('DOES overwrite a comp row when the caller allows it (checkout-originated)', async () => {
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
    })
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT, {
      allowOverrideComp: true,
    })
    expect(state.upsertCalls).toBe(1)
  })

  it('DOES overwrite a real paid row (non-null stripe id) — not a comp', async () => {
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: 'sub_real',
      status: 'active',
    })
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT)
    expect(state.upsertCalls).toBe(1)
  })

  it('DOES overwrite a cancelled null-stripe-id row — not a live comp', async () => {
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'cancelled',
    })
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT)
    expect(state.upsertCalls).toBe(1)
  })

  it('creates a new row when none exists (no comp to protect)', async () => {
    const { client, state } = makeClient(null)
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT)
    expect(state.upsertCalls).toBe(1)
  })

  it('fails closed (no write, returns internal) when the existing-row read errors', async () => {
    // Review finding 2: a transient read error must not let a stale event
    // clobber a possible comp row. Fail closed → webhook 500 → Stripe retries.
    const { client, state } = makeClient(null, { readError: true })
    const result = await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT)
    expect(state.upsertCalls).toBe(0)
    expect(result.ok).toBe(false)
  })

  it('lets a genuine out-of-band paid subscription (real id + active) replace a comp row', async () => {
    // Review finding 3: an org comped via /admin can be moved onto a real Stripe
    // subscription outside Checkout; its created/updated event (real sub id +
    // active) must be persisted, not skipped.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
    })
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, {
      ...INPUT,
      stripeSubscriptionId: 'sub_real',
      status: 'active',
    })
    expect(state.upsertCalls).toBe(1)
  })
})
