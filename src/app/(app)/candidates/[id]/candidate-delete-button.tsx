'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

import { deleteCandidateAction } from './actions'

export function CandidateDeleteButton({
  candidateId,
  candidateName,
}: {
  candidateId: string
  candidateName: string
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteCandidateAction({ candidateId })
      // On success the action revalidates + redirects to /candidates, so no
      // value comes back. Only a failure returns — surface it and keep the
      // dialog open (never navigate away on a failed mutation).
      if (res && !res.ok) {
        toast.error(res.error)
      }
    })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Delete
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !isPending) setOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {candidateName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the candidate, their CVs, and AI summaries — it
              can&apos;t be undone. A candidate who is in a job pipeline or has placement
              history can&apos;t be deleted here; remove them from all jobs and floats first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isPending ? 'Deleting…' : 'Delete candidate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
