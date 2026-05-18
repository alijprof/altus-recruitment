import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { listApplicationsForJob } from '@/lib/db/applications'
import { getJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { AddCandidateForm } from './add-candidate-form'
import { ApplicationsList } from './applications-list'
import { JobDetailHeader } from './job-detail-header'

export default async function JobDetailPage({
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

  const applicationsResult = await listApplicationsForJob(supabase, id)
  const applications = applicationsResult.ok ? applicationsResult.data : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/jobs"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Jobs
        </Link>
        <Button asChild variant="outline">
          <Link href={`/jobs/${id}/pipeline`}>View pipeline</Link>
        </Button>
      </div>

      <JobDetailHeader job={job} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Applications</h2>
          <AddCandidateForm jobId={id} />
        </div>
        <ApplicationsList rows={applications} />
      </section>
    </div>
  )
}
