import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimeAgo } from '@/lib/date'
import type { ShortlistRow } from '@/lib/db/shortlists'

// Extracted from floats/page.tsx — pure move, identical JSX structure.
// ShortlistRow is what listAllFloats returns; floats always have job_id=null.

export function FloatsTable({ rows }: { rows: ShortlistRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Current role</TableHead>
            <TableHead>Added</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                {row.candidate ? (
                  <Link
                    href={`/candidates/${row.candidate.id}/floats`}
                    className="hover:underline"
                  >
                    {row.candidate.full_name}
                  </Link>
                ) : (
                  'Unknown'
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {row.candidate?.current_role_title ? (
                  <span>
                    {row.candidate.current_role_title}
                    {row.candidate.current_company ? (
                      <span className="text-muted-foreground/80">
                        {' '}
                        · {row.candidate.current_company}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm tabular-nums">
                {formatTimeAgo(row.created_at)}
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="outline" className="text-xs font-normal">
                  Float
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
