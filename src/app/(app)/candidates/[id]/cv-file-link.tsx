'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { getCvFileUrlAction } from './actions'

type CvFileLinkProps = {
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
 * The View control for a single candidate_cvs row (D-01, Plan 07-01). Calls
 * getCvFileUrlAction to mint a short-lived signed URL and opens it in a new
 * tab — never a silent failure (CLAUDE.md's mandatory error-handling rule):
 * a failed sign shows a toast, a blocked popup shows a toast carrying the
 * link itself (CR-02), and the row's own state is untouched either way
 * (this control mutates nothing, so there's no form/data to roll back).
 *
 * When `downloadable` is false, the control renders disabled with the
 * shared reason as its title, and the click handler is never wired at all —
 * this is the client half of the same isCvFileDownloadable gate
 * getCvFileUrlAction enforces server-side.
 */
export function CvFileLink({
  candidateCvId,
  filename,
  downloadable,
  disabledReason,
}: CvFileLinkProps) {
  const [isPending, startTransition] = useTransition()

  if (!downloadable) {
    return (
      <Button variant="outline" size="sm" disabled title={disabledReason}>
        View
      </Button>
    )
  }

  const onClick = () => {
    // CR-02 (review 2026-08-11) — OPEN THE TAB SYNCHRONOUSLY, inside the
    // click. Safari/WebKit and any strict popup blocker only honour a
    // window.open that runs in the same tick as the user gesture; after the
    // `await` below the transient activation is gone, window.open returns
    // null, and the previous code discarded that null — so the button
    // flickered "Opening…" and did nothing at all, on the phase's headline
    // feature.
    //
    // `noopener` is deliberately NOT passed here: per spec, window.open with
    // `noopener` returns null, which would leave us no handle to navigate.
    // Nulling `win.opener` below while the tab is still about:blank (and so
    // still same-origin) is the equivalent reverse-tabnabbing mitigation.
    const win = window.open('', '_blank')
    if (win) {
      win.opener = null
    }

    startTransition(async () => {
      // WR-R1 (re-review): the awaited action can REJECT (network drop,
      // server crash), not just resolve {ok:false} — without this catch the
      // recruiter is left staring at an orphan blank tab with no feedback,
      // the exact silent-failure class this control exists to kill.
      let result: Awaited<ReturnType<typeof getCvFileUrlAction>>
      try {
        result = await getCvFileUrlAction({ candidateCvId })
      } catch {
        win?.close()
        toast.error("Couldn't open the CV — please try again.")
        return
      }
      if (!result.ok) {
        win?.close()
        toast.error(result.error)
        return
      }

      if (win && !win.closed) {
        win.location.href = result.url
        return
      }

      // Popup blocked (or the tab was closed while the URL was being
      // minted). NEVER fail silently: hand the recruiter the URL as a
      // control they can activate themselves — a window.open inside a
      // direct click always navigates, blocker or not.
      //
      // AUDIT ORDERING (deliberate, see getCvFileUrlAction): the action
      // files the `export` audit row at the moment it releases the signed
      // URL, and every branch here delivers that URL to the user — either
      // by navigating the tab we already opened, or via this toast. There
      // is no path left where a row is filed for a URL the user never
      // received. The toast outlives the default 4s so the link is still
      // clickable well inside the 60s TTL.
      toast.error('Your browser blocked the new tab.', {
        description: 'Allow pop-ups for this site, or open the CV directly.',
        duration: 30_000,
        action: {
          label: 'Open CV',
          onClick: () => window.open(result.url, '_blank', 'noopener,noreferrer'),
        },
      })
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={isPending} title={filename}>
      {isPending ? 'Opening…' : 'View'}
    </Button>
  )
}
