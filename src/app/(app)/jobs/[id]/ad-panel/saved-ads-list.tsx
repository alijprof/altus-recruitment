import { Badge } from '@/components/ui/badge'
import type { JobAdRow } from '@/lib/db/job-ads'

import { SavedAdRowActions } from './saved-ad-row-actions'

// ---------------------------------------------------------------------------
// Plan 03-04 Task D.3 — saved-ads list. Server-rendered inside jobs/[id]/page.tsx
// using rows from listJobAdsForJob(). Newest first.
//
// UAT-260523-AD-SAVE-UX: full body render + per-row Copy / View full / Delete
// (mirrors application-row-actions.tsx). ScorePill and formatDate are kept.
// The previewBody helper is removed — the full markdown is now rendered in a
// scrollable div so the recruiter can read and select-to-copy inline.
// ---------------------------------------------------------------------------

function ScorePill({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return (
      <Badge variant="outline" className="text-xs">
        No score
      </Badge>
    )
  }
  const variant: 'default' | 'secondary' | 'destructive' =
    score >= 80 ? 'default' : score >= 60 ? 'secondary' : 'destructive'
  return (
    <Badge variant={variant} className="text-xs">
      Inclusivity {score}/100
    </Badge>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SavedAdsList({ ads, jobId }: { ads: readonly JobAdRow[]; jobId: string }) {
  if (ads.length === 0) {
    return (
      <div className="text-muted-foreground rounded border border-dashed p-4 text-xs">
        No saved ads yet. Click <span className="font-semibold">Generate ad</span>{' '}
        above to draft one.
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {ads.map((ad) => (
        <li key={ad.id} className="bg-card space-y-2 rounded-md border p-3">
          {/* Header row: score pill on the left, metadata + row-actions on the right */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ScorePill score={ad.inclusivity_score} />
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs font-normal tabular-nums">
                {formatDate(ad.created_at)} · {ad.model} · {ad.cost_pence}p
              </span>
              <SavedAdRowActions
                adId={ad.id}
                jobId={jobId}
                bodyMarkdown={ad.body_markdown}
                inclusivityScore={ad.inclusivity_score}
                inclusivitySuggestions={ad.inclusivity_suggestions}
              />
            </div>
          </div>
          {/* Full body — no max-height clamp; long ads scroll the page, not the row */}
          <div className="bg-muted/40 max-w-prose break-words rounded border p-3 text-sm leading-relaxed whitespace-pre-wrap">
            {ad.body_markdown}
          </div>
        </li>
      ))}
    </ul>
  )
}
