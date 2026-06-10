import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// voice_notes DB helpers (Plan 04-02 Task 1).
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

/**
 * Placeholder signature for applying approved voice note field changes to a
 * candidate. Implemented and consumed in plan 04-03; defined here so the
 * apply action in 04-03 can import the type and function stub.
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
    proposal: VoiceNoteProposal
  },
): Promise<DbResult<{ voiceNoteId: string }>> {
  // Implementation in plan 04-03. This stub exists so 04-02 type-checks cleanly.
  void supabase
  void args
  return { ok: false, code: 'internal' }
}
