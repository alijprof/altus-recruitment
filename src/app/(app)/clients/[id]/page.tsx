import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, ExternalLink } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { getClient, getClientTimeline } from '@/lib/db/clients'
import { listContactsForCompany } from '@/lib/db/contacts'
import { listJobsForCompany } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

import { ClientManagementTabs } from './client-management-tabs'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseClient()

  const clientResult = await getClient(supabase, id)
  if (!clientResult.ok) {
    if (clientResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive p-8">Couldn&apos;t load this client. Please refresh.</div>
    )
  }
  const client = clientResult.data

  // Pre-fetch all four tabs' data so the client component receives them as
  // props (Plan 3 chooses props-down over Suspense for simplicity).
  const [contactsResult, timelineResult, jobsResult] = await Promise.all([
    listContactsForCompany(supabase, id),
    getClientTimeline(supabase, id, 100),
    listJobsForCompany(supabase, id),
  ])

  const contacts = contactsResult.ok ? contactsResult.data : []
  const timeline = timelineResult.ok ? timelineResult.data : []
  // Plan 4 owns the Jobs tab content — see client-management-tabs.tsx.
  const jobs = jobsResult.ok ? jobsResult.data : []

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clients"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Clients
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
            {client.dormant ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-xs font-normal text-amber-700 dark:text-amber-300"
              >
                Dormant
              </Badge>
            ) : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {client.industry ? <span>{client.industry}</span> : null}
            {client.website ? (
              <a
                href={client.website}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground inline-flex items-center gap-1"
              >
                {client.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
          {client.notes ? (
            <p className="text-muted-foreground mt-2 max-w-prose text-sm whitespace-pre-wrap">
              {client.notes}
            </p>
          ) : null}
        </div>
      </header>

      <ClientManagementTabs
        clientId={id}
        contacts={contacts.map((c) => ({
          id: c.id,
          full_name: c.full_name,
          role_title: c.role_title,
          email: c.email,
          phone: c.phone,
          last_contacted_at: c.last_contacted_at,
        }))}
        jobs={jobs}
        timeline={timeline}
      />
    </div>
  )
}
