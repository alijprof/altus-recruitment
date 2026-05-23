'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Loader2, MoreHorizontal } from 'lucide-react'

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
import { PIPELINE_STAGES, type PipelineStage } from '@/lib/db/pipeline-stages'

// UI-SPEC §4 card spec:
//   * candidate name (text-sm font-semibold)
//   * current role (text-xs text-muted-foreground font-normal)
//   * days-in-stage chip (text-xs font-normal)
//   * stale indicator (amber dot) when days_in_stage > 14
//   * Actions dropdown — MUST have aria-label="Actions for {name}"
//   * Pending state: opacity-60 + Loader2 16px + "Saving…" microtext
//
// dnd-kit gotchas (RESEARCH §21 pitfalls):
//   * Combine sortable `attributes` + `listeners` on the OUTER element so
//     the whole card is draggable, but the DropdownMenuTrigger button
//     stops propagation on pointerdown/click so clicking the "..." doesn't
//     initiate a drag.
//   * activationConstraint distance:4 is set on the PointerSensor in the
//     PipelineBoard.

function stageLabel(stage: PipelineStage): string {
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Card prop accepts the wider PipelineCardData shape from the db helper —
// the kanban filters out terminal stages before rendering, so by the time
// the card mounts the stage is always one of the seven PIPELINE_STAGES.
// We still narrow the dropdown options below to non-current stages.
export type PipelineCardProps = {
  card: import('@/lib/db/pipeline-stages').PipelineCardData
  isPending: boolean
  onMoveTo: (toStage: PipelineStage) => void
  onReject: () => void
  onRemove: () => void
}

export function PipelineCard({
  card,
  isPending,
  onMoveTo,
  onReject,
  onRemove,
}: PipelineCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const isStale = card.days_in_stage > 14

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-card-id={card.id}
      data-stage={card.stage}
      className={cn(
        'group bg-background rounded-md border p-3 shadow-xs hover:border-foreground/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'cursor-grab active:cursor-grabbing',
        isPending && 'opacity-60',
        isDragging && 'opacity-30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{card.candidate_name}</p>
          {card.current_role_title || card.current_company ? (
            <p className="text-muted-foreground truncate text-xs font-normal">
              {card.current_role_title ?? ''}
              {card.current_role_title && card.current_company ? ' · ' : ''}
              {card.current_company ?? ''}
            </p>
          ) : null}
        </div>
        {/*
          Stop pointerdown / click propagation so clicking the "..." button
          doesn't initiate a drag (RESEARCH §21 pitfall). We attach the
          handlers on the wrapper because DropdownMenuTrigger has asChild.
        */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${card.candidate_name}`}
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
                  {PIPELINE_STAGES.filter((s) => s !== card.stage).map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => onMoveTo(s)}>
                      {stageLabel(s)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove}>
                Remove from job
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onReject}
                className="text-destructive focus:text-destructive"
              >
                Reject…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs font-normal">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
            isStale
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {isStale ? (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-amber-500"
            />
          ) : null}
          {card.days_in_stage}d in stage
        </span>
        {isPending ? (
          <span className="text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Saving…
          </span>
        ) : null}
      </div>
    </div>
  )
}
