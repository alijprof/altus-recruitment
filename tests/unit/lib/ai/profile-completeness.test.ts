/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  isProfileEffectivelyEmpty,
  PROFILE_COMPLETENESS_ARRAY_COLUMNS,
  PROFILE_COMPLETENESS_COLUMNS,
  PROFILE_COMPLETENESS_SCALAR_COLUMNS,
} from '@/lib/ai/profile-completeness'

// Minimal shape — only the fields the predicate consumes (full_name is
// deliberately excluded, see the module's header comment for why).
const base = {
  current_role_title: null as string | null,
  current_company: null as string | null,
  location: null as string | null,
  seniority_level: null as string | null,
  years_experience: null as number | null,
  skills: [] as string[],
  sector_tags: [] as string[],
}

describe('isProfileEffectivelyEmpty', () => {
  it('is true when name is the only populated field (everything else null/[])', () => {
    expect(isProfileEffectivelyEmpty(base)).toBe(true)
  })

  it('is false when a real skill is present', () => {
    expect(isProfileEffectivelyEmpty({ ...base, skills: ['Python'] })).toBe(false)
  })

  it('is false when current_role_title alone is present', () => {
    expect(isProfileEffectivelyEmpty({ ...base, current_role_title: 'Engineer' })).toBe(false)
  })

  it('is false when years_experience is 0 (a real value, not empty)', () => {
    expect(isProfileEffectivelyEmpty({ ...base, years_experience: 0 })).toBe(false)
  })

  it('is true when location is whitespace-only', () => {
    expect(isProfileEffectivelyEmpty({ ...base, location: '   ' })).toBe(true)
  })

  it('is false when sector_tags has a real entry', () => {
    expect(isProfileEffectivelyEmpty({ ...base, sector_tags: ['energy'] })).toBe(false)
  })
})

// Review 2026-08-04 C1/H1 drift guard. The reconciler's heal selector and
// the embed-batch sweep both express this predicate in SQL, built from the
// exported column lists. If a field is added to the predicate but not to the
// lists (or vice versa) the SQL and TS versions silently diverge, which is
// exactly the starvation class those findings describe. These tests fail
// loudly on that divergence.
describe('PROFILE_COMPLETENESS_COLUMNS (SQL/TS drift guard)', () => {
  it('is the concatenation of the scalar and array column lists', () => {
    expect(PROFILE_COMPLETENESS_COLUMNS).toEqual([
      ...PROFILE_COMPLETENESS_SCALAR_COLUMNS,
      ...PROFILE_COMPLETENESS_ARRAY_COLUMNS,
    ])
  })

  it('names exactly the keys the base fixture (an empty profile) carries', () => {
    expect([...PROFILE_COMPLETENESS_COLUMNS].sort()).toEqual(Object.keys(base).sort())
  })

  it('every listed column, populated alone, flips the predicate to false', () => {
    const nonEmptyValue: Record<string, unknown> = {
      current_role_title: 'Engineer',
      current_company: 'Altus',
      location: 'Leeds',
      seniority_level: 'senior',
      years_experience: 5,
      skills: ['Python'],
      sector_tags: ['energy'],
    }
    for (const column of PROFILE_COMPLETENESS_COLUMNS) {
      expect(isProfileEffectivelyEmpty({ ...base, [column]: nonEmptyValue[column] })).toBe(false)
    }
  })
})
