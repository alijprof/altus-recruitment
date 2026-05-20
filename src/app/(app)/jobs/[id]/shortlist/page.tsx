import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { getJob } from '@/lib/db/jobs'
import { listShortlistForJob } from '@/lib/db/shortlists'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { AddToShortlistDialog } from './add-to-shortlist-dialog'
import { ShortlistList } from './shortlist-list'

/**
 * Per-job shortlist tab (SHORT-01).
 *
 * The recruiter's "working set" for a job — candidates who could be
 * submitted but aren't yet in the formal pipeline. Filtered server-side on
 * application_type='shortlist'; the pipeline kanban filters on
 * application_type='standard' (D3-17), so the two views are mutually
 * exclusive.
 *
 * Promotion ("Convert to formal application") flips the row's
 * application_type to 'standard' via convertShortlistToApplicationAction,
 * after which the row drops out of this view and lands in the pipeline at
 * stage='applied'.
 */
export default async function JobShortlistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseClient()

  const jobResult = await getJob(supabase, id)
  if (!jobResult.ok) {
    if (jobResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">Couldn&apos;t load this job. Please refresh.</div>
    )
  }
  const job = jobResult.data

  const shortlistResult = await listShortlistForJob(supabase, id)
  const rows = shortlistResult.ok ? shortlistResult.data : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/jobs/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          {job.title}
        </Link>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/jobs/${id}`}>Applications</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${id}/pipeline`}>Pipeline</Link>
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{job.title} — Shortlist</h1>
        <p className="text-muted-foreground text-sm">
          Candidates you&apos;re considering for this role, kept off the formal
          pipeline. Promote to add them to the applied stage.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Shortlist ({rows.length})</h2>
          <AddToShortlistDialog jobId={id} />
        </div>
        <ShortlistList jobId={id} rows={rows} />
      </section>
    </div>
  )
}
