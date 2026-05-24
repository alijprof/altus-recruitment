import dynamic from 'next/dynamic'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { EmptyState } from '@/components/app/empty-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  getCommissionSummary,
  getPipelineValueSparkline,
  getPlacementsByRecruiterQuarter,
  getTimeToFillBySector,
  pivotRecruiterQuarters,
} from '@/lib/db/buyer-value'
import { getProfile } from '@/lib/db/profiles'
import {
  getSourceAttribution,
  type SourceAttributionRow,
} from '@/lib/db/source-attribution'
import { formatPence } from '@/lib/format'
import { resolveBuyerValueRange } from '@/lib/reports/buyer-value-range'
import { createClient } from '@/lib/supabase/server'

import { CommissionShell } from './_components/commission-shell'
import { SourceRoiShell } from './_components/source-roi-shell'
import { DateFilter } from './date-filter'

// ---------------------------------------------------------------------------
// Quick task 260524-cwd — REPORT-02 (buyer-value dashboards).
//
// Server Component reads searchParams (`preset` / `from` / `to`), resolves
// them via `resolveBuyerValueRange`, fetches 5 metrics in parallel, and
// renders Cards in the locked order:
//   1. Placements per recruiter per quarter (stacked bar)
//   2. Time-to-fill by sector (horizontal bar; single Unspecified bucket v1)
//   3. Source ROI (table, reuses source_attribution_summary RPC)
//   4. Pipeline value (big number + sparkline)
//   5. Commission summary (per-recruiter table @ 20% placeholder, GBP only)
//
// Then a native <details> Methodology block at the bottom.
//
// Chart components are loaded via `next/dynamic({ ssr: false })` to avoid
// the Recharts ResponsiveContainer hydration mismatch (RESEARCH §Pitfall 2).
// Each loading placeholder matches the eventual fixed-height parent
// (h-72 for full charts, h-20 for sparkline) to prevent CLS.
// ---------------------------------------------------------------------------

const StackedBar = dynamic(
  () => import('@/components/charts/stacked-bar').then((m) => m.StackedBar),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
)

const HorizontalBar = dynamic(
  () => import('@/components/charts/horizontal-bar').then((m) => m.HorizontalBar),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
)

const Sparkline = dynamic(
  () => import('@/components/charts/sparkline').then((m) => m.Sparkline),
  {
    ssr: false,
    loading: () => (
      <div className="h-20 w-full animate-pulse rounded-md bg-muted/40" />
    ),
  },
)

type PageProps = {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>
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

export default async function BuyerValuePage({ searchParams }: PageProps) {
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
  const range = resolveBuyerValueRange(sp)

  const [placements, ttf, sourceRoi, sparkline, commission] = await Promise.all([
    getPlacementsByRecruiterQuarter(supabase, {
      from: range.from,
      to: range.to,
    }),
    getTimeToFillBySector(supabase, { from: range.from, to: range.to }),
    getSourceAttribution(supabase, { from: range.from, to: range.to }),
    getPipelineValueSparkline(supabase, { from: range.from, to: range.to }),
    getCommissionSummary(supabase, { from: range.from, to: range.to }),
  ])

  const placementsPivot = placements.ok
    ? pivotRecruiterQuarters(placements.data)
    : { data: [], recruiters: [] }
  const ttfRows = ttf.ok
    ? ttf.data.map((r) => ({
        label: r.sector,
        median: Number(r.median_days ?? 0),
        p90: Number(r.p90_days ?? 0),
      }))
    : []
  const sourceRoiRows: SourceAttributionRow[] = sourceRoi.ok ? sourceRoi.data : []
  const sparkRows = sparkline.ok ? sparkline.data : []
  const lastSparkRow = sparkRows.length > 0 ? sparkRows[sparkRows.length - 1] : undefined
  const currentPipelineValuePence = lastSparkRow ? lastSparkRow.pipeline_value_pence : 0
  const sparkChartData = sparkRows.map((r) => ({
    x: r.bucket_date,
    y: r.pipeline_value_pence,
  }))
  const commissionRows = commission.ok ? commission.data : []

  const failedMetrics: string[] = []
  if (!placements.ok) failedMetrics.push('Placements per recruiter')
  if (!ttf.ok) failedMetrics.push('Time-to-fill')
  if (!sourceRoi.ok) failedMetrics.push('Source ROI')
  if (!sparkline.ok) failedMetrics.push('Pipeline value')
  if (!commission.ok) failedMetrics.push('Commission summary')

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
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
          Buyer-value report
        </h1>
        <p className="text-muted-foreground text-sm font-normal">
          Five acquirer-due-diligence metrics across the selected window —{' '}
          {rangeSubtitle(range.from, range.to)}.
        </p>
      </header>

      <DateFilter
        currentPreset={range.preset}
        currentFrom={range.from}
        currentTo={range.to}
      />

      {failedMetrics.length > 0 && (
        <Card>
          <CardContent className="text-destructive py-4 text-sm">
            We couldn&apos;t load: {failedMetrics.join(', ')}. The rest of the
            page is still usable; reload to retry.
          </CardContent>
        </Card>
      )}

      {/* Card 1 — Placements per recruiter per quarter */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Placements per recruiter per quarter
          </CardTitle>
          <CardDescription>
            Stacked bars show each recruiter&apos;s placement count by
            quarter. Higher and more even = healthier team distribution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {placementsPivot.data.length === 0 ? (
            <EmptyState
              heading="No placements yet"
              body="Move candidates into the Placed stage on a job to see them stacked by recruiter and quarter."
              cta={{ href: '/pipeline', label: 'Open pipeline' }}
            />
          ) : (
            <StackedBar
              data={placementsPivot.data}
              keys={placementsPivot.recruiters}
              categoryKey="quarter"
            />
          )}
        </CardContent>
      </Card>

      {/* Card 2 — Time-to-fill by sector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Time-to-fill by sector
          </CardTitle>
          <CardDescription>
            Median + 90th-percentile days from job creation to placement.
            Sector grouping is bucketed under &quot;Unspecified&quot; until a
            sector field is added to jobs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ttfRows.length === 0 ? (
            <EmptyState
              heading="No placements to measure"
              body="Time-to-fill is computed from jobs that have at least one placed application in the window."
            />
          ) : (
            <HorizontalBar data={ttfRows} />
          )}
        </CardContent>
      </Card>

      {/* Card 3 — Source ROI (reuses source_attribution_summary RPC) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Source ROI</CardTitle>
          <CardDescription>
            Placements grouped by candidate source, with fee revenue and
            average time-to-place per channel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sourceRoiRows.length === 0 ? (
            <EmptyState
              heading="No source attributions yet"
              body="Move candidates into the Placed stage to see them attributed back to their source channel."
              cta={{ href: '/pipeline', label: 'Open pipeline' }}
            />
          ) : (
            <SourceRoiShell rows={sourceRoiRows} />
          )}
        </CardContent>
      </Card>

      {/* Card 4 — Pipeline value */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Pipeline value
          </CardTitle>
          <CardDescription>
            Sum of <code>salary_max × 20%</code> across open jobs (assumed
            GBP). Sparkline shows the trend over the selected window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sparkRows.length === 0 && currentPipelineValuePence === 0 ? (
            <EmptyState
              heading="No open jobs in this window"
              body="Mark a job as Open with a salary_max set to populate pipeline value."
              cta={{ href: '/jobs', label: 'Open jobs' }}
            />
          ) : (
            <>
              <div className="text-4xl font-semibold tabular-nums">
                {formatPence(currentPipelineValuePence)}
              </div>
              <Sparkline data={sparkChartData} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 5 — Commission summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            Commission summary
          </CardTitle>
          <CardDescription>
            Per-recruiter commission, computed as 20% of recorded fees
            (placeholder until per-recruiter rates exist). GBP placements
            only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {commissionRows.length === 0 ? (
            <EmptyState
              heading="No commissioned placements yet"
              body="Recorded fees on GBP placements will show here per recruiter."
              cta={{ href: '/pipeline', label: 'Open pipeline' }}
            />
          ) : (
            <CommissionShell rows={commissionRows} />
          )}
        </CardContent>
      </Card>

      <details className="rounded-md border bg-muted/30 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Methodology
        </summary>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            <strong>Fee assumption.</strong> Pipeline value uses{' '}
            <code>salary_max × 20%</code> as expected fee per open job.
          </p>
          <p>
            <strong>Commission placeholder.</strong> Estimated commission =
            total fee × 20%. Replace with per-recruiter rates once schema
            supports them.
          </p>
          <p>
            <strong>Pipeline sparkline.</strong> &quot;Open as of date X&quot;
            = jobs with <code>status=&apos;open&apos;</code> and{' '}
            <code>created_at ≤ X</code>. We lack a historical status table,
            so the trend is indicative only.
          </p>
          <p>
            <strong>Currency.</strong> Commission and pipeline aggregations
            are filtered to GBP placements (
            <code>placement_currency = &apos;GBP&apos;</code>).
          </p>
          <p>
            <strong>Sector.</strong> The <code>jobs</code> table has no
            sector column; time-to-fill rolls up into a single
            &quot;Unspecified&quot; bucket until a sector field is added.
          </p>
          <p>
            <strong>Recruiter attribution.</strong> Placements credit{' '}
            <code>owner_user_id</code>, falling back to <code>created_by</code>.
          </p>
        </div>
      </details>
    </div>
  )
}
