'use client'

// Stripe Checkout return page — 05-01 Task 1.2
//
// Landing page after a successful Stripe Checkout. The user arrives here
// with ?session_id=cs_... in the URL. We show a brief "Setting up your
// account…" state and poll the subscription status via a server action for
// up to ~5 seconds (Pitfall 1: webhook race). Once a non-'none' status is
// confirmed, or after the timeout, we redirect to the dashboard.
//
// This page is intentionally simple — its job is to absorb the webhook race
// gracefully, not to display billing details (that's the /settings/billing page).
//
// Route: /stripe/return (outside the (app) group so there's no auth layout
// overhead on this thin redirect page, but it IS authenticated — the user
// just came from Stripe with a valid card session).

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { checkSubscriptionStatus } from './actions'

export default function StripeReturnPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session_id') ?? ''
  const [statusMessage, setStatusMessage] = useState('Setting up your account…')

  useEffect(() => {
    let cancelled = false
    const POLL_INTERVAL_MS = 1000
    const MAX_ATTEMPTS = 5

    async function poll(attempt: number) {
      if (cancelled) return

      try {
        const status = await checkSubscriptionStatus()
        if (status !== 'none' && status !== null) {
          // Subscription is live — go to the dashboard.
          if (!cancelled) router.replace('/')
          return
        }
      } catch {
        // Ignore poll errors — keep trying until timeout.
      }

      if (attempt >= MAX_ATTEMPTS) {
        // Timeout — redirect anyway. The subscription will sync via the
        // next webhook event or on the next page load via getEntitlement.
        if (!cancelled) {
          setStatusMessage('All done! Redirecting…')
          router.replace('/')
        }
        return
      }

      // Wait and try again.
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      await poll(attempt + 1)
    }

    void poll(0)
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto size-12 animate-spin rounded-full border-4 border-current border-t-transparent text-primary" />
        <h1 className="text-xl font-semibold">{statusMessage}</h1>
        <p className="text-muted-foreground text-sm">
          Your subscription is being activated. This only takes a moment.
        </p>
      </div>
    </div>
  )
}
