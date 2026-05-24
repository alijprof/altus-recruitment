'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { resendInviteAction } from './actions'

export function ResendInviteButton({ inviteId }: { inviteId: string }) {
  const [isPending, startTransition] = useTransition()

  const onClick = () => {
    startTransition(async () => {
      const result = await resendInviteAction({ inviteId })
      if (result.ok) {
        toast.success('Invitation resent')
        return
      }
      if ('formError' in result) {
        toast.error(result.formError)
        return
      }
      toast.error('Could not resend invitation.')
    })
  }

  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={isPending}>
      {isPending ? 'Sending…' : 'Resend'}
    </Button>
  )
}
