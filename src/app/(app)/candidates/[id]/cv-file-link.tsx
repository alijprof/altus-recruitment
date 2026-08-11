'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { getCvFileUrlAction } from './actions'

type CvFileLinkProps = {
  candidateCvId: string
  // Used for the hover tooltip only — the accessible name stays the literal
  // "View" text content (per plan's frozen smoke-assertion note in 07-08).
  filename: string
  downloadable: boolean
  // The shared disabled-state copy from cv-file-display.ts, shown as the
  // control's `title` when it can't be clicked.
  disabledReason: string
}

/**
 * The View control for a single candidate_cvs row (D-01, Plan 07-01). Calls
 * getCvFileUrlAction to mint a short-lived signed URL and opens it in a new
 * tab — never a silent failure (CLAUDE.md's mandatory error-handling rule):
 * a failed sign shows a toast, and the row's own state is untouched either
 * way (this control mutates nothing, so there's no form/data to roll back).
 *
 * When `downloadable` is false, the control renders disabled with the
 * shared reason as its title, and the click handler is never wired at all —
 * this is the client half of the same isCvFileDownloadable gate
 * getCvFileUrlAction enforces server-side.
 */
export function CvFileLink({ candidateCvId, filename, downloadable, disabledReason }: CvFileLinkProps) {
  const [isPending, startTransition] = useTransition()

  if (!downloadable) {
    return (
      <Button variant="outline" size="sm" disabled title={disabledReason}>
        View
      </Button>
    )
  }

  const onClick = () => {
    startTransition(async () => {
      const result = await getCvFileUrlAction({ candidateCvId })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={isPending} title={filename}>
      {isPending ? 'Opening…' : 'View'}
    </Button>
  )
}
