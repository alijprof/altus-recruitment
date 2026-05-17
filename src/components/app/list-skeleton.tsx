import { Skeleton } from '@/components/ui/skeleton'

export type ListSkeletonProps = {
  rows?: number
  cols?: number
}

// UI-SPEC §1 "Loading: skeleton rows (5 rows of 6 cells each)". Used by route-
// level loading.tsx files and inside <Suspense> boundaries where a streamed
// table would otherwise blank-out the layout. Width jitter (alternating
// w-3/4, w-1/2, etc.) gives the skeleton a more realistic "reading rhythm"
// without becoming distracting.
const WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-3/4', 'w-1/3']

export function ListSkeleton({ rows = 5, cols = 6 }: ListSkeletonProps) {
  return (
    <div className="rounded-md border" data-testid="list-skeleton">
      <div className="bg-card flex border-b px-4 py-3">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="flex-1 px-2">
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex border-b px-4 py-4 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1 px-2">
              <Skeleton className={`h-4 ${WIDTHS[(r + c) % WIDTHS.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
