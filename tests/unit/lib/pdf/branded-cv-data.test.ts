/**
 * @vitest-environment node
 *
 * branded-cv-data — the contact-stripping allowlist mapper (BCV-03). Every
 * assertion here is either a direct pin on the type-level guarantee ("this
 * module cannot express a contact field") or a runtime pin on defensive
 * coercion of hostile/malformed jsonb. See 08-03-PLAN.md Task 1 <behavior>.
 */
import { describe, expect, it } from 'vitest'

import {
  BRANDED_CV_FREE_TEXT_WARNING,
  type BrandedCvData,
  toBrandedCvData,
} from '@/lib/pdf/branded-cv-data'

// A fully-populated hostile candidate row: every field the mapper must
// strip is set to a UNIQUE, easily-greppable value so the serialisation pin
// below can prove none of them leaked into the output by any path.
const CONTACT_STRIP_ROW = {
  full_name: 'Jamie Fixture',
  headline: 'Senior Engineer',
  about: 'Loves TypeScript.',
  current_role_title: 'Staff Engineer',
  current_company: 'Acme Ltd',
  seniority_level: 'Staff',
  years_experience: 9,
  location: 'Manchester, UK',
  skills: ['TypeScript', 'React'],
  sector_tags: ['Tech'],
  work_experience: [{ title: 'Engineer', company: 'Acme Ltd', dates: '2020-2024' }],
  education: [{ school: 'Manchester Uni', degree: 'BSc CS', dates: '2012-2015' }],
  // The fields under test — every value below is unique and must never
  // appear anywhere in the output's JSON serialisation.
  email: 'contact-strip-pin-9f3e@example.com',
  phone: '+44-7700-STRIP-PIN-900123',
  salary_current_estimate: 87654.32,
  salary_expectation: 99887.11,
  currency: 'ZZZ-STRIP-PIN-CURRENCY',
}

describe('toBrandedCvData — BCV-03 contact-strip runtime pin', () => {
  it('the full JSON serialisation contains none of email/phone/salary/currency', () => {
    const output = toBrandedCvData(CONTACT_STRIP_ROW)
    const serialised = JSON.stringify(output)
    expect(serialised).not.toContain('contact-strip-pin-9f3e@example.com')
    expect(serialised).not.toContain('STRIP-PIN-900123')
    expect(serialised).not.toContain('87654.32')
    expect(serialised).not.toContain('99887.11')
    expect(serialised).not.toContain('ZZZ-STRIP-PIN-CURRENCY')
  })

  it('has no email/phone/salary/currency keys on the output object at all', () => {
    const output = toBrandedCvData(CONTACT_STRIP_ROW) as unknown as Record<string, unknown>
    expect(Object.keys(output).sort()).toEqual(
      [
        'about',
        'currentCompany',
        'currentRoleTitle',
        'education',
        'fullName',
        'headline',
        'location',
        'sectorTags',
        'seniorityLevel',
        'skills',
        'work',
        'yearsExperience',
      ].sort(),
    )
  })

  it('compile-time pin: BrandedCvData cannot express email/phone/salaryExpectation', () => {
    const data: BrandedCvData = toBrandedCvData(CONTACT_STRIP_ROW)
    // @ts-expect-error — email must not exist on BrandedCvData
    void data.email
    // @ts-expect-error — phone must not exist on BrandedCvData
    void data.phone
    // @ts-expect-error — salaryExpectation must not exist on BrandedCvData
    void data.salaryExpectation
  })
})

describe('toBrandedCvData — location retention (A1 CONFIRMED 2026-08-12)', () => {
  it('location IS present on the output when set on the row', () => {
    const output = toBrandedCvData({ full_name: 'X', location: 'Manchester, UK' })
    expect(output.location).toBe('Manchester, UK')
  })

  it('location is null when absent on the row', () => {
    const output = toBrandedCvData({ full_name: 'X' })
    expect(output.location).toBeNull()
  })
})

describe('toBrandedCvData — presence/absence of scalar fields', () => {
  it('full_name is always present (defaults to empty string when missing)', () => {
    expect(toBrandedCvData({ full_name: 'Jamie Fixture' }).fullName).toBe('Jamie Fixture')
    expect(toBrandedCvData({}).fullName).toBe('')
  })

  it('headline/about/current_role_title/current_company/seniority_level/years_experience are null when absent', () => {
    const output = toBrandedCvData({ full_name: 'X' })
    expect(output.headline).toBeNull()
    expect(output.about).toBeNull()
    expect(output.currentRoleTitle).toBeNull()
    expect(output.currentCompany).toBeNull()
    expect(output.seniorityLevel).toBeNull()
    expect(output.yearsExperience).toBeNull()
  })

  it('scalar fields pass through when present', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      headline: 'Senior Engineer',
      about: 'A summary.',
      current_role_title: 'Staff Engineer',
      current_company: 'Acme Ltd',
      seniority_level: 'Staff',
      years_experience: 9,
    })
    expect(output.headline).toBe('Senior Engineer')
    expect(output.about).toBe('A summary.')
    expect(output.currentRoleTitle).toBe('Staff Engineer')
    expect(output.currentCompany).toBe('Acme Ltd')
    expect(output.seniorityLevel).toBe('Staff')
    expect(output.yearsExperience).toBe(9)
  })
})

describe('toBrandedCvData — work_experience mapping', () => {
  it('a well-formed array maps 1:1, preserving order', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      work_experience: [
        { title: 'Engineer', company: 'Acme', dates: '2020-2022' },
        { title: 'Senior Engineer', company: 'Acme', dates: '2022-2024' },
      ],
    })
    expect(output.work).toEqual([
      { title: 'Engineer', company: 'Acme', dates: '2020-2022' },
      { title: 'Senior Engineer', company: 'Acme', dates: '2022-2024' },
    ])
  })

  it.each([
    ['null', null],
    ['a string', 'not-an-array'],
    ['a number', 42],
    ['an object', { title: 'X' }],
  ])('work_experience holding %s degrades to [] without throwing', (_label, value) => {
    expect(() => toBrandedCvData({ full_name: 'X', work_experience: value })).not.toThrow()
    expect(toBrandedCvData({ full_name: 'X', work_experience: value }).work).toEqual([])
  })

  it('an array of strings degrades to [] (no entries are plain objects)', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      work_experience: ['Engineer at Acme', 'Senior Engineer at Acme'],
    })
    expect(output.work).toEqual([])
  })

  it('an array of objects with missing/non-string members never throws and drops only the bad entries', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      work_experience: [
        { title: 'Real Entry', company: 'Acme', dates: '2020-2022' },
        { title: 123, company: null, dates: undefined },
        null,
        'not an object',
        {},
      ],
    })
    expect(() =>
      toBrandedCvData({ full_name: 'X', work_experience: output.work }),
    ).not.toThrow()
    // The genuinely all-blank / non-object entries are dropped; the real
    // entry survives untouched.
    expect(output.work).toContainEqual({ title: 'Real Entry', company: 'Acme', dates: '2020-2022' })
    expect(output.work.length).toBeLessThan(5)
  })

  it('entries whose fields are all empty after trimming are dropped', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      work_experience: [
        { title: '   ', company: '', dates: '  ' },
        { title: 'Real Entry', company: 'Acme', dates: '2020-2022' },
      ],
    })
    expect(output.work).toEqual([{ title: 'Real Entry', company: 'Acme', dates: '2020-2022' }])
  })

  it('caps at 20 work entries', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      title: `Role ${i}`,
      company: 'Acme',
      dates: '2020',
    }))
    const output = toBrandedCvData({ full_name: 'X', work_experience: entries })
    expect(output.work.length).toBe(20)
    expect(output.work[0]).toEqual({ title: 'Role 0', company: 'Acme', dates: '2020' })
  })
})

describe('toBrandedCvData — education mapping (identical behaviour to work_experience)', () => {
  it('a well-formed array maps 1:1, preserving order', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      education: [
        { school: 'Manchester Uni', degree: 'BSc CS', dates: '2012-2015' },
        { school: 'LSE', degree: 'MSc Econ', dates: '2015-2016' },
      ],
    })
    expect(output.education).toEqual([
      { school: 'Manchester Uni', degree: 'BSc CS', dates: '2012-2015' },
      { school: 'LSE', degree: 'MSc Econ', dates: '2015-2016' },
    ])
  })

  it.each([
    ['null', null],
    ['a string', 'not-an-array'],
    ['a number', 42],
    ['an object', { school: 'X' }],
  ])('education holding %s degrades to [] without throwing', (_label, value) => {
    expect(() => toBrandedCvData({ full_name: 'X', education: value })).not.toThrow()
    expect(toBrandedCvData({ full_name: 'X', education: value }).education).toEqual([])
  })

  it('an array of objects with missing/non-string members never throws and drops only the bad entries', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      education: [
        { school: 'Real School', degree: 'BSc', dates: '2012-2015' },
        { school: 123, degree: null, dates: undefined },
        null,
        {},
      ],
    })
    expect(output.education).toContainEqual({ school: 'Real School', degree: 'BSc', dates: '2012-2015' })
    expect(output.education.length).toBeLessThan(4)
  })

  it('entries whose fields are all empty after trimming are dropped', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      education: [
        { school: '  ', degree: '', dates: '   ' },
        { school: 'Real School', degree: 'BSc', dates: '2012-2015' },
      ],
    })
    expect(output.education).toEqual([{ school: 'Real School', degree: 'BSc', dates: '2012-2015' }])
  })

  it('caps at 12 education entries', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      school: `Uni ${i}`,
      degree: 'BSc',
      dates: '2012',
    }))
    const output = toBrandedCvData({ full_name: 'X', education: entries })
    expect(output.education.length).toBe(12)
  })
})

describe('toBrandedCvData — prototype pollution safety', () => {
  it('a JSON-parsed jsonb entry carrying literal __proto__/constructor keys is not copied onto the output', () => {
    const hostileEntry = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": {"polluted": true}, "title": "Real Entry", "company": "Acme", "dates": "2020"}',
    ) as Record<string, unknown>
    const output = toBrandedCvData({ full_name: 'X', work_experience: [hostileEntry] })
    expect(output.work).toEqual([{ title: 'Real Entry', company: 'Acme', dates: '2020' }])
    expect((output.work[0] as unknown as Record<string, unknown>).polluted).toBeUndefined()
    // The global prototype must never be touched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a candidate row itself carrying literal __proto__/constructor keys never throws and never pollutes', () => {
    const hostileRow = JSON.parse(
      '{"__proto__": {"polluted": true}, "full_name": "Jamie", "location": "Manchester, UK"}',
    ) as Record<string, unknown>
    expect(() => toBrandedCvData(hostileRow)).not.toThrow()
    const output = toBrandedCvData(hostileRow)
    expect(output.fullName).toBe('Jamie')
    expect(output.location).toBe('Manchester, UK')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('toBrandedCvData — skills/sector_tags', () => {
  it('a well-formed string array passes through', () => {
    const output = toBrandedCvData({ full_name: 'X', skills: ['TypeScript', 'React'] })
    expect(output.skills).toEqual(['TypeScript', 'React'])
  })

  it.each([
    ['null', null],
    ['a string', 'not-an-array'],
    ['an array of numbers', [1, 2, 3]],
    ['an array of objects', [{ a: 1 }]],
  ])('skills holding %s degrades to [] without throwing', (_label, value) => {
    expect(() => toBrandedCvData({ full_name: 'X', skills: value })).not.toThrow()
    expect(toBrandedCvData({ full_name: 'X', skills: value }).skills).toEqual([])
  })

  it('empty/whitespace strings are dropped and duplicates collapsed', () => {
    const output = toBrandedCvData({
      full_name: 'X',
      skills: ['TypeScript', '  ', '', 'TypeScript', 'React', 'typescript'],
    })
    // 'typescript' (lowercase) is a distinct string from 'TypeScript' —
    // only EXACT duplicates collapse.
    expect(output.skills).toEqual(['TypeScript', 'React', 'typescript'])
  })

  it('caps at 60 skills and 12 sector tags', () => {
    const manySkills = Array.from({ length: 90 }, (_, i) => `Skill ${i}`)
    const manyTags = Array.from({ length: 30 }, (_, i) => `Tag ${i}`)
    const output = toBrandedCvData({ full_name: 'X', skills: manySkills, sector_tags: manyTags })
    expect(output.skills.length).toBe(60)
    expect(output.sectorTags.length).toBe(12)
  })

  it('sector_tags behaves identically to skills', () => {
    const output = toBrandedCvData({ full_name: 'X', sector_tags: ['Tech', 'Tech', '  '] })
    expect(output.sectorTags).toEqual(['Tech'])
  })
})

describe('toBrandedCvData — string length caps', () => {
  it('truncates full_name to 120 chars', () => {
    const output = toBrandedCvData({ full_name: 'A'.repeat(200) })
    expect(output.fullName.length).toBe(120)
  })

  it('truncates headline to 200 chars', () => {
    const output = toBrandedCvData({ full_name: 'X', headline: 'B'.repeat(300) })
    expect(output.headline?.length).toBe(200)
  })

  it('truncates about to 2500 chars', () => {
    const output = toBrandedCvData({ full_name: 'X', about: 'C'.repeat(3000) })
    expect(output.about?.length).toBe(2500)
  })

  it('truncates other strings (location) to 200 chars', () => {
    const output = toBrandedCvData({ full_name: 'X', location: 'D'.repeat(300) })
    expect(output.location?.length).toBe(200)
  })
})

describe('toBrandedCvData — hostile top-level input never throws', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not-a-candidate'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
  ])('candidate = %s produces a safe empty-ish default without throwing', (_label, value) => {
    expect(() => toBrandedCvData(value)).not.toThrow()
    const output = toBrandedCvData(value)
    expect(output.fullName).toBe('')
    expect(output.work).toEqual([])
    expect(output.education).toEqual([])
    expect(output.skills).toEqual([])
  })
})

describe('BRANDED_CV_FREE_TEXT_WARNING', () => {
  it('is a non-empty, user-facing string', () => {
    expect(typeof BRANDED_CV_FREE_TEXT_WARNING).toBe('string')
    expect(BRANDED_CV_FREE_TEXT_WARNING.length).toBeGreaterThan(20)
  })
})
