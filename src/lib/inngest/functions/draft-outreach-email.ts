import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { draftOutreachEmail } from '@/lib/ai/outreach-draft'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// draft-outreach-email — Plan 03-05 / Task E.2.
//
// Triggered by `requestOutreachDraftAction`'s `outreach-draft/requested`
// event. The function:
//   1. Reads the company name + most recent placement summary (service-role
//      query, with explicit HARD RULE 4 tenant-boundary assertion on the
//      company row).
//   2. Calls the Sonnet wrapper (`draftOutreachEmail`) which logs ai_usage.
//   3. Inserts an activities row with kind='email_draft', body=subject,
//      metadata={ subject, body_html, draft_for_company_id }.
//
// The draft is NOT auto-sent (D3-20 + HARD RULE 8 + CLAUDE.md). The
// recruiter approves and sends via the modal -> sendOutreachAction path.
//
// Pattern per PATTERNS §2 + RESEARCH §"Sentry tags" — every captureException
// wraps `${name}: ${status}` (never the raw error).
// ---------------------------------------------------------------------------

type OutreachDraftRequestedEventData = {
  organization_id: string
  company_id: string
  user_id: string | null
}

function asEventData(value: unknown): OutreachDraftRequestedEventData {
  // reason: Inngest typings are deliberately wide; this function only
  // accepts events from `requestOutreachDraftAction`. The HARD RULE 4
  // tenant-boundary check below catches a forged event from a compromised
  // session.
  return value as OutreachDraftRequestedEventData
}

export const draftOutreachEmailFn = inngest.createFunction(
  {
    id: 'draft-outreach-email',
    triggers: [{ event: 'outreach-draft/requested' }],
    // Light single-draft function; no concurrency cap needed for now (one
    // draft per recruiter click). Match the embed-job-on-jd-change shape
    // per PATTERNS §2 for orgs that may click many in a row.
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
            function: 'draft-outreach-email',
            handler: 'onFailure',
            company_id: original.company_id,
          },
        },
      )
    },
  },
  async ({ event, step }) => {
    const { organization_id, company_id, user_id } = asEventData(event.data)

    // Step 1 — gather context. Service-role bypasses RLS, so we MUST verify
    // the company_id is in the event's organization_id (HARD RULE 4).
    const context = await step.run('gather-context', async () => {
      const supabase = createServiceClient()

      const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('id, name, organization_id')
        .eq('id', company_id)
        .maybeSingle()
      if (companyErr) {
        throw new Error(`gather-context.company: ${companyErr.message}`)
      }
      if (!company) {
        throw new NonRetriableError('company-not-found')
      }
      if (company.organization_id !== organization_id) {
        throw new NonRetriableError('cross-tenant-company')
      }

      // Most recent placed application for any job at this company.
      const { data: placements, error: placementsErr } = await supabase
        .from('applications')
        .select('stage_changed_at, jobs!inner(title, company_id)')
        .eq('stage', 'placed')
        .eq('jobs.company_id', company_id)
        .order('stage_changed_at', { ascending: false })
        .limit(1)
      if (placementsErr) {
        throw new Error(`gather-context.placements: ${placementsErr.message}`)
      }

      let lastPlacementSummary: string | null = null
      const top = placements?.[0] as
        | {
            stage_changed_at: string
            jobs: { title: string } | { title: string }[] | null
          }
        | undefined
      if (top) {
        const job = Array.isArray(top.jobs) ? top.jobs[0] : top.jobs
        const title = job?.title?.trim()
        const when = new Date(top.stage_changed_at)
        if (title && !Number.isNaN(when.getTime())) {
          const monthYear = `${when.toLocaleString('en-GB', { month: 'short' })} ${when.getUTCFullYear()}`
          lastPlacementSummary = `${title} placed ${monthYear}`
        }
      }

      return {
        client_name: company.name,
        last_placement_summary: lastPlacementSummary,
      }
    })

    // Step 2 — call Sonnet. The wrapper logs ai_usage automatically
    // (D3-24 / CLAUDE.md non-negotiable). Do NOT instantiate Anthropic.
    const draft = await step.run('claude-draft', async () => {
      return await draftOutreachEmail({
        clientName: context.client_name,
        lastPlacementSummary: context.last_placement_summary,
        organizationId: organization_id,
        userId: user_id,
      })
    })

    // Step 3 — write the email_draft activity row. Service-role caller has
    // no session, so we pass organization_id explicitly (the
    // activities_set_org trigger can't read current_organization_id under
    // service-role and would otherwise raise).
    const activity = await step.run('write-activity', async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('activities')
        .insert({
          organization_id,
          // reason: 'email_draft' is added in this plan's migration;
          // generated Database types may not include it yet — cast at the
          // boundary. Postgres validates the value at insert time.
          kind: 'email_draft' as unknown as 'email',
          entity_type: 'company',
          entity_id: company_id,
          body: draft.subject,
          actor_user_id: user_id,
          metadata: {
            subject: draft.subject,
            body_html: draft.body_html,
            draft_for_company_id: company_id,
          },
        })
        .select('id')
        .single()
      if (error || !data) {
        throw new Error(`write-activity: ${error?.message ?? 'no row returned'}`)
      }
      return data
    })

    return { activity_id: activity.id, company_id }
  },
)
