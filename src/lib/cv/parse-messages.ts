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
// object (client PUT never completed) — reconciler `fail-no-file` outcome,
// and parse-cv's download step when the object is missing at parse time.
// The substring 'never finished uploading' is LOAD-BEARING —
// isUploadIncomplete below keys off it, and the UI uses it to withhold a
// doomed "Try again" button (there is no stored file to re-parse).
export const CV_UPLOAD_INCOMPLETE_MESSAGE =
  'The CV file never finished uploading. Please upload it again.'

// SF-4/SF-5 fix: shown when a row is stuck 'pending' past the reconciler's
// requeue budget (reconciler `fail-stuck` outcome), and when confirmApplyAction
// fails to enqueue the parse (SF-4).
export const CV_STUCK_MESSAGE = 'Parsing didn’t start. You can retry now, or upload the CV again.'

// Plan 06-07 Task 2(c): the AI's response was cut off at max_tokens with
// nothing usable extracted (CVParseTruncatedError, src/lib/ai/claude.ts,
// plan 06-06). Deliberately a DEDICATED literal rather than reusing
// CV_DAMAGED_FILE_MESSAGE's "appears to be damaged" copy — the FILE is fine,
// the model's output ran long for this input. Deliberately KEPT OUT of
// isUnretryableParseFailure below: Claude's output length is not
// deterministic for identical input, so a retry is a real affordance, not a
// doomed one — same reasoning as CV_STUCK_MESSAGE.
export const CV_PARSE_TRUNCATED_MESSAGE =
  'The AI was cut off partway through extracting this CV, likely because the document is unusually long or dense. You can retry now.'

// Plan 06-07: the four Tier-2 extraction-error classes classifyExtractionError
// (src/lib/cv/extraction-errors.ts) maps library error shapes onto. Retrying
// the SAME stored bytes cannot produce a different result for any of these —
// isUnretryableParseFailure below withholds the doomed "Try again" button.

// Corrupt or truncated PDF (pdf.js InvalidPDFException — no valid xref/trailer
// survives). The substring 'appears to be damaged' is LOAD-BEARING —
// isDamagedFile below keys off it.
export const CV_DAMAGED_FILE_MESSAGE =
  'This file appears to be damaged or incomplete. Re-save or re-export it from the original application and upload it again — retrying the same file will not help.'

// Password-protected/encrypted PDF (pdf.js PasswordException). The substring
// 'password-protected' is LOAD-BEARING — isPasswordProtected below keys off
// it.
export const CV_PASSWORD_PROTECTED_MESSAGE =
  'This PDF is password-protected. Remove the password (or print/export to an unprotected PDF) and upload it again.'

// Wrong-extension upload: real bytes of one format saved/labelled as another
// (a .docx renamed .pdf, or vice versa — mammoth's jszip can't find a central
// directory). The substring 'isn’t a PDF or Word' is LOAD-BEARING — isWrongFormat
// below keys off it.
export const CV_WRONG_FORMAT_MESSAGE =
  'This file’s contents don’t match its extension — it isn’t a PDF or Word document as labelled. Save it as a real PDF or .docx and upload again.'

// Genuinely unsupported mime type (legacy .doc, RTF, ODT, TXT, or any mime
// extractTextFromBuffer doesn't route — UnsupportedCVMimeTypeError). The
// substring 'only PDF and Word' is LOAD-BEARING — isUnsupportedFormat below
// keys off it.
export const CV_UNSUPPORTED_FORMAT_MESSAGE =
  'We support only PDF and Word (.docx) CVs right now. Save this file as a PDF or .docx and upload it again.'

// The PostgREST `ilike` pattern the reconciler's resume-budget-capped step
// uses to find rows parked by the AI budget. It and isBudgetCapped MUST key
// off the same substring — a copy edit that drops 'AI budget' would silently
// disable the auto-resume the UI promises (review 2026-08-04 L1). Asserted
// by tests/unit/lib/cv/parse-messages.test.ts.
export const CV_BUDGET_CAPPED_ILIKE_PATTERN = '%AI budget%'

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

/**
 * Matches the upload-incomplete message. Load-bearing substring:
 * 'never finished uploading'.
 *
 * Review 2026-08-04 C2: this state has NO storage object behind it, so a
 * "Try again" button is a doomed affordance — the re-parse re-runs the same
 * download and fails identically, and (before this fix) overwrote the honest
 * reason with the generic one. The UI branch keyed on this predicate offers
 * re-upload guidance instead of a retry.
 */
export function isUploadIncomplete(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('never finished uploading')
}

/** Matches the damaged/corrupt/truncated-file message. Load-bearing substring: 'appears to be damaged'. */
export function isDamagedFile(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('appears to be damaged')
}

/** Matches the password-protected message. Load-bearing substring: 'password-protected'. */
export function isPasswordProtected(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('password-protected')
}

/** Matches the wrong-extension message. Load-bearing substring: 'isn’t a PDF or Word'. */
export function isWrongFormat(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('isn’t a PDF or Word')
}

/** Matches the unsupported-mime-type message. Load-bearing substring: 'only PDF and Word'. */
export function isUnsupportedFormat(parseError: string | null | undefined): boolean {
  return (parseError ?? '').includes('only PDF and Word')
}

/**
 * True when retrying the SAME stored bytes cannot possibly produce a
 * different outcome — the six classes above (no-text, upload-incomplete,
 * damaged, password-protected, wrong-format, unsupported-format) are all
 * deterministic: the same file re-downloaded and re-extracted fails
 * identically every time. The UI and `retryParseAction` (actions.ts) both
 * key off this single predicate so a doomed "Try again" can never be shown
 * OR honoured (review 2026-08-04 C2, plan 06-07 T-06-27).
 *
 * Deliberately EXCLUDES:
 *   - `CV_BUDGET_CAPPED_MESSAGE`: not a property of the file — the
 *     reconciler auto-resumes it, and a manual retry after the budget
 *     resets/is raised genuinely succeeds.
 *   - `CV_STUCK_MESSAGE`: parsing simply never started; a re-dispatch can
 *     genuinely succeed.
 *   - `CV_PARSE_FAILED_MESSAGE` (generic) and a max_tokens truncation: an
 *     unrecognised fault, or a Claude response that happened to run long,
 *     may well be transient — Claude's output length is not deterministic
 *     for the same input, so a retry is a legitimate affordance, not a
 *     doomed one.
 */
export function isUnretryableParseFailure(parseError: string | null | undefined): boolean {
  return (
    isUnparseableSource(parseError) ||
    isUploadIncomplete(parseError) ||
    isDamagedFile(parseError) ||
    isPasswordProtected(parseError) ||
    isWrongFormat(parseError) ||
    isUnsupportedFormat(parseError)
  )
}
