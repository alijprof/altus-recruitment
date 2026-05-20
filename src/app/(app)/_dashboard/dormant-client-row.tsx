'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DormantClient } from '@/lib/db/dormant-clients'

import { SendCheckinModal } from './send-checkin-modal'

// ---------------------------------------------------------------------------
// Plan 03-05 / Task E.2 — REPEAT-01 + D3-19.
//
// Client Component row for the dashboard "Dormant clients" widget. Opens
// the SendCheckinModal on button click; the modal handles the
// requestOutreachDraft → poll → sendOutreach flow.
// ---------------------------------------------------------------------------

export type DormantClientRowProps = {
  item: DormantClient
}

export function DormantClientRow({ item }: DormantClientRowProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="px-6 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/clients/${item.client_id}`}
            className="hover:underline text-sm font-semibold"
          >
            {item.client_name}
          </Link>
          <p className="text-muted-foreground text-xs font-normal">
            Last contact: {item.days_since} days ago
          </p>
          {item.last_placement_summary ? (
            <p className="text-muted-foreground mt-1 text-xs font-normal">
              {item.last_placement_summary}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {item.is_long_dormant ? (
            <Badge variant="destructive" className="font-normal">
              Long dormant
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Send check-in
          </Button>
        </div>
      </div>
      <SendCheckinModal
        clientId={item.client_id}
        clientName={item.client_name}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  )
}
