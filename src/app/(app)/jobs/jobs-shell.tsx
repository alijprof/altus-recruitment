'use client'

// Responsive shell: below md shows JobsCards; at md+ shows JobsTable.
// Single child rendered in the DOM — no dual-tree approach.

import { useIsMobile } from '@/hooks/use-is-mobile'
import type { JobListRow } from '@/lib/db/jobs'

import { JobsCards } from './jobs-cards'
import { JobsTable } from './jobs-table'

interface JobsShellProps {
  rows: JobListRow[]
  total: number
  page: number
  pageSize: number
}

export function JobsShell({ rows, total, page, pageSize }: JobsShellProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <JobsCards rows={rows} total={total} page={page} pageSize={pageSize} />
  }

  return <JobsTable rows={rows} total={total} page={page} pageSize={pageSize} />
}
