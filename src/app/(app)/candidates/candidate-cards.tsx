import Link from 'next/link'
import { Briefcase, Building2, Clock, Mail, MapPin, Phone } from 'lucide-react'

import { MarketStatusBadge } from '@/components/app/market-status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { formatTimeAgo } from '@/lib/date'
import type { CandidateListRow, SortDir, SortKey } from '@/lib/db/candidates'
import type { Enums } from '@/types/database'

const SOURCE_LABEL: Record<Enums<'candidate_source'>, string> = {
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  direct_add: 'Direct add',
  other: 'Other',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export type CandidateCardsProps = {
  rows: CandidateListRow[]
  total: number
  page: number
  pageSize: number
  sort: SortKey
  dir: SortDir
  query?: string
}

function pageHref(
  query: string | undefined,
  sort: SortKey,
  dir: SortDir,
  page: number,
): string {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  params.set('sort', sort)
  params.set('dir', dir)
  params.set('page', String(page))
  params.set('view', 'cards')
  return `/candidates?${params.toString()}`
}

export function CandidateCards({
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  query,
}: CandidateCardsProps) {
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(total, page * pageSize)
  const hasPrev = page > 1
  const hasNext = page * pageSize < total

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-md border p-12 text-center">
        <p className="text-muted-foreground text-sm">No candidates match your search.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/candidates/${row.id}`}
            className="bg-card group focus-visible:ring-ring/40 flex flex-col gap-3 rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2"
          >
            <div className="flex items-start gap-3">
              <Avatar className="size-10 shrink-0">
                <AvatarFallback className="bg-slate-100 text-xs font-semibold text-slate-700">
                  {initials(row.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {row.full_name}
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-xs">
                  {row.current_role_title ?? '—'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <MarketStatusBadge status={row.market_status} />
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="text-muted-foreground flex items-center gap-2">
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{row.email ?? '—'}</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-2">
                <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{row.phone ?? '—'}</span>
              </div>
              <div className="text-muted-foreground flex items-center gap-2">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{row.location ?? '—'}</span>
              </div>
              {row.current_company ? (
                <div className="text-muted-foreground flex items-center gap-2">
                  <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{row.current_company}</span>
                </div>
              ) : null}
            </div>

            <div className="border-border mt-auto flex items-center justify-between border-t pt-3 text-[11px]">
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                {formatTimeAgo(row.last_contacted_at)}
              </span>
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Briefcase className="size-3" aria-hidden="true" />
                {SOURCE_LABEL[row.source]}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {total === 0
            ? '0 candidates'
            : `${firstIndex}–${lastIndex} of ${total} ${total === 1 ? 'candidate' : 'candidates'}`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!hasPrev} asChild={hasPrev}>
            {hasPrev ? (
              <Link href={pageHref(query, sort, dir, page - 1)}>Previous</Link>
            ) : (
              <span>Previous</span>
            )}
          </Button>
          <Button variant="outline" size="sm" disabled={!hasNext} asChild={hasNext}>
            {hasNext ? (
              <Link href={pageHref(query, sort, dir, page + 1)}>Next</Link>
            ) : (
              <span>Next</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
