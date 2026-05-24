'use client'

// Quick task 260524-cwd — REPORT-02. Mobile-responsive shell for the
// Commission summary card: below md renders the card list, at md+ renders
// the table.

import { useIsMobile } from '@/hooks/use-is-mobile'
import type { CommissionSummaryRow } from '@/lib/db/buyer-value'

import { CommissionCards } from './commission-cards'
import { CommissionTable } from './commission-table'

type CommissionShellProps = {
  rows: CommissionSummaryRow[]
}

export function CommissionShell({ rows }: CommissionShellProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <CommissionCards rows={rows} />
  }
  return <CommissionTable rows={rows} />
}
