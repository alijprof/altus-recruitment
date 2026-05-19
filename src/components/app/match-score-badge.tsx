import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// MatchScoreBadge — Plan 1 Task 1.2 (cosine mode) + Plan 2 Task 2.2 (score
// mode).
//
// Two variants, picked by which prop the caller passes:
//   * `cosine` / `trigram` / `rrf` (Plan 1, used by /search + /matches
//     vector-only fallback) → percent of cosine similarity.
//   * `score` (Plan 2, used by match-card.tsx) → Sonnet 0-100 score.
//
// Tone bands per mode follow UI-SPEC §3 confidence-badge convention.
// ---------------------------------------------------------------------------

export type MatchScoreBadgeProps =
  | {
      // Plan 1 cosine-mode (vector-only fallback).
      cosine: number
      trigram: number
      rrf: number
      score?: never
      className?: string
    }
  | {
      // Plan 2 Sonnet-score mode. Pass `score` only — cosine/trigram/rrf
      // would render as Plan 1 mode and confuse the reader.
      score: number
      cosine?: never
      trigram?: never
      rrf?: never
      className?: string
    }

type Tone = 'high' | 'medium' | 'low' | 'weak'

function bucketCosine(cosine: number): Tone {
  if (cosine >= 0.7) return 'high'
  if (cosine >= 0.5) return 'medium'
  return 'low'
}

function bucketScore(score: number): Tone {
  // Plan 2 thresholds per RESEARCH §B.7 ("90+ = strong, 70-89 = good,
  // 50-69 = mixed, < 50 = weak"). The badge groups 70-89 + 90+ as
  // "high" to keep three colour bands visually distinct.
  if (score >= 80) return 'high'
  if (score >= 60) return 'medium'
  if (score >= 40) return 'low'
  return 'weak'
}

const TONE_CLASSES: Record<Tone, string> = {
  high: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/60',
  medium:
    'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/60',
  low: 'bg-muted text-muted-foreground border-border',
  weak: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200/60 dark:border-rose-900/60',
}

export function MatchScoreBadge(props: MatchScoreBadgeProps) {
  // Plan 2 — Sonnet score mode.
  if (props.score !== undefined) {
    const { score, className } = props
    const tone = bucketScore(score)
    const title = `AI match score: ${score} / 100`
    return (
      <Badge
        variant="outline"
        title={title}
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-normal tabular-nums',
          TONE_CLASSES[tone],
          className,
        )}
        aria-label={`Match score ${score} out of 100`}
      >
        {score}
      </Badge>
    )
  }

  // Plan 1 — cosine mode (vector-only fallback).
  const { cosine, trigram, rrf, className } = props
  const tone = bucketCosine(cosine)
  const pct = Math.round(cosine * 100)
  const title = `Cosine: ${cosine.toFixed(2)} / Trigram: ${trigram.toFixed(2)} / RRF: ${rrf.toFixed(4)}`
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-normal tabular-nums',
        TONE_CLASSES[tone],
        className,
      )}
      aria-label={`Match score ${pct} percent — ${title}`}
    >
      {pct}%
    </Badge>
  )
}
