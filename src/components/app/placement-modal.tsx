'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { moveApplicationAction } from '@/app/(app)/jobs/[id]/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// UAT-260523-PLACEMENT-CAPTURE: Placement capture modal — the analogue of
// DeclineModal for the `placed` stage. Captures fee (£), placement date,
// placement type (perm / contract / temp / fixed_term), and optional notes.
//
// Intentionally NOT imported from decline-modal — the two components will
// evolve independently. Sharing a parent would couple future placement-specific
// fields (e.g. IR35 status, day rate) to the decline flow.
//
// Visual rule: the confirm button uses the default (primary) variant, NOT
// destructive. Placing a candidate is a celebratory event.

const PLACEMENT_TYPE_OPTIONS = [
  { value: 'perm', label: 'Perm' },
  { value: 'contract', label: 'Contract' },
  { value: 'temp', label: 'Temp' },
  { value: 'fixed_term', label: 'Fixed-term' },
] as const

type PlacementTypeValue = (typeof PLACEMENT_TYPE_OPTIONS)[number]['value']

export type PlacementModalProps = {
  applicationId: string
  candidateName: string
  jobId?: string | null
  /** Set when opened from the candidate detail page — drives a revalidate
   *  on /candidates/[id] so the row re-renders post-placement. */
  candidateId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPlaced?: (applicationId: string) => void
  onError?: (applicationId: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function PlacementModal({
  applicationId,
  candidateName,
  jobId,
  candidateId,
  open,
  onOpenChange,
  onPlaced,
  onError,
}: PlacementModalProps) {
  // feeGbp is a string so the user can type freely. Parsed to pence on submit.
  const [feeGbp, setFeeGbp] = useState('')
  const [placementDate, setPlacementDate] = useState(todayIso)
  const [placementType, setPlacementType] = useState<PlacementTypeValue | ''>('')
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setFeeGbp('')
    setPlacementDate(todayIso())
    setPlacementType('')
    setNotes('')
  }

  // Validation: fee must parse to a non-negative finite integer of pence.
  // Strip £, spaces and thousands separators first — bare parseFloat turns
  // "7,500" into 7 (£7 instead of £7,500). Then require a clean numeric
  // string with no trailing garbage so a value like "7500abc" is rejected
  // (returns null → disabled Confirm = the inline validation signal).
  function parsedFeePence(): number | null {
    const sanitised = feeGbp.replace(/[£\s,]/g, '')
    if (sanitised.length === 0) return null
    if (!/^\d+(\.\d{1,2})?$/.test(sanitised)) return null
    const parsed = Number(sanitised)
    if (!isFinite(parsed) || parsed < 0) return null
    return Math.round(parsed * 100)
  }

  const feePence = parsedFeePence()
  const canSubmit =
    feePence !== null &&
    placementDate.length > 0 &&
    placementType !== '' &&
    !isPending

  function handleConfirm() {
    if (!canSubmit || feePence === null || !placementType) return

    // Convert the local date (YYYY-MM-DD) to a UTC ISO 8601 timestamp.
    // Interpreting as midnight UTC is the correct anchor: the recruiter picks
    // the placement date without time-zone nuance; we store it as UTC midnight
    // so aggregations are consistent regardless of the server's TZ.
    const placementDateIso = new Date(placementDate + 'T00:00:00Z').toISOString()

    startTransition(async () => {
      const res = await moveApplicationAction({
        applicationId,
        toStage: 'placed',
        placementFeePence: feePence,
        placementDate: placementDateIso,
        placementType,
        placementCurrency: 'GBP',
        jobId: jobId ?? null,
        candidateId: candidateId ?? null,
      })

      if (!res.ok) {
        toast.error(res.error)
        onError?.(applicationId)
        return
      }

      toast.success('Placement recorded.')
      onPlaced?.(applicationId)
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
          <DialogTitle>Mark {candidateName} as placed</DialogTitle>
          <DialogDescription>
            This moves the application to the placed stage and writes a stage_change
            activity with the placement metadata. Fee revenue will appear in the
            source-attribution report once saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="placement-fee">Fee (£)</Label>
            <Input
              id="placement-fee"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 7500"
              value={feeGbp}
              onChange={(e) => setFeeGbp(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="placement-date">Placement date</Label>
            <Input
              id="placement-date"
              type="date"
              value={placementDate}
              onChange={(e) => setPlacementDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="placement-type">Type</Label>
            <Select
              value={placementType}
              onValueChange={(v) => setPlacementType(v as PlacementTypeValue)}
            >
              <SelectTrigger id="placement-type">
                <SelectValue placeholder="Select a type…" />
              </SelectTrigger>
              <SelectContent>
                {PLACEMENT_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="placement-notes">Notes (optional)</Label>
            <Textarea
              id="placement-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Any additional placement notes…"
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
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="h-11 md:h-10"
          >
            {isPending ? 'Saving…' : 'Confirm placement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
