import Link from 'next/link'

import { Button } from '@/components/ui/button'
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
  // M-8: jobs can now be created directly via /jobs/new (the form has its own
  // client picker) as well as from a spec call. Empty-state primary CTA → the
  // form; the spec-call path stays as the AI-first secondary option.
  const isEmpty = total === 0

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <Button asChild className="h-11 md:h-10">
          <Link href="/jobs/new">New job</Link>
        </Button>
      </header>

      {isEmpty ? (
        <EmptyState
          heading="Add your first job"
          body="Create a job from scratch and assign it to a client — or record a spec call and we'll draft the JD for you."
          cta={{ href: '/jobs/new', label: 'Create a job' }}
          secondaryCta={{ href: '/spec/new', label: 'Record a spec call' }}
        />
      ) : (
        <JobsShell rows={rows} total={total} page={page} pageSize={PAGE_SIZE} />
      )}
    </div>
  )
}
