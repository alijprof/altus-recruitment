'use client'

// Quick task 260524-cwd — REPORT-02. Mobile-responsive shell for the
// Source ROI card: below md renders the card list, at md+ renders the table.
// Mirrors `candidates-shell.tsx` pattern (single child in the DOM, no
// dual-tree).

import { useIsMobile } from '@/hooks/use-is-mobile'
import type { SourceAttributionRow } from '@/lib/db/source-attribution'

import { SourceRoiCards } from './source-roi-cards'
import { SourceRoiTable } from './source-roi-table'

type SourceRoiShellProps = {
  rows: SourceAttributionRow[]
}

export function SourceRoiShell({ rows }: SourceRoiShellProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <SourceRoiCards rows={rows} />
  }
  return <SourceRoiTable rows={rows} />
}
