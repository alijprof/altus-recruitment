import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// create-job-from-spec — Plan 03-02 Task B.3.
//
// Triggered by approveSpecDraftAction's `spec-draft/approved` event.
// Reads the approved spec_drafts row, inserts a jobs row from the structured
// JD payload, then patches spec_drafts.created_job_id so the recruiter can
// see the link.
//
// HARD RULE 4 (tenant boundary): assert the spec_drafts row's
// organization_id matches the event payload BEFORE any further reads.
// Service-role bypasses RLS — this is the only thing that catches a forged
// event payload.
//
// Pattern per PATTERNS §2 (mirror embed-job-on-jd-change.ts shape).
// ---------------------------------------------------------------------------

type SpecDraftApprovedEventData = {
  organization_id: string
  spec_draft_id: string
  user_id: string | null
}

function asEventData(value: unknown): SpecDraftApprovedEventData {
  return value as SpecDraftApprovedEventData
}

type SpecJd = {
  title?: string
  seniority_level?: string | null
  job_type?: 'perm' | 'contract' | 'temp' | null
  location?: string | null
  salary_range_min?: number | null
  salary_range_max?: number | null
  currency?: string | null
  must_haves?: string[]
  nice_to_haves?: string[]
  culture_notes?: string | null
  reporting_line?: string | null
  urgency?: string | null
  hiring_context?: 'new_role' | 'backfill' | null
}

// Compose a plain-text description from the structured fields. The jobs.description
// column is the canonical text used for embedding + display; this is the
// minimum viable rendering until Plan 03-04 (job ads) generates a richer body.
function composeDescription(jd: SpecJd, recruiterNotes: string[] = []): string {
  const parts: string[] = []
  if (jd.must_haves && jd.must_haves.length > 0) {
    parts.push(`Must-haves:\n- ${jd.must_haves.filter(Boolean).join('\n- ')}`)
  }
  if (jd.nice_to_haves && jd.nice_to_haves.length > 0) {
    parts.push(`Nice-to-haves:\n- ${jd.nice_to_haves.filter(Boolean).join('\n- ')}`)
  }
  if (jd.culture_notes) parts.push(`Culture:\n${jd.culture_notes}`)
  if (jd.reporting_line) parts.push(`Reporting line: ${jd.reporting_line}`)
  if (jd.urgency) parts.push(`Urgency: ${jd.urgency}`)
  parts.push(...recruiterNotes)
  return parts.join('\n\n')
}

export const createJobFromSpec = inngest.createFunction(
  {
    id: 'create-job-from-spec',
    triggers: [{ event: 'spec-draft/approved' }],
    // Light single-write function; concurrency cap matches embed-job-on-jd-change.
    concurrency: { limit: 5, key: 'event.data.organization_id' },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const original = asEventData(event.data.event.data)
      const status = readStatus(error)
      Sentry.captureException(
        new Error(`${error.name}: ${status} (onFailure handler)`),
        {
          tags: {
            phase: 'p3',
            layer: 'inngest',
            function: 'create-job-from-spec',
            handler: 'onFailure',
            spec_draft_id: original.spec_draft_id,
          },
        },
      )
    },
  },
  async ({ event, step }) => {
    const { organization_id, spec_draft_id, user_id } = asEventData(event.data)

    const draft = await step.run('read-draft', async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('spec_drafts')
        .select(
          'id, organization_id, created_by, company_id, structured_data, status, created_job_id',
        )
        .eq('id', spec_draft_id)
        .maybeSingle()
      if (error) {
        throw new Error(`read-draft: ${error.message}`)
      }
      if (!data) {
        throw new NonRetriableError('spec-draft:not-found')
      }
      // HARD RULE 4: assert before reading any payload field.
      if (data.organization_id !== organization_id) {
        throw new NonRetriableError('cross-tenant-spec-draft')
      }
      return data
    })

    if (draft.status !== 'approved') {
      // Defensive — approve action sets status to 'approved' before sending
      // the event, so this should never fire. Skip silently to avoid
      // creating duplicate jobs if the event is delivered twice.
      return { skipped: 'status-not-approved' }
    }

    if (draft.created_job_id) {
      // Idempotency — a prior delivery of the same event already created
      // the job. Skip without throwing so re-deliveries are no-ops.
      return { skipped: 'already-created', job_id: draft.created_job_id }
    }

    const jd = (draft.structured_data ?? {}) as SpecJd

    if (!jd.title || jd.title.trim().length === 0) {
      throw new NonRetriableError('spec-draft:missing-title')
    }

    if (!draft.company_id) {
      // Surface this through the spec_drafts row so the recruiter sees it
      // on /spec/[id]/review. The recruiter should pick a client before
      // approving — UI hint to be added in a follow-up plan when the
      // client picker lands on the review page.
      const supabase = createServiceClient()
      await supabase
        .from('spec_drafts')
        .update({
          status: 'failed',
          parse_error: 'Pick a client before approving — jobs require a company.',
        })
        .eq('id', spec_draft_id)
        .eq('organization_id', organization_id)
      throw new NonRetriableError('spec-draft:missing-company')
    }

    // Narrow company_id past the early-return guard. TypeScript can't
    // trace the discriminant through step.run's async boundary.
    const companyId = draft.company_id
    const title = jd.title.trim()
    const newJob = await step.run('insert-job', async () => {
      const supabase = createServiceClient()
      const payload: {
        organization_id: string
        company_id: string
        title: string
        location: string | null
        job_type: 'perm' | 'contract' | 'temp'
        hiring_context: 'new_role' | 'backfill'
        status: 'open'
        description: string
        salary_min: number | null
        salary_max: number | null
        currency: string
        created_by: string
        owner_user_id: string
      } = {
        organization_id,
        company_id: companyId,
        title,
        location: jd.location ?? null,
        job_type: jd.job_type ?? 'perm',
        hiring_context: jd.hiring_context ?? 'new_role',
        status: 'open' as const,
        description: composeDescription(jd),
        salary_min: jd.salary_range_min ?? null,
        salary_max: jd.salary_range_max ?? null,
        currency: jd.currency ?? 'GBP',
        created_by: draft.created_by,
        owner_user_id: draft.created_by,
      }
      const { data, error } = await supabase
        .from('jobs')
        .insert(payload)
        .select('id')
        .single()
      if (error) {
        throw new Error(`insert-job: ${error.message}`)
      }
      return data
    })

    await step.run('patch-draft-job-id', async () => {
      const supabase = createServiceClient()
      const { error } = await supabase
        .from('spec_drafts')
        .update({ created_job_id: newJob.id })
        .eq('id', spec_draft_id)
        .eq('organization_id', organization_id)
      if (error) {
        throw new Error(`patch-draft-job-id: ${error.message}`)
      }
    })

    // Fire `job/embed` so embed-job-on-jd-change picks it up. The embed
    // function listens for `job/embed` (NOT `jobs/jd-changed`, which nothing
    // consumes) — same event the two real job-creation paths emit. Without
    // this the spec-approved job is never embedded or match-scored.
    // The new job has a fresh description from the structured fields and
    // must be embedded for semantic search.
    try {
      await inngest.send({
        name: 'job/embed',
        data: {
          organization_id,
          job_id: newJob.id,
          user_id,
        },
      })
    } catch (sendErr) {
      const name = sendErr instanceof Error ? sendErr.name : 'UnknownError'
      Sentry.captureException(new Error(`${name}: job/embed dispatch failed`), {
        tags: {
          phase: 'p3',
          layer: 'inngest',
          function: 'create-job-from-spec',
          subop: 'inngest.send',
          job_id: newJob.id,
        },
      })
      // Don't throw — the batch embed sweep will pick the job up on its
      // next 10-min cadence.
    }

    return { created: true, job_id: newJob.id }
  },
)
