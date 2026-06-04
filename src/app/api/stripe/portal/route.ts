// Stripe Customer Portal session creation — 05-01 Task 1.2
//
// Owner-only: opens the Stripe-hosted portal where they can upgrade, downgrade,
// or cancel. Returns { url } for the caller to redirect to.
//
// Security:
//   - Authenticated: user must be signed in + must be an owner.
//   - org is resolved from session, not from client input.
//   - Stripe not configured → 503 (graceful).
//   - No stripe_customer_id yet → 400 (must checkout first).

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

import { assertStripe, stripe } from '@/lib/stripe/client'
import { getOrganization } from '@/lib/db/organizations'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'

export async function POST(): Promise<NextResponse> {
  // Graceful degradation.
  if (!stripe) {
    return NextResponse.json({ error: 'Billing not configured' }, { status: 503 })
  }

  // Auth check.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve org + role from session.
  const { data: me, error: meError } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()

  if (meError || !me) {
    return NextResponse.json({ error: 'Could not load your profile' }, { status: 400 })
  }

  // Owner-only gate.
  if (me.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can access billing' }, { status: 403 })
  }

  const orgResult = await getOrganization(supabase, me.organization_id)
  if (!orgResult.ok) {
    return NextResponse.json({ error: 'Could not load your organisation' }, { status: 400 })
  }

  const stripeCustomerId = orgResult.data.stripe_customer_id
  if (!stripeCustomerId) {
    return NextResponse.json(
      { error: 'No billing account found. Please start a subscription first.' },
      { status: 400 },
    )
  }

  try {
    const portalSession = await assertStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (err) {
    // PII discipline: no customer email or name.
    Sentry.captureException(err, {
      tags: {
        layer: 'stripe',
        handler: 'portal',
        organization_id: me.organization_id,
      },
    })
    const message = err instanceof Error ? err.message : 'Portal session creation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
