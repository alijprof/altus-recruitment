'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useOptimistic, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { formatDateLong, formatTimeAgo } from '@/lib/date'

import { inviteMemberAction, resendInviteAction, revokeInviteAction } from './actions'
import { inviteMemberSchema, type InviteMemberInput } from './schema'

// Quick task 260603-gdz (ONBOARD-4): optimistic invite UI. Send / resend /
// revoke reflect in the list immediately instead of waiting for a full server
// round-trip. All three optimistic operations share one useOptimistic store, so
// the invite dialog and the pending list must live in the same client
// component. On any server-action failure the optimistic state reverts (the
// real `initialInvites` prop is unchanged) AND a toast.error fires — never a
// silent false-success (CLAUDE.md mutation rule).

export type InviteView = {
  id: string
  email: string
  expires_at: string
  created_at: string
  inviterLabel: string
}

type OptimisticInvite = InviteView & { pending?: 'adding' | 'resending' }

type OptimisticAction =
  | { type: 'add'; invite: OptimisticInvite }
  | { type: 'remove'; id: string }
  | { type: 'resending'; id: string }

function reducer(state: OptimisticInvite[], action: OptimisticAction): OptimisticInvite[] {
  switch (action.type) {
    case 'add':
      return [action.invite, ...state]
    case 'remove':
      return state.filter((i) => i.id !== action.id)
    case 'resending':
      return state.map((i) => (i.id === action.id ? { ...i, pending: 'resending' } : i))
    default:
      return state
  }
}

export function TeamInvites({ initialInvites }: { initialInvites: InviteView[] }) {
  const [optimistic, addOptimistic] = useOptimistic<OptimisticInvite[], OptimisticAction>(
    initialInvites,
    reducer,
  )
  const [, startTransition] = useTransition()

  // Drop the optimistic "Sending…" ghost as soon as the real (revalidated) row
  // for the same email appears. inviteMemberAction calls revalidatePath BEFORE
  // it finishes sending the email, so without this the temp row (key
  // `optimistic-<email>`) and the real row (key = real UUID) would both render
  // for the duration of the email send. (WR-01)
  const realEmails = new Set(optimistic.filter((i) => i.pending !== 'adding').map((i) => i.email))
  const rows = optimistic.filter((i) => !(i.pending === 'adding' && realEmails.has(i.email)))

  function handleRevoke(id: string) {
    startTransition(async () => {
      addOptimistic({ type: 'remove', id })
      const result = await revokeInviteAction({ inviteId: id })
      if (result.ok) {
        toast.success('Invitation revoked')
        return
      }
      // Optimistic removal reverts when the transition settles (initialInvites
      // still holds the row). Surface the failure so it is never silent.
      toast.error('formError' in result ? result.formError : 'Could not revoke invitation.')
    })
  }

  function handleResend(id: string) {
    startTransition(async () => {
      addOptimistic({ type: 'resending', id })
      const result = await resendInviteAction({ inviteId: id })
      if (result.ok) {
        if (result.emailDelivered) {
          toast.success('Invitation resent')
        } else {
          toast.warning(
            'Invitation saved, but the email could not be sent. Check Resend is configured (RESEND_API_KEY) and NEXT_PUBLIC_SITE_URL is set.',
          )
        }
        return
      }
      toast.error('formError' in result ? result.formError : 'Could not resend invitation.')
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base font-semibold">Pending invitations</CardTitle>
          <CardDescription>
            Invitations awaiting acceptance. Links expire after 7 days.
          </CardDescription>
        </div>
        <InviteDialog addOptimistic={addOptimistic} startTransition={startTransition} />
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm font-normal">No pending invitations.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold">
                    {row.email}
                    {row.pending === 'adding' ? (
                      <Badge variant="secondary" className="font-normal">
                        Sending…
                      </Badge>
                    ) : row.pending === 'resending' ? (
                      <Badge variant="secondary" className="font-normal">
                        Resending…
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground truncate text-xs font-normal">
                    Invited by {row.inviterLabel} · {formatTimeAgo(row.created_at)}
                  </p>
                  <p className="text-muted-foreground text-xs font-normal">
                    Expires {formatDateLong(row.expires_at)}
                  </p>
                </div>
                {row.pending === 'adding' ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResend(row.id)}
                      disabled={row.pending === 'resending'}
                    >
                      Resend
                    </Button>
                    <RevokeButton email={row.email} onConfirm={() => handleRevoke(row.id)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function InviteDialog({
  addOptimistic,
  startTransition,
}: {
  addOptimistic: (action: OptimisticAction) => void
  startTransition: (cb: () => void) => void
}) {
  const [open, setOpen] = useState(false)
  const form = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = (data: InviteMemberInput) => {
    // Close + reset immediately; the optimistic row carries the feedback.
    setOpen(false)
    form.reset({ email: '' })
    startTransition(async () => {
      addOptimistic({
        type: 'add',
        invite: {
          id: `optimistic-${data.email}`,
          email: data.email,
          // A client-rendered placeholder; the real row (with server times)
          // replaces it once the action's revalidatePath refreshes the list.
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          inviterLabel: 'you',
          pending: 'adding',
        },
      })
      const result = await inviteMemberAction(data)
      if (result.ok) {
        // The DB row exists either way (the invite is real); only WARN if the
        // email itself couldn't be delivered, so we never show a misleading
        // "Invitation sent" when no email went out.
        if (result.emailDelivered) {
          toast.success('Invitation sent')
        } else {
          toast.warning(
            'Invitation saved, but the email could not be sent. Check Resend is configured (RESEND_API_KEY) and NEXT_PUBLIC_SITE_URL is set.',
          )
        }
        return
      }
      // The dialog already closed and the optimistic row reverts when the
      // transition settles — surface the reason as a toast so it is never a
      // silent failure (CLAUDE.md mutation rule). Client-side zod already
      // blocks malformed emails, so the server fieldError here is the
      // duplicate-pending case.
      if ('fieldErrors' in result) {
        const firstMessage = Object.values(result.fieldErrors).find(
          (messages) => messages && messages.length > 0,
        )?.[0]
        toast.error(firstMessage ?? 'Could not send the invitation.')
        return
      }
      toast.error(result.formError)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 md:h-10">Invite member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email with a sign-in link. The link is valid for 7 days.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" placeholder="name@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" className="h-11 md:h-10">
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeButton({ email, onConfirm }: { email: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
          <AlertDialogDescription>
            The invitation for <span className="font-medium">{email}</span> will be removed. They
            will no longer be able to join with the existing link.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
