import { EmptyState } from '@/components/app/empty-state'
import { MetricCard } from '@/components/app/metric-card'
import {
  getDashboardMetrics,
  getFollowUpCandidates,
  getRecentActivity,
  getStaleApplications,
} from '@/lib/db/dashboard'
import { createClient } from '@/lib/supabase/server'

import { FollowUpWidget } from './_dashboard/follow-up-widget'
import { RecentActivityFeed } from './_dashboard/recent-activity-feed'
import { StaleApplicationsWidget } from './_dashboard/stale-applications-widget'

// Plan 5 Task 5.1 — Dashboard. RSC fetches all four data sources in parallel
// (each helper is a single round-trip / batched-IN set) and renders the
// UI-SPEC §6 layout: metric cards on top, two-column body below
// (RecentActivityFeed left 2/3, StaleApplicationsWidget + FollowUpWidget
// stacked right 1/3 on desktop, stacked on mobile).

export default async function DashboardPage() {
  const supabase = await createClient()

  const [metrics, activityResult, staleResult, followUpResult] = await Promise.all([
    getDashboardMetrics(supabase),
    getRecentActivity(supabase, 20),
    getStaleApplications(supabase, 20),
    getFollowUpCandidates(supabase, 10),
  ])

  const isEmpty = metrics.candidates === 0 && metrics.openJobs === 0

  if (isEmpty) {
    return (
      <div className="space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Altus</h1>
          <p className="text-muted-foreground text-sm font-normal">
            Add your first candidate or client to get the pipeline moving.
          </p>
        </header>
        <EmptyState
          heading="Nothing here yet"
          body="Start by adding a candidate. CV uploads, semantic search, and pipeline tracking all build from there."
          cta={{ href: '/candidates/new', label: 'Add your first candidate' }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm font-normal">
          A live view of your candidates, jobs and pipeline.
        </p>
      </header>

      <section
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Key metrics"
      >
        <MetricCard label="Candidates" value={metrics.candidates} />
        <MetricCard label="Open jobs" value={metrics.openJobs} />
        <MetricCard label="Open applications" value={metrics.openApplications} />
        <MetricCard
          label="Placements this month"
          value={metrics.placementsThisMonth}
          caption="Lands in Phase 4"
        />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivityFeed entries={activityResult.ok ? activityResult.data : []} />
        </div>
        <div className="space-y-6">
          <StaleApplicationsWidget items={staleResult.ok ? staleResult.data : []} />
          <FollowUpWidget items={followUpResult.ok ? followUpResult.data : []} />
        </div>
      </section>
    </div>
  )
}
