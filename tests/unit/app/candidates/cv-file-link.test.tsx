import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CvFileLink } from '@/app/(app)/candidates/[id]/cv-file-link'

// ---------------------------------------------------------------------------
// PRODUCTION INCIDENT REWORK (2026-08-11).
//
// This control used to be a Button that opened a blank popup and awaited
// getCvFileUrlAction inside startTransition. Verified live on production: the
// action responded 200 with a valid signed URL and the client promise NEVER
// SETTLED — no branch ran, no toast, no pending state, popup orphaned at
// about:blank. The previous version of this file passed all seven of its
// tests while the feature was completely dead in the customer's browser,
// because jsdom cannot reproduce the popup + async-action interaction at all.
//
// The lesson is baked into the design, not into more mocks: there is no async
// client path left to test. The control is a plain anchor to a GET route
// handler, so what these tests pin is exactly what the browser needs to be
// correct — the href the route actually serves, new-tab semantics, and a
// disabled state that is genuinely non-navigable.
// ---------------------------------------------------------------------------

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111'
const CV_ID = '22222222-2222-4222-8222-222222222222'
const DISABLED_COPY = 'The upload never finished, so there is no stored file.'

function renderEnabled() {
  render(
    <CvFileLink
      candidateId={CANDIDATE_ID}
      candidateCvId={CV_ID}
      filename="dana-okafor-cv.pdf"
      downloadable
      disabledReason={DISABLED_COPY}
    />,
  )
}

describe('CvFileLink — anchor semantics', () => {
  it('renders a link (not a button) so the browser owns the navigation', () => {
    renderEnabled()

    // A LINK is the whole fix: the tab is opened by the browser from the
    // user's gesture, with no JS, no popup handle, and no promise to hang.
    expect(screen.getByRole('link', { name: 'View' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })

  it('points at the candidate-scoped CV route that mints the signed URL', () => {
    renderEnabled()

    // Drift pin: this literal must stay in step with the file path
    // src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts. If someone moves
    // or renames that route without updating the anchor, the control silently
    // 404s in production — the same "looks fine, does nothing" class of bug
    // this rework exists to kill.
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      `/candidates/${CANDIDATE_ID}/cv-file/${CV_ID}`,
    )
  })

  it('opens in a new tab with the opener severed', () => {
    renderEnabled()
    const link = screen.getByRole('link', { name: 'View' })

    expect(link).toHaveAttribute('target', '_blank')
    const rel = link.getAttribute('rel') ?? ''
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
  })

  it('shows the filename as the tooltip while keeping "View" as the accessible name', () => {
    renderEnabled()
    const link = screen.getByRole('link', { name: 'View' })

    // The accessible name is load-bearing for the smoke spec's
    // getByRole('link', { name: 'View', exact: true }) lookup — the filename
    // must stay in `title` and never leak into the name.
    expect(link).toHaveAttribute('title', 'dana-okafor-cv.pdf')
    expect(link).toHaveTextContent('View')
  })

  it('renders a disabled, non-navigable control when the upload never finished', () => {
    render(
      <CvFileLink
        candidateId={CANDIDATE_ID}
        candidateCvId={CV_ID}
        filename="dana-okafor-cv.pdf"
        downloadable={false}
        disabledReason={DISABLED_COPY}
      />,
    )

    const button = screen.getByRole('button', { name: 'View' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', DISABLED_COPY)

    // There must be NO href in this state — a disabled-looking anchor is
    // still clickable, and would hand the user a 404 instead of the reason.
    expect(screen.queryByRole('link', { name: 'View' })).toBeNull()
    expect(button).not.toHaveAttribute('href')
  })
})
