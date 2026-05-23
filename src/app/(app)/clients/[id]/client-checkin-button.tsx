'use client'

import { Mail } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { SendCheckinModal } from '@/app/(app)/_dashboard/send-checkin-modal'

// Always-on check-in affordance on the client detail page header. The
// button is visible whether the client is dormant or not — the recruiter
// might want to drop a friendly note at any stage. When the client IS
// dormant, the button takes the filled "primary" variant so it draws the
// eye next to the amber Dormant badge.

type Props = {
  clientId: string
  clientName: string
  isDormant?: boolean
}

export function ClientCheckinButton({ clientId, clientName, isDormant = false }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size="sm"
        variant={isDormant ? 'default' : 'outline'}
        onClick={() => setOpen(true)}
      >
        <Mail className="size-4" aria-hidden />
        Send check-in
      </Button>
      <SendCheckinModal
        clientId={clientId}
        clientName={clientName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
