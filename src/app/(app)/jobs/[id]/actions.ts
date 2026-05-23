'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  createApplication,
  deleteApplication,
  moveApplication,
} from '@/lib/db/applications'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import type { Enums } from '@/types/database'

// ---------------------------------------------------------------------------
// Add candidate to job
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid()

const addCandidateSchema = z.object({
  jobId: idSchema,
  candidateId: idSchema,
})

export type AddCandidateResult =
  | { ok: true; applicationId: string }
  | { ok: false; formError: string }

export async function addCandidateToJobAction(
  rawInput: unknown,
): Promise<AddCandidateResult> {
  const parsed = addCandidateSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid candidate or job id.' }
  }

  const supabase = await createSupabaseClient()
  const result = await createApplication(supabase, {
    jobId: parsed.data.jobId,
    candidateId: parsed.data.candidateId,
  })

  if (!result.ok) {
    // Could be a unique-violation (candidate already on this job) or a
    // cross-tenant FK guard fire. The db helper logs to Sentry already; we
    // surface a generic message so we don't leak which org a candidate
    // lives in.
    return { ok: false, formError: 'Could not add candidate. They may already be on this job.' }
  }

  revalidatePath(`/jobs/${parsed.data.jobId}`)
  revalidatePath(`/jobs/${parsed.data.jobId}/pipeline`)
  return { ok: true, applicationId: result.data.id }
}

// ---------------------------------------------------------------------------
// Search candidates (used by AddCandidateForm)
//
// Re-uses Plan 1's search_candidates RPC. We hand-shape the response to a
// minimal client payload — never leak full row data into the client bundle.
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  q: z.string().trim().min(2).max(200),
})

type CandidateSearchOption = {
  id: string
  full_name: string
  current_role_title: string | null
  current_company: string | null
}

export type SearchCandidatesResult =
  | { ok: true; data: CandidateSearchOption[] }
  | { ok: false; formError: string }

export async function searchCandidatesAction(
  q: string,
): Promise<SearchCandidatesResult> {
  const parsed = searchSchema.safeParse({ q })
  if (!parsed.success) {
    return { ok: true, data: [] } // too short = no results, not an error
  }

  const supabase = await createSupabaseClient()
  // reason: search_candidates is added by Plan 1's
  // 20260517215939_search_candidates_rpc.sql which isn't yet in the
  // generated Database['Functions'] map.
  const supabaseUntyped = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: Array<{
        id: string
        full_name: string
        current_role_title: string | null
        current_company: string | null
      }> | null
      error: unknown
    }>
  }
  const { data, error } = await supabaseUntyped.rpc('search_candidates', {
    p_query: parsed.data.q,
    p_limit: 10,
    p_offset: 0,
  })

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'action', helper: 'searchCandidatesAction' },
    })
    return { ok: false, formError: 'Search failed. Please try again.' }
  }

  const options = (data ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    current_role_title: c.current_role_title,
    current_company: c.current_company,
  }))
  return { ok: true, data: options }
}

// ---------------------------------------------------------------------------
// moveApplicationAction — the central pipeline mutation.
//
// Called from <PipelineBoard> on drop (drag-and-drop pending state), from
// <PipelineMobileList> on stage tap, and from <DeclineModal> on confirm.
// Wraps the move_application RPC (created in Task 4.1) which atomically
// updates the application stage and writes the matching activities row.
//
// The schema's decline_reason_present_when_terminal CHECK constraint is the
// final authority on whether a terminal move needs a reason — we duplicate
// the check here for UX (faster failure, clear error message).
// ---------------------------------------------------------------------------

const APPLICATION_STAGES = [
  'applied',
  'screening',
  'cv_submitted',
  'first_interview',
  'second_interview',
  'offer',
  'placed',
  'rejected',
  'withdrawn',
] as const

const moveSchema = z.object({
  applicationId: idSchema,
  toStage: z.enum(APPLICATION_STAGES),
  declineReason: z
    .enum([
      'not_qualified',
      'salary_mismatch',
      'location_mismatch',
      'candidate_withdrew',
      'client_rejected_skills',
      'client_rejected_culture',
      'client_filled_internally',
      'client_filled_other',
      'other',
    ])
    .optional()
    .nullable(),
  declineNotes: z.string().trim().max(5_000, 'Too long').optional().nullable(),
  jobId: idSchema.optional().nullable(),
  // Optional — the candidate detail page passes its id so the page revalidates
  // immediately after an inline stage change. Pipeline + per-job callers
  // leave it null.
  candidateId: idSchema.optional().nullable(),
})

export type MoveApplicationResult =
  | { ok: true }
  | { ok: false; error: string }

export async function moveApplicationAction(
  rawInput: unknown,
): Promise<MoveApplicationResult> {
  const parsed = moveSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid move payload.' }
  }
  const { applicationId, toStage, declineReason, declineNotes, jobId, candidateId } =
    parsed.data

  // UI-SPEC error state: terminal stages require a decline reason. The
  // server function will reject this too, but failing fast here gives the
  // DeclineModal a clearer error to show.
  if ((toStage === 'rejected' || toStage === 'withdrawn') && !declineReason) {
    return { ok: false, error: 'Please select a decline reason.' }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const res = await moveApplication(supabase, {
    applicationId,
    toStage: toStage as Enums<'application_stage'>,
    declineReason: declineReason ?? null,
    declineNotes: declineNotes ?? null,
    actorUserId: userId,
  })

  if (!res.ok) {
    return { ok: false, error: 'Move failed. Please try again.' }
  }

  // Invalidate every surface the change could appear on. Cheap; the kanban
  // is the source of truth client-side (optimistic state) and won't refetch
  // unless the user navigates away.
  revalidatePath('/pipeline')
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`)
    revalidatePath(`/jobs/${jobId}/pipeline`)
  }
  if (candidateId) {
    revalidatePath(`/candidates/${candidateId}`)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// removeApplicationAction — hard-delete the candidate↔job junction row.
//
// Distinct from moveApplicationAction(toStage='rejected'): this is the
// "added by mistake" affordance, used by the pipeline card dropdown's
// "Remove from job" item. No decline_reason is required because no
// rejection is recorded — the row is simply gone.
//
// Audit trail is preserved via record_audit (action='delete',
// entity_type='application') so the compliance picture stays intact.
// ---------------------------------------------------------------------------

const removeSchema = z.object({
  applicationId: idSchema,
  jobId: idSchema.optional().nullable(),
})

export type RemoveApplicationResult =
  | { ok: true }
  | { ok: false; error: string }

export async function removeApplicationAction(
  rawInput: unknown,
): Promise<RemoveApplicationResult> {
  const parsed = removeSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid remove payload.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const res = await deleteApplication(supabase, {
    applicationId: parsed.data.applicationId,
  })
  if (!res.ok) {
    return { ok: false, error: 'Could not remove candidate from job.' }
  }

  // Write an audit_log row so the compliance picture survives the hard-
  // delete. record_audit is security definer + reads org from session,
  // so no org needs to be passed.
  const supabaseUntyped = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  }
  const { error: auditErr } = await supabaseUntyped.rpc('record_audit', {
    p_action: 'delete',
    p_entity_type: 'application',
    p_entity_id: res.data.id,
    p_metadata: {
      candidate_id: res.data.candidate_id,
      job_id: res.data.job_id,
      via: 'pipeline_remove_from_job',
    },
  })
  if (auditErr) {
    Sentry.captureException(auditErr, {
      tags: { layer: 'action', helper: 'removeApplicationAction', subop: 'audit' },
    })
    // Don't block on audit failure — the application is already deleted
    // and the request was authorised. Log to Sentry and continue.
  }

  revalidatePath('/pipeline')
  if (parsed.data.jobId) {
    revalidatePath(`/jobs/${parsed.data.jobId}`)
    revalidatePath(`/jobs/${parsed.data.jobId}/pipeline`)
    revalidatePath(`/jobs/${parsed.data.jobId}/shortlist`)
  }
  revalidatePath(`/candidates/${res.data.candidate_id}`)
  return { ok: true }
}
