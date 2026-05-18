import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

type ConfidenceBadgeProps = {
  confidence: ConfidenceLevel
  field?: string
  className?: string
}

// Semantic color mapping per UI-SPEC §3 Confidence Badge spec.
// Tone is intentionally muted — the badge is a status hint, not a CTA.
const CONFIDENCE_CLASSES: Record<ConfidenceLevel, string> = {
  high:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/60',
  medium:
    'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/60',
  low: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200/60 dark:border-rose-900/60',
}

export function ConfidenceBadge({ confidence, field, className }: ConfidenceBadgeProps) {
  const label = field ? `${field} · ${confidence}` : confidence
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-normal',
        CONFIDENCE_CLASSES[confidence],
        className,
      )}
      aria-label={`Confidence ${confidence}${field ? ` for ${field}` : ''}`}
    >
      {label}
    </Badge>
  )
}
