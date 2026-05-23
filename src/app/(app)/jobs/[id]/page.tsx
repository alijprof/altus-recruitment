import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { listApplicationsForJob } from '@/lib/db/applications'
import { listJobAdsForJob } from '@/lib/db/job-ads'
import { getJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { AdPanelTrigger } from './ad-panel/ad-panel-trigger'
import { SavedAdsList } from './ad-panel/saved-ads-list'
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

  // Plan 03-04 / Task D.3 — saved ads section (D3-33: multiple ads per job).
  const adsResult = await listJobAdsForJob(supabase, id)
  const ads = adsResult.ok ? adsResult.data : []

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
        <div className="flex gap-2">
          <AdPanelTrigger jobId={id} />
          <Button asChild variant="outline">
            <Link href={`/jobs/${id}/matches`}>Top matches</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${id}/shortlist`}>Shortlist</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${id}/pipeline`}>View pipeline</Link>
          </Button>
        </div>
      </div>

      <JobDetailHeader job={job} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Applications</h2>
          <AddCandidateForm jobId={id} />
        </div>
        <ApplicationsList rows={applications} jobId={id} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Saved ads</h2>
        <SavedAdsList ads={ads} />
      </section>
    </div>
  )
}
