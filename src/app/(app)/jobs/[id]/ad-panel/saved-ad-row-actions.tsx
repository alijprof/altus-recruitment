'use client'

import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { deleteJobAdAction } from './actions'
import { SavedAdViewDialog } from './saved-ad-view-dialog'

// ---------------------------------------------------------------------------
// Per-row '...' client island for the saved-ads list on /jobs/[id].
// UAT-260523-AD-SAVE-UX: Copy ad / View full / Delete.
// Mirrors application-row-actions.tsx: only this component is a Client
// Component; SavedAdsList (the list shell) stays a Server Component.
// ---------------------------------------------------------------------------

type Props = {
  adId: string
  jobId: string
  bodyMarkdown: string
  inclusivityScore: number | null
  // reason: jsonb from job_ads is shaped as InclusivitySuggestion[] | null but
  // typed unknown on the row; the View dialog narrows it at the boundary.
  inclusivitySuggestions: unknown | null
}

export function SavedAdRowActions({
  adId,
  jobId,
  bodyMarkdown,
  inclusivityScore,
  inclusivitySuggestions,
}: Props) {
  const router = useRouter()
  const [viewOpen, setViewOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) {
        toast.error('Could not copy. Try selecting the text manually.')
        return
      }
      await navigator.clipboard.writeText(bodyMarkdown)
      toast.success('Copied to clipboard.')
    } catch {
      toast.error('Could not copy. Try selecting the text manually.')
    }
  }

  const handleDelete = () => {
    if (!window.confirm('Delete this saved ad? This cannot be undone.')) return
    startTransition(async () => {
      const res = await deleteJobAdAction({ adId, jobId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Saved ad deleted.')
      router.refresh()
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Actions for saved ad"
            disabled={isPending}
            className="h-8 w-8"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={handleCopy}>Copy ad</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setViewOpen(true)}>View full</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SavedAdViewDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        bodyMarkdown={bodyMarkdown}
        inclusivityScore={inclusivityScore}
        inclusivitySuggestions={inclusivitySuggestions}
      />
    </>
  )
}
