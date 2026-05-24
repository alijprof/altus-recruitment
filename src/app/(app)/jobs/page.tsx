import { EmptyState } from '@/components/app/empty-state'
import { listJobs } from '@/lib/db/jobs'
import { createClient } from '@/lib/supabase/server'

import { JobsShell } from './jobs-shell'

// D-15: Jobs default sort is created_at DESC and statusFilter defaults to
// `open`. D-14 puts list interaction state in URL search params.
const PAGE_SIZE = 25

type JobsSearchParams = {
  page?: string
  // status filter is hard-coded to 'open' in MVP; a future change can wire
  // a Select that writes ?status=... to the URL.
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<JobsSearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const page = parsePage(params.page)
  const result = await listJobs(supabase, {
    page,
    pageSize: PAGE_SIZE,
    sort: 'created_at',
    dir: 'desc',
    statusFilter: 'open',
  })

  if (!result.ok) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        </header>
        <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          Couldn&apos;t load jobs. Please refresh.
        </div>
      </div>
    )
  }

  const { rows, total } = result.data
  // Empty-state primary CTA points at /spec/new (AI-first path); secondary
  // routes via /clients because `/jobs/new` is not yet implemented — jobs
  // currently have to be created against a client. See plan 260524-cjl
  // SUMMARY.md for the Phase 4 follow-up.
  const isEmpty = total === 0

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
      </header>

      {isEmpty ? (
        <EmptyState
          heading="Add your first job"
          body="Jobs hang off a client. Pick a client and create a job against them — or record a spec call and we'll extract the JD for you."
          cta={{ href: '/spec/new', label: 'Record a spec call' }}
          secondaryCta={{ href: '/clients', label: 'Pick a client' }}
        />
      ) : (
        <JobsShell rows={rows} total={total} page={page} pageSize={PAGE_SIZE} />
      )}
    </div>
  )
}
