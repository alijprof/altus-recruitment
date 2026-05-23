'use client'

// Responsive shell: below md shows FloatsCards; at md+ shows FloatsTable.
// Single child rendered in the DOM — no dual-tree approach.

import { useIsMobile } from '@/hooks/use-is-mobile'
import type { ShortlistRow } from '@/lib/db/shortlists'

import { FloatsCards } from './floats-cards'
import { FloatsTable } from './floats-table'

interface FloatsShellProps {
  rows: ShortlistRow[]
}

export function FloatsShell({ rows }: FloatsShellProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <FloatsCards rows={rows} />
  }

  return <FloatsTable rows={rows} />
}
