import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CvReviewPanel } from '@/app/(app)/candidates/[id]/cv-review-panel'
import {
  CV_NO_TEXT_MESSAGE,
  CV_STUCK_MESSAGE,
  CV_UPLOAD_INCOMPLETE_MESSAGE,
} from '@/lib/cv/parse-messages'
import type { CandidateCvRow } from '@/lib/db/candidate-cvs'

// ---------------------------------------------------------------------------
// Review 2026-08-04 C2 + C3 regression tests.
//
// C2: the generic FailedState branch rendered hardcoded copy and never read
//     parseError, so CV_UPLOAD_INCOMPLETE_MESSAGE and CV_STUCK_MESSAGE were
//     write-only; and fail-no-file shipped a "Try again" button with no
//     storage object behind it.
// C3: `timedOut` was a one-way latch — clicking "Try again" fired the server
//     action, toasted success, and left the amber alert up forever with no
//     polling. These tests walk that exact transition.
// ---------------------------------------------------------------------------

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

const retryParseAction = vi.fn()
const acceptCVFieldsAction = vi.fn()
vi.mock('@/app/(app)/candidates/[id]/actions', () => ({
  retryParseAction: (...args: unknown[]) => retryParseAction(...args),
  acceptCVFieldsAction: (...args: unknown[]) => acceptCVFieldsAction(...args),
}))

const POLL_INTERVAL_MS = 3_000
const TIMEOUT_MS = 5 * 60_000

function cvRow(overrides: Partial<CandidateCvRow>): CandidateCvRow {
  // reason: CandidateCvRow is the full generated row type; these tests only
  // exercise the four fields the panel branches on, so the rest is filled by
  // the cast rather than by inventing ~15 irrelevant column values.
  return {
    id: 'cv-1',
    candidate_id: 'cand-1',
    parsing_status: 'pending',
    parse_error: null,
    extracted_data: null,
    ...overrides,
  } as unknown as CandidateCvRow
}

beforeEach(() => {
  refresh.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  retryParseAction.mockReset().mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('CvReviewPanel — FailedState copy (C2)', () => {
  it('renders the stored upload-incomplete reason and offers NO retry button', () => {
    render(
      <CvReviewPanel
        candidateCv={cvRow({ parsing_status: 'failed', parse_error: CV_UPLOAD_INCOMPLETE_MESSAGE })}
        candidateFullName="Test Candidate"
      />,
    )
    expect(screen.getByText(CV_UPLOAD_INCOMPLETE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('renders the stored "parsing didn’t start" reason AND keeps a retry button', () => {
    render(
      <CvReviewPanel
        candidateCv={cvRow({ parsing_status: 'failed', parse_error: CV_STUCK_MESSAGE })}
        candidateFullName="Test Candidate"
      />,
    )
    expect(screen.getByText(CV_STUCK_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('renders the unparseable-source reason with no retry button', () => {
    render(
      <CvReviewPanel
        candidateCv={cvRow({ parsing_status: 'failed', parse_error: CV_NO_TEXT_MESSAGE })}
        candidateFullName="Test Candidate"
      />,
    )
    expect(screen.getByText(CV_NO_TEXT_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('falls back to the locked generic literal when parse_error is NULL', () => {
    render(
      <CvReviewPanel
        candidateCv={cvRow({ parsing_status: 'failed', parse_error: null })}
        candidateFullName="Test Candidate"
      />,
    )
    expect(screen.getByText(/retry now or continue and parse later/i)).toBeInTheDocument()
  })
})

/** Fire the next poll tick and flush the React work it schedules. */
async function tick(times = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * times)
  })
}

/**
 * Jump the wall clock past the component's 5-minute cap WITHOUT executing the
 * ~100 intervening interval callbacks (which makes the test slow and tells us
 * nothing extra). The component compares `Date.now() - startedAt`, so moving
 * the clock and firing one tick reproduces the timeout exactly.
 */
async function jumpPastTimeout() {
  vi.setSystemTime(Date.now() + TIMEOUT_MS + 1_000)
  await tick()
}

describe('CvReviewPanel — PendingState timeout recovery (C3)', () => {
  it('polls, times out after 5 minutes, then RESTARTS polling after a retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<CvReviewPanel candidateCv={cvRow({})} candidateFullName="Test Candidate" />)

    // Polling is live before the cap.
    expect(screen.getByText(/AI is extracting structured fields/i)).toBeInTheDocument()
    await tick(3)
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3)

    // Cross the 5-minute cap: the interval is cleared and the honest
    // timed-out alert replaces the spinner.
    await jumpPastTimeout()
    expect(await screen.findByText(/taking longer than expected/i)).toBeInTheDocument()

    const refreshesAtTimeout = refresh.mock.calls.length
    await tick(5)
    expect(refresh).toHaveBeenCalledTimes(refreshesAtTimeout) // proven dead

    // The fix: retry clears the latch, restarts the 5-minute budget, and
    // brings polling back. Before this change the alert stayed up forever.
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(retryParseAction).toHaveBeenCalledWith({ candidateCvId: 'cv-1' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())

    expect(screen.queryByText(/taking longer than expected/i)).not.toBeInTheDocument()
    expect(screen.getByText(/AI is extracting structured fields/i)).toBeInTheDocument()

    await tick(3)
    expect(refresh.mock.calls.length).toBeGreaterThan(refreshesAtTimeout)
  })

  it('does not clear the timed-out state when the retry action fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    retryParseAction.mockResolvedValue({ ok: false, error: 'Not signed in.' })

    render(<CvReviewPanel candidateCv={cvRow({})} candidateFullName="Test Candidate" />)
    await jumpPastTimeout()
    expect(await screen.findByText(/taking longer than expected/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Not signed in.'))
    expect(screen.getByText(/taking longer than expected/i)).toBeInTheDocument()
  })
})
