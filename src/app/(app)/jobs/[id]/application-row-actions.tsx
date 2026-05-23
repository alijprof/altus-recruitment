'use client'

import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { DeclineModal } from '@/components/app/decline-modal'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/db/pipeline-stages'

import { moveApplicationAction, removeApplicationAction } from './actions'

// Per-row "..." dropdown on the Applications table on /jobs/[id]. Mirrors
// the PipelineCard dropdown so the recruiter has the same affordances
// whether they're in the kanban or the table. Owns its own DeclineModal
// state — the parent table stays a Server Component.
//
// Removal + decline both rely on revalidatePath inside the actions, so
// after success we just router.refresh() to re-fetch the table.

function stageLabel(stage: PipelineStage): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

type Props = {
  applicationId: string
  candidateName: string
  currentStage: string
  jobId: string
}

export function ApplicationRowActions({
  applicationId,
  candidateName,
  currentStage,
  jobId,
}: Props) {
  const router = useRouter()
  const [declineOpen, setDeclineOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleMove = (toStage: PipelineStage) => {
    startTransition(async () => {
      const res = await moveApplicationAction({
        applicationId,
        toStage,
        jobId,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Moved ${candidateName} to ${stageLabel(toStage)}.`)
      router.refresh()
    })
  }

  const handleRemove = () => {
    if (
      !window.confirm(
        `Remove ${candidateName} from this job? Their candidate record will remain — only the application is deleted.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await removeApplicationAction({ applicationId, jobId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`${candidateName} removed from job.`)
      router.refresh()
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${candidateName}`}
            disabled={isPending}
            className="h-8 w-8"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to stage</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>Stages</DropdownMenuLabel>
              {PIPELINE_STAGES.filter((s) => s !== currentStage).map((s) => (
                <DropdownMenuItem key={s} onSelect={() => handleMove(s)}>
                  {stageLabel(s)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleRemove}>
            Remove from job
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDeclineOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            Reject…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeclineModal
        applicationId={applicationId}
        candidateName={candidateName}
        jobId={jobId}
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        onDeclined={() => {
          router.refresh()
        }}
      />
    </>
  )
}
