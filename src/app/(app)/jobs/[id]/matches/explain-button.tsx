'use client'

import { useRouter } from 'next/navigation'
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
// disabled during pending.
//
// Plan 07-07 Task 1: the server action already calls revalidatePath on
// every success path, but that only invalidates the Next.js cache — it does
// not tell THIS client to re-fetch. router.refresh() is the missing half
// (identical pattern to cv-review-panel.tsx's onAcceptAll), so the card
// upgrades in place instead of asking the recruiter to refresh manually.
// ---------------------------------------------------------------------------

export type ExplainButtonProps = {
  jobId: string
  candidateId: string
}

export function ExplainButton({ jobId, candidateId }: ExplainButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const onClick = () => {
    startTransition(async () => {
      const result = await explainCandidateMatchAction(jobId, candidateId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Match explained')
      router.refresh()
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
