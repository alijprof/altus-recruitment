import { EmptyState } from '@/components/app/empty-state'
import { PipelineShell } from '@/app/(app)/jobs/[id]/pipeline/pipeline-shell'
import { listAllApplicationsByStage } from '@/lib/db/applications'
import { listOpenJobOptions } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { PipelineFilters } from './pipeline-filters'

// D-12: global pipeline reuses PipelineShell (same component tree as the
// per-job kanban). URL search params (`owner`, `job`, `client`) drive the
// three filters.

type PipelineSearchParams = {
  owner?: string
  job?: string
  client?: string
}

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null
}

export default async function GlobalPipelinePage({
  searchParams,
}: {
  searchParams: Promise<PipelineSearchParams>
}) {
  const params = await searchParams
  const supabase = await createSupabaseClient()

  const ownerId = nonEmpty(params.owner)
  const jobId = nonEmpty(params.job)
  const clientId = nonEmpty(params.client)

  const [byStageResult, ownersData, jobsResult, clientsData] = await Promise.all([
    listAllApplicationsByStage(supabase, { ownerId, jobId, clientId }),
    supabase.from('users').select('id, full_name, email').order('full_name', { ascending: true }),
    listOpenJobOptions(supabase),
    supabase.from('companies').select('id, name').order('name', { ascending: true }),
  ])

  if (!byStageResult.ok) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          Couldn&apos;t load the pipeline. Please refresh.
        </div>
      </div>
    )
  }

  const grouped = byStageResult.data
  const totalCards = Object.values(grouped).reduce((acc, list) => acc + list.length, 0)

  const owners = (ownersData.data ?? []).map((u) => ({
    id: u.id,
    label: u.full_name ?? u.email ?? 'Unnamed',
  }))
  const jobs = (jobsResult.ok ? jobsResult.data : []).map((j) => ({ id: j.id, label: j.title }))
  const clients = (clientsData.data ?? []).map((c) => ({ id: c.id, label: c.name }))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground text-sm">
            All open jobs across the agency. Drag to move between stages.
          </p>
        </div>
        <PipelineFilters owners={owners} jobs={jobs} clients={clients} />
      </header>

      {totalCards === 0 ? (
        <EmptyState
          heading="No candidates in pipeline"
          body={
            ownerId || jobId || clientId
              ? 'No applications match the active filters.'
              : 'Add candidates to your open jobs to start tracking them.'
          }
          cta={ownerId || jobId || clientId ? null : { href: '/jobs', label: 'View jobs' }}
        />
      ) : (
        // No jobId on the global view — moves still write activity rows
        // and revalidate /pipeline.
        <PipelineShell initial={grouped} jobId={null} />
      )}
    </div>
  )
}
