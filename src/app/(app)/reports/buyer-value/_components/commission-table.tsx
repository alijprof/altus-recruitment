'use client'

// Quick task 260524-cwd — REPORT-02. Commission summary table (md+).

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CommissionSummaryRow } from '@/lib/db/buyer-value'
import { formatPence } from '@/lib/format'

type CommissionTableProps = {
  rows: CommissionSummaryRow[]
}

export function CommissionTable({ rows }: CommissionTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Recruiter</TableHead>
          <TableHead className="text-right">Placements</TableHead>
          <TableHead className="text-right">Total fee</TableHead>
          <TableHead className="text-right">Estimated commission</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.recruiter_id}>
            <TableCell className="font-medium">{row.recruiter_name}</TableCell>
            <TableCell className="text-right tabular-nums">
              <Badge variant="secondary">{row.placements_count}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPence(row.total_fee_pence)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPence(row.estimated_commission_pence)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
