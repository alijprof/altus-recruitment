/**
 * @vitest-environment node
 *
 * branded-cv-document — the standard branded CV template (BCV-02/BCV-03).
 * Every assertion here is a pin on the real mapper -> real renderer chain:
 * a `candidates`-shaped fixture (INCLUDING email/phone/salary) goes through
 * `toBrandedCvData` (08-03) and then `renderBrandedCv` (this plan), and we
 * extract the text back out of the generated PDF bytes with `unpdf` — the
 * only honest way to pin "this document never contains a contact detail or
 * a salary figure", since a compile-time type guarantee on `BrandedCvData`
 * only proves the PROPS can't carry those fields, not that nothing else in
 * the render path could leak them.
 *
 * See 08-04-PLAN.md Task 2 <behavior> for the full list this file pins.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getDocumentProxy, extractText } from 'unpdf'
import { describe, expect, it } from 'vitest'

import { toBrandedCvData } from '@/lib/pdf/branded-cv-data'
import type { BrandedCvBranding } from '@/lib/pdf/branded-cv-document'
import { renderBrandedCv } from '@/lib/pdf/branded-cv-document'

// A 1x1 transparent PNG — the smallest possible valid PNG (68 bytes: the
// 8-byte signature + minimal IHDR/IDAT/IEND chunks). Constructed in-test per
// the plan's instruction (no fixture file on disk, no network fetch); this
// exact base64 constant is a well-known minimal-PNG test fixture.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const TINY_PNG_BYTES = new Uint8Array(Buffer.from(TINY_PNG_BASE64, 'base64'))

const ORG_BRANDING: Omit<BrandedCvBranding, 'logo'> = {
  orgName: 'Steele Charles Ltd',
  primary: '#1A6B50',
  secondary: '#5DCAA5',
}

// A realistic `candidates`-shaped source row, INCLUDING the fields BCV-03
// requires to be structurally excluded. Every stripped field carries a
// unique, easily-greppable value so the absence assertions below can prove
// none of them leaked through by any path (mirrors the CONTACT_STRIP_ROW
// pattern in tests/unit/lib/pdf/branded-cv-data.test.ts, extended to the
// full render chain).
const LONG_ABOUT = Array.from(
  { length: 22 },
  (_, i) =>
    `Paragraph sentence number ${i + 1} describing extensive professional delivery, technical leadership, and cross-functional mentoring experience gained across several large engineering organisations.`,
).join(' ')

const FULL_FIXTURE_ROW = {
  full_name: 'Renée Müller',
  headline: 'Senior Full-Stack Engineer',
  about: `Day-rate history around £850 per day on recent contracts. ${LONG_ABOUT}`,
  current_role_title: 'Staff Engineer',
  current_company: 'Acme Corp',
  seniority_level: 'Staff',
  years_experience: 12,
  location: 'Manchester, UK',
  skills: [
    'TypeScript',
    'React',
    'Node.js',
    'PostgreSQL',
    'AWS',
    'GraphQL',
    'Docker',
    'Kubernetes',
    'Python',
    'Go',
  ],
  sector_tags: ['Fintech', 'Healthtech'],
  work_experience: Array.from({ length: 8 }, (_, i) => ({
    title: `Engineer Role ${i + 1}`,
    company: `Fixture Company ${i + 1} Ltd`,
    dates: `20${10 + i}-20${11 + i}`,
  })),
  education: [
    { school: 'Manchester University', degree: 'BSc Computer Science', dates: '2008-2012' },
    { school: 'Open University', degree: 'MSc Software Engineering', dates: '2016-2018' },
  ],
  // The fields under test — must never reach the rendered PDF (BCV-03).
  email: 'renee-muller-strip-pin-9f3e@example.com',
  phone: '+44-7700-STRIP-PIN-900123',
  salary_current_estimate: 65432.17,
  salary_expectation: 78901.23,
  currency: 'GBP',
}

const FULL_FIXTURE_DATA = toBrandedCvData(FULL_FIXTURE_ROW)

/** Builds a plain `Uint8Array` view over a Buffer's bytes, never a raw Node
 * `Buffer` — unpdf 1.6.x explicitly rejects `Buffer` (it subclasses
 * `Uint8Array` but unpdf does a `Buffer.isBuffer` check), mirroring the
 * production pattern already established in
 * tests/unit/lib/pdf/render-foundation.test.ts and src/lib/ai/cv-extract.ts. */
function toUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/** PDF text extraction inserts arbitrary spacing between text runs
 * (kerning-adjusted glyph runs, column breaks) — collapse whitespace before
 * substring matching so assertions aren't flaky on layout details that have
 * nothing to do with actual content. */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

async function extractMergedText(buffer: Buffer): Promise<string> {
  const pdfDocument = await getDocumentProxy(toUint8Array(buffer))
  const { text } = await extractText(pdfDocument, { mergePages: true })
  return normaliseWhitespace(text)
}

async function extractPerPageText(
  buffer: Buffer,
): Promise<{ totalPages: number; pages: string[] }> {
  const pdfDocument = await getDocumentProxy(toUint8Array(buffer))
  const { text, totalPages } = await extractText(pdfDocument)
  return { totalPages, pages: text.map(normaliseWhitespace) }
}

describe('renderBrandedCv — full fixture (BCV-02 content + BCV-03 contact-strip, end to end)', () => {
  it('renders a real PDF starting %PDF- and the extracted text contains name, headline, every skill, every work title/company, and every school', async () => {
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const text = await extractMergedText(buffer)

    expect(text).toContain('Renée Müller')
    expect(text).toContain('Senior Full-Stack Engineer')
    for (const skill of FULL_FIXTURE_DATA.skills) {
      expect(text).toContain(skill)
    }
    for (const entry of FULL_FIXTURE_DATA.work) {
      expect(text).toContain(entry.title)
      expect(text).toContain(entry.company)
    }
    for (const entry of FULL_FIXTURE_DATA.education) {
      expect(text).toContain(entry.school)
    }
  })

  it("extracted text does NOT contain the source candidate row's email, phone or salary values (raw-bytes pin, the stronger check)", async () => {
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })

    const text = await extractMergedText(buffer)
    // The raw buffer, read as latin1, is the stronger pin: PDF text
    // extraction can split a string across content-stream runs in ways
    // that would make a substring check on `text` a false negative for
    // absence — but a value that was NEVER written to the byte stream at
    // all cannot appear in the raw bytes either way.
    const rawBytes = buffer.toString('latin1')

    for (const forbidden of [
      FULL_FIXTURE_ROW.email,
      FULL_FIXTURE_ROW.phone,
      String(FULL_FIXTURE_ROW.salary_current_estimate),
      String(FULL_FIXTURE_ROW.salary_expectation),
    ]) {
      expect(text).not.toContain(forbidden)
      expect(rawBytes).not.toContain(forbidden)
    }
  })

  it('extracted text DOES contain the city-level location (A1 CONFIRMED by the founder 2026-08-12)', async () => {
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })
    const text = await extractMergedText(buffer)
    expect(text).toContain('Manchester, UK')
  })

  it('a £ in free text and a name with é/ü survive extraction intact', async () => {
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })
    const text = await extractMergedText(buffer)
    expect(text).toContain('Renée Müller')
    expect(text).toContain('£850 per day')
  })
})

describe('renderBrandedCv — sparse candidate (only full_name)', () => {
  it('renders exactly one page, with no empty section headings, and does not throw', async () => {
    const sparseData = toBrandedCvData({ full_name: 'Solo Candidate' })

    const buffer = await renderBrandedCv(sparseData, { ...ORG_BRANDING, logo: null })
    const { totalPages, pages } = await extractPerPageText(buffer)

    expect(totalPages).toBe(1)
    expect(pages[0]).toContain('Solo Candidate')
    // Section headings render uppercase (textTransform: 'uppercase' in the
    // template's styles.sectionHeading) — none of them should appear at
    // all, since the sparse candidate has no about/skills/work/education.
    for (const heading of ['PROFILE', 'SKILLS', 'EXPERIENCE', 'EDUCATION']) {
      expect(pages[0]).not.toContain(heading)
    }
    // The footer's org-name/page-number row must still render even on a
    // single, mostly-empty page (see the pagination test's comment for the
    // regression this specifically pins).
    expect(pages[0]).toContain('Page 1 of 1')
  })
})

describe('renderBrandedCv — pagination', () => {
  it('a candidate with 8 work-history entries and a long about paginates to more than one page, and the footer org name AND page-number row appear on every page', async () => {
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })
    const { totalPages, pages } = await extractPerPageText(buffer)

    expect(totalPages).toBeGreaterThan(1)
    expect(pages.length).toBe(totalPages)
    for (const [index, pageText] of pages.entries()) {
      const pageNumber = index + 1
      expect(pageText).toContain(ORG_BRANDING.orgName)
      // Pinned specifically as `Page N of M`, not just a loose
      // "org name appears somewhere" check — the org name also appears
      // inside the separate footer notice sentence ("Candidate contact
      // details available from ..."), so that substring alone would not
      // catch a regression where the footer's org-name/page-number ROW
      // itself silently fails to render (a real bug this suite caught:
      // `lineHeight` set at the Page style level cascaded into the
      // footer's row layout and dropped it — see the comment on
      // `styles.page` in branded-cv-document.tsx).
      expect(pageText).toContain(`Page ${pageNumber} of ${totalPages}`)
    }
  })
})

describe('renderBrandedCv — logo handling', () => {
  it('a PNG logo buffer renders without error', async () => {
    const branding: BrandedCvBranding = {
      ...ORG_BRANDING,
      logo: { data: TINY_PNG_BYTES, format: 'png' },
    }
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, branding)
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('passing logo: null renders the org-name wordmark fallback in the header region of page 1', async () => {
    const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })
    const { pages } = await extractPerPageText(buffer)
    expect(pages[0]).toContain(ORG_BRANDING.orgName)
  })
})

describe('renderBrandedCv — colour safety (T-08-18, safeHex fallback)', () => {
  it.each([['javascript:alert(1)'], ['red'], ['#zzzzzz'], ['#12345']])(
    'an invalid primary %s does not throw and never appears anywhere in the PDF bytes',
    async (invalidPrimary) => {
      const branding: BrandedCvBranding = {
        ...ORG_BRANDING,
        primary: invalidPrimary,
        logo: null,
      }
      // No try/catch, no expect(...).not.toThrow() wrapper around an async
      // call (that matcher only observes synchronous throws, and would
      // silently pass even if the returned promise rejected) — a genuine
      // rejection here fails the test naturally via the unhandled promise.
      const buffer = await renderBrandedCv(FULL_FIXTURE_DATA, branding)
      const rawBytes = buffer.toString('latin1')
      expect(rawBytes).not.toContain(invalidPrimary)
    },
  )
})

// Generates the two founder-review sample PDFs into a gitignored scratch
// directory (`/playwright-report` is already excluded — see .gitignore).
// Guarded behind WRITE_PDF_SAMPLES=1 so ordinary `pnpm test`/CI runs stay
// side-effect free; run explicitly for the Task 3 founder eyeball via:
//   WRITE_PDF_SAMPLES=1 pnpm vitest run tests/unit/lib/pdf/branded-cv-document.test.ts
describe('WRITE_PDF_SAMPLES — founder-review sample generation (Task 3)', () => {
  const shouldWrite = process.env.WRITE_PDF_SAMPLES === '1'

  it.runIf(shouldWrite)(
    'writes sample-with-logo.pdf and sample-no-logo.pdf from the full fixture',
    async () => {
      const outDir = join(process.cwd(), 'playwright-report', 'branded-cv-samples')
      await mkdir(outDir, { recursive: true })

      const withLogo = await renderBrandedCv(FULL_FIXTURE_DATA, {
        ...ORG_BRANDING,
        logo: { data: TINY_PNG_BYTES, format: 'png' },
      })
      const noLogo = await renderBrandedCv(FULL_FIXTURE_DATA, { ...ORG_BRANDING, logo: null })

      await writeFile(join(outDir, 'sample-with-logo.pdf'), withLogo)
      await writeFile(join(outDir, 'sample-no-logo.pdf'), noLogo)

      expect(withLogo.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(noLogo.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    },
  )

  it.skipIf(shouldWrite)('sample generation skipped (set WRITE_PDF_SAMPLES=1 to generate)', () => {
    expect(true).toBe(true)
  })
})
