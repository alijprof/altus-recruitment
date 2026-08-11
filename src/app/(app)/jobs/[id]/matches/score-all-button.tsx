'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { scoreAllMatchesAction } from './actions'

// ---------------------------------------------------------------------------
// Plan 07-07 Task 2 — <ScoreAllButton>.
//
// One-click bulk scoring for /jobs/[id]/matches. Fires
// scoreAllMatchesAction, which sends the SAME `job/score-top-candidates`
// event the createJob and embed-on-JD-change paths already produce.
// `precompute-matches-for-job` does the real work (up to 10 candidates,
// each its own step.run) — this button never claims completion the client
// cannot observe. That dead end (infinite spinner, or a false "done") is
// the SF-5 failure mode this codebase already paid to close once in
// cv-review-panel.tsx's PendingState; this component reuses that shape:
// a bounded setInterval poll, torn down on unmount, that gives up honestly
// after a fixed budget instead of spinning forever.
//
// The action itself only STARTS scoring — it can't know when the last
// candidate finishes. So the success toast says "started", not "done",
// and cards fill in as router.refresh() re-fetches the RSC tree on each
// poll tick and precompute upserts land.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000
const POLL_MAX_DURATION_MS = 90_000

export type ScoreAllButtonProps = {
  jobId: string
}

export function ScoreAllButton({ jobId }: ScoreAllButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isPolling, setIsPolling] = useState(false)
  const [pollTimedOut, setPollTimedOut] = useState(false)
  // Ref (not state) for the poll start time — it only needs to be read
  // inside the interval callback, never rendered, so a ref avoids an
  // extra render on every tick.
  const pollStartedAtRef = useRef<number | null>(null)

  // Bounded poll — 3s interval, 90s hard cap. Mirrors
  // cv-review-panel.tsx PendingState's 5-minute cap on the same shape:
  // clear the interval and flip to an honest "may still be running" state
  // rather than polling forever.
  useEffect(() => {
    if (!isPolling) return
    pollStartedAtRef.current = Date.now()
    const id = setInterval(() => {
      const startedAt = pollStartedAtRef.current
      if (startedAt !== null && Date.now() - startedAt > POLL_MAX_DURATION_MS) {
        clearInterval(id)
        setIsPolling(false)
        setPollTimedOut(true)
        return
      }
      router.refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [isPolling, router])

  const onClick = () => {
    setPollTimedOut(false)
    startTransition(async () => {
      const result = await scoreAllMatchesAction(jobId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      // Honest about asynchrony — scoring has STARTED, not finished. The
      // client cannot observe server-side completion, so it must never
      // claim it.
      toast.success('Scoring started — cards will fill in as each candidate finishes.')
      setIsPolling(true)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={onClick}
        // WR-03 (review 2026-08-11) — `isPending` clears the instant
        // inngest.send resolves, but `isPolling` keeps a spinner on screen
        // for up to 90 more seconds, which reads as "busy". The button was
        // still live underneath it, so an impatient second click started a
        // second concurrent precompute run and re-paid Sonnet for every
        // candidate the first run had not yet finished writing. The action
        // now also carries an hour-bucketed dedup id as the server-side
        // half of this guard.
        disabled={isPending || isPolling}
        className="gap-2"
      >
        {isPending || isPolling ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-4" aria-hidden="true" />
        )}
        Score all
      </Button>
      {pollTimedOut ? (
        <p className="text-muted-foreground text-xs font-normal">
          Scoring may still be running — reload to see the rest.
        </p>
      ) : null}
    </div>
  )
}
