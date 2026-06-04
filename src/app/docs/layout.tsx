import type { ReactNode } from 'react'
import Link from 'next/link'

import { DOC_ARTICLES } from './content'

// /docs layout — public, no auth required (/docs is in PUBLIC_PATHS from 05-00).
// Provides a sidebar nav + content area. Responsive: sidebar collapses to a
// top nav on small screens. Static — no dynamic data needed.

export const metadata = {
  title: 'Documentation — Altus',
  description: 'In-app documentation for Altus: candidates, search, jobs, pipeline, and more.',
}

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-white">
      {/* Top bar */}
      <header className="border-border/60 sticky top-0 z-50 border-b bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/welcome"
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
            >
              <span className="font-bold" style={{ color: '#0A3D5C' }}>
                Altus
              </span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-sm font-medium">Documentation</span>
          </div>
          <Link
            href="/sign-up"
            className="text-sm font-medium text-white"
            style={{
              backgroundColor: '#0A3D5C',
              padding: '0.375rem 0.875rem',
              borderRadius: '0.375rem',
            }}
          >
            Get started
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-0 px-4 sm:flex-row sm:px-6">
        {/* Sidebar nav */}
        <aside className="w-full shrink-0 py-6 sm:w-56 sm:py-8">
          <nav aria-label="Documentation navigation">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 sm:flex-col sm:gap-y-0.5">
              {DOC_ARTICLES.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/docs/${article.slug}`}
                    className="text-muted-foreground hover:text-foreground block rounded px-2 py-1.5 text-sm transition-colors hover:bg-slate-50"
                  >
                    {article.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Content area */}
        <main className="min-w-0 flex-1 border-l-0 py-6 sm:border-l sm:py-8 sm:pl-8">
          {children}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-border/60 border-t py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-xs sm:px-6">
          <span className="text-muted-foreground">
            &copy; {new Date().getFullYear()} Altus
          </span>
          <div className="text-muted-foreground flex gap-4">
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link href="/features" className="hover:text-foreground transition-colors">
              Features
            </Link>
            <Link href="/status" className="hover:text-foreground transition-colors">
              Status
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
