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

import { deleteCompanyAction } from './actions'

export function ClientDeleteButton({
  companyId,
  companyName,
}: {
  companyId: string
  companyName: string
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteCompanyAction({ companyId })
      // Success redirects to /clients; only a failure returns. Keep the dialog
      // open and surface the error — never navigate on a failed mutation.
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
            <AlertDialogTitle>Delete {companyName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the client and all of its contacts — it can&apos;t be
              undone. A client that has any jobs can&apos;t be deleted here; delete or reassign
              its jobs first.
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
              {isPending ? 'Deleting…' : 'Delete client'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
