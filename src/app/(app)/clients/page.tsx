import Link from 'next/link'
import { Plus } from 'lucide-react'

import { isListView, ViewToggle } from '@/components/app/view-toggle'
import { Button } from '@/components/ui/button'
import { listClients, type ClientListSort, type ListDir } from '@/lib/db/clients'
import { createClient } from '@/lib/supabase/server'

import { ClientCards } from './client-cards'
import { ClientTable } from './client-table'
import { SearchInput } from './search-input'

const VALID_SORTS: ClientListSort[] = ['name', 'last_contacted_at', 'similarity']
const VALID_DIRS: ListDir[] = ['asc', 'desc']

function parseSort(raw: string | undefined): ClientListSort {
  if (raw && (VALID_SORTS as string[]).includes(raw)) return raw as ClientListSort
  return 'last_contacted_at'
}

function parseDir(raw: string | undefined): ListDir {
  if (raw && (VALID_DIRS as string[]).includes(raw)) return raw as ListDir
  return 'desc'
}

function parsePage(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string; view?: string }>
}) {
  const sp = await searchParams
  const q = sp.q?.trim() ?? ''
  const sort = parseSort(sp.sort)
  const dir = parseDir(sp.dir)
  const page = parsePage(sp.page)
  const view = isListView(sp.view)
  const pageSize = 25

  const supabase = await createClient()
  const result = await listClients(supabase, { q, sort, dir, page, pageSize })

  if (!result.ok) {
    return (
      <div className="text-destructive p-8">Couldn&apos;t load clients. Please refresh.</div>
    )
  }

  const { rows, total } = result.data
  const isEmpty = total === 0 && q.length === 0
  const isNoMatch = total === 0 && q.length > 0
  const pageStart = (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, total)
  const hasPrev = page > 1
  const hasNext = page * pageSize < total

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (sort !== 'last_contacted_at') params.set('sort', sort)
    if (dir !== 'desc') params.set('dir', dir)
    if (targetPage > 1) params.set('page', String(targetPage))
    if (view === 'cards') params.set('view', 'cards')
    const qs = params.toString()
    return qs ? `/clients?${qs}` : '/clients'
  }

  if (isEmpty) {
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        </header>
        <div className="bg-card flex flex-col items-center gap-3 rounded-md border p-12 text-center">
          <h2 className="text-lg font-semibold">No clients yet</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            Add a client to track jobs and contacts.
          </p>
          <Button asChild className="mt-2 h-11">
            <Link href="/clients/new">
              <Plus className="mr-1 size-4" />
              Add your first client
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <Button asChild>
          <Link href="/clients/new">
            <Plus className="mr-1 size-4" />
            Add client
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput />
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-xs">
            {total === 0
              ? 'No matches'
              : `${pageStart}–${pageEnd} of ${total} client${total === 1 ? '' : 's'}`}
          </p>
          <ViewToggle current={view} />
        </div>
      </div>

      {isNoMatch ? (
        <div className="bg-card rounded-md border p-12 text-center">
          <p className="text-muted-foreground text-sm">
            No clients match &ldquo;{q}&rdquo;. Try a shorter or different search term.
          </p>
        </div>
      ) : view === 'cards' ? (
        <ClientCards rows={rows} />
      ) : (
        <ClientTable rows={rows} />
      )}

      {total > pageSize && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <Button asChild variant="outline" size="sm" disabled={!hasPrev}>
            {hasPrev ? <Link href={buildPageHref(page - 1)}>Previous</Link> : <span>Previous</span>}
          </Button>
          <span className="text-muted-foreground text-xs">Page {page}</span>
          <Button asChild variant="outline" size="sm" disabled={!hasNext}>
            {hasNext ? <Link href={buildPageHref(page + 1)}>Next</Link> : <span>Next</span>}
          </Button>
        </nav>
      )}
    </div>
  )
}
