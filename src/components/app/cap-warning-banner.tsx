'use client'

// AI cap warning banner — 05-01 Task 1.4
//
// Shown in the authenticated app shell when the org has crossed the 80% or
// 100% AI usage threshold for any cap bucket this month.
//
// Rendered server-side (RSC reads entitlement; boolean props passed here).
// This component is 'use client' only for the dismiss / close state.
// The server never calls Stripe — entitlement is local-DB-only.

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

type CapWarningBannerProps = {
  softCapBreached: boolean
  hardCapBreached: boolean
}

export function CapWarningBanner({ softCapBreached, hardCapBreached }: CapWarningBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  // Only show if a cap is breached.
  if (dismissed || (!softCapBreached && !hardCapBreached)) return null

  const isHard = hardCapBreached

  return (
    <div
      role="alert"
      className={`flex items-center justify-between px-4 py-2 text-sm font-medium ${
        isHard
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
      }`}
    >
      <span>
        {isHard ? (
          <>
            Your team has hit the AI usage limit for this month. Some AI features are running in
            fallback mode.{' '}
          </>
        ) : (
          <>
            Your team is approaching the AI usage limit for this month.{' '}
          </>
        )}
        <Link href="/settings/billing" className="underline underline-offset-2 hover:opacity-80">
          Manage your plan
        </Link>
        {' '}to upgrade.
      </span>
      <button
        type="button"
        aria-label="Dismiss AI cap warning"
        onClick={() => setDismissed(true)}
        className="ml-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
