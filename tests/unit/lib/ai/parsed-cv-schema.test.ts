/**
 * @vitest-environment node
 *
 * Unit tests for the zod coercion boundary (plan 06-06 Task 1) — the single
 * place where Claude's probabilistic tool output crosses into a strongly
 * typed system whose fields land in real, bounded Postgres columns.
 *
 * Two rules govern every expectation below:
 *   1. COERCE, NEVER REJECT. One bad field must never fail a whole parse —
 *      that would trade a Tier-3 "silent empty profile" bug for a Tier-3
 *      "whole CV lost" bug (06-RESEARCH.md Pitfall 2).
 *   2. NEVER INVENT DATA. A value that cannot be represented honestly is
 *      DROPPED, not clamped. Clamping a mis-read calendar year (2015) to 99
 *      would store a fabricated fact on a candidate record.
 *
 * Bounds under test come from the actual column types (migration
 * 20260513152244): salary_* integer, years_experience numeric(4,1).
 */

import { describe, expect, it } from 'vitest'

import { coerceParsedCV, parsedCVSchema } from '@/lib/ai/parsed-cv-schema'

import { HOSTILE_PAYLOADS } from '../../../fixtures/cv-corpus/hostile-payloads'

describe('coerceParsedCV — object level', () => {
  it('returns confidence_per_field {} for an empty object and never throws', () => {
    expect(coerceParsedCV({})).toEqual({ confidence_per_field: {} })
  })

  it('never throws for a non-object input (null, string, number, array)', () => {
    for (const input of [null, undefined, 'a string', 42, [], NaN]) {
      expect(() => coerceParsedCV(input)).not.toThrow()
      expect(coerceParsedCV(input)).toEqual({ confidence_per_field: {} })
    }
  })

  it('exports a usable zod schema whose safeParse never rejects a plain object', () => {
    expect(parsedCVSchema.safeParse({ name: 'Jane Doe' }).success).toBe(true)
  })

  it('strips unknown keys Claude was never asked for', () => {
    const out = coerceParsedCV({ name: 'Jane Doe', hallucinated_field: 'nope' })
    expect(out).not.toHaveProperty('hallucinated_field')
    expect(out.name).toBe('Jane Doe')
  })

  it('a single bad field never causes the whole parse to fail', () => {
    const out = coerceParsedCV({
      name: 'Jane Doe',
      email: 'jane@example.com',
      salary_current_estimate: { min: 1, max: 2 },
      years_experience_total: 2015,
      skills: 'not-an-array',
      work_history: null,
    })
    // The good fields survive intact...
    expect(out.name).toBe('Jane Doe')
    expect(out.email).toBe('jane@example.com')
    // ...and only the unusable ones are absent.
    expect(out.salary_current_estimate).toBeUndefined()
    expect(out.years_experience_total).toBeUndefined()
    expect(out.skills).toBeUndefined()
    expect(out.work_history).toBeUndefined()
  })

  it('never throws for any payload in the verified hostile-payload table', () => {
    for (const entry of HOSTILE_PAYLOADS) {
      expect(() => coerceParsedCV(entry.payload), `payload ${entry.id}`).not.toThrow()
    }
  })
})

describe('coerceParsedCV — name', () => {
  it('passes a string through unchanged', () => {
    expect(coerceParsedCV({ name: 'Jane Doe' }).name).toBe('Jane Doe')
  })

  it('joins an array of strings with a single space (C5a: .trim() must never throw)', () => {
    expect(coerceParsedCV({ name: ['Jane', 'Doe'] }).name).toBe('Jane Doe')
  })

  it('drops a number, an object, null and an empty array', () => {
    expect(coerceParsedCV({ name: 42 }).name).toBeUndefined()
    expect(coerceParsedCV({ name: { first: 'Jane' } }).name).toBeUndefined()
    expect(coerceParsedCV({ name: null }).name).toBeUndefined()
    expect(coerceParsedCV({ name: [] }).name).toBeUndefined()
  })
})

describe('coerceParsedCV — salary_current_estimate / salary_expectation', () => {
  const cases: Array<[unknown, number | undefined]> = [
    ['£45,000', 45000],
    ['45,000', 45000],
    ['45000', 45000],
    [45000.5, 45001],
    [45000, 45000],
    ['£45k', 45000],
    [3_000_000_000, undefined],
    [-5, undefined],
    [{ min: 40000, max: 50000 }, undefined],
    [[45000], undefined],
    ['not a salary', undefined],
    [null, undefined],
    [Infinity, undefined],
  ]

  for (const [input, expected] of cases) {
    it(`salary_current_estimate ${JSON.stringify(input)} -> ${String(expected)}`, () => {
      expect(coerceParsedCV({ salary_current_estimate: input }).salary_current_estimate).toBe(
        expected,
      )
    })
    it(`salary_expectation ${JSON.stringify(input)} -> ${String(expected)}`, () => {
      expect(coerceParsedCV({ salary_expectation: input }).salary_expectation).toBe(expected)
    })
  }
})

describe('coerceParsedCV — years_experience_total (numeric(4,1))', () => {
  const cases: Array<[unknown, number | undefined]> = [
    [12.5, 12.5],
    [999.9, 999.9],
    [8, 8],
    [0, 0],
    // A calendar year is not a duration — DROPPED, never clamped.
    [2015, undefined],
    // The exact numeric(4,1) overflow cliff.
    [1000, undefined],
    ['10+', 10],
    ['ten', undefined],
    [-1, undefined],
    [{ years: 10 }, undefined],
  ]

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${String(expected)}`, () => {
      expect(coerceParsedCV({ years_experience_total: input }).years_experience_total).toBe(
        expected,
      )
    })
  }

  it('rounds to the one decimal place numeric(4,1) actually stores, before the cliff check', () => {
    // 999.96 would round to 1000.0 in the column and overflow — drop it.
    expect(coerceParsedCV({ years_experience_total: 999.96 }).years_experience_total).toBeUndefined()
    expect(coerceParsedCV({ years_experience_total: 12.34 }).years_experience_total).toBe(12.3)
  })
})

describe('coerceParsedCV — skills / sector_tags (text[])', () => {
  it('drops non-string elements', () => {
    expect(coerceParsedCV({ skills: ['python', { name: 'Python' }, 3, null] }).skills).toEqual([
      'python',
    ])
  })

  it('drops empty and whitespace-only strings', () => {
    expect(coerceParsedCV({ skills: ['python', '', '   '] }).skills).toEqual(['python'])
  })

  it('yields only the string elements of a 2-D array (possibly an empty array)', () => {
    expect(coerceParsedCV({ skills: [['python'], 'sql'] }).skills).toEqual(['sql'])
    expect(coerceParsedCV({ skills: [['python']] }).skills).toEqual([])
  })

  it('drops a non-array entirely', () => {
    expect(coerceParsedCV({ skills: 'python, sql' }).skills).toBeUndefined()
    expect(coerceParsedCV({ sector_tags: { a: 1 } }).sector_tags).toBeUndefined()
  })

  it('preserves a clean array untouched', () => {
    expect(coerceParsedCV({ sector_tags: ['fintech', 'energy'] }).sector_tags).toEqual([
      'fintech',
      'energy',
    ])
  })
})

describe('coerceParsedCV — work_history / education', () => {
  it('drops null and non-object elements (C5b)', () => {
    expect(coerceParsedCV({ work_history: [null, { role: 'Dev' }, 'nope', 7] }).work_history).toEqual(
      [{ role: 'Dev' }],
    )
    expect(coerceParsedCV({ education: [null, { institution: 'Oxford' }] }).education).toEqual([
      { institution: 'Oxford' },
    ])
  })

  it('keeps per-item fields only when they are strings', () => {
    expect(
      coerceParsedCV({
        work_history: [
          { company: 'Acme', role: 'Dev', start_date: 2020, end_date: null, summary: 'Built things' },
        ],
      }).work_history,
    ).toEqual([{ company: 'Acme', role: 'Dev', summary: 'Built things' }])
  })

  it('drops a non-array entirely', () => {
    expect(coerceParsedCV({ work_history: 'Acme, 2020-2023' }).work_history).toBeUndefined()
    expect(coerceParsedCV({ education: null }).education).toBeUndefined()
  })
})

describe('coerceParsedCV — seniority_level', () => {
  const allowed = ['junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'director']

  for (const value of allowed) {
    it(`keeps the tool-schema enum value "${value}"`, () => {
      expect(coerceParsedCV({ seniority_level: value }).seniority_level).toBe(value)
    })
  }

  it('drops anything outside the seven enum values', () => {
    expect(coerceParsedCV({ seniority_level: 'Senior Engineer' }).seniority_level).toBeUndefined()
    expect(coerceParsedCV({ seniority_level: 'C-suite' }).seniority_level).toBeUndefined()
    expect(coerceParsedCV({ seniority_level: 3 }).seniority_level).toBeUndefined()
  })
})

describe('coerceParsedCV — confidence_per_field', () => {
  it('yields {} when the key is missing', () => {
    expect(coerceParsedCV({ name: 'Jane Doe' }).confidence_per_field).toEqual({})
  })

  it('drops values that are not high|medium|low', () => {
    expect(
      coerceParsedCV({
        confidence_per_field: { name: 'high', email: 'very-sure', phone: 'low', skills: 3 },
      }).confidence_per_field,
    ).toEqual({ name: 'high', phone: 'low' })
  })

  it('yields {} for a non-object', () => {
    expect(coerceParsedCV({ confidence_per_field: 'high' }).confidence_per_field).toEqual({})
  })
})

describe('coerceParsedCV — legal-but-exotic content is byte-identical', () => {
  it('preserves emoji with ZWJ, CJK, RTL, astral plane, diacritics and smart quotes', () => {
    const exotic = '\u{1F469}‍\u{1F4BB} 张伟 Zoë O’Brien-Şahin مرحبا'
    const out = coerceParsedCV({ name: exotic, current_company: exotic, skills: [exotic] })
    expect(out.name).toBe(exotic)
    expect(out.current_company).toBe(exotic)
    expect(out.skills).toEqual([exotic])
  })

  it('preserves a 100k-character work_history summary', () => {
    const long = 'x'.repeat(100_000)
    const out = coerceParsedCV({ work_history: [{ role: 'Dev', summary: long }] })
    expect(out.work_history?.[0]?.summary).toBe(long)
    expect(out.work_history?.[0]?.summary?.length).toBe(100_000)
  })

  it('preserves plain scalar string fields verbatim', () => {
    const out = coerceParsedCV({
      email: 'jane@example.com',
      phone: '+44 7000 000000',
      location: 'London, UK',
      current_role: 'Senior Engineer',
    })
    expect(out).toMatchObject({
      email: 'jane@example.com',
      phone: '+44 7000 000000',
      location: 'London, UK',
      current_role: 'Senior Engineer',
    })
  })
})
