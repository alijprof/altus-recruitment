'use client'

// Responsive shell: below md always shows ClientCards; at md+ honours
// the URL-driven desktopView ('list' | 'cards'). Same pattern as candidates-shell.

import { useIsMobile } from '@/hooks/use-is-mobile'
import type { ClientRow } from '@/lib/db/clients'

import { ClientCards } from './client-cards'
import { ClientTable } from './client-table'

interface ClientsShellProps {
  desktopView: 'list' | 'cards'
  rows: ClientRow[]
}

export function ClientsShell({ desktopView, rows }: ClientsShellProps) {
  const isMobile = useIsMobile()

  if (isMobile || desktopView === 'cards') {
    return <ClientCards rows={rows} />
  }

  return <ClientTable rows={rows} />
}
