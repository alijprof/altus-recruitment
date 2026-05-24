'use client'

// Quick task 260524-cwd — REPORT-02. Source ROI table (md+ viewport).
// Mirrors the table layout used at /reports/source-attribution lines 191-218.

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SourceAttributionRow } from '@/lib/db/source-attribution'
import { formatPence } from '@/lib/format'

// Defined inline rather than imported from /reports/source-attribution/page —
// that file does not export the constant, and we don't want a cross-route
// dependency for a private label map.
const SOURCE_LABEL: Record<SourceAttributionRow['source'], string> = {
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  direct_add: 'Direct add',
  other: 'Other',
}

type SourceRoiTableProps = {
  rows: SourceAttributionRow[]
}

export function SourceRoiTable({ rows }: SourceRoiTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Placements</TableHead>
          <TableHead className="text-right">Total fee</TableHead>
          <TableHead className="text-right">Avg time to place</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.source}>
            <TableCell className="font-medium">
              {SOURCE_LABEL[row.source] ?? row.source}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <Badge variant="secondary">{row.placements_count}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPence(row.total_fee_pence)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.avg_time_to_place_days.toFixed(1)} days
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
