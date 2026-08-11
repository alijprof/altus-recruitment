'use client'

// ---------------------------------------------------------------------------
// BackfillMatchScoresForm — Phase 7 Plan 07-06 (D-04 backfill half).
//
// Queues the one-off match-score backfill sweep for applications that
// predate auto-scoring (shipped 4 August). Costs roughly a penny per
// unscored application, is idempotent (a second run enqueues nothing new
// and spends nothing — see backfill-application-match-scores.ts), and only
// a super-admin can trigger it. Same security model as the other admin
// forms: holds no service-role client; the gate is enforced in the admin
// layout AND re-checked inside backfillMatchScoresAction.
// ---------------------------------------------------------------------------

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { backfillMatchScoresAction } from '@/app/admin/actions'

export function BackfillMatchScoresForm() {
  const [isPending, start] = useTransition()

  function handleSubmit() {
    start(async () => {
      try {
        const result = await backfillMatchScoresAction()
        if (result.ok) {
          toast.success(result.message)
        } else {
          toast.error(result.error)
        }
      } catch (err) {
        console.error('backfillMatchScoresAction failed:', err)
        toast.error(err instanceof Error ? err.message : 'Failed to queue the backfill')
      }
    })
  }

  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Backfill match scores</h2>
      <p className="mt-1 text-xs text-slate-500">
        Queues a one-off sweep that scores every application that predates auto-scoring, across all
        organisations. Costs roughly a penny per unscored application. Safe to run more than once —
        already-scored applications are skipped and nothing is spent twice. Scores appear on job and
        application screens as the sweep finishes.
      </p>

      <Button
        type="button"
        aria-label="Backfill match scores"
        onClick={handleSubmit}
        disabled={isPending}
        size="sm"
        className="mt-4"
      >
        {isPending ? 'Queuing…' : 'Backfill match scores (all orgs)'}
      </Button>
    </div>
  )
}
