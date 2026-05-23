import { ArrowRight, Mail, MessageSquare, Phone, Sparkles, Users } from 'lucide-react'
import type { ComponentType } from 'react'

import { formatTimeAgo } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Enums, Json } from '@/types/database'

// Polymorphic across every domain entity that can have activities attached to
// it. Plan 1 only renders the candidate variant; Plan 3 will consume this
// shape for clients/contacts and Plan 4 for jobs/applications. Exporting the
// full prop type now means Plan 3 doesn't need to rewrite anything — they
// just pass entries through the same component.
//
// Two ways to drive this component:
//   1. Pass `entries={...}` already fetched by the route (preferred for
//      candidate detail — the route already needed an RSC fetch anyway).
//   2. (Future) accept `{ entityType, entityId }` and fetch internally. Plan 3
//      may add this overload; the type already documents it so the API is
//      stable.

export type TimelineEntityType = 'candidate' | 'company' | 'contact' | 'job' | 'application'

export type ActivityActor = {
  full_name: string | null
  email: string | null
} | null

export type ActivityEntry = {
  id: string
  kind: Enums<'activity_kind'>
  body: string | null
  occurred_at: string
  actor_user_id: string | null
  actor?: ActivityActor
  metadata?: Json | null
}

// Either provide pre-fetched entries OR (future) the entityType/entityId pair
// for the component to fetch its own. Discriminated union so the call site
// can't accidentally pass both.
export type ActivityTimelineProps =
  | {
      entries: ActivityEntry[]
      emptyHeading?: string
      emptyBody?: string
      className?: string
    }
  | {
      entityType: TimelineEntityType
      entityId: string
      emptyHeading?: string
      emptyBody?: string
      className?: string
    }

type KindMeta = {
  icon: ComponentType<{ className?: string }>
  label: string
  iconClass?: string
}

// UI-SPEC §2 + Copywriting Contract "Activity Type Labels". stage_change
// labels are completed by the caller (Plan 4) since they need the target
// stage name from metadata; here we render a default and let the caller
// override via the metadata.label field when provided.
const KIND_META: Record<Enums<'activity_kind'>, KindMeta> = {
  note: { icon: MessageSquare, label: 'Added a note' },
  call: { icon: Phone, label: 'Logged a call' },
  email: { icon: Mail, label: 'Logged an email' },
  email_draft: {
    icon: Mail,
    label: 'Drafted an email',
    iconClass: 'text-muted-foreground',
  },
  meeting: { icon: Users, label: 'Logged a meeting' },
  stage_change: { icon: ArrowRight, label: 'Moved stages' },
  system: { icon: Sparkles, label: 'System update', iconClass: 'text-muted-foreground' },
}

function actorInitials(actor: ActivityActor): string {
  if (!actor) return '·'
  const name = actor.full_name?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    return (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  }
  const email = actor.email?.trim()
  if (email) return email[0]?.toUpperCase() ?? '·'
  return '·'
}

function actorName(actor: ActivityActor): string {
  if (!actor) return 'System'
  return actor.full_name?.trim() || actor.email || 'Someone'
}

// Extracts an optional custom label from metadata.label (e.g., Plan 4 will
// store "Moved to First interview" there for stage_change entries).
function entryLabel(entry: ActivityEntry): string {
  const meta = entry.metadata as Record<string, unknown> | null | undefined
  const custom = meta && typeof meta.label === 'string' ? (meta.label as string) : null
  return custom ?? KIND_META[entry.kind]?.label ?? 'Activity'
}

export function ActivityTimeline(props: ActivityTimelineProps) {
  // Only the pre-fetched entries variant is implemented in Plan 1. The
  // entityType variant is documented in the prop type so Plan 3 can extend
  // without breaking callers — until then, callers MUST pass `entries`.
  if (!('entries' in props)) {
    // reason: defensive runtime guard. Hitting this means a future plan
    // forgot to implement the fetch branch. Throwing here surfaces the bug
    // in dev rather than silently rendering nothing.
    throw new Error(
      'ActivityTimeline: entityType/entityId variant not implemented yet. Pass `entries` instead.',
    )
  }

  const { entries, emptyHeading, emptyBody, className } = props

  if (entries.length === 0) {
    return (
      <div className={cn('rounded-md border bg-card px-6 py-10 text-center', className)}>
        <h3 className="text-sm font-semibold">{emptyHeading ?? 'No activity logged'}</h3>
        <p className="text-muted-foreground mt-1 text-sm font-normal">
          {emptyBody ?? 'Log a call, meeting, or note to start tracking this relationship.'}
        </p>
      </div>
    )
  }

  return (
    <ol className={cn('space-y-4', className)}>
      {entries.map((entry, idx) => {
        const meta = KIND_META[entry.kind]
        const Icon = meta.icon
        const isLast = idx === entries.length - 1
        return (
          <li key={entry.id} className="relative flex gap-3">
            {!isLast ? (
              <span
                aria-hidden="true"
                className="bg-border absolute top-9 bottom-0 left-[15px] w-px"
              />
            ) : null}
            <span
              className={cn(
                'bg-muted text-foreground relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full',
                meta.iconClass,
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pb-2">
              <p className="text-sm font-normal">
                <span className="font-semibold">{actorName(entry.actor ?? null)}</span>{' '}
                <span className="text-muted-foreground">
                  · {entryLabel(entry)} · {formatTimeAgo(entry.occurred_at)}
                </span>
              </p>
              {entry.body ? (
                <p className="text-foreground mt-1 text-sm font-normal whitespace-pre-wrap">
                  {entry.body}
                </p>
              ) : null}
              <span
                className="text-muted-foreground sr-only"
                aria-label={`Author initials ${actorInitials(entry.actor ?? null)}`}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
