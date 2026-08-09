// Maps the Tier-2 library-error shapes thrown by `extractTextFromBuffer`
// (src/lib/ai/cv-extract.ts) onto honest, type-specific user copy plus a
// PII-free `detail` string for `parse_error_detail`.
//
// NO `import 'server-only'` — this module must stay unit-testable in a
// plain Node/vitest environment (no Next bundler) and importable from
// src/lib/inngest/functions/parse-cv.ts. Classification is done PURELY by
// `err.name` / `err.message` SUBSTRING, never by `instanceof` against a
// library's exported error class, so this file carries zero import
// dependency on cv-extract.ts (which pulls in `server-only`) or on unpdf /
// mammoth themselves.

import {
  CV_DAMAGED_FILE_MESSAGE,
  CV_PASSWORD_PROTECTED_MESSAGE,
  CV_UNSUPPORTED_FORMAT_MESSAGE,
  CV_WRONG_FORMAT_MESSAGE,
} from './parse-messages'

export type ExtractionClassification = { message: string; detail: string; retryable: false }

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : ''
}

/**
 * Classify a caught `extractTextFromBuffer` error into an honest,
 * type-specific message a recruiter can act on. Returns `null` for anything
 * unrecognised — the caller keeps today's generic, retryable behaviour,
 * because an unknown fault may well be transient (a library upgrade, a
 * runtime OOM, etc — see the `<behavior>` spec in 06-07-PLAN.md).
 *
 * Verified library error names/messages (06-07-PLAN.md interfaces, recorded
 * live in tests/fixtures/cv-corpus/manifest.json's `expectErrorName`):
 *   - `UnsupportedCVMimeTypeError` — thrown by extractTextFromBuffer itself
 *     for any mime it doesn't route (legacy .doc, RTF, ODT, TXT, ...).
 *   - `InvalidPDFException` — pdf.js, for a corrupt/truncated/zero-byte PDF
 *     OR a non-PDF's bytes fed in as PDF_MIME (no `%PDF` magic header).
 *   - `PasswordException` — pdf.js, for an encrypted PDF whose implicit
 *     empty-password check fails.
 *   - a plain `Error` whose message contains "Can't find end of central
 *     directory" — mammoth/jszip, for a non-DOCX's bytes fed in as
 *     DOCX_MIME (jszip can't find a central directory in what it expected
 *     to be a zip).
 *
 * `detail` is the PII-free technical string for `parse_error_detail`:
 * `extract-text: ${err.name} (${mimeType})`. NEVER `err.message` — pdf.js
 * and mammoth error messages can echo file-content fragments (T-06-25).
 */
export function classifyExtractionError(
  err: unknown,
  mimeType: string,
): ExtractionClassification | null {
  const name = errorName(err)
  const message = errorMessage(err)
  const detail = `extract-text: ${name} (${mimeType})`

  if (name === 'UnsupportedCVMimeTypeError') {
    return { message: CV_UNSUPPORTED_FORMAT_MESSAGE, detail, retryable: false }
  }
  if (name === 'InvalidPDFException') {
    return { message: CV_DAMAGED_FILE_MESSAGE, detail, retryable: false }
  }
  if (name === 'PasswordException') {
    return { message: CV_PASSWORD_PROTECTED_MESSAGE, detail, retryable: false }
  }
  if (message.includes("Can't find end of central directory")) {
    return { message: CV_WRONG_FORMAT_MESSAGE, detail, retryable: false }
  }
  return null
}
