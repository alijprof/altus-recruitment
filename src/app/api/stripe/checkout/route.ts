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

    if (!stripeCustomerId) {
      const customer = await s.customers.create({
        email: user.email,
        name: orgDetails.data.name,
        metadata: { organization_id: organizationId },
      })
      stripeCustomerId = customer.id

      // Persist immediately — webhook may race here (Pitfall 1).
      const serviceClient = createServiceClient()
      // reason: TablesUpdate<'organizations'> from the generated database.ts
      // includes stripe_customer_id (added by Phase-5 migration 20260604120000
      // and picked up in Task 0.4 type regeneration). The unknown cast is
      // belt-and-braces for if the TS inference on the chain narrows too
      // aggressively. The write is correct — the column exists server-side.
      // reason: The TablesUpdate<'organizations'> type does include
      // stripe_customer_id from migration 20260604120000 (Task 0.4 regenerated
      // types). We cast through unknown to handle the strict
      // RejectExcessProperties constraint on the .update() overload while
      // keeping the actual payload correct.
      const { error: updateErr } = await serviceClient
        .from('organizations')
        .update({ stripe_customer_id: stripeCustomerId } as unknown as TablesUpdate<'organizations'>)
        .eq('id', organizationId)

      if (updateErr) {
        // Log but continue — the checkout session will still work; the customer
        // ID can be reconciled from the webhook's customer field.
        Sentry.captureException(updateErr, {
          tags: { layer: 'stripe', handler: 'checkout', step: 'persist-customer-id' },
        })
      }
    }

    // Create the checkout session.
    const session = await s.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_collection: 'always',
      subscription_data: {
        trial_period_days: 14,
        metadata: { organization_id: organizationId },
      },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing`,
      metadata: { organization_id: organizationId },
    })

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
