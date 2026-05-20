import { Badge } from '@/components/ui/badge'
import type { JobAdRow } from '@/lib/db/job-ads'

// ---------------------------------------------------------------------------
// Plan 03-04 Task D.3 — saved-ads list. Server-rendered inside jobs/[id]/page.tsx
// using rows from listJobAdsForJob(). Newest first. Shows the inclusivity
// score badge, model + cost, created_at, and a preview of the markdown.
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

function previewBody(markdown: string): string {
  const trimmed = markdown.trim()
  if (trimmed.length <= 240) return trimmed
  return `${trimmed.slice(0, 240).trimEnd()}…`
}

export function SavedAdsList({ ads }: { ads: readonly JobAdRow[] }) {
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
        <li
          key={ad.id}
          className="bg-card space-y-2 rounded-md border p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ScorePill score={ad.inclusivity_score} />
            <span className="text-muted-foreground text-xs font-normal tabular-nums">
              {formatDate(ad.created_at)} · {ad.model} · {ad.cost_pence}p
            </span>
          </div>
          <pre className="bg-muted/40 max-h-40 overflow-y-auto rounded border p-2 text-xs font-normal whitespace-pre-wrap">
            {previewBody(ad.body_markdown)}
          </pre>
        </li>
      ))}
    </ul>
  )
}
