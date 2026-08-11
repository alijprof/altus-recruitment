import { Button } from '@/components/ui/button'

type CvFileLinkProps = {
  // Owner of the CV row — supplies the `[id]` segment of the route below, so
  // every stored file has one canonical, shareable address.
  candidateId: string
  candidateCvId: string
  // Used for the hover tooltip only — the accessible name stays the literal
  // "View" text content (per plan's frozen smoke-assertion note in 07-08).
  filename: string
  downloadable: boolean
  // The shared disabled-state copy from cv-file-display.ts, shown as the
  // control's `title` when it can't be clicked.
  disabledReason: string
}

/**
 * The View control for a single candidate_cvs row (D-01, Plan 07-01).
 *
 * A PLAIN ANCHOR to a GET route handler that mints the signed URL server-side
 * and 302-redirects to it. No JavaScript runs on click at all: the browser
 * opens the tab from the user's own gesture, which is WebKit-safe by
 * construction and cannot be defeated by a popup blocker.
 *
 * WHY IT IS NOT A BUTTON ANY MORE (production incident, 2026-08-11): this
 * control used to open a blank popup synchronously and then await
 * getCvFileUrlAction inside startTransition. On production the action returned
 * 200 with a valid signed URL and the client promise NEVER SETTLED — no
 * branch ran, no toast, no pending state, and the popup sat orphaned at
 * about:blank. There was no error to handle because nothing ever resolved,
 * which is exactly why the popup/toast/transition machinery that used to live
 * here could not save it, and why jsdom tests could not catch it. Deleting the
 * async client path deletes the failure mode: there is no promise to hang, no
 * popup handle to lose, and no silent-failure branch left to get wrong.
 *
 * When `downloadable` is false the control renders as a disabled button with
 * the shared reason as its title and NO href — a non-interactive element, so
 * there is nothing to navigate to. That is the client half of the same
 * isCvFileDownloadable gate the route enforces server-side.
 *
 * Not a Client Component: with the transition and toast gone this renders no
 * interactivity of its own, so it stays server-rendered inside the RSC
 * cv-files-panel (it is also imported by the client cv-review-panel, which
 * simply bundles it — legal in both directions).
 */
export function CvFileLink({
  candidateId,
  candidateCvId,
  filename,
  downloadable,
  disabledReason,
}: CvFileLinkProps) {
  if (!downloadable) {
    return (
      <Button variant="outline" size="sm" disabled title={disabledReason}>
        View
      </Button>
    )
  }

  return (
    // A raw <a>, deliberately not next/link: the destination 302-redirects to
    // a cross-origin Storage URL, so this must be a real document navigation,
    // never a client-side route transition. `rel` is belt-and-braces — the
    // opener is severed and the referrer withheld before we ever leave — and
    // `asChild` keeps the exact outline/sm button styling the row had before.
    <Button variant="outline" size="sm" asChild title={filename}>
      <a
        href={`/candidates/${candidateId}/cv-file/${candidateCvId}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        View
      </a>
    </Button>
  )
}
