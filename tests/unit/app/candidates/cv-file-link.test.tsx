import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CvFileLink } from '@/app/(app)/candidates/[id]/cv-file-link'

// ---------------------------------------------------------------------------
// CR-02 regression (review 2026-08-11) — the blocked-popup silent failure.
//
// window.open used to run AFTER the server-action await, so the click's
// transient activation was already gone (Safari/WebKit, and any strict popup
// blocker). window.open returned null, the return value was never checked,
// and the button flickered "Opening…" then did nothing — on the feature this
// whole phase exists to deliver. Worse, the signed URL had been minted and an
// `export` audit row written, so the audit recorded an access that never
// happened.
//
// These tests pin all three branches: navigate the synchronously-opened tab,
// close it + toast on a failed sign, and — when the popup was blocked —
// surface the URL in a toast the recruiter can activate.
// ---------------------------------------------------------------------------

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: (message: string, opts?: unknown) => toastError(message, opts),
  },
}))

const getCvFileUrlAction = vi.fn()
vi.mock('@/app/(app)/candidates/[id]/actions', () => ({
  getCvFileUrlAction: (...args: unknown[]) => getCvFileUrlAction(...args),
}))

type FakeWindow = {
  location: { href: string }
  closed: boolean
  opener: unknown
  close: () => void
}

function fakeWindow(): FakeWindow {
  const win: FakeWindow = {
    location: { href: '' },
    closed: false,
    opener: {},
    close: () => {
      win.closed = true
    },
  }
  return win
}

const SIGNED_URL = 'https://storage.example.test/signed/cv.pdf?token=abc'

let openSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  toastError.mockReset()
  getCvFileUrlAction.mockReset()
  getCvFileUrlAction.mockResolvedValue({ ok: true, url: SIGNED_URL })
})

afterEach(() => {
  openSpy?.mockRestore()
})

function renderLink() {
  render(
    <CvFileLink
      candidateCvId="cv-1"
      filename="dana-okafor-cv.pdf"
      downloadable
      disabledReason="unused"
    />,
  )
}

describe('CvFileLink — popup handling (CR-02)', () => {
  it('opens the tab synchronously, BEFORE the server round trip', async () => {
    const user = userEvent.setup()
    const win = fakeWindow()
    const order: string[] = []
    // reason: jsdom's window.open is a no-op returning null; the spy is the
    // only way to observe the call ordering this fix turns on.
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => {
      order.push('window.open')
      return win as unknown as Window
    })
    getCvFileUrlAction.mockImplementation(async () => {
      order.push('action')
      return { ok: true, url: SIGNED_URL }
    })

    renderLink()
    await user.click(screen.getByRole('button', { name: 'View' }))

    await waitFor(() => expect(getCvFileUrlAction).toHaveBeenCalledTimes(1))
    // If these ever swap, the popup blocker wins and the feature is dead.
    expect(order).toEqual(['window.open', 'action'])
  })

  it('navigates the opened tab to the signed URL and shows no error', async () => {
    const user = userEvent.setup()
    const win = fakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)

    renderLink()
    await user.click(screen.getByRole('button', { name: 'View' }))

    await waitFor(() => expect(win.location.href).toBe(SIGNED_URL))
    expect(toastError).not.toHaveBeenCalled()
    expect(win.closed).toBe(false)
  })

  it('severs window.opener before navigating (reverse-tabnabbing)', async () => {
    const user = userEvent.setup()
    const win = fakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)

    renderLink()
    await user.click(screen.getByRole('button', { name: 'View' }))

    await waitFor(() => expect(win.location.href).toBe(SIGNED_URL))
    expect(win.opener).toBeNull()
  })

  it('does not pass noopener to the placeholder open — that would return null', async () => {
    const user = userEvent.setup()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow() as unknown as Window)

    renderLink()
    await user.click(screen.getByRole('button', { name: 'View' }))

    const features = openSpy.mock.calls[0]?.[2]
    expect(String(features ?? '')).not.toContain('noopener')
  })

  it('closes the placeholder tab and toasts when the sign fails', async () => {
    const user = userEvent.setup()
    const win = fakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    getCvFileUrlAction.mockResolvedValue({ ok: false, error: 'CV not found.' })

    renderLink()
    await user.click(screen.getByRole('button', { name: 'View' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0]?.[0]).toBe('CV not found.')
    expect(win.closed).toBe(true)
    expect(win.location.href).toBe('')
  })

  it('never fails silently when the popup is blocked — toasts a usable link', async () => {
    const user = userEvent.setup()
    // A blocked popup is exactly this: window.open returns null.
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    renderLink()
    await user.click(screen.getByRole('button', { name: 'View' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    const [message, opts] = toastError.mock.calls[0] ?? []
    expect(String(message)).toMatch(/blocked/i)

    // The toast must carry an action that opens the URL from a fresh user
    // gesture — the whole point is that the recruiter is not left stranded.
    const action = (opts as { action?: { label: string; onClick: () => void } } | undefined)?.action
    expect(action?.label).toBe('Open CV')
    openSpy.mockClear()
    action?.onClick()
    expect(openSpy).toHaveBeenCalledWith(SIGNED_URL, '_blank', 'noopener,noreferrer')
  })

  it('renders disabled with the shared reason and never calls the action', async () => {
    const user = userEvent.setup()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <CvFileLink
        candidateCvId="cv-1"
        filename="dana-okafor-cv.pdf"
        downloadable={false}
        disabledReason="The upload never finished."
      />,
    )

    const button = screen.getByRole('button', { name: 'View' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'The upload never finished.')
    await user.click(button)
    expect(getCvFileUrlAction).not.toHaveBeenCalled()
  })
})
