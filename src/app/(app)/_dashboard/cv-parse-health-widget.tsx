import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CvParseHealth } from '@/lib/db/dashboard'
import { cn } from '@/lib/utils'

// SF-4 org-level visibility (2026-07-31 Steele Charles feature review). A
// stuck or failed CV parse was previously invisible to anyone except a
// recruiter who happened to open that exact candidate page. This widget
// surfaces it org-wide. Renders ONLY when there's something to see — an
// empty state here would just be more dashboard noise.

export type CvParseHealthWidgetProps = {
  health: CvParseHealth
  className?: string
}

export function CvParseHealthWidget({ health, className }: CvParseHealthWidgetProps) {
  const total = health.failed + health.stalePending
  if (total === 0) return null

  return (
    <Card className={cn('border-amber-200 dark:border-amber-900', className)}>
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          CV parsing needs attention
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap gap-2 text-xs font-normal">
          {health.failed > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              {health.failed} failed
            </Badge>
          ) : null}
          {health.stalePending > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              {health.stalePending} stuck pending
            </Badge>
          ) : null}
        </div>
        {health.candidates.length > 0 ? (
          <ul className="divide-y">
            {health.candidates.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/candidates/${c.id}`}
                  className="hover:bg-muted/50 -mx-1 block rounded px-1 py-1.5 text-sm font-normal transition-colors"
                >
                  {c.fullName}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
