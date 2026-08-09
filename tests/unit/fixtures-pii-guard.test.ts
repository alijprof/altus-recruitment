/**
 * @vitest-environment node
 *
 * Mechanical guard against real PII entering the public repo through the
 * committed fixture corpus (T-06-12: `tests/fixtures/**` -> public repo,
 * any PII here is permanently public). Walks every file under
 * `tests/fixtures/` recursively — including binaries (PDF/DOCX) — reading
 * each as latin1 so text embedded in uncompressed PDF streams or ZIP
 * entries stays visible as bytes rather than throwing on invalid UTF-8.
 *
 * This is a tripwire, not a proof: false NEGATIVES are acceptable (a
 * compressed/binary region hiding a violation from these patterns), false
 * POSITIVES are not, so the patterns below are kept intentionally tight
 * and the allow-list is explicit and commented — see
 * `tests/fixtures/cv-corpus/README.md`'s "synthetic-identity rule".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = join(process.cwd(), 'tests/fixtures')

// IANA-reserved for documentation/examples (RFC 2606) — never routable.
// This is the corpus's entire allowed email surface.
const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net'])

// Path (relative to tests/fixtures/, forward-slash) -> reason a finding on
// that file is a false positive, not real PII. Empty by design: nothing in
// the corpus currently needs an exception. Add an entry here ONLY after
// manually inspecting the flagged file and confirming it contains no real
// PII — never to silence a finding you haven't reviewed.
const ALLOWLIST: Record<string, string> = {
  // (none yet — tests/fixtures/sample-cv.pdf was inspected during 06-04
  // and contains only the synthetic "Jane Doe" persona at
  // jane.doe@example.com / +44 7700 900100, both already inside the
  // allow-listed domain / Ofcom drama range below, so it needed no
  // exception.)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...walk(full))
    } else {
      out.push(full)
    }
  }
  return out
}

const relativeFixturePaths = walk(FIXTURES_DIR)
  .map((full) => relative(FIXTURES_DIR, full))
  .sort()

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
const UK_MOBILE_RE = /\+?44\s?7\d{3}\s?\d{6}|07\d{3}\s?\d{6}/g
// Customer/founder identifiers — must never appear in a synthetic fixture.
const FORBIDDEN_IDENTIFIER_RE = /altus|steele|charles/gi

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

// The Ofcom "drama" range reserved for fiction/testing is 07700 900000-
// 07700 900999. Normalise a matched UK mobile number to its national
// 10-digit form (drop a leading +44 or 0) and check it falls inside that
// block, regardless of how the source text spaced the digits.
function isOfcomDramaRange(match: string): boolean {
  const digits = digitsOnly(match)
  const national = digits.startsWith('44') ? digits.slice(2) : digits.replace(/^0/, '')
  return national.startsWith('7700900')
}

describe('fixture PII guard (T-06-12)', () => {
  it('found at least one fixture file to sweep', () => {
    expect(relativeFixturePaths.length).toBeGreaterThan(0)
  })

  it('includes tests/fixtures/sample-cv.pdf in the sweep', () => {
    expect(relativeFixturePaths).toContain('sample-cv.pdf')
  })

  it.each(relativeFixturePaths)('%s carries no real-looking PII', (relPath) => {
    if (relPath in ALLOWLIST) return

    const text = readFileSync(join(FIXTURES_DIR, relPath), 'latin1')

    const badEmails = [...text.matchAll(EMAIL_RE)]
      .filter((m) => !ALLOWED_EMAIL_DOMAINS.has((m[1] ?? '').toLowerCase()))
      .map((m) => m[0])
    expect(badEmails, `non-allow-listed email domain(s) in ${relPath}`).toEqual([])

    const badMobiles = [...text.matchAll(UK_MOBILE_RE)]
      .filter((m) => !isOfcomDramaRange(m[0]))
      .map((m) => m[0])
    expect(badMobiles, `UK mobile number(s) outside the Ofcom drama range in ${relPath}`).toEqual(
      [],
    )

    const badIdentifiers = text.match(FORBIDDEN_IDENTIFIER_RE) ?? []
    expect(badIdentifiers, `customer/founder identifier(s) leaked in ${relPath}`).toEqual([])
  })
})
