import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { formatTimeAgo } from '@/lib/date'
import type { ShortlistRow } from '@/lib/db/shortlists'

// Mobile card list for the /floats page.
// Empty-state is handled by page.tsx — this component only renders cards.

export function FloatsCards({ rows }: { rows: ShortlistRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((row) => {
        const candidate = row.candidate

        // No candidate on this float — render without a link.
        if (!candidate) {
          return (
            <div
              key={row.id}
              className="bg-card flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground text-sm font-semibold">Unknown</span>
                <Badge variant="outline" className="shrink-0 text-xs font-normal">
                  Float
                </Badge>
              </div>
              <div className="text-muted-foreground truncate text-xs">—</div>
              <div className="text-muted-foreground text-xs">{formatTimeAgo(row.created_at)}</div>
            </div>
          )
        }

        const roleCompany = [candidate.current_role_title, candidate.current_company]
          .filter(Boolean)
          .join(' · ')

        return (
          <Link
            key={row.id}
            href={`/candidates/${candidate.id}/floats`}
            className="bg-card focus-visible:ring-ring/40 flex flex-col gap-2 rounded-lg border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2"
          >
            {/* Candidate name + Float badge */}
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-sm font-semibold">{candidate.full_name}</span>
              <Badge variant="outline" className="shrink-0 text-xs font-normal">
                Float
              </Badge>
            </div>

            {/* Current role · company */}
            <div className="text-muted-foreground truncate text-xs">{roleCompany || '—'}</div>

            {/* Created-ago */}
            <div className="text-muted-foreground text-xs">{formatTimeAgo(row.created_at)}</div>
          </Link>
        )
      })}
    </div>
  )
}
