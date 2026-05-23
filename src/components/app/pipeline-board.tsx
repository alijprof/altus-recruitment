'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { DeclineModal } from '@/components/app/decline-modal'
import { PlacementModal } from '@/components/app/placement-modal'
import { PipelineCard } from '@/components/app/pipeline-card'
import { cn } from '@/lib/utils'
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

// UI-SPEC §4: stage column titles.
function stageLabel(stage: PipelineStage): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export type PipelineBoardProps = {
  initial: GroupedByStage
  /** When the user is on /jobs/[id]/pipeline, jobId is set so revalidations
   *  invalidate the per-job page. Omitted for the global /pipeline view. */
  jobId?: string | null
}

export function PipelineBoard({ initial, jobId }: PipelineBoardProps) {
  const [columns, setColumns] = useState<GroupedByStage>(initial)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [declineTarget, setDeclineTarget] = useState<PipelineCardData | null>(null)
  // UAT-260523-PLACEMENT-CAPTURE: intercept placed-stage moves before action call.
  const [placementTarget, setPlacementTarget] = useState<PipelineCardData | null>(null)
  const [, startTransition] = useTransition()

  // PointerSensor activationConstraint.distance: 4 px — prevents click-to-
  // drag confusion on the "..." button and inner controls. KeyboardSensor
  // is added for accessibility (RESEARCH §21 pitfalls).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function findStageOf(cardId: string): PipelineStage | null {
    for (const s of PIPELINE_STAGES) {
      if (columns[s].some((c) => c.id === cardId)) return s
    }
    return null
  }

  function moveCardLocal(
    cardId: string,
    fromStage: PipelineStage,
    toStage: PipelineStage,
    targetIndex?: number,
  ): GroupedByStage {
    return ((prev: GroupedByStage) => {
      const card = prev[fromStage].find((c) => c.id === cardId)
      if (!card) return prev
      const remaining = prev[fromStage].filter((c) => c.id !== cardId)
      const targetList = [...prev[toStage]]
      const inserted: PipelineCardData = { ...card, stage: toStage }
      if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= targetList.length) {
        targetList.splice(targetIndex, 0, inserted)
      } else {
        targetList.push(inserted)
      }
      return {
        ...prev,
        [fromStage]: remaining,
        [toStage]: targetList,
      }
    })(columns)
  }

  function removeCardLocal(cardId: string, fromStage: PipelineStage): GroupedByStage {
    return {
      ...columns,
      [fromStage]: columns[fromStage].filter((c) => c.id !== cardId),
    }
  }

  function performMove(
    card: PipelineCardData,
    fromStage: PipelineStage,
    toStage: PipelineStage,
  ) {
    if (fromStage === toStage) return

    // Optimistic local move + mark pending. The card stays in the target
    // column with opacity-60 + "Saving…" indicator until the server
    // confirms (D-09).
    setColumns(moveCardLocal(card.id, fromStage, toStage))
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.add(card.id)
      return next
    })

    startTransition(async () => {
      const res = await moveApplicationAction({
        applicationId: card.id,
        toStage,
        jobId: jobId ?? null,
      })

      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(card.id)
        return next
      })

      if (!res.ok) {
        // Snap back to source column + toast per UI-SPEC.
        setColumns((prev) => {
          const inTarget = prev[toStage].find((c) => c.id === card.id)
          if (!inTarget) return prev
          return {
            ...prev,
            [toStage]: prev[toStage].filter((c) => c.id !== card.id),
            [fromStage]: [...prev[fromStage], { ...inTarget, stage: fromStage }],
          }
        })
        toast.error(`Couldn't move ${card.candidate_name} — please try again.`)
      }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    if (!overId) return

    const fromStage = findStageOf(activeId)
    if (!fromStage) return

    // overId is either a column (stage name) or a card id within a column.
    const toStage = (PIPELINE_STAGES as readonly string[]).includes(overId)
      ? (overId as PipelineStage)
      : findStageOf(overId)
    if (!toStage) return

    const card = columns[fromStage].find((c) => c.id === activeId)
    if (!card) return

    // UAT-260523-PLACEMENT-CAPTURE: intercept drag-to-Placed. Do NOT optimistically
    // move the card; wait for PlacementModal.onPlaced to confirm the DB write
    // succeeded. If the modal is cancelled, the card stays in its original column.
    if (toStage === 'placed') {
      setPlacementTarget(card)
      return
    }

    performMove(card, fromStage, toStage)
  }

  function handleDropdownMove(card: PipelineCardData, toStage: PipelineStage) {
    const fromStage = findStageOf(card.id)
    if (!fromStage) return

    // UAT-260523-PLACEMENT-CAPTURE: intercept dropdown "Move to → Placed".
    // Open PlacementModal instead of calling performMove. No optimistic move
    // until onPlaced fires.
    if (toStage === 'placed') {
      setPlacementTarget(card)
      return
    }

    performMove(card, fromStage, toStage)
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

    // Optimistic: drop the card immediately. Restore on failure.
    setColumns(removeCardLocal(card.id, fromStage))

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
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {/* Full-bleed breakout so all 7 stages fit without horizontal scroll
            on desktop. mx-[calc(50%-50vw)] yanks the board to viewport edges
            from inside the layout's max-w-6xl wrapper; px-4 sm:px-6 restores
            comfortable gutters. */}
        <div className="relative mx-[calc(50%-50vw)] w-screen px-4 sm:px-6">
          <div className="grid grid-cols-7 gap-2 pb-4 lg:gap-3">
            {PIPELINE_STAGES.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                cards={columns[stage]}
                pendingIds={pendingIds}
                onMoveTo={handleDropdownMove}
                onReject={(card) => setDeclineTarget(card)}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </div>
      </DndContext>

      {declineTarget ? (
        <DeclineModal
          applicationId={declineTarget.id}
          candidateName={declineTarget.candidate_name}
          jobId={jobId ?? null}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeclineTarget(null)
          }}
          onDeclined={(applicationId) => {
            // Remove the card from whatever column it sits in.
            const fromStage = findStageOf(applicationId)
            if (fromStage) setColumns(removeCardLocal(applicationId, fromStage))
          }}
        />
      ) : null}

      {/* UAT-260523-PLACEMENT-CAPTURE: PlacementModal for drag-to-placed and
          dropdown "Move to → Placed". Only moves the card locally AFTER the
          DB write is confirmed (onPlaced). Cancel leaves the card in place. */}
      {placementTarget ? (
        <PlacementModal
          applicationId={placementTarget.id}
          candidateName={placementTarget.candidate_name}
          jobId={jobId ?? null}
          open={true}
          onOpenChange={(open) => {
            if (!open) setPlacementTarget(null)
          }}
          onPlaced={(applicationId) => {
            // Move card to the placed column now that the DB write succeeded.
            const fromStage = findStageOf(applicationId)
            if (fromStage) {
              setColumns(moveCardLocal(applicationId, fromStage, 'placed'))
            }
            setPlacementTarget(null)
          }}
          onError={() => {
            // No optimistic move to revert — card stayed in its original column.
            setPlacementTarget(null)
          }}
        />
      ) : null}
    </>
  )
}

type ColumnProps = {
  stage: PipelineStage
  cards: PipelineCardData[]
  pendingIds: Set<string>
  onMoveTo: (card: PipelineCardData, toStage: PipelineStage) => void
  onReject: (card: PipelineCardData) => void
  onRemove: (card: PipelineCardData) => void
}

function Column({
  stage,
  cards,
  pendingIds,
  onMoveTo,
  onReject,
  onRemove,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  return (
    <div
      ref={setNodeRef}
      data-column={stage}
      className={cn(
        'bg-card flex min-w-0 flex-col rounded-md border p-3',
        isOver && 'ring-ring/40 ring-2',
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{stageLabel(stage)}</h3>
        <span className="text-muted-foreground bg-muted rounded-full px-2 text-xs font-normal">
          {cards.length}
        </span>
      </div>

      <SortableContext
        id={stage}
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="mt-3 flex-1 space-y-2">
          {cards.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs font-normal">
              No candidates.
            </p>
          ) : (
            cards.map((c) => (
              <PipelineCard
                key={c.id}
                card={c}
                isPending={pendingIds.has(c.id)}
                onMoveTo={(toStage) => onMoveTo(c, toStage)}
                onReject={() => onReject(c)}
                onRemove={() => onRemove(c)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}
