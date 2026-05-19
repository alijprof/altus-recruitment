import { LayoutGrid, List } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

export type ListView = 'list' | 'cards'

export function isListView(value: string | undefined): ListView {
  return value === 'cards' ? 'cards' : 'list'
}

type ViewToggleProps = {
  /** Path to the list page, e.g. '/candidates' or '/clients'. */
  basePath: string
  current: ListView
  /** Other URL search params to preserve across the toggle. */
  params?: Record<string, string | undefined>
  className?: string
}

// Server-rendered toggle between list (table) and cards (grid). Pages pass
// in basePath + the other search params; we build the hrefs server-side so
// no client-side useSearchParams is required (Next.js 16 enforces Suspense
// around it, which was breaking /candidates and /clients).
export function ViewToggle({ basePath, current, params, className }: ViewToggleProps) {
  function hrefFor(view: ListView): string {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') usp.set(k, v)
    }
    if (view === 'cards') {
      usp.set('view', 'cards')
    } else {
      usp.delete('view')
    }
    const qs = usp.toString()
    return qs ? `${basePath}?${qs}` : basePath
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
