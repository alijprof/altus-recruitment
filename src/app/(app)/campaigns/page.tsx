import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EmptyState } from '@/components/app/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listCampaigns } from '@/lib/db/campaigns'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Campaign status badge colours — per UI-SPEC §Color "Campaign status colors".
// ---------------------------------------------------------------------------

type CampaignStatus = 'draft' | 'approved' | 'sending' | 'sent' | 'failed'

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
  switch (status as CampaignStatus) {
    case 'draft':
      return '' // default muted badge — no override
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function CampaignsPage() {
  const supabase = await createClient()
  const result = await listCampaigns(supabase)
  const campaigns = result.ok ? result.data : []

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            New campaign
          </Link>
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          heading="No campaigns yet"
          body="Build a segmented email campaign to reach candidates at the right moment."
          cta={{ href: '/campaigns/new', label: 'Create campaign' }}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="hover:underline"
                    >
                      {campaign.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={campaign.status === 'draft' ? 'secondary' : 'outline'}
                      className={cn('font-normal', campaignStatusClasses(campaign.status))}
                    >
                      {campaignStatusLabel(campaign.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.recipient_count ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.sent_count}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(campaign.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
