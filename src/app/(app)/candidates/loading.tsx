import { ListSkeleton } from '@/components/app/list-skeleton'
import { Skeleton } from '@/components/ui/skeleton'

// Route-level loading boundary — replaces the candidate list while the
// initial server fetch is in flight. UI-SPEC §1 specifies 5 skeleton rows of
// 6 cells each, which is what ListSkeleton renders by default.
export default function CandidatesLoading() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
        <Skeleton className="h-9 w-32" />
      </header>
      <Skeleton className="h-9 w-64" />
      <ListSkeleton rows={5} cols={6} />
    </div>
  )
}
