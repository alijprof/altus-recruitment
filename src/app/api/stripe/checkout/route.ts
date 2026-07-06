// Stripe Checkout session creation — 05-01 Task 1.2
//
// Creates a card-upfront checkout session with a 14-day free trial.
// Returns { url } for the caller to redirect to.
//
// Security:
//   T-05-01-03: Price IDs come from server env (PLAN_PRICE_IDS), never from
//   the client. planKey is validated against the PLANS enum via Zod.
//   T-05-01-04: Route is under (app)/ authentication — the caller must have a
//   valid session; org is resolved from the session, not from client input.
//
// Graceful degradation: when STRIPE_SECRET_KEY is absent, returns 503 with a
// clear message. pnpm build passes with zero Stripe env vars.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'

import { assertStripe, stripe } from '@/lib/stripe/client'
import { PLAN_PRICE_IDS } from '@/lib/stripe/plans'
import type { PlanKey } from '@/lib/stripe/plans'
import { getOrganization } from '@/lib/db/organizations'
import { getSubscriptionForOrg, isLiveSubscriptionStatus } from '@/lib/db/subscriptions'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { env } from '@/lib/env'
import type { TablesUpdate } from '@/types/database'

const checkoutBodySchema = z.object({
  planKey: z.enum(['starter', 'pro', 'scale']).default('pro'),
})

export async function POST(request: Request): Promise<NextResponse> {
  // Graceful degradation — Stripe not configured (dev without keys, CI).
  if (!stripe) {
    return NextResponse.json({ error: 'Billing not configured' }, { status: 503 })
  }

  // Auth check — user must be signed in.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse + validate body.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = checkoutBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { planKey } = parsed.data

  // Resolve caller's org + role from their session (RLS-scoped — cannot be forged).
  const orgResult = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle()
  if (orgResult.error || !orgResult.data) {
    return NextResponse.json({ error: 'Could not load your profile' }, { status: 400 })
  }
  // Billing is OWNER-ONLY — same contract the portal route + settings UI enforce.
  // Without this gate, any authenticated member could bind a Stripe customer to
  // the org and start a subscription/trial.
  if (orgResult.data.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only organisation owners can manage billing' },
      { status: 403 },
    )
  }
  const organizationId = orgResult.data.organization_id

  // Defence-in-depth: never start a SECOND subscription. The billing UI only
  // shows the checkout buttons when status is 'none', but a direct POST must
  // also be rejected — otherwise an owner can create duplicate Stripe
  // subscriptions, which are painful to reconcile against the webhook ledger.
  const existing = await getSubscriptionForOrg(createServiceClient(), organizationId)
  if (existing.ok && isLiveSubscriptionStatus(existing.data.status)) {
    return NextResponse.json(
      { error: 'You already have an active subscription. Use "Manage billing" to make changes.' },
      { status: 409 },
    )
  }

  const orgDetails = await getOrganization(supabase, organizationId)
  if (!orgDetails.ok) {
    return NextResponse.json({ error: 'Could not load your organisation' }, { status: 400 })
  }

  // Validate the price ID is configured.
  const priceId = PLAN_PRICE_IDS[planKey as PlanKey]
  if (!priceId) {
    return NextResponse.json(
      { error: `Price ID for plan '${planKey}' is not configured` },
      { status: 503 },
    )
  }

  // Stripe requires ABSOLUTE success/cancel URLs. NEXT_PUBLIC_SITE_URL is
  // .optional() (so the build never breaks), but if it is unset here the URLs
  // would be relative and Stripe rejects them with an opaque error. Fail loud.
  const siteUrl = env.NEXT_PUBLIC_SITE_URL
  if (!siteUrl) {
    Sentry.captureMessage('stripe_checkout: NEXT_PUBLIC_SITE_URL not configured', {
      level: 'error',
      tags: { layer: 'stripe', handler: 'checkout' },
    })
    return NextResponse.json(
      { error: 'Billing is not fully configured (site URL missing). Contact support.' },
      { status: 503 },
    )
  }

  // Resolve or create the Stripe customer.
  // CRITICAL (Pitfall 1): we persist the customer ID to the DB immediately
  // so that a concurrent webhook (checkout.session.completed) arriving
  // before this response can correlate by customer ID.
  let stripeCustomerId = orgDetails.data.stripe_customer_id

  try {
    const s = assertStripe()

    // Minute bucket for the SESSION idempotency key below (bounds its replay
    // window so a stale/expired session can't be replayed hours later).
    const minuteBucket = Math.floor(Date.now() / 60_000)

    if (!stripeCustomerId) {
      // No Stripe idempotency key on the customer create. A stable key wedges
      // first checkout for 24h if the first response was a 4xx or the org name
      // later changes (Stripe replays the stored response for the key's full
      // life); a minute-bucketed key re-opens a double-CUSTOMER race across the
      // minute boundary. Instead the DB is the one-customer-per-org authority:
      // persist CONDITIONALLY (only while still null) and re-read. A concurrent
      // request that already claimed a customer wins; our just-created customer
      // is orphaned (harmless — no subscription attaches) and we adopt the
      // winner, so the session create + expire-older pass below both operate on
      // a single customer (review batch3 round3: double-customer race + wedge).
      const customer = await s.customers.create({
        email: user.email,
        name: orgDetails.data.name,
        metadata: { organization_id: organizationId },
      })

      const serviceClient = createServiceClient()
      // reason: TablesUpdate<'organizations'> includes stripe_customer_id
      // (migration 20260604120000, Task 0.4 regenerated types). The unknown
      // cast handles the strict RejectExcessProperties constraint on .update().
      const { data: claimed, error: claimErr } = await serviceClient
        .from('organizations')
        .update({ stripe_customer_id: customer.id } as unknown as TablesUpdate<'organizations'>)
        .eq('id', organizationId)
        .is('stripe_customer_id', null)
        .select('stripe_customer_id')
        .maybeSingle()

      if (claimErr) {
        // Log but continue — the webhook can reconcile via its customer field.
        Sentry.captureException(claimErr, {
          tags: { layer: 'stripe', handler: 'checkout', step: 'persist-customer-id' },
        })
      }

      if (claimed?.stripe_customer_id) {
        // We won the claim — use the customer we just created + persisted.
        stripeCustomerId = claimed.stripe_customer_id
      } else {
        // Either a concurrent request already claimed one, or the conditional
        // update matched no row — read the authoritative value; fall back to
        // our own new customer if the re-read is unavailable.
        const { data: fresh } = await serviceClient
          .from('organizations')
          .select('stripe_customer_id')
          .eq('id', organizationId)
          .maybeSingle()
        stripeCustomerId = fresh?.stripe_customer_id ?? customer.id
      }
    }

    // Create the checkout session.
    //
    // DOUBLE-SUBSCRIBE HARDENING (audit min-23). The DB guard above is
    // check-then-act: two tabs can both pass it and each create an open
    // checkout session, and completing both creates duplicate Stripe
    // subscriptions. Two mechanisms close this:
    //   1. A Stripe idempotency key on (org, plan, minute-bucket) collapses
    //      simultaneous same-plan creates into ONE session — both tabs get the
    //      same URL, and a Checkout Session can only be completed once.
    //   2. After create, every OLDER still-open session for this customer is
    //      expired, so an older abandoned tab's session can't be completed
    //      later after this one converts.
    // The minute bucket bounds the key's replay window: without it, a replay
    // hours later could return a session that step 2 has since expired.
    const idempotencyKey = `co:${organizationId}:${planKey}:${minuteBucket}`
    const sessionParams = {
      customer: stripeCustomerId,
      mode: 'subscription' as const,
      payment_method_collection: 'always' as const,
      subscription_data: {
        trial_period_days: 14,
        metadata: { organization_id: organizationId },
      },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing`,
      metadata: { organization_id: organizationId },
    }
    let session = await s.checkout.sessions.create(sessionParams, { idempotencyKey })

    // A create RESPONSE — including an idempotent replay — returns the STORED
    // create-time body, whose status always reads 'open' even if a concurrent
    // request's expire pass has since closed it. A fresh retrieve reveals the
    // real status (review batch3 round2 finding 5). GUARD it: a transient
    // retrieve error must NOT 500 a checkout whose session was already created
    // — fall back to the created session (correct in the common case; the
    // re-mint below only matters for the rare replay-of-expired tail) (review
    // batch3 round3).
    let liveStatus: string | null = session.status
    try {
      const liveCheck = await s.checkout.sessions.retrieve(session.id)
      liveStatus = liveCheck.status
    } catch (retrieveErr) {
      Sentry.captureException(retrieveErr, {
        tags: { layer: 'stripe', handler: 'checkout', step: 'verify-session-live' },
      })
    }
    if (liveStatus !== 'open') {
      session = await s.checkout.sessions.create(sessionParams, {
        idempotencyKey: `${idempotencyKey}:retry:${Date.now()}`,
      })
    }

    // Expire STRICTLY OLDER open checkout sessions for this customer
    // (best-effort — a failure here must not block the checkout we just
    // created). Only-older matters: if two near-simultaneous creates each
    // expired "every other" session, both tabs would end on dead URLs
    // (review batch3 finding 5). With the older-only rule (id as the
    // tiebreak on equal timestamps), exactly one session — the newest —
    // always survives.
    try {
      const openSessions = await s.checkout.sessions.list({
        customer: stripeCustomerId,
        status: 'open',
        limit: 10,
      })
      for (const stale of openSessions.data) {
        if (stale.id === session.id) continue
        const isOlder =
          stale.created < session.created ||
          (stale.created === session.created && stale.id < session.id)
        if (!isOlder) continue
        await s.checkout.sessions.expire(stale.id)
      }
    } catch (expireErr) {
      Sentry.captureException(expireErr, {
        tags: { layer: 'stripe', handler: 'checkout', step: 'expire-stale-sessions' },
      })
    }

    if (!session.url) {
      Sentry.captureMessage('stripe_checkout: Stripe returned a session with no url', {
        level: 'error',
        tags: { layer: 'stripe', handler: 'checkout' },
      })
      return NextResponse.json(
        { error: 'Checkout could not be started. Please try again.' },
        { status: 500 },
      )
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    // PII discipline: do not log user email or org name.
    Sentry.captureException(err, {
      tags: { layer: 'stripe', handler: 'checkout', organization_id: organizationId },
    })
    const message = err instanceof Error ? err.message : 'Checkout session creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
