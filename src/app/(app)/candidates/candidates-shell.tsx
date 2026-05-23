'use client'

// Responsive shell: below md always shows CandidateCards; at md+ honours
// the URL-driven desktopView ('list' | 'cards'). This mirrors the
// pipeline-shell pattern — single child in the DOM, no dual-tree.

import { useIsMobile } from '@/hooks/use-is-mobile'
import type { CandidateListRow, SortDir, SortKey } from '@/lib/db/candidates'

import { CandidateCards } from './candidate-cards'
import { CandidateTable } from './candidate-table'

interface CandidatesShellProps {
  desktopView: 'list' | 'cards'
  rows: CandidateListRow[]
  total: number
  page: number
  pageSize: number
  sort: SortKey
  dir: SortDir
  query?: string
}

export function CandidatesShell({
  desktopView,
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  query,
}: CandidatesShellProps) {
  const isMobile = useIsMobile()

  if (isMobile || desktopView === 'cards') {
    return (
      <CandidateCards
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        dir={dir}
        query={query}
      />
    )
  }

  return (
    <CandidateTable
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      sort={sort}
      dir={dir}
      query={query}
    />
  )
}
