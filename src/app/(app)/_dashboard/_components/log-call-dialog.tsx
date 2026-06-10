'use client'

import { useState } from 'react'
import { Phone } from 'lucide-react'
import { toast } from 'sonner'

import { logActivityAction } from '@/app/(app)/candidates/[id]/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Plan 04-06 / Task 1 — REMIND-01 quick-action.
//
// Inline "Log call" trigger used by the FollowUpWidget row. Opens a lightweight
// Dialog that calls logActivityAction (kind='call') without navigating away
// from the dashboard.
//
// The trigger Button must stopPropagation — it sits inside the row Link so
// without this the click would also trigger the Link navigation (Surface 5 §UI-SPEC).
// ---------------------------------------------------------------------------

export type LogCallDialogProps = {
  candidateId: string
  candidateName: string
}

export function LogCallDialog({ candidateId, candidateName }: LogCallDialogProps) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [isPending, setIsPending] = useState(false)

  function handleTriggerClick(e: React.MouseEvent) {
    // Stop the click from bubbling to the parent row Link.
    e.stopPropagation()
    e.preventDefault()
    setOpen(true)
  }

  async function handleLogCall() {
    setIsPending(true)
    try {
      // logActivityAction requires a non-empty body. When notes are blank we
      // send a sensible default so the schema constraint is satisfied while
      // keeping the textarea optional in the UI (UI-SPEC Surface 5).
      const body = notes.trim() || 'Logged a call.'
      const result = await logActivityAction({ candidateId, kind: 'call', body })
      if (!result.ok) {
        toast.error(result.error)
        // Keep the dialog open on failure (CLAUDE.md mutation rule).
        return
      }
      toast.success('Call logged')
      setOpen(false)
      setNotes('')
    } catch {
      toast.error("Couldn't log the call. Please try again.")
    } finally {
      setIsPending(false)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && !isPending) {
      setOpen(false)
      setNotes('')
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleTriggerClick}
        aria-label={`Log call with ${candidateName}`}
      >
        <Phone className="mr-1.5 size-3.5" aria-hidden />
        Log call
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log call — {candidateName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`log-call-notes-${candidateId}`}>Call notes (optional)</Label>
            <Textarea
              id={`log-call-notes-${candidateId}`}
              rows={3}
              placeholder="Brief summary of what you discussed."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleLogCall} disabled={isPending}>
              {isPending ? 'Logging…' : 'Log call'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
