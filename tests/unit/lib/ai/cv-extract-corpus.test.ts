/**
 * @vitest-environment node
 *
 * Layer 1 of the Phase-6 three-layer CV-intake harness — manifest-driven,
 * runs the REAL production extractor (`extractTextFromBuffer`) over the
 * entire fixture corpus in `tests/fixtures/cv-corpus/`. Fast, no database,
 * no network, no AI: this is the layer that runs on every `pnpm test`.
 *
 * The suite is generated entirely from `manifest.json` — there is no
 * hand-picked expectation duplicated in this file. Add a fixture to the
 * manifest and this file automatically gains coverage for it; nothing here
 * needs editing.
 *
 * ---------------------------------------------------------------------
 * DELIBERATE RED STATE — READ BEFORE "FIXING" A FAILURE HERE
 * ---------------------------------------------------------------------
 * EXPECTED FAILURE COUNT: 3
 *
 * The three `hostile/*` fixtures (`hostile-pdf-tounicode-nul.pdf`,
 * `hostile-docx-raw-nul.docx`, `hostile-docx-charref-nul.docx`) each carry
 * an independently-verified mechanism that makes the production extractor
 * emit a literal U+0000 into the returned text (a ToUnicode CMap glyph
 * mapped to NUL, a raw 0x00 byte inside a preserved XML text run, and an
 * XML character reference `&#x0;` that decodes to NUL). `normaliseWhitespace`
 * in `src/lib/ai/cv-extract.ts` does not currently strip NUL, so the "must
 * not emit U+0000" assertion on each of these three fixtures FAILS today.
 * That is correct and expected — these are the first RED tests of Phase 6.
 *
 * Plan 06-06 ships the sanitiser inside `normaliseWhitespace` that turns
 * these three green. Until then:
 *   - The correct response to a red `hostile/*` test is to SHIP THE
 *     SANITISER (plan 06-06), not to weaken this assertion or delete the
 *     fixture.
 *   - If `pnpm test` reports MORE than 3 failures, or failures in any file
 *     outside `hostile/*`, that is new breakage — investigate it, it is not
 *     part of this deliberate RED state.
 *   - If a `hostile/*` test unexpectedly PASSES before 06-06 lands, the
 *     FIXTURE is wrong (see `tests/fixtures/cv-corpus/README.md`), not the
 *     bug fixed early — check whether the corpus was regenerated with a
 *     different Chromium version that changed font subsetting.
 * ---------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

// Stub `server-only` so cv-extract.ts (which has `import 'server-only'` at
// the top) can be imported in this Node test environment. Must be
// registered before the dynamic import below — vitest hoists vi.mock calls
// ahead of module loading regardless of source order.
vi.mock('server-only', () => ({}))

type ManifestEntry = {
  file: string
  tier: 1 | 2 | 'hostile'
  mime: string
  declaredExtension: string
  expect: 'parse' | 'reject'
  minChars?: number
  mustContain?: string[]
  expectNulCount?: 0 | '>0'
  expectErrorName?: string
  expectMinCharsBelow?: number
  why: string
}

const CORPUS_DIR = join(process.cwd(), 'tests/fixtures/cv-corpus')

const manifest: ManifestEntry[] = JSON.parse(
  readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8'),
) as ManifestEntry[]

// Local helpers only — do NOT import the production sanitiser (it does not
// exist yet, and importing it later would make this test assert the fix
// against itself instead of against the real extractor's raw output).
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

function countNul(text: string): number {
  return (text.match(/\u0000/g) ?? []).length
}

function countLoneSurrogates(text: string): number {
  return (text.match(LONE_SURROGATE_RE) ?? []).length
}

// Populated by the dynamic import in beforeAll — the plan's interface
// contract requires a dynamic `await import('@/lib/ai/cv-extract')`
// rather than a static import, so vi.mock('server-only', ...) above is
// guaranteed registered first regardless of hoisting behaviour.
let extractTextFromBuffer: (buffer: ArrayBuffer | Uint8Array, mimeType: string) => Promise<string>

beforeAll(async () => {
  const mod = await import('@/lib/ai/cv-extract')
  extractTextFromBuffer = mod.extractTextFromBuffer
})

// Tracks which manifest entries actually had a test body execute, so we
// can assert every fixture in the manifest is exercised — a fixture with
// no matching test is itself a failure. Populated at the top of every
// generated test body (including the deliberately-red hostile ones) so
// coverage is recorded regardless of pass/fail.
const coveredFiles = new Set<string>()

describe.each(manifest)('$file', (entry) => {
  // Read once per fixture at suite-construction time — cheap, and matches
  // production's own buffer type (Node Buffer, a Uint8Array subclass; see
  // parse-cv.ts's `Buffer.from(base64Buffer, 'base64')`).
  const buffer = readFileSync(join(CORPUS_DIR, entry.file))

  if (entry.tier === 'hostile') {
    // RED UNTIL PLAN 06-06 — see the header comment above.
    it(`${entry.file}: extractor must not emit U+0000 (RED until 06-06 sanitises normaliseWhitespace)`, async () => {
      coveredFiles.add(entry.file)
      const text = await extractTextFromBuffer(buffer, entry.mime)
      expect(countNul(text)).toBe(0)
    })
    return
  }

  if (entry.expect === 'parse') {
    it(`${entry.file}: extracts real text with the expected content and zero illegal bytes`, async () => {
      coveredFiles.add(entry.file)
      const text = await extractTextFromBuffer(buffer, entry.mime)

      if (entry.minChars !== undefined) {
        expect(text.length).toBeGreaterThanOrEqual(entry.minChars)
      }
      for (const needle of entry.mustContain ?? []) {
        expect(text).toContain(needle)
      }
      if (entry.expectNulCount === 0) {
        expect(countNul(text)).toBe(0)
        expect(countLoneSurrogates(text)).toBe(0)
      }
    })
    return
  }

  // entry.expect === 'reject'
  if (entry.expectMinCharsBelow !== undefined) {
    // The scanned/no-text-layer PDF: unpdf does not throw, it just
    // extracts (almost) nothing. Rejection here is the pipeline's
    // MIN_EXTRACTED_CHARS branch downstream in parse-cv.ts, not a caught
    // exception — so this fixture resolves, it just resolves short.
    const threshold = entry.expectMinCharsBelow
    it(`${entry.file}: resolves but stays below MIN_EXTRACTED_CHARS (< ${threshold} chars)`, async () => {
      coveredFiles.add(entry.file)
      const text = await extractTextFromBuffer(buffer, entry.mime)
      expect(text.trim().length).toBeLessThan(threshold)
    })
    return
  }

  it(`${entry.file}: rejected with ${entry.expectErrorName}`, async () => {
    coveredFiles.add(entry.file)
    let caught: unknown
    try {
      // The mime is always the MANIFEST's mime, never derived from the
      // file extension — this is how the wrong-extension fixtures
      // (t2-docx-renamed.pdf, t2-pdf-renamed.docx) reach the "wrong"
      // library and produce the recorded error.
      await extractTextFromBuffer(buffer, entry.mime)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe(entry.expectErrorName)
  })
})

it('exercises every fixture in the manifest (manifest.length === executedCount)', () => {
  expect(coveredFiles.size).toBe(manifest.length)
})
