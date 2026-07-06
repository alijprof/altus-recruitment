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

  it('allowOverrideComp does NOT override a comp when the event predates it (round3 finding 1)', async () => {
    // A delayed retry of the ORIGINAL checkout (event created before the org
    // was comped) must not clobber the comp even though it is
    // checkout-originated — the staleness guard applies to every caller.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
      updated_at: '2026-07-04T12:00:00+00:00', // comp granted here
    })
    const result = await upsertSubscriptionFromStripe(
      client as unknown as ClientArg,
      { ...INPUT, stripeSubscriptionId: 'sub_trial', status: 'trialing' },
      { allowOverrideComp: true, eventCreatedAtIso: '2026-07-02T09:00:00.000Z' },
    )
    expect(state.upsertCalls).toBe(0)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('active') // comp preserved
  })

  it('allowOverrideComp DOES override a comp for a genuine fresh conversion (event postdates comp)', async () => {
    // The org clicks "start subscription" while already comped — the checkout
    // event is newer than the comp row, so the conversion is legitimate.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
      updated_at: '2026-07-04T12:00:00+00:00',
    })
    await upsertSubscriptionFromStripe(
      client as unknown as ClientArg,
      { ...INPUT, stripeSubscriptionId: 'sub_new', status: 'trialing' },
      { allowOverrideComp: true, eventCreatedAtIso: '2026-07-05T09:00:00.000Z' },
    )
    expect(state.upsertCalls).toBe(1)
  })

  it('DOES overwrite a real paid row when the downgrade is about the SAME subscription', async () => {
    // INPUT is a 'cancelled' downgrade for sub_stale — allowed only because
    // the row tracks that same sub id (the normal churn path).
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: 'sub_stale',
      status: 'active',
    })
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, INPUT)
    expect(state.upsertCalls).toBe(1)
  })

  it('refuses a downgrade about a DIFFERENT subscription than the row tracks (round2 finding 2)', async () => {
    // Delayed deleted/payment_failed for old sub_A must not clobber a row
    // that has since moved to live sub_B (the org re-subscribed).
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: 'sub_B',
      status: 'active',
    })
    const result = await upsertSubscriptionFromStripe(client as unknown as ClientArg, {
      ...INPUT,
      stripeSubscriptionId: 'sub_A',
      status: 'cancelled',
    })
    expect(state.upsertCalls).toBe(0)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('active') // live row preserved
  })

  it('a merely-TRIALING out-of-band sub does NOT replace a comp row (round2 finding 0)', async () => {
    // A trial is not evidence of payment — converting a permanent comp into a
    // 14-day trial would paywall an invoice-billed customer at trial end.
    // Checkout-originated trials convert via allowOverrideComp instead.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
    })
    const result = await upsertSubscriptionFromStripe(client as unknown as ClientArg, {
      ...INPUT,
      stripeSubscriptionId: 'sub_trial',
      status: 'trialing',
    })
    expect(state.upsertCalls).toBe(0)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('active') // comp preserved
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

  it('refuses a STALE genuine-paid event minted before the comp row was written (batch3 finding 8)', async () => {
    // Sub A's final pre-cancellation 'active' updated event arrives days late
    // (Stripe retries up to 3 days), AFTER the org churned and was comped.
    // event.created < comp row updated_at → the carve-out must not fire.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
      updated_at: '2026-07-03T12:00:00+00:00', // comp granted here
    })
    const result = await upsertSubscriptionFromStripe(
      client as unknown as ClientArg,
      { ...INPUT, stripeSubscriptionId: 'sub_A', status: 'active' },
      { eventCreatedAtIso: '2026-07-01T09:00:00.000Z' }, // event predates the comp
    )
    expect(state.upsertCalls).toBe(0)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('active') // comp row preserved
  })

  it('allows a genuine-paid event minted AFTER the comp row was written', async () => {
    // A real post-comp conversion (Dashboard-created sub) must still persist.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
      updated_at: '2026-07-03T12:00:00+00:00',
    })
    await upsertSubscriptionFromStripe(
      client as unknown as ClientArg,
      { ...INPUT, stripeSubscriptionId: 'sub_B', status: 'active' },
      { eventCreatedAtIso: '2026-07-04T09:00:00.000Z' },
    )
    expect(state.upsertCalls).toBe(1)
  })

  it('without an event timestamp (reconciliation cron), genuine-paid still replaces a comp', async () => {
    // The cron's input reflects CURRENT Stripe truth (live listing), so it
    // omits eventCreatedAtIso — behaviour must match the pre-batch3 carve-out.
    const { client, state } = makeClient({
      organization_id: 'org-1',
      stripe_subscription_id: null,
      status: 'active',
      updated_at: '2026-07-03T12:00:00+00:00',
    })
    await upsertSubscriptionFromStripe(client as unknown as ClientArg, {
      ...INPUT,
      stripeSubscriptionId: 'sub_live',
      status: 'active',
    })
    expect(state.upsertCalls).toBe(1)
  })
})
