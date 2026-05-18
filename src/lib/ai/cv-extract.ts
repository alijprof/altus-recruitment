import 'server-only'

import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'

// RESEARCH §15. PDF via unpdf (pure-JS PDF.js — Vercel-safe, no native
// bindings). DOCX via mammoth (Office Open XML → raw text). Both run in
// Node runtime; do not call from edge runtime.
//
// Throws on unsupported mime types so the caller (Inngest function)
// surfaces a NonRetriableError and stops the pipeline cleanly.

export const PDF_MIME = 'application/pdf'
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type SupportedCVMimeType = typeof PDF_MIME | typeof DOCX_MIME

export class UnsupportedCVMimeTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported CV mime type: ${mimeType}`)
    this.name = 'UnsupportedCVMimeTypeError'
  }
}

function normaliseWhitespace(text: string): string {
  // Collapse runs of whitespace + trim. CVs frequently have stray tabs and
  // double spaces from PDF column extraction — Claude tolerates them but
  // they bloat the token count for no benefit.
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Extract plain text from a CV buffer. Routes by mime type.
 */
export async function extractTextFromBuffer(
  buffer: ArrayBuffer | Uint8Array,
  mimeType: string,
): Promise<string> {
  if (mimeType === PDF_MIME) {
    // unpdf wants a Uint8Array view into the buffer.
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    const pdf = await getDocumentProxy(bytes)
    const { text } = await extractText(pdf, { mergePages: true })
    // `text` is typed as `string | string[]` (`string[]` when mergePages is
    // false). With mergePages: true unpdf returns a single string, but the
    // type doesn't narrow — defensively join.
    const merged = Array.isArray(text) ? text.join('\n\n') : text
    return normaliseWhitespace(merged)
  }
  if (mimeType === DOCX_MIME) {
    // mammoth's NodeJS API wants a Buffer. Inngest functions run in Node
    // so `Buffer` is available globally; type it via globalThis to avoid
    // pulling @types/node into client-facing modules.
    const nodeBuffer =
      buffer instanceof Uint8Array
        ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : Buffer.from(buffer)
    const result = await mammoth.extractRawText({ buffer: nodeBuffer })
    return normaliseWhitespace(result.value)
  }
  throw new UnsupportedCVMimeTypeError(mimeType)
}
