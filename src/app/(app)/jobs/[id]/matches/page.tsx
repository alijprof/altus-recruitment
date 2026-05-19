import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getTopCandidatesForJob } from '@/lib/db/embeddings'
import { getJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { MatchRow } from './match-row'

// Plan 1 Task 1.3 — vector-only candidate matches for a job (SEARCH-04
// minimum). Plan 2 will layer Sonnet-generated explanations on top of
// this list (strengths, gaps, screening questions). No audit row here —
// it's a list view (D-16 carry-forward).

const MATCH_LIMIT = 10

export default async function JobMatchesPage({
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
      <div className="text-destructive p-8">
        Couldn&apos;t load this job. Please refresh.
      </div>
    )
  }
  const job = jobResult.data

  const matchesResult = await getTopCandidatesForJob(supabase, {
    jobId: id,
    limit: MATCH_LIMIT,
  })
  const matches = matchesResult.ok ? matchesResult.data : []
  const errored = !matchesResult.ok

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/jobs/${id}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back to job
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Top matches</h1>
        <p className="text-muted-foreground text-sm font-normal">
          {job.title}
          {job.company_name ? <> · {job.company_name}</> : null}
        </p>
      </header>

      {errored ? (
        <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          Couldn&apos;t load matches. Please refresh.
        </div>
      ) : matches.length === 0 ? (
        <Alert>
          <AlertTitle>Not indexed yet</AlertTitle>
          <AlertDescription>
            This job hasn&apos;t been embedded yet. Matches will appear
            within ~30 seconds — refresh shortly.
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="rounded-md border bg-card">
          {matches.map((row) => (
            <MatchRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  )
}
