'use client'

// Client component: POSTs to /api/stripe/checkout with the chosen planKey
// and redirects to the returned Stripe Checkout URL.
//
// Follows CLAUDE.md error-surfacing pattern: catch → toast on failure,
// never navigate on failure. Parses JSON body ONCE (unlike manage-billing-button.tsx
// which calls res.json() twice and throws "body already read" on !res.ok paths).

import { useState } from 'react'
import { toast } from 'sonner'
import * as Sentry from '@sentry/nextjs'

import { Button } from '@/components/ui/button'
import type { PlanKey } from '@/lib/stripe/plans'

interface StartCheckoutButtonProps {
  planKey: PlanKey
  label?: string
  variant?: React.ComponentProps<typeof Button>['variant']
}

export function StartCheckoutButton({
  planKey,
  label = 'Start 14-day trial',
  variant,
}: StartCheckoutButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planKey }),
      })
      // Parse body ONCE — calling res.json() twice throws "body already read".
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) {
        // Surface error without navigating (CLAUDE.md: don't navigate on failure).
        toast.error(data.error ?? 'Could not start checkout. Please try again.')
        return
      }
      if (data.url) {
        // Stripe Checkout is a cross-origin URL — use a full-page navigation.
        // next/navigation router.push is for in-app route transitions only.
        window.location.href = data.url
      } else {
        toast.error('No checkout URL returned. Please try again.')
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { layer: 'billing', component: 'StartCheckoutButton' } })
      toast.error('Could not start checkout. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      size="sm"
      {...(variant ? { variant } : {})}
    >
      {loading ? 'Starting…' : label}
    </Button>
  )
}
