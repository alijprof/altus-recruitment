/**
 * @vitest-environment jsdom
 *
 * Plan 03-01 Task A.1 — three-stage selector fallback per RESEARCH §Pattern 2.
 * Each extractor returns { value, confidence: 'high'|'medium'|'low',
 * strategy_used: 'aria'|'datatest'|'h2'|'class' } so the route handler can
 * decide whether to accept the profile or surface a low-confidence warning
 * via the popup.
 *
 * The fixture (linkedin-profile-2026-05-19.html) is a well-formed anonymized
 * LinkedIn profile. The tests assert that the five top-level fields (name,
 * headline, current_role, current_company, skills) scrape with at least
 * `medium` confidence, AND that a deliberately mangled fixture (experience
 * section removed) returns `null` rather than throwing.
 *
 * Acceptance gate (PLAN A.1): every extractor must return ≥ 'medium' on the
 * happy-path fixture and `null` (not throw) when the section is missing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { scrapeLinkedInProfile } from '../src/content/scrape-profile'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(__dirname, 'fixtures/linkedin-profile-2026-05-19.html')

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf8')
}

function mountFixture(html: string) {
  document.documentElement.innerHTML = html
}

describe('scrapeLinkedInProfile — happy path (2026-05-19 fixture)', () => {
  beforeEach(() => {
    mountFixture(loadFixture())
  })

  it('extracts the full name from the h1 with medium-or-better confidence', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.name.value).toBe('Alex Placeholder')
    expect(['high', 'medium']).toContain(profile.name.confidence)
  })

  it('extracts the headline (current role + summary line)', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.headline.value).toContain('Senior Backend Engineer')
    expect(['high', 'medium']).toContain(profile.headline.confidence)
  })

  it('extracts current_role and current_company from the latest experience entry', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.current_role.value).toBe('Senior Backend Engineer')
    expect(profile.current_company.value).toBe('PlaceholderCo')
    expect(['high', 'medium']).toContain(profile.current_role.confidence)
  })

  it('extracts the location', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.location.value).toBe('London, England, United Kingdom')
  })

  it('extracts the About text', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.about.value).toMatch(/Placeholder bio/)
  })

  it('extracts at least two work_experience entries', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.work_experience.length).toBeGreaterThanOrEqual(2)
    expect(profile.work_experience[0]).toMatchObject({
      title: expect.stringContaining('Senior Backend Engineer'),
      company: 'PlaceholderCo',
    })
  })

  it('extracts at least one education entry', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.education.length).toBeGreaterThanOrEqual(1)
    expect(profile.education[0]).toMatchObject({
      school: 'University of Placeholder',
    })
  })

  it('extracts at least four declared skills', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.skills.length).toBeGreaterThanOrEqual(4)
    expect(profile.skills).toContain('PostgreSQL')
    expect(profile.skills).toContain('TypeScript')
  })

  it('NEVER captures profile-photo URLs (D3-03 privacy rule)', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile).not.toHaveProperty('photo_url')
    expect(JSON.stringify(profile)).not.toMatch(/profile-displayphoto/i)
  })

  it('emits a capture_confidence number between 0 and 1', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.capture_confidence).toBeGreaterThan(0)
    expect(profile.capture_confidence).toBeLessThanOrEqual(1)
  })

  it('round-trips linkedin_url verbatim from the argument', () => {
    const url = 'https://www.linkedin.com/in/placeholder/'
    const profile = scrapeLinkedInProfile(url)
    expect(profile.linkedin_url).toBe(url)
  })
})

describe('scrapeLinkedInProfile — degraded DOM (experience section removed)', () => {
  beforeEach(() => {
    const html = loadFixture().replace(
      /<section data-view-name="profile-component-entity-experience"[\s\S]*?<\/section>/,
      '',
    )
    mountFixture(html)
  })

  it('returns an empty work_experience array (does NOT throw)', () => {
    expect(() => scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')).not.toThrow()
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.work_experience).toEqual([])
  })

  it('downgrades current_role to null + confidence "low" when experience is gone', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.current_role.value).toBeNull()
    expect(profile.current_role.confidence).toBe('low')
  })

  it('drops overall capture_confidence below 1 when sections are missing', () => {
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/placeholder/')
    expect(profile.capture_confidence).toBeLessThan(1)
  })
})

describe('scrapeLinkedInProfile — totally empty DOM (no main element)', () => {
  beforeEach(() => {
    mountFixture('<html><body></body></html>')
  })

  it('returns a profile with all extractors null + low confidence (does NOT throw)', () => {
    expect(() => scrapeLinkedInProfile('https://www.linkedin.com/in/x/')).not.toThrow()
    const profile = scrapeLinkedInProfile('https://www.linkedin.com/in/x/')
    expect(profile.name.value).toBeNull()
    expect(profile.headline.value).toBeNull()
    expect(profile.work_experience).toEqual([])
    expect(profile.education).toEqual([])
    expect(profile.skills).toEqual([])
    expect(profile.capture_confidence).toBeLessThan(0.5)
  })
})
