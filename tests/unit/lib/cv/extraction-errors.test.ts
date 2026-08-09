/**
 * @vitest-environment node
 *
 * `classifyExtractionError` — driven against the REAL errors thrown by the
 * production extractor (`extractTextFromBuffer`) over the Tier-2 fixture
 * corpus, not synthetic stand-ins. Every `tests/fixtures/cv-corpus/manifest.json`
 * entry that records an `expectErrorName` is a real, independently-verified
 * library error (06-03-PLAN.md's generator PRINTED the observed name) — this
 * suite catches the file, extracts with the manifest's declared mime, catches
 * the real thrown error, and asserts the classifier maps it to a non-null,
 * `retryable: false` result whose `detail` never carries `err.message`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// Stub `server-only` so cv-extract.ts (which has `import 'server-only'` at
// the top) can be imported in this Node test environment — same idiom as
// tests/unit/lib/ai/cv-extract-corpus.test.ts.
vi.mock('server-only', () => ({}))

import {
  CV_DAMAGED_FILE_MESSAGE,
  CV_PASSWORD_PROTECTED_MESSAGE,
  CV_UNSUPPORTED_FORMAT_MESSAGE,
  CV_WRONG_FORMAT_MESSAGE,
} from '@/lib/cv/parse-messages'

import { classifyExtractionError } from '@/lib/cv/extraction-errors'

type ManifestEntry = {
  file: string
  tier: 1 | 2 | 'hostile'
  mime: string
  expect: 'parse' | 'reject'
  expectErrorName?: string
}

const CORPUS_DIR = join(process.cwd(), 'tests/fixtures/cv-corpus')

const manifest: ManifestEntry[] = JSON.parse(
  readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8'),
) as ManifestEntry[]

// Only Tier-2 entries that actually THROW (a caught, named error) belong
// here — t2-pdf-scanned-no-text.pdf rejects via the MIN_EXTRACTED_CHARS
// branch downstream in parse-cv.ts, not a caught exception, so it has no
// `expectErrorName` and is out of scope for this classifier.
const tier2ThrowingEntries = manifest.filter(
  (entry) => entry.tier === 2 && entry.expect === 'reject' && entry.expectErrorName,
)

// Sanity: fail loudly if the manifest shape changes underneath us and this
// suite silently stops exercising anything.
it('the corpus manifest still has Tier-2 throwing fixtures to drive this suite from', () => {
  expect(tier2ThrowingEntries.length).toBeGreaterThan(0)
})

describe.each(tier2ThrowingEntries)('$file (real corpus error)', (entry) => {
  it(`classifyExtractionError maps the real ${entry.expectErrorName} to a non-null, unretryable classification`, async () => {
    const { extractTextFromBuffer } = await import('@/lib/ai/cv-extract')
    const buffer = readFileSync(join(CORPUS_DIR, entry.file))

    let caught: unknown
    try {
      await extractTextFromBuffer(buffer, entry.mime)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe(entry.expectErrorName)

    const classification = classifyExtractionError(caught, entry.mime)
    expect(classification).not.toBeNull()
    expect(classification?.retryable).toBe(false)
    // detail is PII-free: only the error name + mime, never err.message
    // (pdf.js / mammoth messages can echo file-content fragments).
    expect(classification?.detail).toBe(`extract-text: ${(caught as Error).name} (${entry.mime})`)
    expect(classification?.detail).not.toContain((caught as Error).message)
  })
})

describe('classifyExtractionError message mapping', () => {
  it('maps InvalidPDFException to the damaged-file message', () => {
    const err = new Error('Invalid PDF structure.')
    err.name = 'InvalidPDFException'
    expect(classifyExtractionError(err, 'application/pdf')).toMatchObject({
      message: CV_DAMAGED_FILE_MESSAGE,
      retryable: false,
    })
  })

  it('maps PasswordException to the password-protected message', () => {
    const err = new Error('No password given')
    err.name = 'PasswordException'
    expect(classifyExtractionError(err, 'application/pdf')).toMatchObject({
      message: CV_PASSWORD_PROTECTED_MESSAGE,
      retryable: false,
    })
  })

  it('maps a "Can\'t find end of central directory" message to the wrong-format message', () => {
    const err = new Error("Can't find end of central directory : is this a zip file?")
    expect(
      classifyExtractionError(
        err,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toMatchObject({
      message: CV_WRONG_FORMAT_MESSAGE,
      retryable: false,
    })
  })

  it('maps UnsupportedCVMimeTypeError to the unsupported-format message', () => {
    const err = new Error('Unsupported CV mime type: text/plain')
    err.name = 'UnsupportedCVMimeTypeError'
    expect(classifyExtractionError(err, 'text/plain')).toMatchObject({
      message: CV_UNSUPPORTED_FORMAT_MESSAGE,
      retryable: false,
    })
  })

  it('returns null for an unrecognised error — caller keeps generic, retryable behaviour', () => {
    const err = new Error('ECONNRESET')
    err.name = 'NetworkError'
    expect(classifyExtractionError(err, 'application/pdf')).toBeNull()
  })

  it('returns null for a non-Error thrown value', () => {
    expect(classifyExtractionError('a string was thrown', 'application/pdf')).toBeNull()
    expect(classifyExtractionError(undefined, 'application/pdf')).toBeNull()
  })

  it('detail never contains the raw error message, only the name and mime', () => {
    const err = new Error('Invalid PDF structure. Trailer offset 0x4a2 bytes: <candidate content>')
    err.name = 'InvalidPDFException'
    const result = classifyExtractionError(err, 'application/pdf')
    expect(result?.detail).toBe('extract-text: InvalidPDFException (application/pdf)')
    expect(result?.detail).not.toContain('candidate content')
  })

  it('no classification message contains the substring "AI budget"', () => {
    const cases: Array<[Error, string]> = [
      [Object.assign(new Error(''), { name: 'InvalidPDFException' }), 'application/pdf'],
      [Object.assign(new Error(''), { name: 'PasswordException' }), 'application/pdf'],
      [
        new Error("Can't find end of central directory"),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      [Object.assign(new Error(''), { name: 'UnsupportedCVMimeTypeError' }), 'text/plain'],
    ]
    for (const [err, mime] of cases) {
      const classification = classifyExtractionError(err, mime)
      expect(classification?.message.includes('AI budget')).toBe(false)
    }
  })
})
