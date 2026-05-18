import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { StaleApplicationEntry } from '@/lib/db/dashboard'
import { cn } from '@/lib/utils'
import type { Enums } from '@/types/database'

// UI-SPEC §6 Dashboard "Stale applications" widget. Lists applications whose
// stage_changed_at is older than 14 days; each row links to the relevant
// pipeline page so the recruiter can move or decline immediately.

export type StaleApplicationsWidgetProps = {
  items: StaleApplicationEntry[]
  className?: string
}

const STAGE_LABELS: Record<Enums<'application_stage'>, string> = {
  applied: 'Applied',
  screening: 'Screening',
  cv_submitted: 'CV submitted',
  first_interview: '1st interview',
  second_interview: '2nd interview',
  offer: 'Offer',
  placed: 'Placed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export function StaleApplicationsWidget({ items, className }: StaleApplicationsWidgetProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold">Stale applications</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="text-muted-foreground px-6 py-8 text-center text-sm font-normal">
            <p className="text-foreground text-sm font-semibold">No stale applications</p>
            <p className="mt-1">All your applications have been updated recently.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/jobs/${item.job_id}/pipeline`}
                  className="hover:bg-muted/50 flex flex-col gap-0.5 px-6 py-3 transition-colors"
                >
                  <span className="text-sm font-semibold">{item.candidate_name}</span>
                  <span className="text-muted-foreground text-xs font-normal">
                    Stalled in {STAGE_LABELS[item.stage] ?? item.stage} for {item.days_in_stage}{' '}
                    days
                  </span>
                  <span className="text-muted-foreground text-xs font-normal">
                    {item.job_title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
