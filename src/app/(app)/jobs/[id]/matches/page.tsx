import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { isProfileEffectivelyEmpty } from '@/lib/ai/profile-completeness'
import { listMatchSummariesForJob } from '@/lib/db/ai-summaries'
import { listCandidatesByIds, type CandidateByIdRow } from '@/lib/db/candidates'
import {
  getJobEmbeddingVersion,
  getTopCandidatesForJob,
  listCandidateEmbeddingVersionsByIds,
} from '@/lib/db/embeddings'
import { getJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { MatchCard } from './match-card'
import { ScoreAllButton } from './score-all-button'

// Plan 2 Task 2.2 — top matches with Sonnet-generated explanations.
//
// Read order:
//   1. job header (404 if missing)
//   2. listMatchSummariesForJob — cached match_score rows for this job
//   3. getTopCandidatesForJob — top-10 by vector similarity
//   4. listCandidatesByIds — hydrate display fields for top-10
//
// For each top-10 row, look up the cached summary by candidate id (O(1)
// via a Map). When the cache has the row, render the full card. When it
// doesn't, render the "Not scored yet" placeholder + <ExplainButton>.
//
// D-16 carry-forward: no record_audit call here (list view).

const MATCH_LIMIT = 10

export default async function JobMatchesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseClient()

  const jobResult = await getJob(supabase, id)
  if (!jobResult.ok) {
    if (jobResult.code === 'not_found') notFound()
    return <div className="text-destructive p-8">Couldn&apos;t load this job. Please refresh.</div>
  }
  const job = jobResult.data

  // Phase 2 review C1 fix — `match_candidates_for_job` now requires an
  // explicit organization_id to defend against service-role RLS bypass.
  // Read from the session via the SECURITY DEFINER RPC.
  const orgRpc = await supabase.rpc('current_organization_id')
  const organizationId = typeof orgRpc.data === 'string' ? orgRpc.data : null
  if (!organizationId) {
    return (
      <div className="text-destructive p-8">
        Couldn&apos;t resolve your organisation. Please refresh.
      </div>
    )
  }

  // Run vector top-N and the cache fetch in parallel — they don't depend
  // on each other.
  const [topResult, summariesResult, jobVersionResult] = await Promise.all([
    getTopCandidatesForJob(supabase, {
      jobId: id,
      organizationId,
      limit: MATCH_LIMIT,
    }),
    listMatchSummariesForJob(supabase, { jobId: id, limit: MATCH_LIMIT * 4 }),
    getJobEmbeddingVersion(supabase, id),
  ])
  const matches = topResult.ok ? topResult.data : []
  const summaries = summariesResult.ok ? summariesResult.data : []
  const jobEmbeddingVersion = jobVersionResult.ok ? jobVersionResult.data : 0
  const errored = !topResult.ok

  // Hydrate the top-10 with candidate display fields + live embedding
  // versions (needed for staleness comparison vs the cached summary's
  // recorded versions). PRESERVE the vector order — neither helper
  // guarantees ordering.
  const candidateIds = matches.map((m) => m.id)
  const [candidatesResult, candidateVersionsResult] = await Promise.all([
    listCandidatesByIds(supabase, candidateIds),
    listCandidateEmbeddingVersionsByIds(supabase, candidateIds),
  ])
  const candidatesById = new Map<string, CandidateByIdRow>()
  if (candidatesResult.ok) {
    for (const c of candidatesResult.data) {
      candidatesById.set(c.id, c)
    }
  }
  const candidateVersions = candidateVersionsResult.ok
    ? candidateVersionsResult.data
    : new Map<string, number>()

  // Index summaries by candidate id. There may be more than one summary
  // per (candidate, job) pair when embedding versions have changed; pick
  // the freshest by created_at desc (already the listMatch order).
  const summaryByCandidate = new Map<string, (typeof summaries)[number]>()
  for (const s of summaries) {
    if (s.candidate_id && !summaryByCandidate.has(s.candidate_id)) {
      summaryByCandidate.set(s.candidate_id, s)
    }
  }

  // Plan 07-07 Task 2 — only offer "Score all" when there's something to
  // score. `matches.length === 0` already means "Not indexed yet" (or the
  // vector lookup errored, which also yields an empty array) — a scoring
  // button there would promise work that can't happen yet. Beyond that,
  // hide it once every visible card already carries a fresh (non-stale)
  // summary, using the SAME identity comparison as MatchCard's `isStale` so
  // the two never disagree; derived from data already fetched above, no
  // extra query.
  //
  // WR-04 (review 2026-08-11): candidates precompute REFUSES to score
  // (effectively-empty profiles, isProfileEffectivelyEmpty) must be excluded
  // from this calculation. Including them made `allCardsFresh` unreachable
  // whenever a job's top-10 contained one, so "Score all" showed forever and
  // every click was a guaranteed no-op on that card — permanent, on every
  // visit. Their card now says so explicitly (MatchCard's isUnscorable).
  const scorableMatches = matches.filter(
    (row) => !isProfileEffectivelyEmpty(candidatesById.get(row.id) ?? row),
  )
  const allCardsFresh =
    scorableMatches.length > 0 &&
    scorableMatches.every((row) => {
      const summary = summaryByCandidate.get(row.id)
      if (!summary) return false
      const candidateEmbeddingVersion = candidateVersions.get(row.id) ?? 0
      return (
        (summary.candidate_embedding_version ?? 0) === candidateEmbeddingVersion &&
        (summary.job_embedding_version ?? 0) === jobEmbeddingVersion
      )
    })
  const showScoreAll = scorableMatches.length > 0 && !allCardsFresh

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
        {showScoreAll ? <ScoreAllButton jobId={id} /> : null}
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Top matches</h1>
        <p className="text-muted-foreground text-sm font-normal">
          {job.title}
          {job.company_name ? <> · {job.company_name}</> : null}
        </p>
      </header>

      {errored ? (
        <div className="text-destructive border-destructive/40 bg-destructive/5 rounded-md border p-6 text-sm">
          Couldn&apos;t load matches. Please refresh.
        </div>
      ) : matches.length === 0 ? (
        <Alert>
          <AlertTitle>Not indexed yet</AlertTitle>
          <AlertDescription>
            This job hasn&apos;t been embedded yet. Matches will appear within ~30 seconds — refresh
            shortly.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4">
          {matches.map((row) => {
            const candidate = candidatesById.get(row.id) ?? {
              id: row.id,
              full_name: row.full_name,
              current_role_title: row.current_role_title,
              current_company: row.current_company,
              location: row.location,
              market_status: row.market_status,
              // HybridCandidateRow (the vector-match RPC's return shape)
              // doesn't carry these — this fallback only fires when the
              // candidate vanished between the vector lookup and the
              // listCandidatesByIds hydrate, an edge case where we can't
              // know true completeness anyway. Defaulting to "empty" is the
              // conservative choice for the SF-1 match-card badge.
              seniority_level: null,
              years_experience: null,
              skills: [],
              sector_tags: [],
            }
            const summary = summaryByCandidate.get(row.id) ?? null
            return (
              <MatchCard
                key={row.id}
                candidate={candidate}
                summary={summary}
                jobId={id}
                candidateEmbeddingVersion={candidateVersions.get(row.id) ?? 0}
                jobEmbeddingVersion={jobEmbeddingVersion}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
