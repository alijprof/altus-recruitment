'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

import { applyVoiceNoteAction, rejectVoiceNoteAction } from '../../actions'

// ---------------------------------------------------------------------------
// VoiceNoteProposal — mirrors the shape written by the Inngest pipeline.
// We re-declare it here so the client component doesn't import from
// server-only voice-notes.ts. The server page validates presence before
// rendering this form so we can assume the shape is valid.
// ---------------------------------------------------------------------------

type FieldChange = {
  field: 'current_role_title' | 'current_company' | 'market_status' | 'seniority_level'
  current_value: string | null
  proposed_value: string
}

type VoiceNoteProposal = {
  proposed_field_changes: FieldChange[]
  note_append: string | null
  activity_kind: 'note' | 'call' | 'meeting'
  activity_body: string
  action_items: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<FieldChange['field'], string> = {
  current_role_title: 'Current role title',
  current_company: 'Current company',
  market_status: 'Market status',
  seniority_level: 'Seniority level',
}

function fieldLabel(field: string): string {
  return FIELD_LABELS[field as FieldChange['field']] ?? field
}

const ACTIVITY_KIND_LABELS: Record<'note' | 'call' | 'meeting', string> = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  voiceNoteId: string
  candidateId: string
  // reason: received as Json from the page RSC; the Inngest pipeline writes
  // a known-shape object here; we validate array presence before rendering.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proposal: any
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceNoteReviewForm({ voiceNoteId, candidateId, proposal }: Props) {
  const router = useRouter()
  const [isApplying, startApplyTransition] = useTransition()
  const [isRejecting, startRejectTransition] = useTransition()

  // Parse the proposal at the client boundary.
  // If malformed, render a graceful error rather than crash.
  const parsedProposal: VoiceNoteProposal | null =
    proposal &&
    typeof proposal === 'object' &&
    Array.isArray(proposal.proposed_field_changes)
      ? (proposal as VoiceNoteProposal)
      : null

  // Track which field-change rows are checked (default: all checked).
  const initialChecked = new Set<string>(
    parsedProposal?.proposed_field_changes.map((c) => c.field) ?? [],
  )
  const [approvedFields, setApprovedFields] = useState<Set<string>>(initialChecked)
  const [approveNote, setApproveNote] = useState<boolean>(
    Boolean(parsedProposal?.note_append),
  )

  if (!parsedProposal) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
        <p className="font-medium">Voice note proposal is missing or malformed.</p>
        <p className="mt-1">
          The proposal data could not be read. Please try recording a new voice note.
        </p>
      </div>
    )
  }

  const {
    proposed_field_changes,
    note_append,
    activity_kind,
    activity_body,
    action_items,
  } = parsedProposal

  function toggleField(field: string, checked: boolean) {
    setApprovedFields((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(field)
      } else {
        next.delete(field)
      }
      return next
    })
  }

  // N = count of checked field-change rows (not counting the activity, which
  // is always applied if any approval proceeds — per UI-SPEC).
  const noteChecked = note_append ? approveNote : false
  const approvalCount = approvedFields.size + (noteChecked ? 1 : 0)

  const busy = isApplying || isRejecting

  function handleApply() {
    startApplyTransition(async () => {
      // reason: approvedFields items were added from proposed_field_changes.field
      // which is typed as FieldChange['field'] (the 4-item union). The Zod enum
      // on the server is the authoritative security gate; the cast here is safe.
      type AllowedField =
        | 'current_role_title'
        | 'current_company'
        | 'market_status'
        | 'seniority_level'
      const result = await applyVoiceNoteAction({
        voiceNoteId,
        candidateId,
        approvedFields: [...approvedFields] as AllowedField[],
        approveNote: noteChecked,
        // Activity always logs when any approval proceeds (per plan spec).
        approveActivity: approvalCount > 0,
      })
      if (!result.ok) {
        toast.error(result.error)
        return // do NOT navigate away on failure (CLAUDE.md mutation rule)
      }
      toast.success('Changes applied.')
      router.push(`/candidates/${candidateId}`)
      router.refresh()
    })
  }

  function handleRejectConfirmed() {
    startRejectTransition(async () => {
      const result = await rejectVoiceNoteAction({ voiceNoteId, candidateId })
      if (!result.ok) {
        toast.error(result.error)
        return // do NOT navigate away on failure
      }
      toast.success('Voice note rejected.')
      router.push(`/candidates/${candidateId}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* ---- Per-field checkbox table ---- */}
      {proposed_field_changes.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Proposed field changes</p>
          <div className="divide-y rounded-md border">
            {proposed_field_changes.map((change) => (
              <label
                key={change.field}
                className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/30"
              >
                <Checkbox
                  checked={approvedFields.has(change.field)}
                  onCheckedChange={(v) => toggleField(change.field, Boolean(v))}
                  disabled={busy}
                  aria-label={`Apply ${fieldLabel(change.field)} change`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold">{fieldLabel(change.field)}</span>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    <span className="line-through">{change.current_value ?? '—'}</span>
                    {' → '}
                    <span className="font-semibold text-foreground">{change.proposed_value}</span>
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No field changes proposed.</p>
      )}

      {/* ---- Note append checkbox ---- */}
      {note_append && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Append to notes</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30">
            <Checkbox
              checked={approveNote}
              onCheckedChange={(v) => setApproveNote(Boolean(v))}
              disabled={busy}
              aria-label="Append this text to candidate notes"
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <span className="text-sm font-semibold">Append to notes</span>
              <p className="text-muted-foreground mt-1 text-sm italic">&ldquo;{note_append}&rdquo;</p>
            </div>
          </label>
        </div>
      )}

      {/* ---- Activity summary (read-only, always logged on apply) ---- */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Activity to log</p>
        <div className="bg-muted/40 rounded-md border p-3" role="note">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ACTIVITY_KIND_LABELS[activity_kind]}
          </p>
          <p className="mt-1 text-sm">{activity_body}</p>
        </div>
        {action_items.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Action items</p>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {action_items.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ---- CTA row ---- */}
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
        {/* Reject all — AlertDialog confirmation per UI-SPEC */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:bg-destructive/5"
              disabled={busy}
            >
              {isRejecting ? 'Rejecting…' : 'Reject all'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this voice note?</AlertDialogTitle>
              <AlertDialogDescription>
                The proposed changes will be discarded. Your voice note transcript and audio will
                still be saved.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Keep reviewing</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRejectConfirmed}
                disabled={busy}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Reject all changes
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Apply N changes */}
        <Button
          type="button"
          onClick={handleApply}
          disabled={busy || approvalCount === 0}
          aria-label={
            approvalCount === 0 ? 'Select at least one change to apply' : undefined
          }
        >
          {isApplying
            ? 'Applying…'
            : `Apply ${approvalCount} change${approvalCount !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}
