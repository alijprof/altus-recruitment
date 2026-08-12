'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { generateBrandedCvAction } from './actions'

type BrandedCvGenerateButtonProps = {
  candidateId: string
  label: 'Generate' | 'Regenerate'
}

/**
 * Fires generateBrandedCvAction — a SYNCHRONOUS, zero-AI Server Action
 * (08-RESEARCH.md Pitfall 7: every OTHER multi-step candidate action in this
 * codebase is async because it calls Claude/Voyage/Whisper; this one calls
 * nothing external, so there is no polling UI, no "started" toast, no
 * Inngest event — unlike score-all-button.tsx's bounded poll). This control
 * never opens a document; it only mutates. No popup, no window.open — the
 * View/Download control (delivery route) lands in the next plan (08-08).
 *
 * The success toast says "done" because by the time the action resolves, it
 * is: router.refresh() re-fetches the RSC tree so BrandedCvPanel picks up
 * the new state on the very next paint.
 */
export function BrandedCvGenerateButton({ candidateId, label }: BrandedCvGenerateButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function onClick() {
    startTransition(async () => {
      try {
        const result = await generateBrandedCvAction({ candidateId })
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success('Branded CV generated')
        router.refresh()
      } catch (err) {
        console.error('generateBrandedCvAction failed:', err)
        toast.error('Couldn’t generate the branded CV. Please try again.')
      }
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
      {isPending ? 'Generating…' : label}
    </Button>
  )
}
