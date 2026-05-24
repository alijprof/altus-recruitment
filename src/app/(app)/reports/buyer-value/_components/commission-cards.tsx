'use client'

// Quick task 260524-cwd — REPORT-02. Mobile (<md) card list mirror of
// `commission-table.tsx`.

import { Badge } from '@/components/ui/badge'
import type { CommissionSummaryRow } from '@/lib/db/buyer-value'
import { formatPence } from '@/lib/format'

type CommissionCardsProps = {
  rows: CommissionSummaryRow[]
}

export function CommissionCards({ rows }: CommissionCardsProps) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.recruiter_id}
          className="space-y-2 rounded-md border p-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{row.recruiter_name}</span>
            <Badge variant="secondary" className="tabular-nums">
              {row.placements_count}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Total fee</dt>
            <dd className="text-right font-medium tabular-nums">
              {formatPence(row.total_fee_pence)}
            </dd>
            <dt className="text-muted-foreground">Estimated commission</dt>
            <dd className="text-right tabular-nums">
              {formatPence(row.estimated_commission_pence)}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}
