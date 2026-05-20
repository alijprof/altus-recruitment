import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DormantClient } from '@/lib/db/dormant-clients'
import { cn } from '@/lib/utils'

import { DormantClientRow } from './dormant-client-row'

// ---------------------------------------------------------------------------
// Plan 03-05 / Task E.2 — REPEAT-01 + D3-19 + D3-29.
//
// Server Component listing dormant clients on the dashboard. Each row carries
// a "Send check-in" button (Client Component DormantClientRow) that opens a
// modal containing a Sonnet-drafted email pre-personalized with the client
// name + last placement summary.
//
// D3-29: org-wide visibility — no recruiter filter at the server. Anchor
// agency is 2-3 people; transparency wins over owner-only filtering.
// ---------------------------------------------------------------------------

export type DormantClientsWidgetProps = {
  items: DormantClient[]
  className?: string
}

export function DormantClientsWidget({ items, className }: DormantClientsWidgetProps) {
  return (
    <Card id="dormant-clients" className={cn('', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b pb-4">
        <CardTitle className="text-sm font-semibold">Dormant clients</CardTitle>
        {items.length > 0 ? (
          <Badge variant="secondary" className="font-normal">
            {items.length}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="text-muted-foreground px-6 py-8 text-center text-sm font-normal">
            <p className="text-foreground text-sm font-semibold">No dormant clients</p>
            <p className="mt-1">Every previously-placed account is up to date.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.client_id}>
                <DormantClientRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
