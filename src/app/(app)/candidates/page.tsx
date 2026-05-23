import Link from 'next/link'

import { EmptyState } from '@/components/app/empty-state'
import { isListView, ViewToggle } from '@/components/app/view-toggle'
import { Button } from '@/components/ui/button'
import { listCandidates, type SortDir, type SortKey } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'

import { CandidatesShell } from './candidates-shell'
import { SearchInput } from './search-input'

// D-15: default sort is last_contacted_at DESC NULLS LAST (most recently
// engaged first). D-14 puts all list interaction state in URL searchParams so
// the result is shareable and the bundle stays small. Page size 25 is fixed
// for Phase 1 (UI-SPEC §1).
const PAGE_SIZE = 25
const DEFAULT_SORT: SortKey = 'last_contacted_at'
const DEFAULT_DIR: SortDir = 'desc'
const VALID_SORTS: ReadonlyArray<SortKey> = ['last_contacted_at', 'full_name', 'market_status', 'created_at']

type CandidatesSearchParams = {
  q?: string
  sort?: string
  dir?: string
  page?: string
  view?: string
}

function parseSort(raw: string | undefined): SortKey {
  if (raw && (VALID_SORTS as ReadonlyArray<string>).includes(raw)) {
    return raw as SortKey
  }
  return DEFAULT_SORT
}

function parseDir(raw: string | undefined): SortDir {
  return raw === 'asc' ? 'asc' : DEFAULT_DIR
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

export default async function CandidatesPage({
  searchParams,
}: {
  // Next.js 16: searchParams is a Promise (PATTERNS.md RSC shape).
  searchParams: Promise<CandidatesSearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const sort = parseSort(params.sort)
  const dir = parseDir(params.dir)
  const page = parsePage(params.page)
  const q = params.q?.trim() || undefined
  const view = isListView(params.view)
  const offset = (page - 1) * PAGE_SIZE

  const result = await listCandidates(supabase, { q, sort, dir, offset, limit: PAGE_SIZE })

  if (!result.ok) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
        </header>
        <div className="text-destructive rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          Couldn&apos;t load candidates. Please refresh.
        </div>
      </div>
    )
  }

  const { rows, total } = result.data
  const isEmptyDatabase = total === 0 && !q

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
        {!isEmptyDatabase ? (
          <Button asChild>
            <Link href="/candidates/new">Add candidate</Link>
          </Button>
        ) : null}
      </header>

      {isEmptyDatabase ? (
        <EmptyState
          heading="No candidates yet"
          body="Add your first candidate to get started."
          cta={{ href: '/candidates/new', label: 'Add your first candidate' }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchInput initialQuery={q ?? ''} />
            {/* ViewToggle hidden on mobile — the shell forces cards regardless of ?view= */}
            <div className="hidden md:inline-flex">
              <ViewToggle
                basePath="/candidates"
                current={view}
                params={{
                  q: q,
                  sort: sort !== DEFAULT_SORT ? sort : undefined,
                  dir: dir !== DEFAULT_DIR ? dir : undefined,
                  page: page > 1 ? String(page) : undefined,
                }}
              />
            </div>
          </div>
          <CandidatesShell
            desktopView={view}
            rows={rows}
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            sort={sort}
            dir={dir}
            query={q}
          />
        </>
      )}
    </div>
  )
}
