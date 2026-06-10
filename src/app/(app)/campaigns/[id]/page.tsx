import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getCampaignWithRecipients } from '@/lib/db/campaigns'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

import {
  CampaignRecipientTable,
  type RecipientRow,
} from '../new/_components/campaign-recipient-table'

// ---------------------------------------------------------------------------
// Campaign detail page (review fix CR-02).
//
// The campaigns list links every row to /campaigns/[id] — this page makes
// that link real. Read-only: campaign header + per-recipient send status,
// reusing getCampaignWithRecipients (RLS-scoped via the session client) and
// the wizard's CampaignRecipientTable.
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

function campaignStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    approved: 'Approved',
    sending: 'Sending',
    sent: 'Sent',
    failed: 'Failed',
  }
  return map[status] ?? status
}

function campaignStatusClasses(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-transparent'
    case 'sending':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-transparent'
    case 'sent':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent'
    case 'failed':
      return 'bg-destructive/10 text-destructive border-transparent'
    default:
      return ''
  }
}

function asRecipientStatus(status: string): RecipientRow['recipient_status'] {
  return status === 'sent' || status === 'failed' || status === 'failed_cap_exceeded'
    ? status
    : 'pending'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!uuidSchema.safeParse(id).success) notFound()

  const supabase = await createClient()
  const result = await getCampaignWithRecipients(supabase, id)
  if (!result.ok) {
    if (result.code === 'not_found') notFound()
    throw new Error('Failed to load campaign')
  }
  const campaign = result.data

  // Resolve candidate names + market status for the recipient table.
  // RLS scopes the read to the caller's org; the recipients FK cascades on
  // candidate delete, so every recipient has a live candidate row.
  const candidateIds = campaign.recipients.map((r) => r.candidate_id)
  const { data: candidates } =
    candidateIds.length > 0
      ? await supabase
          .from('candidates')
          .select('id, full_name, market_status')
          .in('id', candidateIds)
      : { data: [] }
  const candidatesById = new Map((candidates ?? []).map((c) => [c.id, c]))

  const rows: RecipientRow[] = campaign.recipients.map((r) => {
    const candidate = candidatesById.get(r.candidate_id)
    return {
      id: r.id,
      full_name: candidate?.full_name ?? r.email,
      email: r.email,
      market_status: candidate?.market_status ?? 'cold',
      recipient_status: asRecipientStatus(r.status),
    }
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button
        variant="link"
        asChild
        className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal"
      >
        <Link href="/campaigns">← Back to campaigns</Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          <p className="text-muted-foreground text-sm">
            Created {formatDate(campaign.created_at)}
            {campaign.sent_at ? ` · Sent ${formatDate(campaign.sent_at)}` : ''}
          </p>
        </div>
        <Badge
          variant={campaign.status === 'draft' ? 'secondary' : 'outline'}
          className={cn('font-normal', campaignStatusClasses(campaign.status))}
        >
          {campaignStatusLabel(campaign.status)}
        </Badge>
      </div>

      <dl className="grid grid-cols-3 gap-4 rounded-md border p-4 text-sm sm:max-w-md">
        <div>
          <dt className="text-muted-foreground">Recipients</dt>
          <dd className="font-medium tabular-nums">{campaign.recipient_count ?? rows.length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sent</dt>
          <dd className="font-medium tabular-nums">{campaign.sent_count}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Failed</dt>
          <dd className="font-medium tabular-nums">{campaign.failed_count}</dd>
        </div>
      </dl>

      <CampaignRecipientTable recipients={rows} showStatus />
    </div>
  )
}
