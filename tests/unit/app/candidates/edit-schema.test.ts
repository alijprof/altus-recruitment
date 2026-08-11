/**
 * Plan 07-03 Task 1 — coverage for the widened `/candidates/[id]/edit` schema
 * (CLT-04: full parsed-field editing). Every behavior case from the plan is
 * asserted directly against `editCandidateSchema.safeParse`.
 */
import { describe, expect, it } from 'vitest'

import {
  editCandidateSchema,
  SENIORITY_LEVEL_VALUES,
} from '@/app/(app)/candidates/[id]/edit/schema'

// Minimal valid payload for the ORIGINAL 8 fields (pre-Plan-07-03 shape).
// Every sub-test spreads this and overrides just the field under test.
const basePayload = {
  full_name: 'Alice Smith',
  email: 'alice@example.com',
  phone: '01234 567890',
  location: 'Aberdeen',
  current_role_title: 'Engineer',
  current_company: 'Acme',
  market_status: 'actively_looking',
  source: 'direct_add',
}

describe('editCandidateSchema — backwards compatibility', () => {
  it('parses a payload with only the 8 original fields, unchanged', () => {
    const r = editCandidateSchema.safeParse(basePayload)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.full_name).toBe('Alice Smith')
      expect(r.data.market_status).toBe('actively_looking')
      // None of the Plan 07-03 fields were sent — they must not appear as
      // populated values.
      expect(r.data.seniority_level).toBeUndefined()
      expect(r.data.years_experience).toBeUndefined()
      expect(r.data.salary_current_estimate).toBeUndefined()
      expect(r.data.salary_expectation).toBeUndefined()
      expect(r.data.headline).toBeUndefined()
      expect(r.data.about).toBeUndefined()
      expect(r.data.skills).toBeUndefined()
      expect(r.data.sector_tags).toBeUndefined()
      expect(r.data.work_experience).toBeUndefined()
      expect(r.data.education).toBeUndefined()
    }
  })
})

describe('editCandidateSchema — seniority_level', () => {
  it.each(SENIORITY_LEVEL_VALUES)('accepts vocabulary value %s', (value) => {
    const r = editCandidateSchema.safeParse({ ...basePayload, seniority_level: value })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.seniority_level).toBe(value)
  })

  it("accepts '' (meaning cleared)", () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, seniority_level: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.seniority_level).toBe('')
  })

  it('rejects an off-vocabulary value', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, seniority_level: 'wizard' })
    expect(r.success).toBe(false)
  })
})

describe('editCandidateSchema — years_experience', () => {
  it.each(['0', '7', '7.5', ''])('accepts %s', (value) => {
    const r = editCandidateSchema.safeParse({ ...basePayload, years_experience: value })
    expect(r.success).toBe(true)
  })

  it.each(['-1', 'abc', '1000'])('rejects %s', (value) => {
    const r = editCandidateSchema.safeParse({ ...basePayload, years_experience: value })
    expect(r.success).toBe(false)
  })
})

describe('editCandidateSchema — salary_current_estimate / salary_expectation', () => {
  for (const field of ['salary_current_estimate', 'salary_expectation'] as const) {
    describe(field, () => {
      it.each(['', '0', '45000', '10000000'])('accepts %s', (value) => {
        const r = editCandidateSchema.safeParse({ ...basePayload, [field]: value })
        expect(r.success).toBe(true)
      })

      it.each(['-1', '45000.5'])('rejects %s', (value) => {
        const r = editCandidateSchema.safeParse({ ...basePayload, [field]: value })
        expect(r.success).toBe(false)
      })
    })
  }
})

describe('editCandidateSchema — headline / about length caps', () => {
  it('accepts headline at exactly 300 chars', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, headline: 'x'.repeat(300) })
    expect(r.success).toBe(true)
  })

  it('rejects headline over 300 chars', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, headline: 'x'.repeat(301) })
    expect(r.success).toBe(false)
  })

  it('accepts about at exactly 5000 chars', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, about: 'x'.repeat(5000) })
    expect(r.success).toBe(true)
  })

  it('rejects about over 5000 chars', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, about: 'x'.repeat(5001) })
    expect(r.success).toBe(false)
  })
})

describe('editCandidateSchema — skills / sector_tags', () => {
  for (const field of ['skills', 'sector_tags'] as const) {
    describe(field, () => {
      it('trims entries and drops blanks', () => {
        const r = editCandidateSchema.safeParse({
          ...basePayload,
          [field]: ['  Python  ', '', '   ', 'PostgreSQL'],
        })
        expect(r.success).toBe(true)
        if (r.success) expect(r.data[field]).toEqual(['Python', 'PostgreSQL'])
      })

      it('accepts an entry at exactly 100 chars', () => {
        const r = editCandidateSchema.safeParse({ ...basePayload, [field]: ['x'.repeat(100)] })
        expect(r.success).toBe(true)
      })

      it('rejects an entry over 100 chars', () => {
        const r = editCandidateSchema.safeParse({ ...basePayload, [field]: ['x'.repeat(101)] })
        expect(r.success).toBe(false)
      })

      it('accepts an empty array (clears the section)', () => {
        const r = editCandidateSchema.safeParse({ ...basePayload, [field]: [] })
        expect(r.success).toBe(true)
        if (r.success) expect(r.data[field]).toEqual([])
      })
    })
  }
})

describe('editCandidateSchema — work_experience', () => {
  it('accepts a row with a non-empty title and optional company/dates', () => {
    const r = editCandidateSchema.safeParse({
      ...basePayload,
      work_experience: [{ title: 'Engineer', company: 'Acme', dates: '2020 - Present' }],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.work_experience).toEqual([
        { title: 'Engineer', company: 'Acme', dates: '2020 - Present' },
      ])
    }
  })

  it('accepts a row with only a title (company/dates omitted)', () => {
    const r = editCandidateSchema.safeParse({
      ...basePayload,
      work_experience: [{ title: 'Engineer' }],
    })
    expect(r.success).toBe(true)
  })

  it('drops a row with a blank title', () => {
    const r = editCandidateSchema.safeParse({
      ...basePayload,
      work_experience: [
        { title: '', company: 'Acme', dates: '2020 - Present' },
        { title: 'Engineer', company: 'Acme', dates: '2020 - Present' },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.work_experience).toHaveLength(1)
  })

  it('accepts an empty array (clears the section)', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, work_experience: [] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.work_experience).toEqual([])
  })
})

describe('editCandidateSchema — education', () => {
  it('accepts a row with a non-empty school and optional degree/dates', () => {
    const r = editCandidateSchema.safeParse({
      ...basePayload,
      education: [{ school: 'University of Aberdeen', degree: 'BSc', dates: '2016 - 2019' }],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.education).toEqual([
        { school: 'University of Aberdeen', degree: 'BSc', dates: '2016 - 2019' },
      ])
    }
  })

  it('accepts a row with only a school (degree/dates omitted)', () => {
    const r = editCandidateSchema.safeParse({
      ...basePayload,
      education: [{ school: 'University of Aberdeen' }],
    })
    expect(r.success).toBe(true)
  })

  it('drops a row with a blank school', () => {
    const r = editCandidateSchema.safeParse({
      ...basePayload,
      education: [
        { school: '', degree: 'BSc', dates: '2016 - 2019' },
        { school: 'University of Aberdeen', degree: 'BSc', dates: '2016 - 2019' },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.education).toHaveLength(1)
  })

  it('accepts an empty array (clears the section)', () => {
    const r = editCandidateSchema.safeParse({ ...basePayload, education: [] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.education).toEqual([])
  })
})
