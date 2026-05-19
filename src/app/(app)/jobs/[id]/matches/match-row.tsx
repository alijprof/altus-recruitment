import Link from 'next/link'

import { MatchScoreBadge } from '@/components/app/match-score-badge'
import type { HybridCandidateRow } from '@/lib/db/embeddings'

// Plan 1 Task 1.3 — minimal MatchRow presentation.
//
// Kept deliberately simple so Plan 2 can swap in <MatchCard> (with Sonnet
// strengths / gaps / screening questions) without disrupting the rest of
// the page.

export type MatchRowProps = {
  row: HybridCandidateRow
}

export function MatchRow({ row }: MatchRowProps) {
  return (
    <li className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <Link
          href={`/candidates/${row.id}`}
          className="font-medium hover:underline"
        >
          {row.full_name}
        </Link>
        <div className="text-muted-foreground mt-0.5 truncate text-xs">
          {row.current_role_title ?? '—'}
          {row.current_company ? <> · {row.current_company}</> : null}
          {row.location ? <> · {row.location}</> : null}
        </div>
      </div>
      <MatchScoreBadge
        cosine={row.cosine_similarity}
        trigram={row.trigram_similarity}
        rrf={row.rrf_score}
      />
    </li>
  )
}
