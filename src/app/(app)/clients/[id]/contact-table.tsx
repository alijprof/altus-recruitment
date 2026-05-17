'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { deleteContactAction } from './actions'

type ContactRow = {
  id: string
  full_name: string
  role_title: string | null
  email: string | null
  phone: string | null
  last_contacted_at: string | null
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function ContactTable({
  rows,
  companyId,
}: {
  rows: ContactRow[]
  companyId: string
}) {
  const [pendingDelete, setPendingDelete] = useState<ContactRow | null>(null)
  const [isPending, startTransition] = useTransition()

  function confirmDelete() {
    if (!pendingDelete) return
    const target = pendingDelete
    startTransition(async () => {
      const result = await deleteContactAction(companyId, target.id)
      if (!result.ok) {
        toast.error(result.formError)
        return
      }
      toast.success('Contact deleted.')
      setPendingDelete(null)
    })
  }

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-md border p-10 text-center">
        <h3 className="text-sm font-semibold">No contacts yet</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Add a contact to track who you work with at this client.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/clients/${companyId}/contacts/new`}>Add contact</Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground text-xs font-normal">Name</TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">Role</TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">Email</TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">Phone</TableHead>
              <TableHead className="text-muted-foreground text-xs font-normal">
                Last contacted
              </TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.full_name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.role_title ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.email ? (
                    <a className="hover:text-foreground" href={`mailto:${row.email}`}>
                      {row.email}
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.phone ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(row.last_contacted_at)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${row.full_name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/clients/${companyId}/contacts/${row.id}/edit`}>
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={(e) => {
                          e.preventDefault()
                          setPendingDelete(row)
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.full_name ?? 'this contact'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Past activity entries for this contact are preserved
              for audit, but the contact will no longer appear in this client&apos;s contacts
              list.
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
              {isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
