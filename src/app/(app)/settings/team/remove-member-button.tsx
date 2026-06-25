'use client'

// Batch B item 5 — owner-only "Remove" control for a team member.
//
// Rendered per member row in the (server) Team page, for every member EXCEPT
// the current user (self-removal is blocked in the action too). Confirm via
// AlertDialog, then call removeMemberAction. Follows the CLAUDE.md mutation
// rule: surface failures via toast, never a silent success.

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

import { removeMemberAction } from './actions'

export function RemoveMemberButton({ userId, label }: { userId: string; label: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRemove() {
    startTransition(async () => {
      const result = await removeMemberAction({ userId })
      if (result.ok) {
        toast.success(`Removed ${label}`)
        // The action revalidates /settings/team; refresh so the row drops out
        // immediately without a manual reload.
        router.refresh()
        return
      }
      toast.error(result.formError)
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          className="text-destructive hover:text-destructive"
        >
          {isPending ? 'Removing…' : 'Remove'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove teammate?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium">{label}</span> will lose access immediately and be signed
            out. Their work — candidates, jobs, drafts and campaigns — stays in your organisation.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              handleRemove()
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
