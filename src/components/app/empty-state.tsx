import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type EmptyStateProps = {
  heading: string
  body?: string
  cta?: { href: string; label: string } | null
  // Optional outline-variant secondary action shown alongside (or instead of)
  // the primary CTA. Rendered as a sibling Button to keep the empty state
  // self-contained — callers don't need to know about button variants.
  secondaryCta?: { href: string; label: string } | null
  className?: string
}

// UI-SPEC empty-state pattern: heading + body + (optional) CTA(s), centered
// inside a bordered container that matches the table shell width so the empty
// state visually replaces the would-be list without layout jank.
export function EmptyState({
  heading,
  body,
  cta,
  secondaryCta,
  className,
}: EmptyStateProps) {
  const hasAnyCta = Boolean(cta || secondaryCta)
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
      {hasAnyCta ? (
        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row">
          {cta ? (
            <Button asChild>
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          ) : null}
          {secondaryCta ? (
            <Button asChild variant="outline">
              <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
