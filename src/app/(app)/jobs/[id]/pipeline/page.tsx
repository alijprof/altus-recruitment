import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { EmptyState } from '@/components/app/empty-state'
import { listApplicationsByStage } from '@/lib/db/applications'
import { getJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { PipelineShell } from './pipeline-shell'

export default async function JobPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseClient()

  const [jobResult, byStageResult] = await Promise.all([
    getJob(supabase, id),
    listApplicationsByStage(supabase, id),
  ])

  if (!jobResult.ok) {
    if (jobResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">Couldn&apos;t load this job. Please refresh.</div>
    )
  }

  const job = jobResult.data
  if (!byStageResult.ok) {
    return (
      <div className="text-destructive p-8">
        Couldn&apos;t load the pipeline. Please refresh.
      </div>
    )
  }
  const grouped = byStageResult.data
  const totalCards = Object.values(grouped).reduce((acc, list) => acc + list.length, 0)

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
      </div>

      <header>
        <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-muted-foreground text-sm">
          Drag candidates between stages. Stage changes are auto-logged.
        </p>
      </header>

      {totalCards === 0 ? (
        <EmptyState
          heading="No candidates in pipeline"
          body="Add candidates to this job to start tracking them."
          cta={{ href: `/jobs/${id}`, label: 'Add candidate to job' }}
        />
      ) : (
        <PipelineShell initial={grouped} jobId={id} />
      )}
    </div>
  )
}
