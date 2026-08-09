/**
 * @vitest-environment node
 *
 * Unit tests for the Postgres-legality sanitiser (plan 06-06 Task 2).
 *
 * The whole point of this module is that it alters ALMOST NOTHING. A CV is
 * the product; stripping "control characters" wholesale would quietly mangle
 * candidate data in order to fix two specific byte sequences. Every
 * "must be preserved" case below is therefore exactly as load-bearing as the
 * two "must be altered" ones.
 *
 * Verified 2026-08-09 against Postgres 17.6 + PostgREST v14.5 — exactly two
 * sequences are illegal in this pipeline:
 *   U+0000                -> 22P05 "unsupported Unicode escape sequence"
 *   lone UTF-16 surrogate -> PGRST102 "Empty or invalid json" (PostgREST)
 *
 * ---------------------------------------------------------------------
 * WHY EVERY SPECIAL CHARACTER BELOW IS BUILT WITH String.fromCharCode
 * ---------------------------------------------------------------------
 * A committed source file must contain NO raw NUL, NO raw lone surrogate and
 * no invisible formatting characters. A raw NUL survives neither editors nor
 * formatters reliably; a raw lone surrogate is not even representable in
 * UTF-8, so writing one to disk silently corrupts it into U+FFFD — which
 * would turn this suite into a no-op that "passes" while testing nothing.
 * Constructing them from code points keeps this file pure ASCII and makes
 * every test's intent explicit.
 */

import { describe, expect, it } from 'vitest'

import { sanitiseForPostgres, sanitiseText } from '@/lib/text/postgres-safe-text'

// --- The two illegal sequences ---------------------------------------------
const NUL = String.fromCharCode(0x00)
const LONE_HIGH = String.fromCharCode(0xd83d) // high half of an emoji pair
const LONE_LOW = String.fromCharCode(0xde00) // low half of an emoji pair
const FFFD = String.fromCharCode(0xfffd) // the sanctioned replacement char

// --- Legal-but-exotic characters that MUST survive untouched ---------------
const ZWJ = String.fromCharCode(0x200d)
const SOFT_HYPHEN = String.fromCharCode(0x00ad)
const BOM = String.fromCharCode(0xfeff)
const NBSP = String.fromCharCode(0x00a0)
const SOH = String.fromCharCode(0x01) // U+0001 — legal in Postgres text
const UNIT_SEP = String.fromCharCode(0x1f) // U+001F — legal in Postgres text
const THUMBS_UP = String.fromCodePoint(0x1f44d)
const WOMAN = String.fromCodePoint(0x1f469)
const LAPTOP = String.fromCodePoint(0x1f4bb)

describe('sanitiseText — the two illegal sequences', () => {
  it('removes U+0000 entirely, leaving the rest of the string intact', () => {
    expect(sanitiseText(`a${NUL}b`)).toBe('ab')
    expect(sanitiseText(`Jane${NUL}Doe`)).toBe('JaneDoe')
    expect(sanitiseText(NUL)).toBe('')
    expect(sanitiseText(`a${NUL}${NUL}b`)).toBe('ab')
  })

  it('replaces a lone HIGH surrogate with U+FFFD, preserving its position', () => {
    expect(sanitiseText(`a${LONE_HIGH}b`)).toBe(`a${FFFD}b`)
    expect(sanitiseText(LONE_HIGH)).toBe(FFFD)
  })

  it('replaces a lone LOW surrogate with U+FFFD, preserving its position', () => {
    expect(sanitiseText(`a${LONE_LOW}b`)).toBe(`a${FFFD}b`)
    expect(sanitiseText(LONE_LOW)).toBe(FFFD)
  })

  it('handles both illegal sequences in one string', () => {
    expect(sanitiseText(`a${NUL}b${LONE_HIGH}c`)).toBe(`ab${FFFD}c`)
  })

  it('never breaks a VALID surrogate pair (an astral-plane glyph)', () => {
    expect(sanitiseText(THUMBS_UP)).toBe(THUMBS_UP)
    expect(sanitiseText(`a${THUMBS_UP}b`)).toBe(`a${THUMBS_UP}b`)
    // Two adjacent pairs: the naive "any surrogate" regex mangles these.
    expect(sanitiseText(`${THUMBS_UP}${WOMAN}`)).toBe(`${THUMBS_UP}${WOMAN}`)
  })
})

describe('sanitiseText — everything else must be preserved byte-for-byte', () => {
  const preserved: Array<[string, string]> = [
    ['empty string', ''],
    ['vertical tab', 'a\vb'],
    ['tab', 'a\tb'],
    ['newlines', 'a\nb\r\nc'],
    ['C0 controls other than NUL', `a${SOH}b${UNIT_SEP}c`],
    ['emoji with ZWJ', `${WOMAN}${ZWJ}${LAPTOP}`],
    ['astral plane', `${THUMBS_UP}${WOMAN}`],
    ['RTL', 'مرحبا'],
    ['CJK', '张伟'],
    ['diacritics', 'Zoë O’Brien-Şahin'],
    ['smart quotes', '“hello” ‘world’'],
    ['soft hyphen', `soft${SOFT_HYPHEN}hyphen`],
    ['BOM', `${BOM}BOM-prefixed`],
    ['non-breaking space', `a${NBSP}b`],
    ['a replacement char that was already there', `a${FFFD}b`],
  ]

  for (const [label, value] of preserved) {
    it(`preserves ${label}`, () => {
      expect(sanitiseText(value)).toBe(value)
    })
  }

  it('returns the SAME REFERENCE for a clean 1.1 MB string (no allocation on the common path)', () => {
    const huge = 'a'.repeat(1_100_000)
    expect(sanitiseText(huge)).toBe(huge)
  })
})

describe('sanitiseForPostgres — recursion', () => {
  it('sanitises string values nested in objects and arrays', () => {
    expect(
      sanitiseForPostgres({
        name: `Jane${NUL}Doe`,
        work_history: [{ role: 'Dev', summary: `Text${NUL}here` }],
      }),
    ).toEqual({
      name: 'JaneDoe',
      work_history: [{ role: 'Dev', summary: 'Texthere' }],
    })
  })

  it('sanitises object KEYS as well as values (a NUL in a key is equally fatal)', () => {
    const out = sanitiseForPostgres({ [`bad${NUL}key`]: 'value' })
    expect(out).toEqual({ badkey: 'value' })
    expect(Object.keys(out)).toEqual(['badkey'])
  })

  it('sanitises keys nested deep inside arrays', () => {
    expect(sanitiseForPostgres({ a: [{ [`k${NUL}ey`]: 'v' }] })).toEqual({ a: [{ key: 'v' }] })
  })

  it('replaces lone surrogates anywhere in the tree', () => {
    expect(sanitiseForPostgres({ name: LONE_HIGH, tags: [LONE_LOW] })).toEqual({
      name: FFFD,
      tags: [FFFD],
    })
  })

  it('returns a deeply equal object when nothing is illegal', () => {
    const clean = {
      name: 'Jane Doe',
      skills: ['python', 'sql'],
      work_history: [{ role: 'Dev', company: 'Acme', summary: `${THUMBS_UP} shipped things` }],
      confidence_per_field: { name: 'high' },
      years_experience_total: 12.5,
    }
    expect(sanitiseForPostgres(clean)).toEqual(clean)
  })
})

describe('sanitiseForPostgres — non-string values', () => {
  it('passes numbers, booleans, null and undefined through unchanged', () => {
    expect(sanitiseForPostgres(42)).toBe(42)
    expect(sanitiseForPostgres(0)).toBe(0)
    expect(sanitiseForPostgres(12.5)).toBe(12.5)
    expect(sanitiseForPostgres(true)).toBe(true)
    expect(sanitiseForPostgres(false)).toBe(false)
    expect(sanitiseForPostgres(null)).toBeNull()
    expect(sanitiseForPostgres(undefined)).toBeUndefined()
  })

  it('preserves numbers, booleans and null nested in a tree', () => {
    const tree = { a: 1, b: true, c: null, d: [1, false, null] }
    expect(sanitiseForPostgres(tree)).toEqual(tree)
  })

  it('does NOT convert a Date into a plain object', () => {
    const date = new Date('2026-08-09T00:00:00.000Z')
    const out = sanitiseForPostgres(date)
    expect(out).toBeInstanceOf(Date)
    expect(out).toBe(date)
  })

  it('does NOT convert a Uint8Array into a plain object', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const out = sanitiseForPostgres(bytes)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out).toBe(bytes)
  })

  it('leaves a Date nested inside an object as a Date', () => {
    const date = new Date('2026-08-09T00:00:00.000Z')
    const out = sanitiseForPostgres({ created_at: date, name: `Jane${NUL}Doe` })
    expect(out.created_at).toBeInstanceOf(Date)
    expect(out.name).toBe('JaneDoe')
  })
})
