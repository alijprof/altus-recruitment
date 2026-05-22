import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActivityTimeline, type ActivityEntry } from '@/components/app/activity-timeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDateLong, formatTimeAgo } from '@/lib/date'
import { listApplicationsForCandidate } from '@/lib/db/applications'
import { listCandidateCVs } from '@/lib/db/candidate-cvs'
import { getCandidate, listCandidateActivities } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'

import { CandidateApplications } from './candidate-applications'
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

// Permissive parsers — work_experience / education are stored as jsonb so the
// generated type is `Json`. The capture path always writes the documented
// shape, but we accept partial entries defensively (any string field can be
// missing) so a malformed historical row doesn't blow up the page.
type WorkEntry = { title: string; company: string | null; dates: string | null }
type EducationEntry = { school: string; degree: string | null; dates: string | null }

function parseWorkExperience(raw: unknown): WorkEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): WorkEntry | null => {
      if (!r || typeof r !== 'object') return null
      const obj = r as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title : null
      if (!title) return null
      return {
        title,
        company: typeof obj.company === 'string' ? obj.company : null,
        dates: typeof obj.dates === 'string' ? obj.dates : null,
      }
    })
    .filter((e): e is WorkEntry => e !== null)
}

function parseEducation(raw: unknown): EducationEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): EducationEntry | null => {
      if (!r || typeof r !== 'object') return null
      const obj = r as Record<string, unknown>
      const school = typeof obj.school === 'string' ? obj.school : null
      if (!school) return null
      return {
        school,
        degree: typeof obj.degree === 'string' ? obj.degree : null,
        dates: typeof obj.dates === 'string' ? obj.dates : null,
      }
    })
    .filter((e): e is EducationEntry => e !== null)
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
  const workExperience = parseWorkExperience(candidate.work_experience)
  const education = parseEducation(candidate.education)

  // CV rows — newest first. Best-effort; an error doesn't block the page.
  const cvsResult = await listCandidateCVs(supabase, id)
  const cvRows = cvsResult.ok ? cvsResult.data : []
  const latestCv = cvRows[0] ?? null
  const olderCvs = cvRows.slice(1)

  // Applications across all jobs — best-effort. Drives the inline stage-
  // change section. If this errors we just hide the section.
  const applicationsResult = await listApplicationsForCandidate(supabase, id)
  const applications = applicationsResult.ok ? applicationsResult.data : []

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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/candidates/${id}/floats`}>Floats</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/candidates/${id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <CandidateDetailHeader candidate={candidate} />

      {/* UI-SPEC §2 two-column on desktop, stacked on mobile. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <LogActivityForm candidateId={candidate.id} />

          <CandidateApplications
            candidateId={candidate.id}
            applications={applications}
          />

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

          {candidate.headline ? (
            <section className="bg-card space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Headline</h2>
              <Separator />
              <p className="text-sm leading-relaxed">{candidate.headline}</p>
            </section>
          ) : null}

          {candidate.about ? (
            <section className="bg-card space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-semibold">About</h2>
              <Separator />
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {candidate.about}
              </p>
            </section>
          ) : null}

          {workExperience.length > 0 ? (
            <section className="bg-card space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Experience</h2>
              <Separator />
              <ul className="space-y-3">
                {workExperience.map((entry, i) => (
                  <li key={`exp-${i}`} className="space-y-0.5">
                    <p className="text-sm font-medium">{entry.title}</p>
                    {entry.company ? (
                      <p className="text-muted-foreground text-sm">{entry.company}</p>
                    ) : null}
                    {entry.dates ? (
                      <p className="text-muted-foreground text-xs">{entry.dates}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {education.length > 0 ? (
            <section className="bg-card space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Education</h2>
              <Separator />
              <ul className="space-y-3">
                {education.map((entry, i) => (
                  <li key={`edu-${i}`} className="space-y-0.5">
                    <p className="text-sm font-medium">{entry.school}</p>
                    {entry.degree ? (
                      <p className="text-muted-foreground text-sm">{entry.degree}</p>
                    ) : null}
                    {entry.dates ? (
                      <p className="text-muted-foreground text-xs">{entry.dates}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {candidate.skills && candidate.skills.length > 0 ? (
            <section className="bg-card space-y-3 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Skills</h2>
              <Separator />
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs font-normal">
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}

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
