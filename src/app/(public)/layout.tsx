import type { ReactNode } from 'react'

// (public) route group. Holds the apply form (`/apply/[orgSlug]`) and any
// other unauthenticated, non-app pages we add later. Distinct from (auth)
// because:
//   * (auth) is for the recruiter signing in (sign-in / sign-up cards)
//   * (public) is for candidates / general visitors (apply form, success
//     page, future shareable resources)
//
// No TopNav, no auth check, no SignOut button. The footer carries the
// "Powered by Altus" line per CONTEXT.md <specifics> — SaaS hygiene that
// Phase 5 may replace with per-org branding.
//
// Middleware allows `/apply` and `/apply/...` via the PUBLIC_PATHS array
// in src/lib/supabase/middleware.ts.

export default async function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {children}
      <footer className="text-muted-foreground mt-12 border-t pt-4 text-center text-xs">
        Powered by Altus
      </footer>
    </main>
  )
}
