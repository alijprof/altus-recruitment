'use client'

import { useTransition } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { explainCandidateMatchAction } from './actions'

// ---------------------------------------------------------------------------
// Plan 2 Task 2.2 — ExplainButton.
//
// Renders inside each <MatchCard> when the cache is missing the row. Calls
// the synchronous explainCandidateMatchAction (3-6s typical wait, see W-1
// documented exception in actions.ts). useTransition keeps the button
// disabled during pending; the matches page revalidates on success so the
// card upgrades on the next render.
// ---------------------------------------------------------------------------

export type ExplainButtonProps = {
  jobId: string
  candidateId: string
}

export function ExplainButton({ jobId, candidateId }: ExplainButtonProps) {
  const [isPending, startTransition] = useTransition()

  const onClick = () => {
    startTransition(async () => {
      const result = await explainCandidateMatchAction(jobId, candidateId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Match explained — refresh to see details')
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      className="gap-2"
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Sparkles className="size-4" aria-hidden="true" />
      )}
      {isPending ? 'Scoring…' : 'Explain match'}
    </Button>
  )
}
