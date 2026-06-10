import Link from 'next/link'

import { MarketStatusBadge } from '@/components/app/market-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FollowUpCandidate } from '@/lib/db/dashboard'
import { cn } from '@/lib/utils'

import { LogCallDialog } from './_components/log-call-dialog'

// UI-SPEC §5 Dashboard "Candidates to follow up" widget. Sort order
// established server-side by getFollowUpCandidates:
// hot → actively_looking → passively_looking (CONTEXT.md specifics).
//
// Plan 04-06 / Task 1 — REMIND-01 quick-action: each row now has an inline
// "Log call" button (LogCallDialog). The row Link navigates to the full
// candidate detail; the button opens a lightweight Dialog so the recruiter
// can act without context-switching.
export type FollowUpWidgetProps = {
  items: FollowUpCandidate[]
  className?: string
}

export function FollowUpWidget({ items, className }: FollowUpWidgetProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold">Candidates to follow up</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="text-muted-foreground px-6 py-8 text-center text-sm font-normal">
            <p className="text-foreground text-sm font-semibold">No follow-ups due</p>
            <p className="mt-1">You&apos;re up to date with your candidate relationships.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-6 py-3">
                {/* Name + days-since navigates to candidate detail */}
                <Link
                  href={`/candidates/${item.id}`}
                  className="hover:bg-muted/50 min-w-0 flex-1 rounded transition-colors"
                >
                  <p className="truncate text-sm font-semibold">{item.full_name}</p>
                  <p className="text-muted-foreground text-xs font-normal">
                    {item.days_since_contact === null
                      ? 'Never contacted'
                      : `${item.days_since_contact} days since last contact`}
                  </p>
                </Link>
                <MarketStatusBadge status={item.market_status} />
                {/* REMIND-01 quick-action: log a call without leaving the dashboard */}
                <LogCallDialog candidateId={item.id} candidateName={item.full_name} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
