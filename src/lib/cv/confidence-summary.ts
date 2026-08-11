// Single source of truth for the "N fields unsure" cue shown OUTSIDE the CV
// review sheet (D-02, Plan 07-02) — surfaces low/medium-confidence parsed
// fields where the recruiter actually looks, not just inside a sheet nobody
// opens. Also the single source of truth for the field-label map the review
// sheet itself renders, so the badge/summary line can never name a field the
// sheet doesn't show.
//
// NO `import 'server-only'`. Mirrors the rationale documented at the top of
// src/lib/cv/parse-messages.ts: the candidate detail page (server component)
// computes the summary, cv-review-panel.tsx ('use client') renders it and
// reuses CV_FIELD_LABELS for the sheet body, and a future Playwright smoke
// spec (07-08) will import CV_FIELD_LABELS directly — none of those contexts
// can pull in a server-only guard.

import type { ConfidenceLevel } from '@/components/app/confidence-badge'

// Labels shown in the review sheet AND the unsure-fields summary line.
// Lifted verbatim from cv-review-panel.tsx's pre-Plan-07-02 local
// FIELD_LABELS array. Key order is LOAD-BEARING in two places: the review
// sheet's ReviewSheetBody renders rows in this exact order (unchanged by
// this plan), and summariseConfidence below walks the same order so the
// summary line always matches the sheet's own ordering.
export const CV_FIELD_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'location', label: 'Location' },
  { key: 'current_role', label: 'Current role' },
  { key: 'current_company', label: 'Current company' },
  { key: 'seniority_level', label: 'Seniority' },
  { key: 'years_experience_total', label: 'Years experience' },
  { key: 'salary_current_estimate', label: 'Current salary (est.)' },
  { key: 'salary_expectation', label: 'Salary expectation' },
  { key: 'skills', label: 'Skills' },
  { key: 'sector_tags', label: 'Sectors' },
]

export type ConfidenceSummary = {
  unsureCount: number
  unsureFields: string[]
}

const EMPTY_SUMMARY: ConfidenceSummary = { unsureCount: 0, unsureFields: [] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnsureLevel(value: unknown): value is Extract<ConfidenceLevel, 'medium' | 'low'> {
  return value === 'medium' || value === 'low'
}

/**
 * Aggregate the low/medium-confidence fields out of a candidate_cvs row's
 * `extracted_data` jsonb. Total by construction: any shape other than a
 * plain object with a plain-object `confidence_per_field` yields the zero
 * result rather than throwing — stored rows predate the coercion boundary
 * added in Phase 6 (coerceConfidence, src/lib/ai/parsed-cv-schema.ts) and the
 * reconciler still re-processes them, so `extracted` here is fully untrusted
 * input (T-07-07: a malformed row must never blank the candidate page).
 *
 * `unsureFields` carries the HUMAN labels (e.g. 'Current role'), never the
 * raw jsonb keys, and is walked in CV_FIELD_LABELS declaration order rather
 * than object-key order so it always reads in the same order the review
 * sheet renders. A confidence_per_field key not present in CV_FIELD_LABELS
 * is silently ignored — it can never produce an undefined label.
 */
export function summariseConfidence(extracted: unknown): ConfidenceSummary {
  if (!isPlainObject(extracted)) return EMPTY_SUMMARY
  const confidencePerField = extracted.confidence_per_field
  if (!isPlainObject(confidencePerField)) return EMPTY_SUMMARY

  const unsureFields: string[] = []
  for (const { key, label } of CV_FIELD_LABELS) {
    if (isUnsureLevel(confidencePerField[key])) {
      unsureFields.push(label)
    }
  }
  return { unsureCount: unsureFields.length, unsureFields }
}
