/**
 * @vitest-environment node
 *
 * file-signature — dependency-free CV byte-signature detection, driven
 * against the REAL Tier-1/Tier-2/hostile corpus fixtures used throughout
 * this phase, not synthetic stand-ins. See 06-08-PLAN.md Task 1 <behavior>.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CV_UNSUPPORTED_FORMAT_MESSAGE, CV_WRONG_FORMAT_MESSAGE } from '@/lib/cv/parse-messages'
import { assertUploadableCV, isDocxArchive, sniffFileType } from '@/lib/cv/file-signature'

const CORPUS_DIR = join(process.cwd(), 'tests/fixtures/cv-corpus')
const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type ManifestEntry = { file: string; tier: 1 | 2 | 'hostile'; mime: string }

const manifest: ManifestEntry[] = JSON.parse(
  readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8'),
) as ManifestEntry[]

function loadBytes(relPath: string): Uint8Array {
  return readFileSync(join(CORPUS_DIR, relPath))
}

describe('sniffFileType — every Tier-1 fixture', () => {
  const tier1Pdfs = manifest.filter((e) => e.tier === 1 && e.file.endsWith('.pdf'))
  const tier1Docxs = manifest.filter((e) => e.tier === 1 && e.file.endsWith('.docx'))

  it('has both PDF and DOCX Tier-1 fixtures to drive this suite from', () => {
    expect(tier1Pdfs.length).toBeGreaterThan(0)
    expect(tier1Docxs.length).toBeGreaterThan(0)
  })

  describe.each(tier1Pdfs)('$file', (entry) => {
    it('sniffs as pdf and is accepted', () => {
      const bytes = loadBytes(entry.file)
      expect(sniffFileType(bytes)).toBe('pdf')
      const result = assertUploadableCV(bytes, PDF_MIME)
      expect(result.ok).toBe(true)
    })
  })

  describe.each(tier1Docxs)('$file', (entry) => {
    it('sniffs as zip, isDocxArchive is true, and is accepted', () => {
      const bytes = loadBytes(entry.file)
      expect(sniffFileType(bytes)).toBe('zip')
      expect(isDocxArchive(bytes)).toBe(true)
      const result = assertUploadableCV(bytes, DOCX_MIME)
      expect(result.ok).toBe(true)
    })
  })
})

describe('sniffFileType/assertUploadableCV — Tier-2 rejection classes', () => {
  it('t2-docx-renamed.pdf: real DOCX bytes labelled .pdf sniff as zip and are rejected wrong-format', () => {
    const bytes = loadBytes('tier2/t2-docx-renamed.pdf')
    expect(sniffFileType(bytes)).toBe('zip')
    expect(isDocxArchive(bytes)).toBe(true)
    const result = assertUploadableCV(bytes, PDF_MIME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('wrong-format')
      expect(result.message).toBe(CV_WRONG_FORMAT_MESSAGE)
    }
  })

  it('t2-pdf-renamed.docx: real PDF bytes labelled .docx sniff as pdf and are rejected wrong-format', () => {
    const bytes = loadBytes('tier2/t2-pdf-renamed.docx')
    expect(sniffFileType(bytes)).toBe('pdf')
    const result = assertUploadableCV(bytes, DOCX_MIME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('wrong-format')
      expect(result.message).toBe(CV_WRONG_FORMAT_MESSAGE)
    }
  })

  it('t2-opendocument.odt: sniffs as zip but is NOT a DOCX archive — rejected unsupported-format, never accepted as a DOCX', () => {
    const bytes = loadBytes('tier2/t2-opendocument.odt')
    expect(sniffFileType(bytes)).toBe('zip')
    expect(isDocxArchive(bytes)).toBe(false)
    const result = assertUploadableCV(bytes, DOCX_MIME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-format')
      expect(result.message).toBe(CV_UNSUPPORTED_FORMAT_MESSAGE)
    }
  })

  it('t2-legacy.doc: sniffs as ole2 (legacy binary compound file) — unsupported-format', () => {
    const bytes = loadBytes('tier2/t2-legacy.doc')
    expect(sniffFileType(bytes)).toBe('ole2')
    const result = assertUploadableCV(bytes, 'application/msword')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-format')
      expect(result.message).toBe(CV_UNSUPPORTED_FORMAT_MESSAGE)
    }
  })

  it('t2-plain.rtf: sniffs as rtf — unsupported-format', () => {
    const bytes = loadBytes('tier2/t2-plain.rtf')
    expect(sniffFileType(bytes)).toBe('rtf')
    const result = assertUploadableCV(bytes, 'application/rtf')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-format')
      expect(result.message).toBe(CV_UNSUPPORTED_FORMAT_MESSAGE)
    }
  })

  it('t2-plain.txt: sniffs as unknown — unsupported-format', () => {
    const bytes = loadBytes('tier2/t2-plain.txt')
    expect(sniffFileType(bytes)).toBe('unknown')
    const result = assertUploadableCV(bytes, 'text/plain')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-format')
      expect(result.message).toBe(CV_UNSUPPORTED_FORMAT_MESSAGE)
    }
  })

  it('t2-pdf-corrupt.pdf: valid %PDF- header, garbage body — ACCEPTED here, not a signature problem', () => {
    // A signature check has no way (and no business trying) to tell a
    // well-formed PDF from one whose body is garbage after the header —
    // that requires actually parsing the object structure, which is
    // classifyExtractionError's job (src/lib/cv/extraction-errors.ts,
    // plan 06-07), surfacing CV_DAMAGED_FILE_MESSAGE once pdf.js throws
    // InvalidPDFException downstream. Asserting acceptance here makes that
    // division of responsibility a tested decision, not an accident.
    const bytes = loadBytes('tier2/t2-pdf-corrupt.pdf')
    expect(sniffFileType(bytes)).toBe('pdf')
    const result = assertUploadableCV(bytes, PDF_MIME)
    expect(result.ok).toBe(true)
  })
})

describe('sniffFileType/isDocxArchive — boundary safety (no out-of-bounds read)', () => {
  it('a zero-byte buffer returns unknown without throwing', () => {
    expect(() => sniffFileType(new Uint8Array(0))).not.toThrow()
    expect(sniffFileType(new Uint8Array(0))).toBe('unknown')
  })

  it('a 3-byte buffer (shorter than every magic number) returns unknown without throwing', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44]) // "%PD" — a truncated PDF magic
    expect(() => sniffFileType(bytes)).not.toThrow()
    expect(sniffFileType(bytes)).toBe('unknown')
  })

  it('isDocxArchive on a zero-byte or short buffer returns false without throwing', () => {
    expect(() => isDocxArchive(new Uint8Array(0))).not.toThrow()
    expect(isDocxArchive(new Uint8Array(0))).toBe(false)
    expect(isDocxArchive(new Uint8Array([0x50, 0x4b]))).toBe(false)
  })

  it('assertUploadableCV on a zero-byte buffer rejects unsupported-format without throwing', () => {
    expect(() => assertUploadableCV(new Uint8Array(0), PDF_MIME)).not.toThrow()
    const result = assertUploadableCV(new Uint8Array(0), PDF_MIME)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-format')
  })
})

describe('hostile corpus — structurally valid PDF/DOCX, sniffs and is accepted', () => {
  const hostileEntries = manifest.filter((e) => e.tier === 'hostile')

  it('has hostile fixtures to drive this suite from', () => {
    expect(hostileEntries.length).toBeGreaterThan(0)
  })

  describe.each(hostileEntries)('$file', (entry) => {
    it('sniffs correctly for its declared mime and is accepted (NUL-byte hostility is a downstream sanitisation concern, plan 06-06, not a signature problem)', () => {
      const bytes = loadBytes(entry.file)
      if (entry.mime === PDF_MIME) {
        expect(sniffFileType(bytes)).toBe('pdf')
      } else if (entry.mime === DOCX_MIME) {
        expect(sniffFileType(bytes)).toBe('zip')
        expect(isDocxArchive(bytes)).toBe(true)
      }
      const result = assertUploadableCV(bytes, entry.mime)
      expect(result.ok).toBe(true)
    })
  })
})

describe('corpus coverage sanity', () => {
  it('the manifest still has fixtures to drive this suite from (guards against a silently emptied corpus)', () => {
    expect(manifest.length).toBeGreaterThan(15)
  })
})
