'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DECLINE_REASONS, type DeclineReason } from '@/lib/legal/decline-reasons'

import { moveApplicationAction } from '@/app/(app)/jobs/[id]/actions'

// UI-SPEC §4 decline modal contract (D-10):
//   * Dialog title "Decline {candidateName}"
//   * Required Select for decline_reason — no default placeholder. Options
//     come from DECLINE_REASONS (the single source of truth per VERIFICATION
//     R1). The Select option `value` is the raw enum string.
//   * Optional Textarea for free-text notes.
//   * "Cancel" (outline) + "Decline candidate" (destructive). Confirm is
//     disabled until a reason is picked.
//   * On success: toast "Candidate declined.", dialog closes, parent's
//     onDeclined callback fires (so the kanban can drop the card).

export type DeclineModalProps = {
  applicationId: string
  candidateName: string
  jobId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeclined?: (applicationId: string) => void
  onError?: (applicationId: string) => void
}

export function DeclineModal({
  applicationId,
  candidateName,
  jobId,
  open,
  onOpenChange,
  onDeclined,
  onError,
}: DeclineModalProps) {
  const [reason, setReason] = useState<DeclineReason | ''>('')
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setReason('')
    setNotes('')
  }

  function handleConfirm() {
    if (!reason) return
    startTransition(async () => {
      const res = await moveApplicationAction({
        applicationId,
        toStage: 'rejected',
        declineReason: reason,
        declineNotes: notes.trim() ? notes.trim() : null,
        jobId: jobId ?? null,
      })
      if (!res.ok) {
        toast.error(res.error)
        onError?.(applicationId)
        return
      }
      toast.success('Candidate declined.')
      onDeclined?.(applicationId)
      reset()
      onOpenChange(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline {candidateName}</DialogTitle>
          <DialogDescription>
            This moves the application to the rejected stage and writes a stage_change
            activity. The candidate record is unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="decline-reason">Reason</Label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as DeclineReason)}
            >
              <SelectTrigger id="decline-reason">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {DECLINE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="decline-notes">Notes (optional)</Label>
            <Textarea
              id="decline-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Additional notes…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-11 md:h-10"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!reason || isPending}
            className="h-11 md:h-10"
          >
            {isPending ? 'Declining…' : 'Decline candidate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
