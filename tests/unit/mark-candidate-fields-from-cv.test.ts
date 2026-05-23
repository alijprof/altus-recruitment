/**
 * @vitest-environment node
 *
 * Unit tests for the D-08 enforcement helper. The helper is the single
 * point where parsed CV data is merged onto the candidate row — a
 * regression here silently overwrites manually-entered values.
 *
 * We mock the entire Supabase chainable query builder so the test stays
 * pure: no database, no fetch, no env. The shape of `current` controls
 * what counts as "empty", and we assert the exact patch passed to
 * `update()`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub `server-only` so the helper can be imported in a Node test env.
vi.mock('server-only', () => ({}))

// Stub Sentry — we don't care about capture calls here.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import { markCandidateFieldsFromCV } from '@/lib/db/candidate-cvs'

type CandidateRow = {
  full_name: string
  email: string | null
  phone: string | null
  location: string | null
  current_role_title: string | null
  current_company: string | null
  seniority_level: string | null
  salary_current_estimate: number | null
  salary_expectation: number | null
  currency: string | null
  years_experience: number | null
  skills: string[]
  sector_tags: string[]
  work_experience: unknown[]
  education: unknown[]
}

type Patch = Partial<CandidateRow>

function makeSupabase(current: CandidateRow) {
  const updateSpy = vi.fn().mockReturnThis()
  const eqUpdateSpy = vi.fn().mockResolvedValue({ error: null })
  let capturedPatch: Patch | null = null

  return {
    spy: () => capturedPatch,
    updateSpy,
    client: {
      from: () => {
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
          update: (patch: Patch) => {
            capturedPatch = patch
            updateSpy(patch)
            return { eq: eqUpdateSpy }
          },
        }
        return builder
      },
    } as never,
  }
}

const emptyCandidate: CandidateRow = {
  full_name: 'Existing Full Name',
  email: null,
  phone: null,
  location: null,
  current_role_title: null,
  current_company: null,
  seniority_level: null,
  salary_current_estimate: null,
  salary_expectation: null,
  currency: null,
  years_experience: null,
  skills: [],
  sector_tags: [],
  work_experience: [],
  education: [],
}

const parsedFull = {
  email: 'parsed@example.com',
  phone: '+44 7000 000000',
  location: 'London',
  current_role: 'Senior Engineer',
  current_company: 'NewCo',
  seniority_level: 'senior',
  salary_current_estimate: 80000,
  salary_expectation: 95000,
  currency: 'GBP',
  years_experience_total: 8,
  skills: ['python', 'sql'],
  sector_tags: ['fintech'],
}

describe('markCandidateFieldsFromCV (D-08 empty-only enforcement)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('populates every column when the candidate is fully empty', async () => {
    const sb = makeSupabase(emptyCandidate)
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: parsedFull,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(sb.spy()).toEqual({
      email: 'parsed@example.com',
      phone: '+44 7000 000000',
      location: 'London',
      current_role_title: 'Senior Engineer',
      current_company: 'NewCo',
      seniority_level: 'senior',
      salary_current_estimate: 80000,
      salary_expectation: 95000,
      currency: 'GBP',
      years_experience: 8,
      skills: ['python', 'sql'],
      sector_tags: ['fintech'],
    })
    expect(result.data.fieldsPopulated.sort()).toEqual(
      [
        'currency',
        'current_company',
        'current_role_title',
        'email',
        'location',
        'phone',
        'salary_current_estimate',
        'salary_expectation',
        'sector_tags',
        'seniority_level',
        'skills',
        'years_experience',
      ].sort(),
    )
  })

  it('NEVER overwrites a manually-entered scalar field (D-08)', async () => {
    // The crucial test: user typed "Old Co" before upload. After parse,
    // the CV says "New Co" — D-08 demands we keep "Old Co".
    const sb = makeSupabase({
      ...emptyCandidate,
      current_company: 'Old Co',
      email: 'manual@example.com',
    })
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: parsedFull,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const patch = sb.spy()
    expect(patch?.current_company).toBeUndefined()
    expect(patch?.email).toBeUndefined()
    // Other empties still get filled.
    expect(patch?.phone).toBe('+44 7000 000000')
    expect(result.data.fieldsPopulated).not.toContain('current_company')
    expect(result.data.fieldsPopulated).not.toContain('email')
  })

  it('treats empty string as empty (legacy form-quirk safety)', async () => {
    const sb = makeSupabase({
      ...emptyCandidate,
      email: '',
    })
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: parsedFull,
    })
    expect(result.ok).toBe(true)
    expect(sb.spy()?.email).toBe('parsed@example.com')
  })

  it('treats EMPTY ARRAY as empty for skills + sector_tags', async () => {
    // candidates.skills/sector_tags are text[] not null default '{}'.
    // The trigger fills them with [] — the helper must treat that as
    // "empty" and populate from the CV, not as "already set".
    const sb = makeSupabase({ ...emptyCandidate, skills: [], sector_tags: [] })
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: parsedFull,
    })
    expect(result.ok).toBe(true)
    expect(sb.spy()?.skills).toEqual(['python', 'sql'])
    expect(sb.spy()?.sector_tags).toEqual(['fintech'])
  })

  it('NEVER overwrites a populated array (D-08)', async () => {
    const sb = makeSupabase({
      ...emptyCandidate,
      skills: ['java'],
    })
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: parsedFull,
    })
    expect(result.ok).toBe(true)
    expect(sb.spy()?.skills).toBeUndefined()
  })

  it('skips the UPDATE entirely when there is nothing to fill', async () => {
    // Candidate already populated; parsed values get rejected. No
    // database write should fire (an empty UPDATE is wasteful and would
    // trigger updated_at unnecessarily).
    const sb = makeSupabase({
      full_name: 'Existing Full Name',
      email: 'a@a.com',
      phone: '+1',
      location: 'X',
      current_role_title: 'X',
      current_company: 'X',
      seniority_level: 'X',
      salary_current_estimate: 1,
      salary_expectation: 1,
      currency: 'GBP',
      years_experience: 1,
      skills: ['x'],
      sector_tags: ['x'],
      work_experience: [{ title: 'X' }],
      education: [{ school: 'X' }],
    })
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: parsedFull,
    })
    expect(result.ok).toBe(true)
    expect(sb.updateSpy).not.toHaveBeenCalled()
    if (result.ok) expect(result.data.fieldsPopulated).toEqual([])
  })

  it('ignores null/undefined values in the parsed payload', async () => {
    const sb = makeSupabase(emptyCandidate)
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: {
        email: null,
        phone: undefined,
        location: '',
      },
    })
    expect(result.ok).toBe(true)
    // All parsed values are empty — no write should occur.
    expect(sb.updateSpy).not.toHaveBeenCalled()
  })

  it('maps work_history → work_experience when the candidate column is empty', async () => {
    const sb = makeSupabase(emptyCandidate)
    const result = await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: {
        work_history: [
          {
            role: 'Senior Engineer',
            company: 'Acme',
            start_date: 'Jan 2020',
            end_date: 'Dec 2023',
          },
          {
            role: 'Junior Engineer',
            company: 'Beta',
            start_date: '2017',
            end_date: '2019',
          },
        ],
      },
    })
    expect(result.ok).toBe(true)
    expect(sb.spy()?.work_experience).toEqual([
      { title: 'Senior Engineer', company: 'Acme', dates: 'Jan 2020 - Dec 2023' },
      { title: 'Junior Engineer', company: 'Beta', dates: '2017 - 2019' },
    ])
  })

  it('synthesises "Present" when work_history end_date is missing', async () => {
    const sb = makeSupabase(emptyCandidate)
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: {
        work_history: [{ role: 'Founder', company: 'NewCo', start_date: '2024' }],
      },
    })
    expect(sb.spy()?.work_experience).toEqual([
      { title: 'Founder', company: 'NewCo', dates: '2024 - Present' },
    ])
  })

  it('skips work_history entries without a role', async () => {
    const sb = makeSupabase(emptyCandidate)
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: {
        work_history: [
          { company: 'Acme' }, // no role — drop
          { role: 'Engineer', company: 'Beta' },
        ],
      },
    })
    expect(sb.spy()?.work_experience).toEqual([
      { title: 'Engineer', company: 'Beta', dates: null },
    ])
  })

  it('maps education[] → candidates.education when empty', async () => {
    const sb = makeSupabase(emptyCandidate)
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: {
        education: [
          { institution: 'University of Warwick', qualification: 'BSc Engineering', year: '2015' },
          { institution: 'Oxford', qualification: 'MSc', year: '' },
        ],
      },
    })
    expect(sb.spy()?.education).toEqual([
      { school: 'University of Warwick', degree: 'BSc Engineering', dates: '2015' },
      { school: 'Oxford', degree: 'MSc', dates: null },
    ])
  })

  it('NEVER overwrites a populated work_experience array (D-08)', async () => {
    const sb = makeSupabase({
      ...emptyCandidate,
      work_experience: [{ title: 'Manual entry' }],
    })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: {
        work_history: [{ role: 'Engineer', company: 'NewCo' }],
      },
    })
    expect(sb.spy()?.work_experience).toBeUndefined()
  })

  it('upgrades full_name when the CV is a strict extension of the existing name', async () => {
    // The common quick-add-then-upload-CV flow: user typed 'Liam', CV says
    // 'Liam Steele'. We upgrade because the parsed name strictly extends
    // the existing one (case-insensitive prefix + trailing space).
    const sb = makeSupabase({ ...emptyCandidate, full_name: 'Liam' })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: { name: 'Liam Steele' },
    })
    expect(sb.spy()?.full_name).toBe('Liam Steele')
  })

  it('upgrades full_name across case differences', async () => {
    // User typed 'liam' lowercase, CV has proper 'Liam Steele'. Still an
    // extension by case-insensitive prefix — upgrade.
    const sb = makeSupabase({ ...emptyCandidate, full_name: 'liam' })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: { name: 'Liam Steele' },
    })
    expect(sb.spy()?.full_name).toBe('Liam Steele')
  })

  it('does NOT downgrade full_name when the CV name is shorter', async () => {
    const sb = makeSupabase({ ...emptyCandidate, full_name: 'Liam Steele' })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: { name: 'Liam' },
    })
    expect(sb.spy()?.full_name).toBeUndefined()
  })

  it('does NOT upgrade full_name when the CV name is unrelated', async () => {
    // 'Lima' (typo) + 'Liam Steele' — neither is a prefix of the other.
    // Preserve the manually-entered value.
    const sb = makeSupabase({ ...emptyCandidate, full_name: 'Lima' })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: { name: 'Liam Steele' },
    })
    expect(sb.spy()?.full_name).toBeUndefined()
  })

  it('does NOT upgrade full_name on partial-word matches', async () => {
    // 'Liam' + 'Liamsy' — same prefix but no separating space. Treat as
    // unrelated names; do not upgrade.
    const sb = makeSupabase({ ...emptyCandidate, full_name: 'Liam' })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: { name: 'Liamsy' },
    })
    expect(sb.spy()?.full_name).toBeUndefined()
  })

  it('fills full_name when the column is an empty string', async () => {
    const sb = makeSupabase({ ...emptyCandidate, full_name: '' })
    await markCandidateFieldsFromCV(sb.client, {
      candidateId: 'cand-1',
      parsed: { name: 'Liam Steele' },
    })
    expect(sb.spy()?.full_name).toBe('Liam Steele')
  })
})
