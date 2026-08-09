import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplyForm } from '@/app/(public)/apply/[orgSlug]/apply-form'
import { CV_WRONG_FORMAT_MESSAGE } from '@/lib/cv/parse-messages'

// ---------------------------------------------------------------------------
// Review 2026-08-09 CR-01 regression test.
//
// confirmApplyAction gained a byte-level format sniff (plan 06-08) that
// returns an honest, actionable `formError` — "…save it as a real PDF or
// .docx and upload again". The client was never wired to it: it rendered a
// hardcoded toast claiming the CV "uploaded" fine and telling the applicant
// to email the agency. That is the OPPOSITE of the truth for a rejected
// file, and it sends the applicant to the one action that cannot fix it.
//
// The existing action-level test (confirm-action-file-sniff.test.ts) asserts
// only the SERVER return value, so nothing caught the client discarding it.
// These tests walk the real component, at the DOM/toast boundary.
// ---------------------------------------------------------------------------

// jsdom has no ResizeObserver; the Radix <Select> in this form measures its
// trigger on mount. Module-scope (not stubGlobal) so vi.unstubAllGlobals()
// in afterEach cannot tear it back down mid-suite.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    writable: true,
    configurable: true,
  })
}

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => toastError(m),
    success: (m: string) => toastSuccess(m),
  },
}))

const submitApplyAction = vi.fn()
const confirmApplyAction = vi.fn()
vi.mock('@/app/(public)/apply/[orgSlug]/actions', () => ({
  submitApplyAction: (...args: unknown[]) => submitApplyAction(...args),
  confirmApplyAction: (...args: unknown[]) => confirmApplyAction(...args),
}))

const CONTACT_EMAIL = 'hello@example-agency.test'
const PDF_MIME = 'application/pdf'

function renderForm() {
  return render(
    <ApplyForm
      orgSlug="example-agency"
      orgName="Example Agency"
      consentText="We will process your data lawfully."
      contactEmail={CONTACT_EMAIL}
    />,
  )
}

/**
 * Drives the form to the point where stage 3 (confirm) has returned.
 * Stage 1 is mocked ok, stage 2 (the direct-to-Storage PUT) is a mocked
 * fetch that succeeds — so the ONLY thing under test is what the component
 * does with confirmApplyAction's result.
 */
async function submitApplication() {
  const user = userEvent.setup()
  renderForm()

  await user.type(screen.getByLabelText('Full name'), 'Jane Doe')
  await user.type(screen.getByLabelText('Email'), 'jane@example.test')

  const file = new File([new Uint8Array([1, 2, 3, 4])], 'cv.pdf', { type: PDF_MIME })
  const fileInput = document.querySelector('input[type="file"]')
  if (!(fileInput instanceof HTMLInputElement)) throw new Error('file input not found')
  await user.upload(fileInput, file)

  await user.click(screen.getByRole('checkbox', { name: /i have read and agree/i }))
  await user.click(screen.getByRole('button', { name: 'Skip captcha (dev)' }))
  await user.click(screen.getByRole('button', { name: 'Submit application' }))
}

describe('ApplyForm — confirm-stage failure messaging (CR-01)', () => {
  beforeEach(() => {
    toastError.mockClear()
    toastSuccess.mockClear()
    submitApplyAction.mockReset()
    confirmApplyAction.mockReset()

    submitApplyAction.mockResolvedValue({
      ok: true,
      signedUrl: 'https://storage.test/signed-put',
      candidateCvId: 'cv-1',
      candidateId: 'cand-1',
    })
    // Stage 2: the direct-to-Storage PUT succeeds.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the server's wrong-format message instead of the generic 'uploaded fine' copy", async () => {
    confirmApplyAction.mockResolvedValue({ ok: false, formError: CV_WRONG_FORMAT_MESSAGE })

    await submitApplication()

    await waitFor(() => expect(confirmApplyAction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(CV_WRONG_FORMAT_MESSAGE))

    // The specific falsehood this finding is about: the applicant must NOT
    // be told the CV uploaded fine, nor pointed at the agency's inbox, when
    // the server has just rejected the bytes and marked the row failed.
    const shown = toastError.mock.calls.map((c) => String(c[0])).join('\n')
    expect(shown).not.toMatch(/uploaded but we couldn/i)
    expect(shown).not.toContain(CONTACT_EMAIL)
  })

  it('passes through any other honest server reason verbatim', async () => {
    confirmApplyAction.mockResolvedValue({
      ok: false,
      formError: 'CV upload did not complete. Please try again.',
    })

    await submitApplication()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('CV upload did not complete. Please try again.'),
    )
  })

  it('falls back to the generic contact copy only when the server sends no message', async () => {
    confirmApplyAction.mockResolvedValue({ ok: false, formError: '   ' })

    await submitApplication()

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(String(toastError.mock.calls[0]?.[0])).toContain(CONTACT_EMAIL)
  })
})
