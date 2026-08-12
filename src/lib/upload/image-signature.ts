// Dependency-free PNG/JPEG magic-byte sniffer that gates logo uploads
// (BCV-04). Mirrors the shape and discipline of src/lib/cv/file-signature.ts
// — bounds-checked prefix matching that never throws, a discriminated
// result, never trusting the client-supplied MIME type alone — but
// deliberately does NOT search a window past offset 0: an image header
// belongs at the start of the file or the file is not the image it claims
// to be. (Contrast file-signature.ts's PDF_HEADER_SEARCH_WINDOW, which
// exists because pdf.js itself tolerates a BOM/junk preamble — no such
// tolerance exists for PNG/JPEG decoders, so mirroring that leniency here
// would just widen the spoofing surface for no compatibility benefit.)
//
// SVG is deliberately unsupported: @react-pdf/renderer's Image component
// accepts JPG/PNG/Buffer sources only and has no SVG rasterisation, so an
// accepted SVG logo would upload fine and preview fine in the browser, then
// silently vanish from the generated branded PDF (08-RESEARCH.md Pitfall 2).
// GIF, PDF, WebP and executables are rejected outright — this module is a
// strict PNG/JPEG allowlist, not a "reject known-bad" denylist.
//
// Deliberately a SEPARATE module from src/lib/cv/file-signature.ts rather
// than an extension of it: the CV sniffer's contract is PDF/DOCX for the
// parse pipeline, and merging the two would couple a customer-facing
// branding-upload gate to the CV parse gate for no shared benefit.
//
// NO `import 'server-only'` — must be importable from vitest, RSC and
// Server Actions alike. No external dependencies.

export type SniffedImageType = 'png' | 'jpeg' | 'unknown'

// Magic bytes (08-03-PLAN.md <interfaces>).
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]

const PNG_MIME = 'image/png'
const JPEG_MIME = 'image/jpeg'

export const MAX_LOGO_BYTES = 2 * 1024 * 1024

export const LOGO_WRONG_FORMAT_MESSAGE =
  'This file’s contents don’t match its declared type — save it as a real PNG or JPEG and upload it again.'

export const LOGO_UNSUPPORTED_FORMAT_MESSAGE =
  'We support PNG or JPEG logos only (SVG is not supported for PDF rendering). Save your logo as a PNG or JPEG and upload it again.'

export const LOGO_TOO_LARGE_MESSAGE = 'This logo is too large — please upload a file under 2 MB.'

function startsWithMagic(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false
  }
  return true
}

/**
 * Sniffs the raw byte signature of an uploaded logo. Never throws — a
 * zero-byte or otherwise too-short buffer simply falls through to
 * 'unknown', because every magic-number check below is bounds-checked
 * against `bytes.length` before it ever indexes into the array. Unlike
 * file-signature.ts's PDF check, this deliberately does NOT search a
 * window past offset 0 — see the header comment.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType {
  if (startsWithMagic(bytes, PNG_MAGIC)) return 'png'
  if (startsWithMagic(bytes, JPEG_MAGIC)) return 'jpeg'
  return 'unknown'
}

export type UploadableLogoCheck =
  | { ok: true; mime: string; ext: 'png' | 'jpg' }
  | { ok: false; reason: 'wrong-format' | 'unsupported-format' | 'too-large'; message: string }

/**
 * Decides whether a fully-buffered upload is an acceptable org logo: real
 * PNG or JPEG bytes (never trusting the client-supplied MIME alone), under
 * the size cap. Never throws — returns a discriminated result.
 *
 * `byteLength` is taken as a separate parameter (rather than derived from
 * `bytes.length`) so a caller that only holds a head-read of a larger
 * upload can still enforce the size cap against the real, full byte count.
 *
 * Two rejection reasons, matching assertUploadableCV's distinction:
 *   - 'wrong-format': the bytes genuinely ARE a supported format (PNG or
 *     JPEG), just labelled as the other.
 *   - 'unsupported-format': the bytes are not PNG or JPEG at all, regardless
 *     of what they were labelled (SVG, GIF, PDF, WebP, executable, ...).
 */
export function assertUploadableLogo(
  bytes: Uint8Array,
  declaredMime: string,
  byteLength: number,
): UploadableLogoCheck {
  if (byteLength > MAX_LOGO_BYTES) {
    return { ok: false, reason: 'too-large', message: LOGO_TOO_LARGE_MESSAGE }
  }

  const sniffed = sniffImageType(bytes)

  if (sniffed === 'png') {
    if (declaredMime === PNG_MIME) return { ok: true, mime: PNG_MIME, ext: 'png' }
    return { ok: false, reason: 'wrong-format', message: LOGO_WRONG_FORMAT_MESSAGE }
  }

  if (sniffed === 'jpeg') {
    if (declaredMime === JPEG_MIME) return { ok: true, mime: JPEG_MIME, ext: 'jpg' }
    return { ok: false, reason: 'wrong-format', message: LOGO_WRONG_FORMAT_MESSAGE }
  }

  return { ok: false, reason: 'unsupported-format', message: LOGO_UNSUPPORTED_FORMAT_MESSAGE }
}
