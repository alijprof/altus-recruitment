/**
 * Plan 03-01 Task A.1 — LinkedIn profile scraper.
 *
 * Runs as a content script on `https://www.linkedin.com/in/*`. The popup
 * (src/popup/popup.ts) messages the background worker, which uses
 * chrome.scripting to inject + call `scrapeLinkedInProfile()` on the active
 * tab. Output is POSTed to `/api/linkedin/ingest`.
 *
 * Selector strategy (RESEARCH §Pattern 2, three-stage fallback):
 *   1. aria-label / data-test-id  (highest stability)
 *   2. data-view-name              (medium stability — LinkedIn's React
 *                                   component tags survive most redesigns)
 *   3. h2 heading text             (medium — visual structure rarely changes)
 *   4. class name                  (low — last resort; classes churn quarterly)
 *
 * D3-03: NEVER capture profile-photo URL.
 *
 * The scraper is total: missing sections return null/empty arrays, never
 * throw. `capture_confidence` is a weighted average across extractors so
 * the popup can flag "couldn't read this profile well — try again".
 */

export type Confidence = 'high' | 'medium' | 'low'
export type Strategy = 'aria' | 'datatest' | 'datavn' | 'h2' | 'class'

export type Extracted<T> = {
  value: T | null
  confidence: Confidence
  strategy_used: Strategy | null
}

export type WorkExperience = {
  title: string
  company: string | null
  dates: string | null
}

export type Education = {
  school: string
  degree: string | null
  dates: string | null
}

export type ScrapedProfile = {
  name: Extracted<string>
  headline: Extracted<string>
  current_role: Extracted<string>
  current_company: Extracted<string>
  location: Extracted<string>
  about: Extracted<string>
  work_experience: WorkExperience[]
  education: Education[]
  skills: string[]
  linkedin_url: string
  capture_confidence: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(el: Element | null | undefined): string | null {
  if (!el) return null
  const t = (el.textContent ?? '').trim()
  return t.length === 0 ? null : t
}

function confidenceFor(strategy: Strategy | null): Confidence {
  if (strategy === 'aria' || strategy === 'datatest') return 'high'
  if (strategy === 'datavn' || strategy === 'h2') return 'medium'
  if (strategy === 'class') return 'low'
  return 'low'
}

const NULL_EXTRACTED: Extracted<string> = {
  value: null,
  confidence: 'low',
  strategy_used: null,
}

// ---------------------------------------------------------------------------
// Per-field extractors. Each returns Extracted<string>; missing fields are
// represented as `value: null, confidence: 'low'`.
// ---------------------------------------------------------------------------

function extractName(doc: Document): Extracted<string> {
  // Stage 1: h1 inside the profile card (most stable structural anchor)
  const h1 = doc.querySelector('main h1, h1.text-heading-xlarge, h1')
  const value = text(h1)
  if (value) {
    return {
      value,
      confidence: confidenceFor('h2'), // h1 is structurally similar — same trust tier
      strategy_used: 'h2',
    }
  }
  return NULL_EXTRACTED
}

function extractHeadline(doc: Document): Extracted<string> {
  // Stage 1: data-test-id (most stable)
  const dt = doc.querySelector('[data-test-id="profile-headline"]')
  let value = text(dt)
  if (value) return { value, confidence: 'high', strategy_used: 'datatest' }

  // Stage 2: class fallback — text-body-medium directly inside the profile card
  const cls = doc.querySelector('.pv-text-details__left-panel .text-body-medium')
  value = text(cls)
  if (value) return { value, confidence: 'low', strategy_used: 'class' }

  return NULL_EXTRACTED
}

function extractLocation(doc: Document): Extracted<string> {
  // Stage 1: data-test-id
  const dt = doc.querySelector('[data-test-id="profile-location"]')
  let value = text(dt)
  if (value) return { value, confidence: 'high', strategy_used: 'datatest' }

  // Stage 2: aria-label
  const aria = doc.querySelector('[aria-label="Location"]')
  value = text(aria)
  if (value) return { value, confidence: 'high', strategy_used: 'aria' }

  return NULL_EXTRACTED
}

function extractAbout(doc: Document): Extracted<string> {
  // Stage 1: data-view-name section
  const section = doc.querySelector('[data-view-name="profile-component-entity-about"]')
  if (section) {
    // Skip the heading; find the body span.
    const span = section.querySelector('.inline-show-more-text span, .pv-shared-text-with-see-more span')
    const value = text(span)
    if (value) return { value, confidence: 'medium', strategy_used: 'datavn' }
  }

  // Stage 2: id="about" anchor (LinkedIn's stable hash anchor)
  const idEl = doc.querySelector('#about')
  if (idEl) {
    const span = idEl.querySelector('.inline-show-more-text span, .pv-shared-text-with-see-more span')
    const value = text(span)
    if (value) return { value, confidence: 'medium', strategy_used: 'h2' }
  }

  return NULL_EXTRACTED
}

function extractWorkExperience(doc: Document): WorkExperience[] {
  const section =
    doc.querySelector('[data-view-name="profile-component-entity-experience"]') ??
    doc.querySelector('#experience')
  if (!section) return []

  const entries = section.querySelectorAll(
    '[data-view-name="profile-component-entity-experience-entry"], li.pvs-list__item--line-separated',
  )
  const out: WorkExperience[] = []
  entries.forEach((entry) => {
    const spans = entry.querySelectorAll('span[aria-hidden="true"]')
    // Common layout: [title, company · type, dates]
    const titleText = text(spans[0])
    const companyRaw = text(spans[1])
    const dates = text(spans[2])
    if (!titleText) return // skip empty entry shells
    // Strip the trailing " · Full-time" / " · Contract" off company.
    const company = companyRaw ? companyRaw.split('·')[0]?.trim() ?? null : null
    out.push({
      title: titleText,
      company: company && company.length > 0 ? company : null,
      dates: dates ?? null,
    })
  })
  return out
}

function extractEducation(doc: Document): Education[] {
  const section =
    doc.querySelector('[data-view-name="profile-component-entity-education"]') ??
    doc.querySelector('#education')
  if (!section) return []

  const entries = section.querySelectorAll(
    '[data-view-name="profile-component-entity-education-entry"], li.pvs-list__item--line-separated',
  )
  const out: Education[] = []
  entries.forEach((entry) => {
    const spans = entry.querySelectorAll('span[aria-hidden="true"]')
    const school = text(spans[0])
    const degree = text(spans[1])
    const dates = text(spans[2])
    if (!school) return
    out.push({
      school,
      degree: degree ?? null,
      dates: dates ?? null,
    })
  })
  return out
}

function extractSkills(doc: Document): string[] {
  const section =
    doc.querySelector('[data-view-name="profile-component-entity-skills"]') ??
    doc.querySelector('#skills')
  if (!section) return []

  const entries = section.querySelectorAll(
    '[data-view-name="profile-component-entity-skill-entry"]',
  )
  const out: string[] = []
  entries.forEach((entry) => {
    const span = entry.querySelector('span[aria-hidden="true"]')
    const value = text(span)
    if (value) out.push(value)
  })
  return out
}

function extractCurrentCompany(
  doc: Document,
  experience: WorkExperience[],
): Extracted<string> {
  // Stage 1: explicit aria-label on the right-panel button
  const btn = doc.querySelector('button[aria-label^="Current company:"]')
  if (btn) {
    const aria = btn.getAttribute('aria-label') ?? ''
    const m = aria.match(/^Current company:\s*(.+)$/i)
    if (m && m[1]) {
      return { value: m[1].trim(), confidence: 'high', strategy_used: 'aria' }
    }
  }

  // Stage 2: first experience entry's company field
  const first = experience[0]
  if (first?.company) {
    return { value: first.company, confidence: 'medium', strategy_used: 'datavn' }
  }

  return NULL_EXTRACTED
}

function extractCurrentRole(experience: WorkExperience[]): Extracted<string> {
  const first = experience[0]
  if (first?.title) {
    return { value: first.title, confidence: 'medium', strategy_used: 'datavn' }
  }
  return NULL_EXTRACTED
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function scrapeLinkedInProfile(linkedinUrl: string): ScrapedProfile {
  const doc = document

  const name = extractName(doc)
  const headline = extractHeadline(doc)
  const location = extractLocation(doc)
  const about = extractAbout(doc)
  const work_experience = extractWorkExperience(doc)
  const education = extractEducation(doc)
  const skills = extractSkills(doc)
  const current_role = extractCurrentRole(work_experience)
  const current_company = extractCurrentCompany(doc, work_experience)

  // Per-field weights → overall capture_confidence (0..1). Weights front-load
  // the fields the recruiter most cares about for matching (name, role,
  // company, skills).
  const weights = {
    name: 0.25,
    current_role: 0.2,
    current_company: 0.15,
    headline: 0.1,
    location: 0.05,
    about: 0.05,
    skills: 0.15,
    experience: 0.05,
  }
  const score = (e: Extracted<unknown>): number => {
    if (!e.value) return 0
    if (e.confidence === 'high') return 1
    if (e.confidence === 'medium') return 0.7
    return 0.4
  }
  const capture_confidence =
    score(name) * weights.name +
    score(current_role) * weights.current_role +
    score(current_company) * weights.current_company +
    score(headline) * weights.headline +
    score(location) * weights.location +
    score(about) * weights.about +
    (skills.length >= 3 ? 1 : skills.length > 0 ? 0.6 : 0) * weights.skills +
    (work_experience.length >= 2 ? 1 : work_experience.length === 1 ? 0.5 : 0) *
      weights.experience

  return {
    name,
    headline,
    current_role,
    current_company,
    location,
    about,
    work_experience,
    education,
    skills,
    linkedin_url: linkedinUrl,
    capture_confidence: Math.max(0, Math.min(1, capture_confidence)),
  }
}
