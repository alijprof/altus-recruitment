import Link from 'next/link'
import { ArrowRight, Mail, MessageSquare, Phone, Sparkles, Users } from 'lucide-react'
import type { ComponentType } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatTimeAgo } from '@/lib/date'
import type { RecentActivityEntry } from '@/lib/db/dashboard'
import { formatDeclineReason, type DeclineReason } from '@/lib/legal/decline-reasons'
import { cn } from '@/lib/utils'
import type { Enums, Json } from '@/types/database'

// UI-SPEC §6 Dashboard "Recent activity" widget. Mirrors the icon mapping in
// <ActivityTimeline> (Plan 1) but a sibling component: this one is
// dashboard-flavoured (no left-rail timeline rule, dense rows, terminal link
// to /pipeline) and reads `RecentActivityEntry` which carries pre-resolved
// entity_label/entity_href/actor instead of the per-entity fetch the timeline
// expects.

export type RecentActivityFeedProps = {
  entries: RecentActivityEntry[]
  className?: string
}

type KindMeta = {
  icon: ComponentType<{ className?: string }>
  label: string
  iconClass?: string
}

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

function entryHeadline(entry: RecentActivityEntry): string {
  const meta = entry.metadata as Record<string, unknown> | Json | null
  if (
    entry.kind === 'stage_change' &&
    meta &&
    typeof meta === 'object' &&
    !Array.isArray(meta) &&
    'label' in meta &&
    typeof (meta as Record<string, unknown>).label === 'string'
  ) {
    return (meta as { label: string }).label
  }
  // For decline activity bodies written by Plan 4's move_application function:
  // body looks like "Declined — <enum>". The decline_reason is also dropped
  // into metadata for richer rendering — surface the human label when present.
  if (
    entry.kind === 'stage_change' &&
    meta &&
    typeof meta === 'object' &&
    !Array.isArray(meta) &&
    'decline_reason' in meta
  ) {
    const reason = (meta as Record<string, unknown>).decline_reason as DeclineReason | string
    return `Declined — ${formatDeclineReason(reason)}`
  }
  return KIND_META[entry.kind]?.label ?? 'Activity'
}

function actorName(actor: RecentActivityEntry['actor']): string {
  if (!actor) return 'System'
  return actor.full_name?.trim() || actor.email || 'Someone'
}

export function RecentActivityFeed({ entries, className }: RecentActivityFeedProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <div className="text-muted-foreground px-6 py-10 text-center text-sm font-normal">
            <p className="text-foreground text-sm font-semibold">No activity yet</p>
            <p className="mt-1">Log a note or move someone through the pipeline to get started.</p>
          </div>
        ) : (
          <ol className="divide-y">
            {entries.map((entry) => {
              // Fallback to a neutral 'system' icon if a new activity_kind
              // enum value lands before this map is updated — avoids
              // crashing the whole dashboard on a single unknown row.
              const meta = KIND_META[entry.kind] ?? KIND_META.system
              const Icon = meta.icon
              const headline = entryHeadline(entry)
              const inner = (
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={cn(
                      'bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-full',
                      meta.iconClass,
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-normal">
                      <span className="font-semibold">{actorName(entry.actor)}</span>{' '}
                      <span className="text-muted-foreground">· {headline}</span>
                      {entry.entity_label ? (
                        <>
                          <span className="text-muted-foreground"> · </span>
                          <span className="font-medium">{entry.entity_label}</span>
                        </>
                      ) : null}
                    </p>
                    {entry.body ? (
                      <p className="text-foreground mt-0.5 line-clamp-2 text-sm font-normal whitespace-pre-wrap">
                        {entry.body}
                      </p>
                    ) : null}
                    <p className="text-muted-foreground mt-0.5 text-xs font-normal">
                      {formatTimeAgo(entry.occurred_at)}
                    </p>
                  </div>
                </div>
              )
              return (
                <li key={entry.id}>
                  {entry.entity_href ? (
                    <Link
                      href={entry.entity_href}
                      className="hover:bg-muted/50 flex items-start gap-3 px-6 py-3 transition-colors"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-6 py-3">{inner}</div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
