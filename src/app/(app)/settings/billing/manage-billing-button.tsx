'use client'

// Client component: POSTs to /api/stripe/portal and redirects to the
// returned Stripe Customer Portal URL.
//
// Follows CLAUDE.md error-surfacing pattern: catch → toast on failure,
// never close/navigate on failure.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        // Surface error without crashing (CLAUDE.md: don't navigate on failure).
        alert(data.error ?? 'Could not open billing portal. Please try again.')
        return
      }
      const data = (await res.json()) as { url?: string }
      if (data.url) {
        router.push(data.url)
      } else {
        alert('No portal URL returned. Please try again.')
      }
    } catch (err) {
      console.error('portal request failed:', err)
      alert('Could not open billing portal. Please try again.')
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
