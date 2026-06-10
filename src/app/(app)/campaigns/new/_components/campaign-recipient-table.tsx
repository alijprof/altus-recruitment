'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Minus, AlertTriangle } from 'lucide-react'

import { MarketStatusBadge } from '@/components/app/market-status-badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Enums } from '@/types/database'

// ---------------------------------------------------------------------------
// Recipient shapes the wizard uses before and after send.
// Before send (preview): only name + market_status + last_active available.
// After send (progress): recipient_status column also populated.
// ---------------------------------------------------------------------------

export type RecipientRow = {
  id: string
  full_name: string
  email: string
  market_status: Enums<'market_status'>
  last_active?: string | null
  // Populated once sending begins
  recipient_status?: 'pending' | 'sent' | 'failed' | 'failed_cap_exceeded'
}

export type CampaignRecipientTableProps = {
  recipients: RecipientRow[]
  // Show the recipient_status column once sending has started
  showStatus?: boolean
}

const PAGE_SIZE = 20

function formatLastActive(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86_400)}d ago`
}

function RecipientStatusIcon({ status }: { status: RecipientRow['recipient_status'] }) {
  if (!status || status === 'pending') {
    return <Minus className="text-muted-foreground size-4" aria-label="Pending" />
  }
  if (status === 'sent') {
    return (
      <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" aria-label="Sent" />
    )
  }
  if (status === 'failed_cap_exceeded') {
    return (
      <span title="AI usage cap reached">
        <AlertTriangle
          className="size-4 text-amber-600 dark:text-amber-400"
          aria-label="AI usage cap reached"
        />
      </span>
    )
  }
  // failed
  return <XCircle className="size-4 text-destructive" aria-label="Failed" />
}

export function CampaignRecipientTable({
  recipients,
  showStatus = false,
}: CampaignRecipientTableProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const visible = recipients.slice(0, visibleCount)
  const hasMore = visibleCount < recipients.length

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Market status</TableHead>
            {/* Hidden at sm: breakpoint — mobile priority is Name + status */}
            <TableHead className="hidden sm:table-cell">Last active</TableHead>
            {showStatus ? <TableHead className="text-center">Status</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.full_name}</TableCell>
              <TableCell>
                <MarketStatusBadge status={r.market_status} />
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">
                {formatLastActive(r.last_active)}
              </TableCell>
              {showStatus ? (
                <TableCell className="text-center">
                  <RecipientStatusIcon status={r.recipient_status} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {recipients.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={showStatus ? 4 : 3}
                className="text-muted-foreground py-6 text-center text-sm"
              >
                No recipients
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {hasMore ? (
        <div className="border-t p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            Show more ({recipients.length - visibleCount} remaining)
          </Button>
        </div>
      ) : null}
    </div>
  )
}
