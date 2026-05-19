'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import {
  triggerCandidateBackfillAction,
  triggerHnswBuildAction,
} from './actions'

// Plan 1 Task 1.3 — small client buttons that fire the server actions and
// surface a toast on completion. No optimistic state; we're firing
// Inngest events which are async by nature.

export function BackfillButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="default"
      disabled={pending || done}
      onClick={() =>
        startTransition(async () => {
          const res = await triggerCandidateBackfillAction()
          if (res.ok) {
            toast.success('Backfill queued — embeddings will appear shortly.')
            setDone(true)
          } else {
            toast.error(res.error)
          }
        })
      }
    >
      {pending ? 'Queueing…' : done ? 'Queued' : `Backfill ${count} candidates`}
    </Button>
  )
}

export function BuildIndexButton({
  table,
}: {
  table: 'candidates' | 'jobs'
}) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending || done}
      onClick={() =>
        startTransition(async () => {
          const res = await triggerHnswBuildAction({ table })
          if (res.ok) {
            toast.success(
              `Build queued for ${table}. Run the manual DDL per docs/hnsw-build-runbook.md.`,
            )
            setDone(true)
          } else {
            toast.error(res.error)
          }
        })
      }
    >
      {pending ? 'Queueing…' : done ? 'Queued' : `Build ${table} index`}
    </Button>
  )
}
