import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type EmptyStateProps = {
  heading: string
  body?: string
  cta?: { href: string; label: string } | null
  className?: string
}

// UI-SPEC empty-state pattern: heading + body + (optional) CTA, centered
// inside a bordered container that matches the table shell width so the empty
// state visually replaces the would-be list without layout jank.
export function EmptyState({ heading, body, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-md border bg-card px-6 py-16 text-center',
        className,
      )}
    >
      <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
      {body ? (
        <p className="text-muted-foreground mt-2 max-w-md text-sm font-normal">{body}</p>
      ) : null}
      {cta ? (
        <Button asChild className="mt-6">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      ) : null}
    </div>
  )
}
