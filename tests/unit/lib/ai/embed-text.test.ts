/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// Stub `server-only` — embed-text.ts is server-only but the functions are pure.
vi.mock('server-only', () => ({}))

import {
  candidateEmbeddingText,
  jobEmbeddingText,
  MAX_CV_CHARS_FOR_EMBED,
} from '@/lib/ai/embed-text'

// Minimal shapes — we only test the fields the builder consumes. The Pick
// in the builder signature accepts these wider objects, so cast is fine.

type CandidateLike = Parameters<typeof candidateEmbeddingText>[0]
type JobLike = Parameters<typeof jobEmbeddingText>[0]

const fullCandidate: CandidateLike = {
  full_name: 'Alice Smith',
  current_role_title: 'Senior Python Engineer',
  current_company: 'Acme Wind Co',
  location: 'Aberdeen, UK',
  skills: ['Python', 'PostgreSQL', 'Wind turbines'],
  seniority_level: 'senior',
  years_experience: 8,
  sector_tags: ['energy', 'offshore'],
}

describe('candidateEmbeddingText', () => {
  it('renders every field on a fully-populated candidate', () => {
    const out = candidateEmbeddingText(fullCandidate, null)
    expect(out).toContain('Name: Alice Smith.')
    expect(out).toContain('Role: Senior Python Engineer.')
    expect(out).toContain('Company: Acme Wind Co.')
    expect(out).toContain('Location: Aberdeen, UK.')
    expect(out).toContain('Skills: Python, PostgreSQL, Wind turbines.')
    expect(out).toContain('Seniority: senior.')
    expect(out).toContain('Years: 8.')
    expect(out).toContain('Sectors: energy, offshore.')
  })

  it('omits the `---` separator when cvText is null', () => {
    const out = candidateEmbeddingText(fullCandidate, null)
    expect(out).not.toContain('---')
  })

  it('includes cvText after `---` when present', () => {
    const out = candidateEmbeddingText(fullCandidate, 'I have done wind work.')
    expect(out).toContain('\n\n---\n\n')
    expect(out).toContain('I have done wind work.')
  })

  it('truncates cvText to MAX_CV_CHARS_FOR_EMBED', () => {
    const longCv = 'x'.repeat(MAX_CV_CHARS_FOR_EMBED + 5000)
    const out = candidateEmbeddingText(fullCandidate, longCv)
    // The truncated CV body should equal MAX_CV_CHARS_FOR_EMBED chars.
    // (The summary precedes it; we measure from the separator onward.)
    const sepIdx = out.indexOf('\n\n---\n\n')
    expect(sepIdx).toBeGreaterThanOrEqual(0)
    const body = out.slice(sepIdx + '\n\n---\n\n'.length)
    expect(body.length).toBe(MAX_CV_CHARS_FOR_EMBED)
  })

  it('skips empty skills array without emitting "Skills: ."', () => {
    const out = candidateEmbeddingText({ ...fullCandidate, skills: [] }, null)
    expect(out).not.toContain('Skills:')
  })

  it('skips null location without emitting "Location: null."', () => {
    const out = candidateEmbeddingText({ ...fullCandidate, location: null }, null)
    expect(out).not.toContain('Location:')
    expect(out).not.toContain('null')
  })

  it('skips null years_experience cleanly', () => {
    const out = candidateEmbeddingText({ ...fullCandidate, years_experience: null }, null)
    expect(out).not.toContain('Years:')
  })

  it('renders the minimum (name only) without crashing', () => {
    const minimal: CandidateLike = {
      full_name: 'Bob',
      current_role_title: null,
      current_company: null,
      location: null,
      skills: [],
      seniority_level: null,
      years_experience: null,
      sector_tags: [],
    }
    const out = candidateEmbeddingText(minimal, null)
    expect(out).toBe('Name: Bob.')
  })
})

const fullJob: JobLike = {
  title: 'Lead Python Developer',
  location: 'Aberdeen',
  job_type: 'perm',
  hiring_context: 'new_role',
  salary_min: 70000,
  salary_max: 90000,
  currency: 'GBP',
  description: 'Build offshore wind monitoring systems in Python.',
}

describe('jobEmbeddingText', () => {
  it('renders the structured header + description for a full job', () => {
    const out = jobEmbeddingText(fullJob)
    expect(out).toContain('Title: Lead Python Developer.')
    expect(out).toContain('Location: Aberdeen.')
    expect(out).toContain('Type: perm.')
    expect(out).toContain('Hiring context: new_role.')
    expect(out).toContain('Salary: 70000-90000 GBP.')
    expect(out).toContain('Description: Build offshore wind monitoring systems in Python.')
  })

  it('omits the salary line when both min and max are null', () => {
    const out = jobEmbeddingText({ ...fullJob, salary_min: null, salary_max: null })
    expect(out).not.toContain('Salary:')
  })

  it('renders a half-open salary range with a `?` placeholder', () => {
    const out = jobEmbeddingText({ ...fullJob, salary_min: 60000, salary_max: null })
    expect(out).toContain('Salary: 60000-?')
  })

  it('omits description when null', () => {
    const out = jobEmbeddingText({ ...fullJob, description: null })
    expect(out).not.toContain('Description:')
  })
})
