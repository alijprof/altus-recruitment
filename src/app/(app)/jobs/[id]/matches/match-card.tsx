import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'

import { MatchScoreBadge } from '@/components/app/match-score-badge'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { MatchSummaryRow } from '@/lib/db/ai-summaries'
import type { CandidateByIdRow } from '@/lib/db/candidates'

import { ExplainButton } from './explain-button'

// ---------------------------------------------------------------------------
// Plan 2 Task 2.2 — <MatchCard>. RSC card representation for a single
// (candidate, job) pair on /jobs/[id]/matches.
//
// Two visual states:
//   1. summary == null  → "Not scored yet" header + <ExplainButton>.
//   2. summary present  → score badge + strengths + gaps + screening
//      questions + AI-generated footer.
//
// When the summary is present but its embedding-version columns are
// behind the live versions, we render a yellow "Refreshing…" badge so
// the recruiter knows the card is stale; the next precompute run will
// replace it, OR the recruiter can hit Explain to force-refresh.
// ---------------------------------------------------------------------------

export type MatchCardProps = {
  candidate: CandidateByIdRow
  summary: MatchSummaryRow | null
  jobId: string
  candidateEmbeddingVersion: number
  jobEmbeddingVersion: number
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.round((now - then) / 1000))
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} h ago`
  const days = Math.round(diffSec / 86400)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function MatchCard({
  candidate,
  summary,
  jobId,
  candidateEmbeddingVersion,
  jobEmbeddingVersion,
}: MatchCardProps) {
  const isStale =
    summary !== null &&
    ((summary.candidate_embedding_version ?? 0) !== candidateEmbeddingVersion ||
      (summary.job_embedding_version ?? 0) !== jobEmbeddingVersion)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold">
              <Link href={`/candidates/${candidate.id}`} className="hover:underline">
                {candidate.full_name}
              </Link>
            </CardTitle>
            <div className="text-muted-foreground mt-1 truncate text-xs">
              {candidate.current_role_title ?? '—'}
              {candidate.current_company ? <> · {candidate.current_company}</> : null}
              {candidate.location ? <> · {candidate.location}</> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {summary ? (
              <MatchScoreBadge score={summary.content.score} />
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-xs font-normal">
                Not scored yet
              </Badge>
            )}
            {isStale ? (
              <Badge
                variant="outline"
                className="border-amber-200/60 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950 dark:text-amber-300 text-xs font-normal"
                title="The candidate or job has changed since this score was generated. Click Explain to refresh."
              >
                Refreshing…
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      {summary ? (
        <CardContent className="space-y-4">
          <section aria-label="Strengths">
            <h3 className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-wide">
              Strengths
            </h3>
            <ul className="space-y-1.5">
              {summary.content.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Gaps">
            <h3 className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-wide">
              Gaps
            </h3>
            {summary.content.gaps.length === 0 ? (
              <p className="text-muted-foreground text-sm">No significant gaps.</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.content.gaps.map((g, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Screening questions">
            <h3 className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-wide">
              Screening questions
            </h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {summary.content.screening_questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </section>
        </CardContent>
      ) : (
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This candidate is a strong vector match for the job but hasn&apos;t been scored
            yet. Click Explain to generate strengths, gaps, and screening questions.
          </p>
        </CardContent>
      )}

      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        {summary ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Sparkles className="size-3" aria-hidden="true" />
            <span>
              AI generated · {summary.content.confidence} confidence ·{' '}
              <time dateTime={summary.created_at}>
                {formatRelativeTime(summary.created_at)}
              </time>
            </span>
          </div>
        ) : (
          <span />
        )}
        {!summary || isStale ? (
          <ExplainButton jobId={jobId} candidateId={candidate.id} />
        ) : null}
      </CardFooter>
    </Card>
  )
}
