import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimeAgo } from '@/lib/date'
import type { JobListRow } from '@/lib/db/jobs'
import type { Enums } from '@/types/database'

// Human labels for enum values rendered inline.
const TYPE_LABEL: Record<Enums<'job_type'>, string> = {
  perm: 'Perm',
  contract: 'Contract',
  temp: 'Temp',
}

const STATUS_VARIANT: Record<
  Enums<'job_status'>,
  'default' | 'outline' | 'secondary'
> = {
  draft: 'outline',
  open: 'default',
  on_hold: 'secondary',
  filled: 'secondary',
  cancelled: 'outline',
}

const STATUS_LABEL: Record<Enums<'job_status'>, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  cancelled: 'Cancelled',
}

export type JobsTableProps = {
  rows: JobListRow[]
  total: number
  page: number
  pageSize: number
}

function pageHref(page: number): string {
  const params = new URLSearchParams()
  params.set('page', String(page))
  return `/jobs?${params.toString()}`
}

export function JobsTable({ rows, total, page, pageSize }: JobsTableProps) {
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(total, page * pageSize)
  const hasPrev = page > 1
  const hasNext = page * pageSize < total

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground text-xs font-normal">
                Title
              </TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">
                Client
              </TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">
                Type
              </TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">
                Status
              </TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">
                Created
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-12 text-center text-sm font-normal"
                >
                  No jobs match this view.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell className="font-normal">
                    <Link
                      href={`/jobs/${row.id}`}
                      className="hover:underline focus:outline-none focus-visible:underline"
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {row.company_name ? (
                      <Link
                        href={`/clients/${row.company_id}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {row.company_name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {TYPE_LABEL[row.job_type]}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANT[row.status]}
                      className="text-xs font-normal"
                    >
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {formatTimeAgo(row.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${row.title}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/jobs/${row.id}`}>View</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/jobs/${row.id}/pipeline`}>Pipeline</Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs font-normal">
          {total === 0
            ? '0 jobs'
            : `${firstIndex}–${lastIndex} of ${total} ${total === 1 ? 'job' : 'jobs'}`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} asChild={hasPrev}>
            {hasPrev ? <Link href={pageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} asChild={hasNext}>
            {hasNext ? <Link href={pageHref(page + 1)}>Next</Link> : <span>Next</span>}
          </Button>
        </div>
      </div>
    </div>
  )
}
