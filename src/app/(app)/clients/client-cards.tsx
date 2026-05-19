import Link from 'next/link'
import { Briefcase, Clock, Factory, Globe, StickyNote } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { ClientRow } from '@/lib/db/clients'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function prettyWebsite(value: string | null): string {
  if (!value) return '—'
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function ClientCards({ rows }: { rows: ClientRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-md border p-12 text-center">
        <p className="text-muted-foreground text-sm">No clients to show.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={`/clients/${row.id}`}
          className="bg-card group focus-visible:ring-ring/40 flex flex-col gap-3 rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2"
        >
          <div className="flex items-start gap-3">
            <Avatar className="size-10 shrink-0">
              <AvatarFallback className="bg-slate-100 text-xs font-semibold text-slate-700">
                {initials(row.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{row.name}</div>
              <div className="text-muted-foreground mt-0.5 truncate text-xs">
                {row.industry ?? '—'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {row.dormant ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-xs font-normal text-amber-700 dark:text-amber-300"
              >
                Dormant
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-green-500/40 bg-green-500/10 text-xs font-normal text-green-700 dark:text-green-300"
              >
                Active
              </Badge>
            )}
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="text-muted-foreground flex items-center gap-2">
              <Factory className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{row.industry ?? '—'}</span>
            </div>
            <div className="text-muted-foreground flex items-center gap-2">
              <Globe className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{prettyWebsite(row.website)}</span>
            </div>
            {row.notes ? (
              <div className="text-muted-foreground flex items-start gap-2">
                <StickyNote className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="line-clamp-2">{row.notes}</span>
              </div>
            ) : null}
          </div>

          <div className="border-border mt-auto flex items-center justify-between border-t pt-3 text-[11px]">
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              {formatDate(row.last_contacted_at)}
            </span>
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Briefcase className="size-3" aria-hidden="true" />
              {row.active_jobs_count} {row.active_jobs_count === 1 ? 'job' : 'jobs'}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
