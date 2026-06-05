'use client'

// Client component: POSTs to /api/stripe/portal and redirects to the
// returned Stripe Customer Portal URL.
//
// Follows CLAUDE.md error-surfacing pattern: catch → toast on failure,
// never close/navigate on failure.

import { useState } from 'react'
import { toast } from 'sonner'
import * as Sentry from '@sentry/nextjs'

import { Button } from '@/components/ui/button'

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      // Parse body ONCE — calling res.json() twice throws "body already read".
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) {
        // Surface error without crashing (CLAUDE.md: don't navigate on failure).
        toast.error(data.error ?? 'Could not open billing portal. Please try again.')
        return
      }
      if (data.url) {
        // Stripe portal is a cross-origin URL — use a full-page navigation.
        // next/navigation router.push does NOT reliably navigate to an external
        // origin (it is for in-app route transitions). Matches the established
        // window.location.href pattern in connect-outlook-card / apply-form.
        window.location.href = data.url
      } else {
        toast.error('No portal URL returned. Please try again.')
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { layer: 'billing', component: 'ManageBillingButton' } })
      toast.error('Could not open billing portal. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={handleClick} disabled={loading} size="sm">
      {loading ? 'Opening…' : 'Manage billing'}
    </Button>
  )
}
