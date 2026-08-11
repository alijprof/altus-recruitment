/**
 * @vitest-environment node
 *
 * confidence-summary — the pure low/medium-confidence aggregation behind the
 * "N fields unsure" badge + named-field summary line on the Latest CV panel
 * (D-02, Plan 07-02), and the shared CV_FIELD_LABELS map the review sheet
 * itself renders from. Every case here mirrors a behaviour bullet in
 * 07-02-PLAN.md Task 1.
 */
import { describe, expect, it } from 'vitest'

import { CV_FIELD_LABELS, summariseConfidence } from '@/lib/cv/confidence-summary'

describe('summariseConfidence', () => {
  it('counts two low and one medium field as unsureCount 3', () => {
    const result = summariseConfidence({
      confidence_per_field: {
        name: 'high',
        current_role: 'low',
        skills: 'medium',
        seniority_level: 'low',
      },
    })
    expect(result.unsureCount).toBe(3)
  })

  it('carries the HUMAN label, not the raw key', () => {
    const result = summariseConfidence({
      confidence_per_field: { current_role: 'low' },
    })
    expect(result.unsureFields).toEqual(['Current role'])
    expect(result.unsureFields).not.toContain('current_role')
  })

  it('preserves CV_FIELD_LABELS declaration order, not object-key order', () => {
    // Object keys deliberately out of declaration order (skills before name).
    const result = summariseConfidence({
      confidence_per_field: {
        skills: 'low',
        name: 'medium',
        seniority_level: 'low',
      },
    })
    expect(result.unsureFields).toEqual(['Name', 'Seniority', 'Skills'])
  })

  it('never counts a high-confidence field', () => {
    const result = summariseConfidence({
      confidence_per_field: { name: 'high', email: 'high' },
    })
    expect(result).toEqual({ unsureCount: 0, unsureFields: [] })
  })

  it('returns the zero result when extracted_data has no confidence_per_field', () => {
    expect(summariseConfidence({ name: 'Jane Smith' })).toEqual({
      unsureCount: 0,
      unsureFields: [],
    })
  })

  it('returns the zero result for null extracted_data and never throws', () => {
    expect(() => summariseConfidence(null)).not.toThrow()
    expect(summariseConfidence(null)).toEqual({ unsureCount: 0, unsureFields: [] })
  })

  it('returns the zero result for a string extracted_data and never throws', () => {
    expect(() => summariseConfidence('not an object')).not.toThrow()
    expect(summariseConfidence('not an object')).toEqual({ unsureCount: 0, unsureFields: [] })
  })

  it('returns the zero result for a number extracted_data and never throws', () => {
    expect(() => summariseConfidence(42)).not.toThrow()
    expect(summariseConfidence(42)).toEqual({ unsureCount: 0, unsureFields: [] })
  })

  it('returns the zero result for an array extracted_data and never throws', () => {
    expect(() => summariseConfidence(['not', 'an', 'object'])).not.toThrow()
    expect(summariseConfidence(['not', 'an', 'object'])).toEqual({
      unsureCount: 0,
      unsureFields: [],
    })
  })

  it('returns the zero result for undefined extracted_data and never throws', () => {
    expect(() => summariseConfidence(undefined)).not.toThrow()
    expect(summariseConfidence(undefined)).toEqual({ unsureCount: 0, unsureFields: [] })
  })

  it('ignores a confidence_per_field value that is not high/medium/low', () => {
    const result = summariseConfidence({
      confidence_per_field: { name: 'unsure', email: 'low' },
    })
    expect(result.unsureFields).toEqual(['Email'])
  })

  it('ignores a confidence_per_field KEY not present in CV_FIELD_LABELS', () => {
    const result = summariseConfidence({
      confidence_per_field: { not_a_real_field: 'low', email: 'low' },
    })
    expect(result.unsureFields).toEqual(['Email'])
  })
})

describe('CV_FIELD_LABELS', () => {
  it('declares exactly the 12 field keys the review sheet renders, in order', () => {
    expect(CV_FIELD_LABELS.map((f) => f.key)).toEqual([
      'name',
      'email',
      'phone',
      'location',
      'current_role',
      'current_company',
      'seniority_level',
      'years_experience_total',
      'salary_current_estimate',
      'salary_expectation',
      'skills',
      'sector_tags',
    ])
  })
})
