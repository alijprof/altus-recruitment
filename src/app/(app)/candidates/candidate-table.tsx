import Link from 'next/link'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'

import { MarketStatusBadge } from '@/components/app/market-status-badge'
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
import { cn } from '@/lib/utils'
import type { CandidateListRow, SortDir, SortKey } from '@/lib/db/candidates'
import type { Enums } from '@/types/database'

// Human-readable labels for the candidate source enum — kept inline because
// it's only used here in Phase 1.
const SOURCE_LABEL: Record<Enums<'candidate_source'>, string> = {
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  direct_add: 'Direct add',
  other: 'Other',
}

export type CandidateTableProps = {
  rows: CandidateListRow[]
  total: number
  page: number
  pageSize: number
  sort: SortKey
  dir: SortDir
  query?: string
}

type ColumnDef = {
  key: SortKey | null // null = unsortable
  label: string
  align?: 'left' | 'right'
}

const COLUMNS: ColumnDef[] = [
  { key: 'full_name', label: 'Name' },
  { key: null, label: 'Role / Company' },
  { key: null, label: 'Location' },
  { key: 'market_status', label: 'Market Status' },
  { key: 'last_contacted_at', label: 'Last Contacted' },
  { key: 'created_at', label: 'Added' },
  { key: null, label: 'Source' },
]

function makeSortHref(
  query: string | undefined,
  page: number,
  active: { sort: SortKey; dir: SortDir },
  target: SortKey,
): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  const nextDir: SortDir = active.sort === target && active.dir === 'asc' ? 'desc' : 'asc'
  params.set('sort', target)
  params.set('dir', nextDir)
  // Reset to page 1 on sort change for the same reason searchInput does.
  if (page !== 1) params.set('page', '1')
  return `/candidates?${params.toString()}`
}

function pageHref(query: string | undefined, sort: SortKey, dir: SortDir, page: number): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  params.set('sort', sort)
  params.set('dir', dir)
  params.set('page', String(page))
  return `/candidates?${params.toString()}`
}

export function CandidateTable({
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  query,
}: CandidateTableProps) {
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(total, page * pageSize)
  const hasPrev = page > 1
  const hasNext = page * pageSize < total
  // While a query is active, sort headers are non-interactive — the search RPC
  // orders by similarity (UI-SPEC §1).
  const searchActive = Boolean(query && query.trim().length > 0)

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((col) => {
                const isSortable = col.key !== null && !searchActive
                const isActive = col.key === sort
                if (!isSortable) {
                  return (
                    <TableHead
                      key={col.label}
                      className="text-muted-foreground text-xs font-normal"
                    >
                      {col.label}
                    </TableHead>
                  )
                }
                const href = makeSortHref(query, page, { sort, dir }, col.key!)
                return (
                  <TableHead
                    key={col.label}
                    className="text-muted-foreground text-xs font-normal"
                  >
                    <Link
                      href={href}
                      className={cn(
                        'hover:text-foreground inline-flex items-center gap-1 font-normal transition-colors',
                        isActive && 'text-foreground',
                      )}
                      aria-label={`Sort by ${col.label.toLowerCase()} ${isActive && dir === 'asc' ? 'descending' : 'ascending'}`}
                    >
                      {col.label}
                      {isActive ? (
                        dir === 'asc' ? (
                          <ChevronUp className="size-3" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-3" aria-hidden="true" />
                        )
                      ) : null}
                    </Link>
                  </TableHead>
                )
              })}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMNS.length + 1}
                  className="text-muted-foreground py-12 text-center text-sm font-normal"
                >
                  No candidates match your search.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group hover:bg-accent/30 transition-colors"
                >
                  <TableCell className="font-normal">
                    <Link
                      href={`/candidates/${row.id}`}
                      className="group-hover:text-foreground hover:underline focus:outline-none focus-visible:underline"
                    >
                      {row.full_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {row.current_role_title || row.current_company ? (
                      <>
                        <span className="text-foreground">{row.current_role_title ?? '—'}</span>
                        {row.current_company ? (
                          <>
                            {' '}
                            <span aria-hidden="true">·</span> {row.current_company}
                          </>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {row.location || '—'}
                  </TableCell>
                  <TableCell>
                    <MarketStatusBadge status={row.market_status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {formatTimeAgo(row.last_contacted_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {formatTimeAgo(row.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-normal">
                    {SOURCE_LABEL[row.source]}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${row.full_name}`}
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/candidates/${row.id}`}>View</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/candidates/${row.id}/edit`}>Edit</Link>
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
            ? '0 candidates'
            : `${firstIndex}–${lastIndex} of ${total} ${total === 1 ? 'candidate' : 'candidates'}`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} asChild={hasPrev}>
            {hasPrev ? <Link href={pageHref(query, sort, dir, page - 1)}>Previous</Link> : <span>Previous</span>}
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} asChild={hasNext}>
            {hasNext ? <Link href={pageHref(query, sort, dir, page + 1)}>Next</Link> : <span>Next</span>}
          </Button>
        </div>
      </div>
    </div>
  )
}
