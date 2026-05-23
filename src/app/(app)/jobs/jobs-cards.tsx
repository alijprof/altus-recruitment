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
import { formatTimeAgo } from '@/lib/date'
import type { JobListRow } from '@/lib/db/jobs'

import { TYPE_LABEL, STATUS_VARIANT, STATUS_LABEL } from './job-labels'

export type JobsCardsProps = {
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

export function JobsCards({ rows, total, page, pageSize }: JobsCardsProps) {
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(total, page * pageSize)
  const hasPrev = page > 1
  const hasNext = page * pageSize < total

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.id} className="relative">
            <Link
              href={`/jobs/${row.id}`}
              className="bg-card focus-visible:ring-ring/40 flex flex-col gap-2 rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2"
            >
              {/* Top row: title + status badge */}
              <div className="flex items-start justify-between gap-2 pr-8">
                <span className="truncate text-sm font-semibold">{row.title}</span>
                <Badge
                  variant={STATUS_VARIANT[row.status]}
                  className="shrink-0 text-xs font-normal"
                >
                  {STATUS_LABEL[row.status]}
                </Badge>
              </div>

              {/* Company name — plain text (no nested <a>) */}
              <div className="text-muted-foreground truncate text-xs">
                {row.company_name ?? '—'}
              </div>

              {/* Type + created-ago */}
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>{TYPE_LABEL[row.job_type]}</span>
                <span>{formatTimeAgo(row.created_at)}</span>
              </div>
            </Link>

            {/* Row actions — absolutely positioned to avoid <a> nesting, stops propagation */}
            <div
              className="absolute right-2 top-2 z-10"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
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
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
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
