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

// ---------------------------------------------------------------------------
// Review 2026-08-09 CR-02: the sniffer must not be STRICTER than the parser
// it gates. unpdf → pdf.js's checkHeader() searches the first 1024 bytes for
// "%PDF-" (node_modules/unpdf/dist/pdfjs.mjs: `function Uc(t,e,n=1024,s=!1)`,
// called as `Uc(e, X1)` with X1 = [37,80,68,70,45]) and moveStart()s to it,
// so a BOM- or junk-prefixed PDF parses perfectly. Requiring the magic at
// offset 0 hard-rejected files already sitting in customers' back-books —
// and on the apply path rejected them into an un-retryable dead end.
// ---------------------------------------------------------------------------
describe('sniffFileType — prefixed PDFs (CR-02: mirror pdf.js 1024-byte header window)', () => {
  const PDF_MAGIC = '%PDF-'
  const HEADER_WINDOW = 1024

  function pdfAfterPrefix(prefixLength: number): Uint8Array {
    // A synthetic buffer: `prefixLength` bytes of non-magic filler, then the
    // header. Only the header search is under test here, not parseability.
    const magic = Array.from(PDF_MAGIC, (c) => c.charCodeAt(0))
    const bytes = new Uint8Array(prefixLength + magic.length + 32)
    bytes.fill(0x20, 0, prefixLength) // spaces — never a magic number
    bytes.set(magic, prefixLength)
    return bytes
  }

  it('accepts the real BOM-prefixed corpus fixture as a PDF', () => {
    const bytes = loadBytes('tier1/t1-pdf-bom-prefixed.pdf')
    // Pin the premise: the magic is genuinely NOT at offset 0.
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(sniffFileType(bytes)).toBe('pdf')
    expect(assertUploadableCV(bytes, PDF_MIME).ok).toBe(true)
  })

  it('accepts the real junk-prefixed corpus fixture as a PDF', () => {
    const bytes = loadBytes('tier1/t1-pdf-junk-prefixed.pdf')
    expect(bytes[0]).not.toBe(0x25) // not '%' — magic is not at offset 0
    expect(sniffFileType(bytes)).toBe('pdf')
    expect(assertUploadableCV(bytes, PDF_MIME).ok).toBe(true)
  })

  it('finds the header at the last offset that still FITS in the window', () => {
    // pdf.js peeks 1024 bytes and requires the whole signature inside them,
    // so the last valid start offset is 1024 - 5 = 1019.
    expect(sniffFileType(pdfAfterPrefix(HEADER_WINDOW - PDF_MAGIC.length))).toBe('pdf')
  })

  it('does NOT find a header that starts one byte beyond the window', () => {
    expect(sniffFileType(pdfAfterPrefix(HEADER_WINDOW - PDF_MAGIC.length + 1))).toBe('unknown')
  })

  it('still classifies a zip as zip even when %PDF- appears inside its first KiB', () => {
    // Ordering guarantee: offset-0 signatures win. Widening the PDF search
    // must not reclassify a genuine DOCX (which would trade CR-02's false
    // rejection for a new one).
    const zipWithPdfString = new Uint8Array(200)
    zipWithPdfString.set([0x50, 0x4b, 0x03, 0x04], 0) // "PK\x03\x04"
    zipWithPdfString.set(
      Array.from(PDF_MAGIC, (c) => c.charCodeAt(0)),
      64,
    )
    expect(sniffFileType(zipWithPdfString)).toBe('zip')
  })

  it('a buffer with no header anywhere is still unknown', () => {
    expect(sniffFileType(new Uint8Array(2048).fill(0x20))).toBe('unknown')
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
