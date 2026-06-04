import Link from 'next/link'

import { Button } from '@/components/ui/button'

// MarketingNav — public header for all (marketing) pages.
// Logo + nav links + sign-in / get-started CTAs.
// Server Component (static, no interactivity needed).
export function MarketingNav() {
  return (
    <header className="border-border/60 sticky top-0 z-50 w-full border-b bg-white/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo / wordmark */}
        <Link href="/welcome" className="flex items-center gap-2" aria-label="Altus — home">
          <span
            className="text-xl font-bold tracking-tight"
            style={{ color: '#0A3D5C' }}
          >
            Altus
          </span>
          <span
            className="hidden rounded px-1.5 py-0.5 text-xs font-semibold sm:block"
            style={{ backgroundColor: '#5DCAA5', color: '#fff' }}
          >
            AI
          </span>
        </Link>

        {/* Centre nav links */}
        <nav aria-label="Marketing navigation" className="hidden items-center gap-6 md:flex">
          <Link
            href="/features"
            className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
          >
            Features
          </Link>
          <Link
            href="/pricing"
            className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/docs"
            className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
          >
            Docs
          </Link>
          <Link
            href="/status"
            className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
          >
            Status
          </Link>
        </nav>

        {/* Right-hand CTAs */}
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm" style={{ backgroundColor: '#0A3D5C' }}>
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
