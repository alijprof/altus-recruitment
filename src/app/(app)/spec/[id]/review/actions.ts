'use server'

import { revalidatePath } from 'next/cache'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import {
  getSpecDraft,
  markSpecDraftApproved,
  markSpecDraftRejected,
  updateSpecDraftStructuredData,
} from '@/lib/db/spec-drafts'
import { inngest } from '@/lib/inngest/client'
import { createClient } from '@/lib/supabase/server'

export type ActionResult = { ok: true } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Spec review actions — Plan 03-02 Task B.3.
//
// approveSpecDraftAction: persist the edited structured_data, mark approved,
//   fire the spec-draft/approved event so create-job-from-spec runs in
//   Inngest (D3-09 + D3-25).
// rejectSpecDraftAction: soft-delete (D3-30); the spec-draft-cleanup-sweep
//   cron hard-deletes after 30 days.
// ---------------------------------------------------------------------------

const seniorityEnum = z
  .enum(['junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'director'])
  .nullable()
  .optional()

const jobTypeEnum = z.enum(['perm', 'contract', 'temp']).nullable().optional()
const urgencyEnum = z.enum(['now', 'weeks', 'exploratory']).nullable().optional()
const hiringContextEnum = z.enum(['new_role', 'backfill']).nullable().optional()

const structuredJdSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  seniority_level: seniorityEnum.transform((v) => v ?? null),
  job_type: jobTypeEnum.transform((v) => v ?? null),
  location: z.string().trim().max(200).nullable().optional().transform((v) => v ?? null),
  salary_range_min: z.number().int().min(0).nullable().optional().transform((v) => v ?? null),
  salary_range_max: z.number().int().min(0).nullable().optional().transform((v) => v ?? null),
  currency: z.string().trim().max(8).nullable().optional().transform((v) => v ?? null),
  must_haves: z.array(z.string().trim().max(500)).max(20).default([]),
  nice_to_haves: z.array(z.string().trim().max(500)).max(20).default([]),
  culture_notes: z.string().trim().max(5000).nullable().optional().transform((v) => v ?? null),
  reporting_line: z.string().trim().max(200).nullable().optional().transform((v) => v ?? null),
  urgency: urgencyEnum.transform((v) => v ?? null),
  hiring_context: hiringContextEnum.transform((v) => v ?? null),
})

export type SpecJdInput = z.infer<typeof structuredJdSchema>

const approveSchema = z.object({
  specDraftId: z.string().uuid('Invalid draft id.'),
  structuredData: structuredJdSchema,
})

export async function approveSpecDraftAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = approveSchema.safeParse(rawInput)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Invalid input.'
    return { ok: false, error: first }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // Re-read the draft to grab organization_id for the Inngest event payload.
  // RLS scopes to the user's tenant so cross-org reads return not_found.
  const draftResult = await getSpecDraft(supabase, parsed.data.specDraftId)
  if (!draftResult.ok) {
    return { ok: false, error: 'Draft not found.' }
  }

  // Guard: jobs require a company_id at the schema level, and the
  // create-job-from-spec Inngest function refuses to create a row without
  // one. Catch this BEFORE the async fire-and-forget so the recruiter sees
  // a clear error rather than getting silently redirected to /jobs with no
  // new row appearing.
  if (!draftResult.data.company_id) {
    return {
      ok: false,
      error: 'Pick a client below before approving — jobs need to be linked to a company.',
    }
  }

  // 1) Persist the recruiter-edited structured JD back to the row.
  const structuredResult = await updateSpecDraftStructuredData(supabase, {
    id: parsed.data.specDraftId,
    structuredData: parsed.data.structuredData,
  })
  if (!structuredResult.ok) {
    return { ok: false, error: 'Could not save edits.' }
  }

  // 2) Mark approved (the create-job-from-spec Inngest function patches
  // created_job_id once the jobs row exists).
  const approvedResult = await markSpecDraftApproved(supabase, {
    id: parsed.data.specDraftId,
  })
  if (!approvedResult.ok) {
    return { ok: false, error: 'Could not approve draft.' }
  }

  // 3) Fire the event to create the jobs row asynchronously. Same Sentry-
  // on-failure pattern as submitSpecCallAction.
  try {
    await inngest.send({
      name: 'spec-draft/approved',
      data: {
        organization_id: draftResult.data.organization_id,
        spec_draft_id: parsed.data.specDraftId,
        user_id: user.id,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send failed`), {
      tags: {
        phase: 'p3',
        layer: 'action',
        helper: 'approveSpecDraftAction',
        spec_draft_id: parsed.data.specDraftId,
      },
    })
    // The draft is marked approved but no job was created. The UI surfaces
    // this with a retry hint; the recruiter can re-click "Approve" which
    // will re-fire the event (the Inngest function is idempotent on
    // created_job_id via a `where created_job_id is null` write).
    return {
      ok: false,
      error: 'Approved, but job creation could not be queued. Try again in a moment.',
    }
  }

  revalidatePath('/spec')
  revalidatePath('/jobs')
  revalidatePath(`/spec/${parsed.data.specDraftId}/review`)
  return { ok: true }
}

const rejectSchema = z.object({
  specDraftId: z.string().uuid('Invalid draft id.'),
})

export async function rejectSpecDraftAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = rejectSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const result = await markSpecDraftRejected(supabase, { id: parsed.data.specDraftId })
  if (!result.ok) {
    return { ok: false, error: 'Could not reject draft.' }
  }

  revalidatePath('/spec')
  return { ok: true }
}
