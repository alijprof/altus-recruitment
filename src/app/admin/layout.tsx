// src/app/admin/layout.tsx
//
// SECURITY BOUNDARY: This layout calls requireSuperAdmin() BEFORE rendering
// any child. If the caller is not a super-admin, requireSuperAdmin() redirects
// (never renders). Only a verified super-admin reaches the children.
//
// IMPORTANT: /admin is NOT in PUBLIC_PATHS (src/lib/supabase/middleware.ts).
// The middleware auth guard fires first (unauthenticated → /sign-in before
// this layout executes). requireSuperAdmin() is the second gate — role check.
// This two-layer guard matches Pitfall 8 from 05-RESEARCH: the layout IS the
// security boundary for page renders; each action independently re-gates for
// mutations (defence in depth).
//
// Design: plain, functional — this is an internal tool, not a customer-facing
// surface. Uses the main app shell colours but without the top nav, so it
// stands out visually as a different context.

import { requireSuperAdmin } from '@/lib/admin/guard'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate runs here — redirects non-super-admins before children render.
  // The return value (user) is unused in the layout itself; pages/actions
  // re-call requireSuperAdmin() for defence in depth on mutations.
  await requireSuperAdmin()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold tracking-wide text-white uppercase">
              Super Admin
            </span>
            <span className="font-semibold text-slate-900">Altus Ops Console</span>
          </div>
          <span className="text-muted-foreground text-xs">Internal — do not share this URL</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
