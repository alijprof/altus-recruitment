// Dependency-free CV file-signature detection: magic-byte sniffing plus a
// DOCX-vs-any-other-zip entry-name check. See 06-08-PLAN.md <interfaces>
// for the byte layout this module is built from.
//
// Deliberately has NO `import 'server-only'` — both
// src/app/(app)/candidates/[id]/actions.ts and
// src/app/(public)/apply/[orgSlug]/actions.ts import this from Server
// Actions, and it must stay importable from plain Node/vitest with zero
// bundler magic (mirrors the same constraint on src/lib/cv/parse-messages.ts
// and src/lib/cv/extraction-errors.ts from plan 06-07).
//
// Deliberately has NO external dependency. jszip is a devDependency only
// (plan 06-01, used by the corpus-generation scripts) — promoting it to a
// runtime dependency to answer a yes/no "does this zip contain these two
// entry names" question is unjustified, and it would mean INFLATING
// attacker-controlled zip bytes just to answer that question (a zip-bomb
// DoS surface — T-06-31). ZIP stores entry FILENAMES uncompressed in both
// the local file headers (front of the archive) and the central directory
// (back of the archive), so a plain byte-scan for the ASCII sequences below
// is sufficient and correct for the Tier-2 goal here: telling a real DOCX
// apart from an ODT, a plain zip, or a mislabelled archive. This is a
// POSITIVE-SIGNAL check, not a full ZIP parse — see isDocxArchive below for
// its documented limit.

import { CV_UNSUPPORTED_FORMAT_MESSAGE, CV_WRONG_FORMAT_MESSAGE } from './parse-messages'

export type SniffedType = 'pdf' | 'zip' | 'ole2' | 'rtf' | 'unknown'

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// File signatures (06-08-PLAN.md <interfaces>).
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04" — docx/xlsx/pptx/odt/jar/plain zip
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] // legacy .doc/.xls/.ppt
const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66] // "{\rtf"

function startsWithMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

/**
 * Sniffs the raw byte signature of a CV upload. Never throws — a zero-byte
 * or otherwise too-short buffer simply falls through to 'unknown', because
 * every magic-number check above is bounds-checked against `bytes.length`
 * before it ever indexes into the array.
 */
export function sniffFileType(bytes: Uint8Array): SniffedType {
  if (startsWithMagic(bytes, PDF_MAGIC)) return 'pdf'
  if (startsWithMagic(bytes, ZIP_MAGIC)) return 'zip'
  if (startsWithMagic(bytes, OLE2_MAGIC)) return 'ole2'
  if (startsWithMagic(bytes, RTF_MAGIC)) return 'rtf'
  return 'unknown'
}

// Local file headers live at the front of a zip archive, the central
// directory at the back — capping the scan to the first + last 64 KiB
// means a 10 MiB file is never scanned end to end (T-06-30).
const SCAN_WINDOW_BYTES = 64 * 1024

// The two entry names that distinguish a real DOCX from any other zip
// (plain zip, ODT — which instead carries a `mimetype` entry of
// `application/vnd.oasis.opendocument.text`, jar, xlsx, pptx, ...).
const CONTENT_TYPES_ENTRY = '[Content_Types].xml'
const DOCUMENT_XML_ENTRY = 'word/document.xml'

function containsAsciiSequence(bytes: Uint8Array, needle: string): boolean {
  const needleBytes = Array.from(needle, (c) => c.charCodeAt(0))
  const n = needleBytes.length
  if (bytes.length < n) return false
  outer: for (let i = 0; i <= bytes.length - n; i++) {
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needleBytes[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * True only when the zip archive contains BOTH `[Content_Types].xml` AND
 * `word/document.xml` — the two entries that mark a real DOCX (as opposed
 * to an ODT, a plain zip, a jar, an xlsx, a pptx, ...). Scans only the
 * first and last 64 KiB of the buffer (see SCAN_WINDOW_BYTES above), so on
 * a buffer that is itself a truncated HEAD READ of a larger object (the
 * apply-path confirm-time sniff, src/app/(public)/apply/[orgSlug]/actions.ts)
 * this can return a false NEGATIVE for a genuine DOCX whose entry order
 * puts `word/document.xml` beyond the read window — callers that only have
 * a partial read must treat a `false` result as INCONCLUSIVE, not as proof
 * the file isn't a DOCX. Never throws on a short or empty buffer.
 */
export function isDocxArchive(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  const head = bytes.subarray(0, SCAN_WINDOW_BYTES)
  const tail =
    bytes.length > SCAN_WINDOW_BYTES ? bytes.subarray(bytes.length - SCAN_WINDOW_BYTES) : bytes
  const hasContentTypes =
    containsAsciiSequence(head, CONTENT_TYPES_ENTRY) ||
    containsAsciiSequence(tail, CONTENT_TYPES_ENTRY)
  const hasDocumentXml =
    containsAsciiSequence(head, DOCUMENT_XML_ENTRY) || containsAsciiSequence(tail, DOCUMENT_XML_ENTRY)
  return hasContentTypes && hasDocumentXml
}

export type UploadableCVCheck =
  | { ok: true; mime: string }
  | { ok: false; reason: 'wrong-format' | 'unsupported-format'; message: string }

/**
 * Decides whether a fully-buffered upload is one of the two supported CV
 * formats (PDF or DOCX) given the FULL bytes of the file — this is only
 * safe to call when the caller genuinely holds every byte (the recruiter
 * upload path, which reads the whole `File` before any Storage write). It
 * is NOT used by the apply-form confirm-time sniff, which only ever has a
 * bounded head read and applies its own, more lenient contradiction rules
 * (see the comment on isDocxArchive above and confirmApplyAction).
 *
 * Two rejection reasons, matching the plan's distinction:
 *   - 'wrong-format': the bytes genuinely ARE one of the two supported
 *     formats, just mislabelled (a DOCX saved as .pdf, or vice versa).
 *   - 'unsupported-format': the bytes are NOT a supported format at all,
 *     regardless of what they were labelled (legacy .doc, RTF, ODT, plain
 *     text, ...).
 *
 * Never throws — returns a discriminated result.
 */
export function assertUploadableCV(bytes: Uint8Array, declaredMime: string): UploadableCVCheck {
  const sniffed = sniffFileType(bytes)

  if (sniffed === 'pdf') {
    if (declaredMime === PDF_MIME) return { ok: true, mime: PDF_MIME }
    // Real bytes ARE a supported format (PDF) — just labelled as the other.
    return { ok: false, reason: 'wrong-format', message: CV_WRONG_FORMAT_MESSAGE }
  }

  if (sniffed === 'zip') {
    if (isDocxArchive(bytes)) {
      if (declaredMime === DOCX_MIME) return { ok: true, mime: DOCX_MIME }
      return { ok: false, reason: 'wrong-format', message: CV_WRONG_FORMAT_MESSAGE }
    }
    // A zip archive that is NOT a real DOCX (ODT, a plain zip, a jar, an
    // xlsx/pptx, ...) is never a supported format, whatever it was labelled.
    return { ok: false, reason: 'unsupported-format', message: CV_UNSUPPORTED_FORMAT_MESSAGE }
  }

  // ole2 (legacy .doc/.xls/.ppt), rtf, or unknown: never a supported format.
  return { ok: false, reason: 'unsupported-format', message: CV_UNSUPPORTED_FORMAT_MESSAGE }
}
