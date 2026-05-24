'use client'

// Quick task 260524-cwd — REPORT-02. Mobile (<md) card list mirror of
// `source-roi-table.tsx`. Visual density matches the candidate-cards pattern.

import { Badge } from '@/components/ui/badge'
import type { SourceAttributionRow } from '@/lib/db/source-attribution'
import { formatPence } from '@/lib/format'

const SOURCE_LABEL: Record<SourceAttributionRow['source'], string> = {
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  direct_add: 'Direct add',
  other: 'Other',
}

type SourceRoiCardsProps = {
  rows: SourceAttributionRow[]
}

export function SourceRoiCards({ rows }: SourceRoiCardsProps) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.source}
          className="space-y-2 rounded-md border p-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {SOURCE_LABEL[row.source] ?? row.source}
            </span>
            <Badge variant="secondary" className="tabular-nums">
              {row.placements_count}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Total fee</dt>
            <dd className="text-right font-medium tabular-nums">
              {formatPence(row.total_fee_pence)}
            </dd>
            <dt className="text-muted-foreground">Avg time to place</dt>
            <dd className="text-right tabular-nums">
              {row.avg_time_to_place_days.toFixed(1)} days
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  )
}
