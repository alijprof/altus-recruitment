// Single source of truth for CV-file display formatting — the pure,
// dependency-free filename derivation + download-eligibility predicate
// shared by the RSC candidate page (cv-files-panel.tsx), the client View
// control (cv-file-link.tsx), and the Playwright smoke spec (07-08-PLAN.md).
//
// NO `import 'server-only'`. Mirrors the rationale documented at the top of
// src/lib/cv/parse-messages.ts: this module is imported by a 'use client'
// component AND by a Node-side Playwright spec, neither of which can pull in
// a server-only guard. It stays dependency-free (only parse-messages.ts, for
// the same reason) so it can never accidentally grow a server-only import
// transitively.

import { isUploadIncomplete } from './parse-messages'

// Shown wherever a filename can't be derived at all — empty/null/undefined
// storage_path, or a path whose basename is empty after stripping.
export const CV_FILE_FALLBACK_NAME = 'CV file'

// The wording a disabled View control shows for an upload-incomplete row.
// Exported as a literal (not hand-copied) so the smoke spec can assert
// against the exact string the UI renders — the same "import, don't
// duplicate" contract parse-messages.ts's exported constants already use.
export const CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY =
  'The upload never finished, so there is no stored file. Use the Upload CV control to add it again.'

// Storage path convention (uploadCVAction, actions.ts:188):
//   `${organizationId}/${candidateId}/${crypto.randomUUID()}-${slugifyFilename(file.name)}.${ext}`
// A uuid is always exactly 36 characters (8-4-4-4-12 hex digits + 4 hyphens).
// This mirrors the shape page.tsx:422 used before this module became the
// single source of truth for the derivation.
const LEADING_UUID_PREFIX = /^[0-9a-f-]{36}-/

/**
 * Derive a human-readable filename from a candidate_cvs.storage_path: take
 * the segment after the last '/', strip a leading uuid-and-hyphen prefix if
 * present, and fall back to CV_FILE_FALLBACK_NAME when nothing usable
 * remains.
 */
export function cvDisplayFilename(storagePath: string | null | undefined): string {
  if (!storagePath) return CV_FILE_FALLBACK_NAME
  const basename = storagePath.split('/').pop()
  if (!basename) return CV_FILE_FALLBACK_NAME
  const stripped = basename.replace(LEADING_UUID_PREFIX, '')
  return stripped || CV_FILE_FALLBACK_NAME
}

/**
 * Whether a candidate_cvs row's stored file can be opened right now.
 *
 * Deliberately independent of parsing_status: a 'failed' row whose failure
 * is a damaged or password-protected PDF still has a real stored file — that
 * is exactly the case a recruiter most needs to open, to see what they're
 * dealing with. A 'pending' or 'complete' row is downloadable the moment its
 * storage object exists.
 *
 * The only two gates are:
 *   1. storage_path is present (there is a Storage object to sign a URL for)
 *   2. the upload actually finished — delegated to isUploadIncomplete from
 *      parse-messages.ts. We do NOT re-implement that predicate or
 *      re-declare its load-bearing sentinel substring here; the shared-module
 *      contract (server + client + this module all reading the same
 *      predicate) is the entire reason parse-messages.ts exists.
 */
export function isCvFileDownloadable(cv: {
  storage_path: string | null
  parse_error: string | null
}): boolean {
  if (!cv.storage_path) return false
  if (isUploadIncomplete(cv.parse_error)) return false
  return true
}
