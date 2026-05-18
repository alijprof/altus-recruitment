'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo } from 'react'
import { Plus } from 'lucide-react'

import { ActivityTimeline, type ActivityEntry } from '@/components/app/activity-timeline'
import type { Json } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatTimeAgo } from '@/lib/date'
import type { ClientTimelineEntry } from '@/lib/db/clients'

import { ContactTable } from './contact-table'
import { LogNoteForm } from './log-note-form'

type ContactRow = {
  id: string
  full_name: string
  role_title: string | null
  email: string | null
  phone: string | null
  last_contacted_at: string | null
}

type JobRow = {
  id: string
  title: string
  status: string
  job_type: string
  hiring_context?: string
  created_at: string
}

const TAB_KEYS = ['contacts', 'jobs', 'activity', 'notes'] as const
type TabKey = (typeof TAB_KEYS)[number]

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value)
}

// Map the `client_activity_timeline` view rows to the shape Plan 1's shared
// polymorphic `<ActivityTimeline>` component expects. The view enriches each
// row with `entity_label` (company name / contact name / job title) which we
// surface via the metadata.label field so the timeline component renders it
// inline next to the kind label.
function toActivityEntries(rows: ClientTimelineEntry[]): ActivityEntry[] {
  return rows.map((row) => {
    // reason: ClientTimelineEntry.metadata is typed as Record<string, unknown>
    // because that's what the SQL view returns; ActivityEntry.metadata uses
    // the recursive Database['Json'] union. Both are JSON-serialisable; the
    // cast is at a stable boundary owned by Plan 3.
    const metadata = (
      row.entity_label
        ? { ...(row.metadata ?? {}), entity_label: row.entity_label }
        : (row.metadata ?? null)
    ) as unknown as Json
    // Review fix H3: populate actor so ActivityTimeline renders the human
    // name instead of "System" for every entry. The view's LEFT JOIN on
    // public.users (migration 20260518211530) exposes actor_full_name and
    // actor_email. Null actor_user_id (system entries) remains "System"
    // via the existing actorName() fallback inside ActivityTimeline.
    const actor =
      row.actor_user_id !== null
        ? { full_name: row.actor_full_name, email: row.actor_email }
        : null
    return {
      id: row.id,
      kind: row.kind,
      body: row.body,
      occurred_at: row.occurred_at,
      actor_user_id: row.actor_user_id,
      actor,
      metadata,
    }
  })
}

export type ClientManagementTabsProps = {
  clientId: string
  contacts: ContactRow[]
  jobs: JobRow[]
  timeline: ClientTimelineEntry[]
}

export function ClientManagementTabs(props: ClientManagementTabsProps) {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initialTab: TabKey = useMemo(() => (isTabKey(tabParam) ? tabParam : 'contacts'), [tabParam])

  return (
    <Tabs defaultValue={initialTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
        <TabsTrigger value="jobs">Jobs</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
      </TabsList>

      <TabsContent value="contacts" className="space-y-4">
        <div className="flex justify-end">
          <Button asChild>
            <Link href={`/clients/${props.clientId}/contacts/new`}>
              <Plus className="mr-1 size-4" />
              Add contact
            </Link>
          </Button>
        </div>
        <ContactTable rows={props.contacts} companyId={props.clientId} />
      </TabsContent>

      <TabsContent value="jobs" className="space-y-4">
        {props.jobs.length === 0 ? (
          <div className="bg-card rounded-md border p-10 text-center">
            <h3 className="text-sm font-semibold">No jobs yet</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Create a job against a client to start building your pipeline.
            </p>
            <Button asChild className="mt-4">
              <Link href={`/clients/${props.clientId}/jobs/new`}>
                <Plus className="mr-1 size-4" />
                Create job
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex justify-end">
              <Button asChild>
                <Link href={`/clients/${props.clientId}/jobs/new`}>
                  <Plus className="mr-1 size-4" />
                  Create job
                </Link>
              </Button>
            </div>
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground p-3 text-left text-xs font-normal">
                      Title
                    </th>
                    <th className="text-muted-foreground p-3 text-left text-xs font-normal">
                      Type
                    </th>
                    <th className="text-muted-foreground p-3 text-left text-xs font-normal">
                      Status
                    </th>
                    <th className="text-muted-foreground p-3 text-left text-xs font-normal">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {props.jobs.map((job) => (
                    <tr key={job.id} className="border-b last:border-b-0">
                      <td className="p-3 font-medium">
                        <Link href={`/jobs/${job.id}`} className="hover:underline">
                          {job.title}
                        </Link>
                      </td>
                      <td className="text-muted-foreground p-3">{job.job_type}</td>
                      <td className="text-muted-foreground p-3">{job.status}</td>
                      <td className="text-muted-foreground p-3">
                        {new Date(job.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </TabsContent>

      <TabsContent value="activity">
        <ActivityTimeline
          entries={toActivityEntries(props.timeline)}
          emptyHeading="No activity logged"
          emptyBody="Log a note or call to start tracking this relationship."
        />
      </TabsContent>

      <TabsContent value="notes" className="space-y-6">
        <LogNoteForm companyId={props.clientId} />
        <div>
          <h3 className="text-muted-foreground mb-3 text-xs font-normal uppercase tracking-wide">
            Notes
          </h3>
          <ol className="space-y-3">
            {props.timeline
              .filter((entry) => entry.kind === 'note' && entry.entity_type === 'company')
              .map((entry) => (
                <li key={entry.id} className="bg-card rounded-md border p-4">
                  <p className="text-muted-foreground mb-1 text-xs">
                    {formatTimeAgo(entry.occurred_at)}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
                </li>
              ))}
            {props.timeline.filter(
              (entry) => entry.kind === 'note' && entry.entity_type === 'company',
            ).length === 0 ? (
              <li className="text-muted-foreground text-sm">No notes yet.</li>
            ) : null}
          </ol>
        </div>
      </TabsContent>
    </Tabs>
  )
}
