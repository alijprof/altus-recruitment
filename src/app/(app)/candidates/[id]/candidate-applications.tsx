'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'

import { DeclineModal } from '@/components/app/decline-modal'
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import {
  PIPELINE_STAGES,
  type PipelineCardData,
  type PipelineStage,
} from '@/lib/db/pipeline-stages'

import { moveApplicationAction } from '@/app/(app)/jobs/[id]/actions'

const TERMINAL_STAGES = new Set(['rejected', 'withdrawn'])

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function stageBadgeClass(stage: string): string {
  switch (stage) {
    case 'placed':
      return 'border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300'
    case 'offer':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'rejected':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'withdrawn':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'first_interview':
    case 'second_interview':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    case 'cv_submitted':
      return 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
    case 'screening':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    default:
      return ''
  }
}

export type CandidateApplicationsProps = {
  candidateId: string
  applications: PipelineCardData[]
}

export function CandidateApplications({
  candidateId,
  applications,
}: CandidateApplicationsProps) {
  const [declineTarget, setDeclineTarget] = useState<PipelineCardData | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function performMove(application: PipelineCardData, toStage: PipelineStage) {
    setPendingId(application.id)
    startTransition(async () => {
      const res = await moveApplicationAction({
        applicationId: application.id,
        toStage,
        jobId: application.job_id ?? null,
        candidateId,
      })
      setPendingId(null)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Moved to ${stageLabel(toStage)}.`)
    })
  }

  if (applications.length === 0) {
    return (
      <section className="bg-card space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Applications</h2>
        <p className="text-muted-foreground text-xs">
          No applications yet. Add this candidate to a job from the job detail page.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="bg-card space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Applications</h2>
        <ul className="space-y-2">
          {applications.map((app) => {
            const isTerminal = TERMINAL_STAGES.has(app.stage)
            const isPending = pendingId === app.id
            const moveTargets = PIPELINE_STAGES.filter((s) => s !== app.stage)
            return (
              <li
                key={app.id}
                className={cn(
                  'border-border flex items-center justify-between gap-3 rounded-md border p-3 transition-colors',
                  'hover:bg-accent/30',
                  isPending && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {app.job_id ? (
                      <Link
                        href={`/jobs/${app.job_id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {app.job_title ?? 'Untitled job'}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium">
                        {app.job_title ?? 'Untitled job'}
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs font-normal',
                        stageBadgeClass(app.stage),
                      )}
                    >
                      {stageLabel(app.stage)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {app.days_in_stage}d in stage
                    {app.decline_reason ? ` · ${stageLabel(app.decline_reason)}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isPending ? (
                    <Loader2
                      className="text-muted-foreground size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${app.job_title ?? 'application'}`}
                        disabled={isPending || isTerminal}
                        className="h-7 w-7"
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Move to stage</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuLabel>Stages</DropdownMenuLabel>
                          {moveTargets.map((s) => (
                            <DropdownMenuItem
                              key={s}
                              onSelect={() => performMove(app, s)}
                            >
                              {stageLabel(s)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => setDeclineTarget(app)}
                        className="text-destructive focus:text-destructive"
                      >
                        Reject…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {declineTarget ? (
        <DeclineModal
          applicationId={declineTarget.id}
          candidateName={declineTarget.candidate_name}
          jobId={declineTarget.job_id ?? null}
          candidateId={candidateId}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeclineTarget(null)
          }}
        />
      ) : null}
    </>
  )
}
