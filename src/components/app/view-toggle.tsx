'use client'

import { LayoutGrid, List } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

import { cn } from '@/lib/utils'

export type ListView = 'list' | 'cards'

export function isListView(value: string | undefined): ListView {
  return value === 'cards' ? 'cards' : 'list'
}

type ViewToggleProps = {
  current: ListView
  className?: string
}

// Toggle between list (table) and cards (grid) on candidate/client list
// pages. Preserves every other URL search param so search/sort/page state
// survives the swap. Server-side parsing lives in isListView() — call it
// in the page to read params.view.
export function ViewToggle({ current, className }: ViewToggleProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function hrefFor(view: ListView): string {
    const params = new URLSearchParams(searchParams.toString())
    if (view === 'list') {
      params.delete('view') // list is the implicit default
    } else {
      params.set('view', view)
    }
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <div
      role="group"
      aria-label="View style"
      className={cn(
        'border-border bg-background inline-flex items-center rounded-md border p-0.5',
        className,
      )}
    >
      <Link
        href={hrefFor('list')}
        aria-pressed={current === 'list'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
          current === 'list'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <List className="size-3.5" aria-hidden="true" />
        List
      </Link>
      <Link
        href={hrefFor('cards')}
        aria-pressed={current === 'cards'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
          current === 'cards'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <LayoutGrid className="size-3.5" aria-hidden="true" />
        Cards
      </Link>
    </div>
  )
}
