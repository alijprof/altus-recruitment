'use client'

import { Mail } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { SendCheckinModal } from '@/app/(app)/_dashboard/send-checkin-modal'

// Parity affordance for the client detail page header. Renders only when
// the page-level Dormant pill is present, so the recruiter can fire the
// same Sonnet-drafted check-in modal from here without bouncing back to
// the dashboard. Reuses the dashboard's SendCheckinModal verbatim — same
// requestOutreachDraft → poll → sendOutreach flow.

type Props = {
  clientId: string
  clientName: string
}

export function ClientCheckinButton({ clientId, clientName }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
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
