import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { EmptyState } from '@/components/app/empty-state'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getProfile } from '@/lib/db/profiles'
import {
  getSourceAttribution,
  type SourceAttributionRow,
} from '@/lib/db/source-attribution'
import { formatPence } from '@/lib/format'
import { resolveSourceAttributionRange } from '@/lib/reports/source-attribution-range'
import { createClient } from '@/lib/supabase/server'

import { DateFilter } from './date-filter'

// ---------------------------------------------------------------------------
// Plan 03-06 / Task F.3 — REPEAT-02 (D3-22 + D3-23).
//
// `/reports/source-attribution` page.
//
// Server Component reads searchParams (`preset` / `from` / `to`), resolves
// them via `resolveSourceAttributionRange`, calls the
// `source_attribution_summary` RPC through `getSourceAttribution`, and
// renders:
//   1. Back link → /reports
//   2. Header + DateFilter Client Component
//   3. Headline card: total placements + total fee revenue across all sources
//   4. Main table: Source | Placements (badge) | Total fee | Avg time to place
//   5. "Top sources by revenue" small card listing top 3
//
// Empty state: "No placements in this date range." card.
//
// No chart library — plain table + numeric badges per D3-23.
// ---------------------------------------------------------------------------

// Next.js 16 App Router types searchParams as a Promise.
type PageProps = {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>
}

const SOURCE_LABEL: Record<SourceAttributionRow['source'], string> = {
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  direct_add: 'Direct add',
  other: 'Other',
}

function rangeSubtitle(from: string, to: string): string {
  // Render `1 Feb 2026 → 20 May 2026`.
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`)
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }
  return `${fmt(from)} → ${fmt(to)}`
}

export default async function SourceAttributionPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/sign-in')
  }
  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) {
    redirect('/sign-in')
  }

  const sp = await searchParams
  const range = resolveSourceAttributionRange(sp)
  const result = await getSourceAttribution(supabase, {
    from: range.from,
    to: range.to,
  })
  const rows: SourceAttributionRow[] = result.ok ? result.data : []

  const totalPlacements = rows.reduce((acc, r) => acc + r.placements_count, 0)
  const totalFeePence = rows.reduce((acc, r) => acc + r.total_fee_pence, 0)
  const topByRevenue = [...rows]
    .sort((a, b) => b.total_fee_pence - a.total_fee_pence)
    .slice(0, 3)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <Link
          href="/reports"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back to reports
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Source attribution
        </h1>
        <p className="text-muted-foreground text-sm font-normal">
          Placements grouped by candidate source — {rangeSubtitle(range.from, range.to)}.
        </p>
      </header>

      <DateFilter
        currentPreset={range.preset}
        currentFrom={range.from}
        currentTo={range.to}
      />

      {!result.ok && (
        <Card>
          <CardContent className="text-destructive py-4 text-sm">
            We couldn&apos;t load the source-attribution report. Please reload
            the page; if the issue persists, contact support.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">In this window</CardTitle>
          <CardDescription>
            Total placements and fee revenue recorded in the selected date range.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              Placements
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {totalPlacements}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              Fee revenue
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {formatPence(totalFeePence)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">By source</CardTitle>
          <CardDescription>
            Ranked by number of placements; ties broken by fee revenue.
            Fee column reflects recorded placement fees only — set
            <code className="bg-muted mx-1 rounded px-1 py-0.5 text-xs">
              fee_pence
            </code>
            on each placement for accurate ROI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              heading="No placements in this date range"
              body="Move candidates into the Placed stage on a job to see them attributed back to their source channel."
              cta={{ href: '/pipeline', label: 'Open pipeline' }}
            />
          ) : (
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Top sources by revenue
          </CardTitle>
          <CardDescription>
            The three channels producing the most fee revenue in this window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topByRevenue.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No placements in this date range.
            </p>
          ) : (
            <ul className="space-y-2">
              {topByRevenue.map((row, idx) => (
                <li
                  key={row.source}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-medium">
                    <span className="text-muted-foreground mr-2 tabular-nums">
                      {idx + 1}.
                    </span>
                    {SOURCE_LABEL[row.source] ?? row.source}
                  </span>
                  <span className="tabular-nums">
                    {formatPence(row.total_fee_pence)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
