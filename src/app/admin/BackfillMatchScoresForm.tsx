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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
        Queues a one-off sweep that scores applications predating auto-scoring, across all
        organisations. Costs roughly a penny per unscored application, up to 500 per run. Safe to
        run more than once — already-scored applications are skipped and nothing is spent twice, and
        each run picks up where the last one left off, so re-run it until nothing new appears.
        Scores appear on job and application screens as the sweep finishes.
      </p>

      {/* IN-06 (review 2026-08-11): one click queues Sonnet spend across
          EVERY organisation. It is bounded (500 enqueues per run, ~£5, with
          per-org ceilings enforced downstream) and super-admin gated, but
          every other spend/destructive control in this admin area asks for
          a confirmation first — matching that is cheap, and an accidental
          click here bills real customers. */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            aria-label="Backfill match scores"
            disabled={isPending}
            size="sm"
            className="mt-4"
          >
            {isPending ? 'Queuing…' : 'Backfill match scores (all orgs)'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Queue the match-score backfill?</AlertDialogTitle>
            <AlertDialogDescription>
              This scores unscored applications across <span className="font-medium">every</span>{' '}
              organisation, up to 500 per run at roughly a penny each. Already-scored applications
              are skipped and nothing is spent twice, and each org&apos;s own AI budget still
              applies. Run it again later to continue through any remaining backlog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit}>Queue backfill</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
