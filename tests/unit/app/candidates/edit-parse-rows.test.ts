import { describe, expect, it } from 'vitest'

import {
  parseEducationRows,
  parseWorkExperienceRows,
} from '@/app/(app)/candidates/[id]/edit/parse-rows'

// ---------------------------------------------------------------------------
// WR-12 regression (review 2026-08-11).
//
// The edit action writes the WHOLE work_experience / education array, so any
// stored row these parsers cannot reproduce would be permanently deleted by
// opening + saving the page, and any extra key a past or future writer
// stored would be stripped. That is a data-destroying default dressed up as
// a display default.
//
// `editable` is the guard: false means the page renders that section
// read-only, so the column is never rewritten from this form.
// ---------------------------------------------------------------------------

describe('parseWorkExperienceRows', () => {
  it('treats the current writer shape as fully editable', () => {
    const result = parseWorkExperienceRows([
      { title: 'Consultant', company: 'Altus', dates: '2022 – Present' },
      { title: 'Resourcer', company: null, dates: null },
    ])
    expect(result.editable).toBe(true)
    expect(result.rows).toEqual([
      { title: 'Consultant', company: 'Altus', dates: '2022 – Present' },
      { title: 'Resourcer', company: '', dates: '' },
    ])
  })

  it('treats an empty or absent array as editable', () => {
    expect(parseWorkExperienceRows([]).editable).toBe(true)
    expect(parseWorkExperienceRows(null).editable).toBe(true)
    expect(parseWorkExperienceRows(undefined).editable).toBe(true)
  })

  it('is NOT editable when a row carries a key this editor would strip', () => {
    const result = parseWorkExperienceRows([
      { title: 'Consultant', company: 'Altus', dates: '2022', source: 'linkedin' },
    ])
    expect(result.editable).toBe(false)
    // Still displayable — the row just cannot be saved back intact.
    expect(result.rows).toHaveLength(1)
  })

  it('is NOT editable when a row has no usable title (it would be dropped)', () => {
    const result = parseWorkExperienceRows([
      { title: 'Consultant' },
      { company: 'Altus', dates: '2020' },
    ])
    expect(result.editable).toBe(false)
    expect(result.rows).toHaveLength(1)
  })

  it('is NOT editable when a row is not an object', () => {
    expect(parseWorkExperienceRows(['Consultant at Altus']).editable).toBe(false)
    expect(parseWorkExperienceRows([['Consultant']]).editable).toBe(false)
    expect(parseWorkExperienceRows([null]).editable).toBe(false)
  })

  it('is NOT editable when an optional field holds a non-text value', () => {
    const result = parseWorkExperienceRows([{ title: 'Consultant', company: 42 }])
    expect(result.editable).toBe(false)
  })

  it('is NOT editable when the column is not an array at all', () => {
    const result = parseWorkExperienceRows({ title: 'Consultant' })
    expect(result.editable).toBe(false)
    expect(result.rows).toEqual([])
  })
})

describe('parseEducationRows', () => {
  it('treats the current writer shape as fully editable', () => {
    const result = parseEducationRows([
      { school: 'University of Leeds', degree: 'BSc', dates: '2015 – 2018' },
    ])
    expect(result.editable).toBe(true)
    expect(result.rows).toEqual([
      { school: 'University of Leeds', degree: 'BSc', dates: '2015 – 2018' },
    ])
  })

  it('is NOT editable when a row carries an unknown key', () => {
    const result = parseEducationRows([{ school: 'Leeds', degree: 'BSc', grade: '2:1' }])
    expect(result.editable).toBe(false)
  })

  it('is NOT editable when a row has no usable school', () => {
    const result = parseEducationRows([{ degree: 'BSc', dates: '2015' }])
    expect(result.editable).toBe(false)
    expect(result.rows).toEqual([])
  })
})
