/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { isProfileEffectivelyEmpty } from '@/lib/ai/profile-completeness'

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
