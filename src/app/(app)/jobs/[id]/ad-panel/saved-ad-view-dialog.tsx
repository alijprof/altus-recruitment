'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Read-only dialog for viewing a full saved ad.
// UAT-260523-AD-SAVE-UX: opened from the per-row '...' dropdown → View full.
// ---------------------------------------------------------------------------

type InclusivitySuggestion = {
  original: string
  improved: string
  reason: string
}

/** Narrow jsonb unknown → InclusivitySuggestion[]. Anything else → empty list. */
function narrowSuggestions(raw: unknown): InclusivitySuggestion[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is InclusivitySuggestion =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>)['original'] === 'string' &&
      typeof (item as Record<string, unknown>)['improved'] === 'string' &&
      typeof (item as Record<string, unknown>)['reason'] === 'string',
  )
}

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

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  bodyMarkdown: string
  inclusivityScore: number | null
  // reason: jsonb from job_ads is shaped as InclusivitySuggestion[] | null but
  // typed unknown on the row; narrowed inside this component.
  inclusivitySuggestions: unknown | null
}

export function SavedAdViewDialog({
  open,
  onOpenChange,
  bodyMarkdown,
  inclusivityScore,
  inclusivitySuggestions,
}: Props) {
  const suggestions = narrowSuggestions(inclusivitySuggestions)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Saved ad</DialogTitle>
          <DialogDescription>
            Read-only view. Use Copy ad from the row menu to send it elsewhere.
          </DialogDescription>
        </DialogHeader>

        {/* Score badge */}
        <div className="flex items-center gap-2">
          <ScorePill score={inclusivityScore} />
        </div>

        {/* Full ad body */}
        <div className="bg-muted/40 max-w-none break-words rounded border p-3 text-sm leading-relaxed whitespace-pre-wrap">
          {bodyMarkdown}
        </div>

        {/* Inclusivity suggestions (when present) */}
        {suggestions.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Inclusivity suggestions</h3>
            <ul className="space-y-3">
              {suggestions.map((s, i) => (
                <li key={i} className="space-y-1 text-sm">
                  <p>
                    <span className="line-through opacity-60">{s.original}</span>
                    {' → '}
                    <span className="font-medium">{s.improved}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">{s.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
