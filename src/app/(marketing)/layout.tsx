import type { ReactNode } from 'react'
import Link from 'next/link'

import { MarketingNav } from '@/components/marketing/marketing-nav'

// (marketing) route group layout.
// Hosts: /welcome, /pricing, /features
// No auth required — all paths in this group are in PUBLIC_PATHS (05-00).
// Provides marketing nav header + footer.

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-white">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <footer className="border-border/60 mt-auto border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: '#0A3D5C' }}>
              Altus
            </span>
            <span className="text-muted-foreground">AI-first recruitment CRM</span>
          </div>
          <nav aria-label="Footer navigation" className="flex items-center gap-6">
            <Link
              href="/features"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </Link>
            <Link
              href="/pricing"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/docs"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/status"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Status
            </Link>
          </nav>
          <p className="text-muted-foreground text-xs">
            &copy; {new Date().getFullYear()} Altus. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
