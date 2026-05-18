import Link from 'next/link'

import { MarketStatusBadge } from '@/components/app/market-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FollowUpCandidate } from '@/lib/db/dashboard'
import { cn } from '@/lib/utils'

// UI-SPEC §6 Dashboard "Candidates to follow up" widget. Sort order
// established server-side by getFollowUpCandidates:
// hot → actively_looking → passively_looking (CONTEXT.md specifics).
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
              <li key={item.id}>
                <Link
                  href={`/candidates/${item.id}`}
                  className="hover:bg-muted/50 flex items-center justify-between gap-3 px-6 py-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.full_name}</p>
                    <p className="text-muted-foreground text-xs font-normal">
                      {item.days_since_contact === null
                        ? 'Never contacted'
                        : `${item.days_since_contact} days since last contact`}
                    </p>
                  </div>
                  <MarketStatusBadge status={item.market_status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
