// Shared source of truth for decline_reason enum values + human labels.
//
// Plan 4 VERIFICATION R1: the schema in
// supabase/migrations/20260513152244_phase1_domain_schema.sql lines 56–66
// defines NINE decline_reason values. Both the DeclineModal Select (input)
// and the ActivityTimeline rendering (output) must source labels from this
// single file — never hard-code labels inline.
//
// This module is intentionally NOT 'server-only': it's consumed by both the
// DeclineModal Client Component AND server actions / activity preprocessors.
// It contains no secrets or DB access — only enum strings + display labels.

import type { Enums } from '@/types/database'

export type DeclineReason = Enums<'decline_reason'>

export const DECLINE_REASONS: ReadonlyArray<{
  value: DeclineReason
  label: string
}> = [
  { value: 'not_qualified', label: 'Not qualified' },
  { value: 'salary_mismatch', label: 'Salary mismatch' },
  { value: 'location_mismatch', label: 'Location / relocation' },
  { value: 'candidate_withdrew', label: 'Candidate withdrew' },
  { value: 'client_rejected_skills', label: 'Client rejected — skills' },
  { value: 'client_rejected_culture', label: 'Client rejected — culture' },
  { value: 'client_filled_internally', label: 'Filled internally' },
  { value: 'client_filled_other', label: 'Filled (other source)' },
  { value: 'other', label: 'Other' },
] as const

const LABEL_BY_VALUE = Object.fromEntries(
  DECLINE_REASONS.map((r) => [r.value, r.label]),
) as Record<DeclineReason, string>

/**
 * Render a decline_reason enum value as its human label. Returns
 * 'Unspecified' for null/undefined (consistent with the
 * `Declined — unspecified` activity body the move_application function
 * writes when a reason is unexpectedly missing). Unknown values pass
 * through untouched — defensive against future enum additions.
 */
export function formatDeclineReason(
  value: DeclineReason | string | null | undefined,
): string {
  if (!value) return 'Unspecified'
  return LABEL_BY_VALUE[value as DeclineReason] ?? value
}
