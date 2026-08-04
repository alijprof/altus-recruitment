// Single source of truth for CV-parse failure copy + the predicates that key
// off it. NO `import 'server-only'` — cv-review-panel.tsx ('use client')
// imports this module directly, and it must not pull in server-only guards.
//
// SF-1 (2026-07-31 Steele Charles feature review): before this module, the
// same literals were duplicated between src/lib/inngest/functions/parse-cv.ts
// and the client-side substring checks in cv-review-panel.tsx, which is how
// the client and server copies drifted. Every consumer imports from here now.

// Locked to UI-SPEC §Error States — do not reword this literal.
export const CV_PARSE_FAILED_MESSAGE =
  'Parsing failed. You can retry now or continue and parse later.'

// Shown when parsing is blocked by the AI budget (monthly £ ceiling or the
// cv_parse cap). The substring 'AI budget' is LOAD-BEARING — isBudgetCapped
// below and the cv-review panel both key off it. Keep that phrase if you
// edit this copy.
export const CV_BUDGET_CAPPED_MESSAGE = 'AI budget reached — parsing paused until reset.'

// SF-1 fix: honest copy for scanned/no-text PDFs. The substring
// 'no extractable text' is LOAD-BEARING — isUnparseableSource below keys off
// it, and the UI uses it to withhold a doomed "Try again" button (retrying
// the same bytes cannot produce a different result).
export const CV_NO_TEXT_MESSAGE =
  'This PDF has no extractable text — it looks like a scan or photo. Retrying the same file won’t work; upload a text-based PDF or Word version instead.'

// SF-4/SF-5 fix: shown when a candidate_cvs row never received a Storage
// object (client PUT never completed) — reconciler `fail-no-file` outcome.
export const CV_UPLOAD_INCOMPLETE_MESSAGE =
  'The CV file never finished uploading. Please upload it again.'

// SF-4/SF-5 fix: shown when a row is stuck 'pending' past the reconciler's
// requeue budget (reconciler `fail-stuck` outcome), and when confirmApplyAction
// fails to enqueue the parse (SF-4).
export const CV_STUCK_MESSAGE = 'Parsing didn’t start. You can retry now, or upload the CV again.'

/** Matches the budget-capped message. Load-bearing substring: 'AI budget'. */
export function isBudgetCapped(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('AI budget')
}

/**
 * Matches the unparseable-source message. Load-bearing substring:
 * 'no extractable text'.
 */
export function isUnparseableSource(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('no extractable text')
}
