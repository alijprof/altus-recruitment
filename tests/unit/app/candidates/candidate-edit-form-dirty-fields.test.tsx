import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CandidateEditForm } from '@/app/(app)/candidates/[id]/edit/candidate-edit-form'
import type { EditCandidateInput } from '@/app/(app)/candidates/[id]/edit/schema'

// ---------------------------------------------------------------------------
// CR-01 regression (review 2026-08-11) — the stale-snapshot wipe.
//
// The widened edit form renders all 18 candidate fields, pre-filled from a
// server read taken at PAGE LOAD. Before this fix it submitted that entire
// snapshot on every save, and the action treats a present-but-empty value as
// a deliberate clear — so a recruiter correcting a phone number while
// `parse-cv` / "Accept all" / the reconcile heal-sweep landed the parsed
// profile in the background would silently wipe skills, work history,
// education, headline and about, with a success redirect and no warning.
//
// The fix: submit only react-hook-form's dirty fields, so untouched keys
// arrive as `undefined` and the action's omitted-vs-cleared helpers skip
// those columns entirely.
//
// These tests assert the PAYLOAD SHAPE, which is the actual contract — not
// the DB write, which lives behind the server action.
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (message: string) => toastError(message) },
}))

const updateCandidateAction = vi.fn()
vi.mock('@/app/(app)/candidates/[id]/edit/actions', () => ({
  updateCandidateAction: (...args: unknown[]) => updateCandidateAction(...args),
}))

// The page-load snapshot for a candidate whose CV has ALREADY been parsed —
// i.e. the interesting case, where there is real AI data to lose.
function parsedSnapshot(): EditCandidateInput {
  return {
    full_name: 'Dana Okafor',
    email: 'dana@example.com',
    phone: '07700 900000',
    location: 'Leeds',
    current_role_title: 'Senior Recruitment Consultant',
    current_company: 'Altus Consultancy',
    market_status: 'actively_looking',
    source: 'direct_add',
    seniority_level: 'senior',
    years_experience: '9',
    salary_current_estimate: '55000',
    salary_expectation: '65000',
    headline: 'Senior consultant, energy sector',
    about: 'Nine years placing engineers into offshore wind.',
    skills: ['Recruitment', 'Offshore wind'],
    sector_tags: ['Energy'],
    work_experience: [{ title: 'Consultant', company: 'Altus', dates: '2022 – Present' }],
    education: [{ school: 'University of Leeds', degree: 'BSc', dates: '2015 – 2018' }],
  }
}

// The snapshot a recruiter gets when they open the edit page SECONDS after
// uploading a CV — the parse has not landed yet, so every parsed field is
// still empty. This is the exact scenario that produced the wipe.
function preParseSnapshot(): EditCandidateInput {
  return {
    ...parsedSnapshot(),
    seniority_level: '',
    years_experience: '',
    salary_current_estimate: '',
    salary_expectation: '',
    headline: '',
    about: '',
    skills: [],
    sector_tags: [],
    work_experience: [],
    education: [],
  }
}

function lastPayload(): Record<string, unknown> {
  const call = updateCandidateAction.mock.calls.at(-1)
  if (!call) throw new Error('updateCandidateAction was never called')
  return call[1] as Record<string, unknown>
}

beforeEach(() => {
  updateCandidateAction.mockReset()
  updateCandidateAction.mockResolvedValue({ ok: true })
  toastError.mockReset()
})

describe('CandidateEditForm — dirty-field submission (CR-01)', () => {
  it('omits every untouched key when only the phone number was edited', async () => {
    const user = userEvent.setup()
    render(<CandidateEditForm candidateId="cand-1" defaultValues={parsedSnapshot()} />)

    const phone = screen.getByLabelText('Phone')
    await user.clear(phone)
    await user.type(phone, '07700 900123')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateCandidateAction).toHaveBeenCalledTimes(1))
    const payload = lastPayload()

    expect(payload.phone).toBe('07700 900123')
    // The AI-parsed columns must not appear AT ALL — a present-but-empty
    // value is a clear, and `undefined` is not the same as absent once the
    // payload is JSON-serialised on the way to postgrest.
    for (const key of [
      'skills',
      'sector_tags',
      'work_experience',
      'education',
      'headline',
      'about',
      'seniority_level',
      'years_experience',
      'salary_current_estimate',
      'salary_expectation',
    ]) {
      expect(Object.hasOwn(payload, key), `${key} must be omitted, not submitted`).toBe(false)
    }
  })

  it('survives the stale-snapshot save: a pre-parse page load sends no empty parsed fields', async () => {
    const user = userEvent.setup()
    render(<CandidateEditForm candidateId="cand-1" defaultValues={preParseSnapshot()} />)

    // The recruiter opened the form before the parse landed, so every parsed
    // field on screen is blank. They fix a typo in the location and save.
    // Meanwhile the parse has filled skills/work history/headline server-side.
    const location = screen.getByLabelText('Location')
    await user.clear(location)
    await user.type(location, 'Leeds, UK')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateCandidateAction).toHaveBeenCalledTimes(1))
    const payload = lastPayload()

    expect(payload.location).toBe('Leeds, UK')
    // Blank-because-not-yet-parsed must never be submitted as blank —
    // that is precisely the write that wiped the parsed profile.
    expect(Object.hasOwn(payload, 'skills')).toBe(false)
    expect(Object.hasOwn(payload, 'work_experience')).toBe(false)
    expect(Object.hasOwn(payload, 'headline')).toBe(false)
    expect(Object.hasOwn(payload, 'about')).toBe(false)
  })

  it('always sends the three schema-required keys even when untouched', async () => {
    const user = userEvent.setup()
    render(<CandidateEditForm candidateId="cand-1" defaultValues={parsedSnapshot()} />)

    const phone = screen.getByLabelText('Phone')
    await user.type(phone, '9')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateCandidateAction).toHaveBeenCalledTimes(1))
    const payload = lastPayload()

    expect(payload.full_name).toBe('Dana Okafor')
    expect(payload.market_status).toBe('actively_looking')
    expect(payload.source).toBe('direct_add')
  })

  it('still submits a field the recruiter deliberately CLEARED', async () => {
    const user = userEvent.setup()
    render(<CandidateEditForm candidateId="cand-1" defaultValues={parsedSnapshot()} />)

    // Clearing is a real edit — the recruiter is asserting "this is wrong,
    // remove it" — so it must reach the action as '' and persist as a clear.
    await user.clear(screen.getByLabelText('Email'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateCandidateAction).toHaveBeenCalledTimes(1))
    const payload = lastPayload()

    expect(Object.hasOwn(payload, 'email')).toBe(true)
    expect(payload.email).toBe('')
    // …and clearing one field must still not touch the others.
    expect(Object.hasOwn(payload, 'phone')).toBe(false)
    expect(Object.hasOwn(payload, 'skills')).toBe(false)
  })

  // --- WR-08: server-side field errors must reach the user --------------

  it('renders a server field error against the real field', async () => {
    const user = userEvent.setup()
    updateCandidateAction.mockResolvedValue({
      ok: false,
      fieldErrors: { phone: ['That phone number is not valid.'] },
    })
    render(<CandidateEditForm candidateId="cand-1" defaultValues={parsedSnapshot()} />)

    await user.type(screen.getByLabelText('Phone'), '9')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('That phone number is not valid.')).toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('never swallows an error keyed under a field the form does not render', async () => {
    const user = userEvent.setup()
    // The exact pre-fix shape: zod's flatten() keyed every issue under
    // `patch`, setError('patch') was a silent no-op, and the save looked
    // like it did nothing at all.
    updateCandidateAction.mockResolvedValue({
      ok: false,
      fieldErrors: { patch: ['Invalid candidate id.'] },
    })
    render(<CandidateEditForm candidateId="cand-1" defaultValues={parsedSnapshot()} />)

    await user.type(screen.getByLabelText('Phone'), '9')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0]?.[0]).toBe('Invalid candidate id.')
  })

  it('sends a field back to its original value as NOT dirty (no needless write)', async () => {
    const user = userEvent.setup()
    render(<CandidateEditForm candidateId="cand-1" defaultValues={parsedSnapshot()} />)

    const phone = screen.getByLabelText('Phone')
    await user.type(phone, '9')
    await user.clear(phone)
    await user.type(phone, '07700 900000')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateCandidateAction).toHaveBeenCalledTimes(1))
    expect(Object.hasOwn(lastPayload(), 'phone')).toBe(false)
  })
})
