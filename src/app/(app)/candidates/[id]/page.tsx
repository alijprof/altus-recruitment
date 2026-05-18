import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActivityTimeline, type ActivityEntry } from '@/components/app/activity-timeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDateLong, formatTimeAgo } from '@/lib/date'
import { listCandidateCVs } from '@/lib/db/candidate-cvs'
import { getCandidate, listCandidateActivities } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'

import { CandidateDetailHeader } from './candidate-detail-header'
import { CvReviewPanel } from './cv-review-panel'
import { CvUpload } from './cv-upload'
import { LogActivityForm } from './log-activity-form'

// Lookup tables for read-only display — labels match the create form schema
// (kept in sync with `src/app/(app)/candidates/new/schema.ts` enum labels).
const SOURCE_LABEL: Record<string, string> = {
  apply_form: 'Apply form',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  email_inbox: 'Email inbox',
  event: 'Event',
  direct_add: 'Direct add',
  other: 'Other',
}

const CONSENT_LABEL: Record<string, string> = {
  consent: 'Explicit consent',
  legitimate_interest: 'Legitimate interest',
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground text-xs font-normal">{label}</dt>
      <dd className="text-sm font-normal">{value || '—'}</dd>
    </div>
  )
}

function FieldGroup({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-card space-y-3 rounded-md border p-4">
      <h2 className="text-sm font-semibold">{heading}</h2>
      <Separator />
      <dl className="space-y-2.5">{children}</dl>
    </section>
  )
}

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // getCandidate writes the audit-log row internally per D-16 / CAND-06.
  // We pass the awaited id straight in; uuid format is enforced by Postgres,
  // so a malformed id produces a not_found code rather than crashing.
  const candidateResult = await getCandidate(supabase, id)
  if (!candidateResult.ok) {
    if (candidateResult.code === 'not_found') notFound()
    return (
      <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
        Couldn&apos;t load this candidate. Please refresh.
      </div>
    )
  }
  const candidate = candidateResult.data

  // CV rows — newest first. Best-effort; an error doesn't block the page.
  const cvsResult = await listCandidateCVs(supabase, id)
  const cvRows = cvsResult.ok ? cvsResult.data : []
  const latestCv = cvRows[0] ?? null
  const olderCvs = cvRows.slice(1)

  // Activities — best-effort. If this errors we still render the page so the
  // user can fix things rather than facing a 500.
  const activitiesResult = await listCandidateActivities(supabase, id)
  const activityEntries: ActivityEntry[] =
    activitiesResult.ok
      ? activitiesResult.data.map((a) => ({
          id: a.id,
          kind: a.kind,
          body: a.body,
          occurred_at: a.occurred_at,
          actor_user_id: a.actor_user_id,
          actor: a.actor ?? null,
          metadata: a.metadata ?? null,
        }))
      : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="link" asChild className="text-muted-foreground -ml-3 h-auto p-0 text-xs font-normal">
          <Link href="/candidates">← All candidates</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/candidates/${id}/edit`}>Edit</Link>
        </Button>
      </div>

      <CandidateDetailHeader candidate={candidate} />

      {/* UI-SPEC §2 two-column on desktop, stacked on mobile. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <LogActivityForm candidateId={candidate.id} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldGroup heading="Contact">
              <FieldRow
                label="Email"
                value={
                  candidate.email ? (
                    <span className="font-mono text-xs">{candidate.email}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <FieldRow
                label="Phone"
                value={
                  candidate.phone ? (
                    <span className="font-mono text-xs">{candidate.phone}</span>
                  ) : (
                    '—'
                  )
                }
              />
            </FieldGroup>

            <FieldGroup heading="Location">
              <FieldRow label="Location" value={candidate.location} />
            </FieldGroup>

            <FieldGroup heading="Employment">
              <FieldRow label="Current role" value={candidate.current_role_title} />
              <FieldRow label="Current company" value={candidate.current_company} />
              <FieldRow label="Source" value={SOURCE_LABEL[candidate.source] ?? candidate.source} />
              <FieldRow
                label="Last contacted"
                value={formatTimeAgo(candidate.last_contacted_at ?? null)}
              />
            </FieldGroup>

            <FieldGroup heading="Data & Consent">
              <FieldRow
                label="Basis"
                value={candidate.consent_basis ? CONSENT_LABEL[candidate.consent_basis] : '—'}
              />
              <FieldRow label="Captured" value={formatDateLong(candidate.consent_at)} />
              <FieldRow
                label="Version"
                value={
                  candidate.consent_text_version ? (
                    <span className="font-mono text-xs">{candidate.consent_text_version}</span>
                  ) : (
                    '—'
                  )
                }
              />
            </FieldGroup>
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Activity</h2>
            <ActivityTimeline entries={activityEntries} />
          </section>
        </div>

        {/* Side panel — CV upload + parse review + history. */}
        <aside className="space-y-4">
          <section className="bg-card space-y-3 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Upload CV</h2>
            <CvUpload candidateId={candidate.id} />
          </section>

          {latestCv ? (
            <CvReviewPanel
              candidateCv={latestCv}
              candidateFullName={candidate.full_name}
            />
          ) : null}

          {olderCvs.length > 0 ? (
            <section className="bg-card space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Previous CVs</h2>
              <ul className="space-y-2">
                {olderCvs.map((cv) => {
                  // Derive a human filename from the storage path. Path
                  // shape is `{org}/{candidate}/{uuid}-{slug}.{ext}` —
                  // strip up to the uuid prefix for readability.
                  const filename =
                    cv.storage_path.split('/').pop()?.replace(/^[0-9a-f-]{36}-/, '') ??
                    'CV'
                  const statusLabel =
                    cv.parsing_status === 'complete'
                      ? 'Parsed'
                      : cv.parsing_status === 'failed'
                        ? 'Failed'
                        : 'Pending'
                  return (
                    <li
                      key={cv.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span
                        className="text-muted-foreground truncate text-xs font-normal"
                        title={filename}
                      >
                        v{cv.version} · {filename}
                      </span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {statusLabel}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
