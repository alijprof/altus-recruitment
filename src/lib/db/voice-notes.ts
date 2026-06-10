import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables, TablesUpdate } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// voice_notes DB helpers (Plan 04-02 Task 1 + Plan 04-03 Task 1).
//
// All writes go through here so the capture action, review page, and Inngest
// functions share one shape. organization_id MUST be passed explicitly by
// the caller — voice_notes does not have a set-org trigger like spec_drafts.
// ---------------------------------------------------------------------------

export type VoiceNoteRow = Tables<'voice_notes'>

// D4-05 allowlist — the ONLY scalar fields Sonnet may propose changes to.
// notes is handled via note_append (append-only), not this list.
export type VoiceNoteAllowedField =
  | 'current_role_title'
  | 'current_company'
  | 'market_status'
  | 'seniority_level'

// Structured proposal shape written into voice_notes.structured_data by the
// Inngest pipeline after Sonnet extraction. Matches the extract_voice_note_updates
// tool schema exactly.
export type VoiceNoteProposal = {
  proposed_field_changes: {
    field: VoiceNoteAllowedField
    current_value: string | null
    proposed_value: string
  }[]
  note_append: string | null
  activity_kind: 'note' | 'call' | 'meeting'
  activity_body: string
  action_items: string[]
}

export type GetVoiceNoteResult =
  | { ok: true; data: VoiceNoteRow }
  | { ok: false; code: 'not_found' | 'db_error'; message?: string }

/**
 * Fetch a single voice note by id. Used by the review page + status poller.
 * RLS enforces tenant isolation for session callers; service callers MUST
 * additionally scope by organization_id in the calling context.
 */
export async function getVoiceNote(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<GetVoiceNoteResult> {
  const { data, error } = await supabase
    .from('voice_notes')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getVoiceNote' } })
    return { ok: false, code: 'db_error', message: error.message }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}

/**
 * Mark a voice note as failed. Used by the Inngest onFailure handler and
 * the outer catch block. Always uses the service client — must be called
 * with both voiceNoteId and organizationId so the write is scoped correctly
 * (service role bypasses RLS).
 */
export async function markVoiceNoteFailed(args: {
  voiceNoteId: string
  organizationId: string
  userMessage: string
}): Promise<void> {
  try {
    const { createServiceClient } = await import('@/lib/supabase/service')
    const supabase = createServiceClient()
    await supabase
      .from('voice_notes')
      .update({ status: 'failed', parse_error: args.userMessage })
      .eq('id', args.voiceNoteId)
      .eq('organization_id', args.organizationId)
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${name}: mark-voice-note-failed write failed`), {
      tags: {
        layer: 'inngest',
        function: 'voice-notes-db',
        subop: 'mark-failed',
        voice_note_id: args.voiceNoteId,
      },
    })
  }
}

// Market status enum values — must mirror the DB enum exactly.
// Used to validate proposed_value before writing to candidates.market_status.
const MARKET_STATUS_VALUES = new Set([
  'actively_looking',
  'passively_looking',
  'hot',
  'placed',
  'cold',
])

/**
 * Apply approved voice note field changes to a candidate.
 *
 * Security contract (enforced by caller applyVoiceNoteAction):
 * - approvedFields have been validated against the Zod allowlist enum
 * - voice_notes row belongs to caller's org (RLS + explicit assert in action)
 * - voice_notes.status === 'ready_for_review' before calling this
 *
 * Writes ONLY the caller-approved subset of proposed_field_changes.
 * notes is append-only — reads existing value, concatenates. Never replaces.
 * market_status is re-validated against the DB enum before write.
 * Activity creation is best-effort (non-fatal failure doesn't roll back
 * candidate field updates — the core write already succeeded).
 */
export async function applyVoiceNoteFields(
  supabase: SupabaseClient<Database>,
  args: {
    voiceNoteId: string
    candidateId: string
    organizationId: string
    approvedFields: VoiceNoteAllowedField[]
    approveNote: boolean
    approveActivity: boolean
    actorUserId: string
    proposal: VoiceNoteProposal
  },
): Promise<DbResult<{ voiceNoteId: string }>> {
  const {
    voiceNoteId,
    candidateId,
    approvedFields,
    approveNote,
    approveActivity,
    actorUserId,
    proposal,
  } = args

  // --- 1. Build the scalar field update payload ---
  // Only write fields from the approved set; skip any with empty proposed_value.
  // reason: TablesUpdate<'candidates'> uses string|null for these fields;
  // we build as a plain record and cast at the boundary (same pattern as
  // createActivity's insertPayload in activities.ts).
  const scalarUpdate: Record<string, string> = {}
  for (const field of approvedFields) {
    const change = proposal.proposed_field_changes.find((c) => c.field === field)
    if (!change) continue
    const val = change.proposed_value?.trim()
    if (!val) continue

    // Extra enum validation for market_status — guard against a Sonnet
    // hallucination landing a non-DB value in the enum column (DB would
    // reject it, but we want an explicit server-side error, not a DB error).
    if (field === 'market_status' && !MARKET_STATUS_VALUES.has(val)) {
      Sentry.captureException(
        new Error(`applyVoiceNoteFields: invalid market_status value '${val}'`),
        { tags: { layer: 'db', helper: 'applyVoiceNoteFields', voice_note_id: voiceNoteId } },
      )
      return { ok: false, code: 'internal' }
    }

    scalarUpdate[field] = val
  }

  // --- 2. Handle note_append (read-then-concatenate, never bare replace) ---
  // T-04-20: append-only to candidates.about (the candidates table has no
  // dedicated 'notes' column; 'about' is the free-text field for recruiter
  // observations). Read-then-concatenate so a voice note never silently
  // replaces existing recruiter copy.
  if (approveNote && proposal.note_append) {
    const appendText = proposal.note_append.trim()
    if (appendText) {
      const { data: candidateRow, error: readErr } = await supabase
        .from('candidates')
        .select('about')
        .eq('id', candidateId)
        .maybeSingle()

      if (readErr) {
        Sentry.captureException(readErr, {
          tags: { layer: 'db', helper: 'applyVoiceNoteFields', subop: 'read-about' },
        })
        return { ok: false, code: 'internal' }
      }

      const existingAbout = candidateRow?.about ?? ''
      const separator = existingAbout.trim() ? '\n\n' : ''
      scalarUpdate['about'] = existingAbout + separator + appendText
    }
  }

  // --- 3. Write scalar + notes update in one UPDATE (if anything to write) ---
  if (Object.keys(scalarUpdate).length > 0) {
    const { error: updateErr } = await supabase
      .from('candidates')
      // reason: scalarUpdate is a subset of TablesUpdate<'candidates'> (string
      // values for string|null columns). The generated type's recursive Json
      // union doesn't structurally match Record<string, string> — cast at the
      // boundary. RLS WITH CHECK enforces org scoping server-side.
      .update(scalarUpdate as unknown as TablesUpdate<'candidates'>)
      .eq('id', candidateId)

    if (updateErr) {
      Sentry.captureException(updateErr, {
        tags: { layer: 'db', helper: 'applyVoiceNoteFields', subop: 'candidate-update' },
      })
      return { ok: false, code: 'internal' }
    }
  }

  // --- 4. Create activity if approved (best-effort — non-fatal) ---
  if (approveActivity) {
    // Dynamic import avoids a circular dependency: voice-notes.ts ← activities.ts
    // would be fine directionally, but the import() pattern mirrors how
    // markVoiceNoteFailed imports createServiceClient.
    const { createActivity } = await import('@/lib/db/activities')
    const actResult = await createActivity(supabase, {
      kind: proposal.activity_kind,
      entity_type: 'candidate',
      entity_id: candidateId,
      body: proposal.activity_body,
      actor_user_id: actorUserId,
      metadata: {
        source: 'voice_note',
        voice_note_id: voiceNoteId,
        action_items: proposal.action_items,
      },
    })
    if (!actResult.ok) {
      // The candidate fields are already written — activity failure is
      // non-fatal. Log to Sentry so we can detect patterns, but don't
      // roll back the successful field updates.
      Sentry.captureException(
        new Error('applyVoiceNoteFields: activity creation failed after field update'),
        { tags: { layer: 'db', helper: 'applyVoiceNoteFields', voice_note_id: voiceNoteId } },
      )
    }
  }

  // --- 5. Mark voice_notes.status = 'applied' ---
  const { error: vnErr } = await supabase
    .from('voice_notes')
    .update({ status: 'applied', applied_at: new Date().toISOString() })
    .eq('id', voiceNoteId)

  if (vnErr) {
    Sentry.captureException(vnErr, {
      tags: { layer: 'db', helper: 'applyVoiceNoteFields', subop: 'mark-applied' },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: { voiceNoteId } }
}
