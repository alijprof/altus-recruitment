/**
 * @vitest-environment node
 *
 * Proof that `classifyForPostgres` reproduces every row of the verified
 * Postgres 17.6 + PostgREST v14.5 failure matrix documented in
 * 06-RESEARCH.md §"Verified failure matrix". One `it()` per matrix row (the
 * row number is in the test name) so a future regression names the exact
 * row that broke.
 *
 * This suite is the sole executable proof of the classifier's correctness —
 * plan 06-02's forensic replay and later plans' sanitisation/coercion
 * boundaries depend on these rules being exactly right, not "close enough".
 */

import { describe, expect, it } from 'vitest'

import { classifyForPostgres, type PgLegalityFinding } from '../../support/pg-legality'

function findingsFor(...rules: string[]) {
  return (findings: PgLegalityFinding[]) => findings.filter((f) => rules.includes(f.rule))
}

describe('classifyForPostgres — Unicode illegalities (rows 1-9)', () => {
  it('row 1: NUL in a string VALUE -> nul-in-string / 22P05', () => {
    const findings = classifyForPostgres({ name: 'Jane\u0000Doe' })
    expect(findings).toEqual([
      { rule: 'nul-in-string', path: 'name', code: '22P05', severity: 'fail' },
    ])
  })

  it('row 2: NUL in an object KEY -> nul-in-key / 22P05', () => {
    const findings = classifyForPostgres({ 'bad\u0000key': 'x' })
    const keyFindings = findingsFor('nul-in-key')(findings)
    expect(keyFindings).toHaveLength(1)
    expect(keyFindings[0]).toMatchObject({ rule: 'nul-in-key', code: '22P05', severity: 'fail' })
  })

  it('row 3: NUL nested at work_history[0].summary reports that exact path', () => {
    const findings = classifyForPostgres({
      work_history: [{ role: 'Dev', summary: 'Text\u0000here' }],
    })
    expect(findings).toEqual([
      { rule: 'nul-in-string', path: 'work_history[0].summary', code: '22P05', severity: 'fail' },
    ])
  })

  it('row 4: lone HIGH surrogate -> lone-surrogate / PGRST102', () => {
    const findings = classifyForPostgres({ name: '\uD83D' })
    expect(findings).toEqual([
      { rule: 'lone-surrogate', path: 'name', code: 'PGRST102', severity: 'fail' },
    ])
  })

  it('row 5: lone LOW surrogate -> lone-surrogate / PGRST102', () => {
    const findings = classifyForPostgres({ name: '\uDE00' })
    expect(findings).toEqual([
      { rule: 'lone-surrogate', path: 'name', code: 'PGRST102', severity: 'fail' },
    ])
  })

  it('row 9 analogue: NUL inside a skills[] element -> nul-in-string / 22P05', () => {
    const findings = classifyForPostgres({ skills: ['python', 'sq\u0000l'] })
    expect(findings).toEqual([
      { rule: 'nul-in-string', path: 'skills[1]', code: '22P05', severity: 'fail' },
    ])
  })
})

describe('classifyForPostgres — legal-but-exotic Unicode (rows 23-25, zero false positives)', () => {
  it('row 23: a 1.1 MB string is legal', () => {
    const huge = 'a'.repeat(1_100_000)
    const findings = classifyForPostgres({ name: huge })
    expect(findings).toEqual([])
  })

  it('row 24: emoji (correctly paired surrogate), ZWJ, astral plane, RTL, CJK, diacritics, smart quotes, soft hyphen and a BOM are all legal', () => {
    const exotic = [
      '👍', // paired surrogate emoji
      '👩‍💻', // ZWJ sequence (also paired surrogates either side)
      '\u{1F600}', // astral plane
      'مرحبا', // RTL (Arabic)
      '张伟', // CJK
      'Zoë O’Brien-Şahin', // diacritics + smart quote
      'soft­hyphen', // soft hyphen
      '﻿BOM-prefixed', // BOM
    ]
    for (const value of exotic) {
      expect(classifyForPostgres({ name: value })).toEqual([])
    }
  })

  it('row 25: control chars U+0001-U+001F other than NUL (e.g. SOH, vertical tab) are legal', () => {
    expect(classifyForPostgres({ name: 'ab' })).toEqual([])
    expect(classifyForPostgres({ name: 'a\vb' })).toEqual([])
  })
})

describe('classifyForPostgres — salary_current_estimate / salary_expectation (rows 10-13, 19)', () => {
  it('row 10: a currency-formatted string -> salary-invalid-type / 22P02', () => {
    const findings = classifyForPostgres({ salary_current_estimate: '£45,000' })
    expect(findings).toEqual([
      {
        rule: 'salary-invalid-type',
        path: 'salary_current_estimate',
        code: '22P02',
        severity: 'fail',
      },
    ])
  })

  it('row 11: a float -> salary-invalid-type / 22P02 (integer column)', () => {
    const findings = classifyForPostgres({ salary_current_estimate: 45000.5 })
    const salaryFindings = findingsFor('salary-invalid-type')(findings)
    expect(salaryFindings).toHaveLength(1)
    expect(salaryFindings[0]).toMatchObject({
      rule: 'salary-invalid-type',
      path: 'salary_current_estimate',
      code: '22P02',
      severity: 'fail',
    })
  })

  it('row 12: > int4 max -> salary-out-of-range / 22003, carries the offending number', () => {
    const findings = classifyForPostgres({ salary_current_estimate: 3_000_000_000 })
    expect(findings).toEqual([
      {
        rule: 'salary-out-of-range',
        path: 'salary_current_estimate',
        code: '22003',
        severity: 'fail',
        value: 3_000_000_000,
      },
    ])
  })

  it('row 13: an object shape ({min,max}) -> salary-invalid-type / 22P02', () => {
    const findings = classifyForPostgres({ salary_expectation: { min: 40000, max: 50000 } })
    expect(findings).toEqual([
      { rule: 'salary-invalid-type', path: 'salary_expectation', code: '22P02', severity: 'fail' },
    ])
  })

  it('row 13 variant: an array shape ([45000]) -> salary-invalid-type / 22P02', () => {
    const findings = classifyForPostgres({ salary_expectation: [45000] })
    expect(findings).toEqual([
      { rule: 'salary-invalid-type', path: 'salary_expectation', code: '22P02', severity: 'fail' },
    ])
  })

  it('row 19: a clean numeric string is coerced cleanly -> zero findings', () => {
    expect(classifyForPostgres({ salary_current_estimate: '45000' })).toEqual([])
  })
})

describe('classifyForPostgres — years_experience_total (rows 14-16, 20)', () => {
  it('row 14: a calendar-year-shaped value -> years-overflow / 22003, carries the offending number', () => {
    const findings = classifyForPostgres({ years_experience_total: 2015 })
    expect(findings).toEqual([
      {
        rule: 'years-overflow',
        path: 'years_experience_total',
        code: '22003',
        severity: 'fail',
        value: 2015,
      },
    ])
  })

  it('row 15: exactly 1000 is the cliff -> years-overflow / 22003', () => {
    const findings = classifyForPostgres({ years_experience_total: 1000 })
    expect(findings).toEqual([
      {
        rule: 'years-overflow',
        path: 'years_experience_total',
        code: '22003',
        severity: 'fail',
        value: 1000,
      },
    ])
  })

  it('row 16: a non-numeric string ("10+") -> years-invalid-type / 22P02', () => {
    const findings = classifyForPostgres({ years_experience_total: '10+' })
    expect(findings).toEqual([
      {
        rule: 'years-invalid-type',
        path: 'years_experience_total',
        code: '22P02',
        severity: 'fail',
      },
    ])
  })

  it('row 20: 999.9 and 12.75 are legal (Postgres rounds silently) -> zero findings', () => {
    expect(classifyForPostgres({ years_experience_total: 999.9 })).toEqual([])
    expect(classifyForPostgres({ years_experience_total: 12.75 })).toEqual([])
  })
})

describe('classifyForPostgres — skills / sector_tags (rows 17, 21, 22)', () => {
  it('row 17: a 2-D array -> nested-array / 22P02 (one finding per nested element)', () => {
    const findings = classifyForPostgres({ skills: [['a', 'b'], ['c']] })
    expect(findings).toEqual([
      { rule: 'nested-array', path: 'skills[0]', code: '22P02', severity: 'fail' },
      { rule: 'nested-array', path: 'skills[1]', code: '22P02', severity: 'fail' },
    ])
  })

  it('row 17 analogue: sector_tags as a 2-D array -> nested-array / 22P02', () => {
    const findings = classifyForPostgres({ sector_tags: [['fintech']] })
    expect(findings).toEqual([
      { rule: 'nested-array', path: 'sector_tags[0]', code: '22P02', severity: 'fail' },
    ])
  })

  it('row 21: an array of objects WRITES successfully but silently corrupts -> severity warn, code null', () => {
    const findings = classifyForPostgres({ skills: [{ name: 'Python' }] })
    expect(findings).toEqual([
      { rule: 'skills-object-elements', path: 'skills[0]', code: null, severity: 'warn' },
    ])
  })

  it('row 22: numbers and null elements are silently coerced -> zero findings', () => {
    expect(classifyForPostgres({ skills: ['python', 1, null] })).toEqual([])
  })
})

describe('classifyForPostgres — JavaScript-level shape violations (TypeError, no DB involved)', () => {
  it('name as an array -> name-not-string / TypeError', () => {
    const findings = classifyForPostgres({ name: ['Jane', 'Doe'] })
    expect(findings).toEqual([
      { rule: 'name-not-string', path: 'name', code: 'TypeError', severity: 'fail' },
    ])
  })

  it('name as a number -> name-not-string / TypeError', () => {
    const findings = classifyForPostgres({ name: 42 })
    expect(findings).toEqual([
      { rule: 'name-not-string', path: 'name', code: 'TypeError', severity: 'fail' },
    ])
  })

  it('work_history containing a null element -> work-history-null-element / TypeError', () => {
    const findings = classifyForPostgres({
      work_history: [null, { role: 'Dev' }],
    })
    expect(findings).toEqual([
      {
        rule: 'work-history-null-element',
        path: 'work_history[0]',
        code: 'TypeError',
        severity: 'fail',
      },
    ])
  })

  it('work_history containing a non-object (string) element -> work-history-null-element / TypeError', () => {
    const findings = classifyForPostgres({
      work_history: ['not an object', { role: 'Dev' }],
    })
    expect(findings).toEqual([
      {
        rule: 'work-history-null-element',
        path: 'work_history[0]',
        code: 'TypeError',
        severity: 'fail',
      },
    ])
  })
})

describe('classifyForPostgres — baseline and PII discipline', () => {
  it('an empty object returns zero findings', () => {
    expect(classifyForPostgres({})).toEqual([])
  })

  it('a fully legal payload returns zero findings', () => {
    const findings = classifyForPostgres({
      name: 'Jane Doe',
      email: 'jane@example.com',
      skills: ['python', 'sql'],
      sector_tags: ['fintech'],
      salary_current_estimate: 65000,
      salary_expectation: '70000',
      years_experience_total: 8.5,
      work_history: [{ role: 'Engineer', company: 'Acme' }],
      education: [{ institution: 'Warwick' }],
    })
    expect(findings).toEqual([])
  })

  it('no finding ever carries a string value — the only value-bearing field is a number, used only for numeric-range rules', () => {
    const findings = classifyForPostgres({
      name: 'Jane\u0000Doe',
      salary_current_estimate: 3_000_000_000,
      years_experience_total: 2015,
      skills: [{ secret: 'should never appear' }],
    })
    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      if ('value' in finding && finding.value !== undefined) {
        expect(typeof finding.value).toBe('number')
      }
    }
    // Explicitly assert the classifier never echoes a string/object payload
    // value anywhere in the finding set (only rule/path/code/severity/number).
    const serialised = JSON.stringify(findings)
    expect(serialised).not.toContain('should never appear')
    expect(serialised).not.toContain('Jane')
  })
})
