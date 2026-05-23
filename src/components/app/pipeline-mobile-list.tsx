'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { DeclineModal } from '@/components/app/decline-modal'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  PIPELINE_STAGES,
  type GroupedByStage,
  type PipelineCardData,
  type PipelineStage,
} from '@/lib/db/pipeline-stages'

import {
  moveApplicationAction,
  removeApplicationAction,
} from '@/app/(app)/jobs/[id]/actions'

// UI-SPEC §4 D-11: below md breakpoint, kanban becomes a stacked Accordion.
// Tapping a card opens a bottom Sheet with "Move to..." buttons + Reject.
// All interactive elements are h-11 (44px) per the mobile rule.
//
// No drag-and-drop on mobile by design.

function stageLabel(stage: PipelineStage): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export type PipelineMobileListProps = {
  initial: GroupedByStage
  jobId?: string | null
}

export function PipelineMobileList({ initial, jobId }: PipelineMobileListProps) {
  const [columns, setColumns] = useState<GroupedByStage>(initial)
  const [declineTarget, setDeclineTarget] = useState<PipelineCardData | null>(null)
  const [, startTransition] = useTransition()

  function findStageOf(cardId: string): PipelineStage | null {
    for (const s of PIPELINE_STAGES) {
      if (columns[s].some((c) => c.id === cardId)) return s
    }
    return null
  }

  function performMove(card: PipelineCardData, toStage: PipelineStage) {
    const fromStage = findStageOf(card.id)
    if (!fromStage || fromStage === toStage) return

    // Optimistic move; the mobile flow doesn't show a per-card spinner
    // because the Sheet closes immediately and the user moves on.
    setColumns((prev) => ({
      ...prev,
      [fromStage]: prev[fromStage].filter((c) => c.id !== card.id),
      [toStage]: [...prev[toStage], { ...card, stage: toStage }],
    }))

    startTransition(async () => {
      const res = await moveApplicationAction({
        applicationId: card.id,
        toStage,
        jobId: jobId ?? null,
      })
      if (!res.ok) {
        // Snap back.
        setColumns((prev) => ({
          ...prev,
          [toStage]: prev[toStage].filter((c) => c.id !== card.id),
          [fromStage]: [...prev[fromStage], { ...card, stage: fromStage }],
        }))
        toast.error(`Couldn't move ${card.candidate_name} — please try again.`)
      }
    })
  }

  function handleDeclined(applicationId: string) {
    const fromStage = findStageOf(applicationId)
    if (!fromStage) return
    setColumns((prev) => ({
      ...prev,
      [fromStage]: prev[fromStage].filter((c) => c.id !== applicationId),
    }))
  }

  function handleRemove(card: PipelineCardData) {
    if (
      !window.confirm(
        `Remove ${card.candidate_name} from this job? Their candidate record will remain — only the application is deleted.`,
      )
    ) {
      return
    }
    const fromStage = findStageOf(card.id)
    if (!fromStage) return

    setColumns((prev) => ({
      ...prev,
      [fromStage]: prev[fromStage].filter((c) => c.id !== card.id),
    }))

    startTransition(async () => {
      const res = await removeApplicationAction({
        applicationId: card.id,
        jobId: jobId ?? null,
      })
      if (!res.ok) {
        setColumns((prev) => ({
          ...prev,
          [fromStage]: [...prev[fromStage], card],
        }))
        toast.error(res.error)
        return
      }
      toast.success(`${card.candidate_name} removed from job.`)
    })
  }

  return (
    <>
      <Accordion
        type="multiple"
        defaultValue={[...PIPELINE_STAGES]}
        className="space-y-2"
      >
        {PIPELINE_STAGES.map((stage) => (
          <AccordionItem key={stage} value={stage} className="rounded-md border bg-card">
            <AccordionTrigger className="px-3 py-3 hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">{stageLabel(stage)}</span>
                <span className="text-muted-foreground bg-muted rounded-full px-2 text-xs font-normal">
                  {columns[stage].length}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 px-3 pb-3">
              {columns[stage].length === 0 ? (
                <p className="text-muted-foreground py-3 text-center text-xs font-normal">
                  No candidates.
                </p>
              ) : (
                columns[stage].map((c) => (
                  <MobileCardRow
                    key={c.id}
                    card={c}
                    onMoveTo={(toStage) => performMove(c, toStage)}
                    onReject={() => setDeclineTarget(c)}
                    onRemove={() => handleRemove(c)}
                  />
                ))
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {declineTarget ? (
        <DeclineModal
          applicationId={declineTarget.id}
          candidateName={declineTarget.candidate_name}
          jobId={jobId ?? null}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeclineTarget(null)
          }}
          onDeclined={handleDeclined}
        />
      ) : null}
    </>
  )
}

type MobileCardRowProps = {
  card: PipelineCardData
  onMoveTo: (stage: PipelineStage) => void
  onReject: () => void
  onRemove: () => void
}

function MobileCardRow({ card, onMoveTo, onReject, onRemove }: MobileCardRowProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          data-card-id={card.id}
          className="hover:border-foreground/30 focus-visible:ring-ring block min-h-11 w-full rounded-md border p-3 text-left focus:outline-none focus-visible:ring-2"
        >
          <div className="text-sm font-semibold">{card.candidate_name}</div>
          {card.current_role_title || card.current_company ? (
            <div className="text-muted-foreground truncate text-xs font-normal">
              {card.current_role_title ?? ''}
              {card.current_role_title && card.current_company ? ' · ' : ''}
              {card.current_company ?? ''}
            </div>
          ) : null}
          <div className="text-muted-foreground mt-1 text-xs font-normal">
            {card.days_in_stage}d in stage
          </div>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Move {card.candidate_name}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-1 gap-2 px-4 pb-6">
          {PIPELINE_STAGES.filter((s) => s !== card.stage).map((s) => (
            <Button
              key={s}
              variant="outline"
              className="h-11 justify-start"
              onClick={() => {
                onMoveTo(s)
                setOpen(false)
              }}
            >
              Move to {stageLabel(s)}
            </Button>
          ))}
          <Button
            variant="outline"
            className="mt-4 h-11"
            onClick={() => {
              setOpen(false)
              onRemove()
            }}
          >
            Remove from job
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            onClick={() => {
              setOpen(false)
              onReject()
            }}
          >
            Reject…
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
