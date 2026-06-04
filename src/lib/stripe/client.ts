import 'server-only'

import Stripe from 'stripe'

import { env } from '@/lib/env'

// Stripe SDK singleton — fails CLOSED at CALL TIME, not at module load.
//
// When STRIPE_SECRET_KEY is absent (dev environment, pre-Stripe-setup, CI):
//   - `stripe` is exported as `null`
//   - The module loads without throwing
//   - `pnpm build` succeeds with zero Stripe env vars set
//
// Call sites that need a live Stripe client must call `assertStripe()` which
// throws a clear "Stripe is not configured" error, keeping the error surface
// at the call site rather than at boot time.
//
// apiVersion is pinned to the version the installed stripe@22.2.0 SDK expects
// (resolved via `require('stripe').API_VERSION` = "2026-05-27.dahlia").
// Using the SDK's own version avoids type mismatches on the response objects.
const API_VERSION = '2026-05-27.dahlia' as const

export const stripe: Stripe | null = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: API_VERSION,
      typescript: true,
    })
  : null

/**
 * Returns the configured Stripe client, or throws a clear error if the
 * STRIPE_SECRET_KEY env var is not set.
 *
 * Usage:
 *   const s = assertStripe()
 *   const session = await s.checkout.sessions.create(...)
 */
export function assertStripe(): Stripe {
  if (!stripe) {
    throw new Error(
      'Stripe is not configured. Set STRIPE_SECRET_KEY in your environment variables.',
    )
  }
  return stripe
}
