import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// MatchScoreBadge — Plan 1 Task 1.2.
//
// Surfaces the most intuitive score (cosine similarity, 0..1) as a percent.
// Hover/title reveals the full RRF breakdown: cosine, trigram, rrf. Color
// follows UI-SPEC §3 confidence-badge tone:
//   * ≥ 0.7 → green
//   * 0.5..0.69 → amber
//   * < 0.5 → neutral
// ---------------------------------------------------------------------------

export type MatchScoreBadgeProps = {
  cosine: number
  trigram: number
  rrf: number
  className?: string
}

function bucket(cosine: number): 'high' | 'medium' | 'low' {
  if (cosine >= 0.7) return 'high'
  if (cosine >= 0.5) return 'medium'
  return 'low'
}

const BUCKET_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/60',
  medium:
    'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/60',
  low: 'bg-muted text-muted-foreground border-border',
}

export function MatchScoreBadge({ cosine, trigram, rrf, className }: MatchScoreBadgeProps) {
  const tone = bucket(cosine)
  const pct = Math.round(cosine * 100)
  // Native title attribute = lightweight tooltip; avoids pulling in a new
  // Radix dep solely for this badge. shadcn doesn't currently ship a
  // Tooltip component in this codebase.
  const title = `Cosine: ${cosine.toFixed(2)} / Trigram: ${trigram.toFixed(2)} / RRF: ${rrf.toFixed(4)}`
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-normal tabular-nums',
        BUCKET_CLASSES[tone],
        className,
      )}
      aria-label={`Match score ${pct} percent — ${title}`}
    >
      {pct}%
    </Badge>
  )
}
