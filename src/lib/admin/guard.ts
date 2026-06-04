import 'server-only'

// ---------------------------------------------------------------------------
// requireSuperAdmin — the SINGLE security chokepoint for all /admin access.
//
// ORDERING (must never deviate):
//   1. createClient() + getUser() — establish identity from Supabase session
//   2. Check app_metadata.super_admin === true — gate BEFORE any service-role call
//   3. Return the user to the caller — only reachable by a verified super-admin
//
// Non-super-admin path:
//   - Unauthenticated → redirect('/sign-in')
//   - Authenticated but not super_admin → redirect('/') (SILENT — do NOT 403
//     or return a 404; revealing the route exists is an information disclosure)
//
// Every admin page layout, server action, and query MUST call this before
// doing anything else — especially before calling createServiceClient().
// The layout gate (src/app/admin/layout.tsx) provides the boundary for
// page-level access. Per-action re-checks provide defence in depth for
// mutations (CLAUDE.md: "never trust the layout alone for mutations").
//
// IMPORTANT: /admin is NOT in PUBLIC_PATHS (src/lib/supabase/middleware.ts).
// The middleware auth guard runs first (redirects unauthenticated users before
// the layout even executes). This function is the second gate — role check.
// ---------------------------------------------------------------------------

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export type SuperAdminUser = {
  id: string
  email: string | undefined
}

export async function requireSuperAdmin(): Promise<SuperAdminUser> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Gate 1: must be authenticated
  if (!user) {
    redirect('/sign-in')
  }

  // Gate 2: must have super_admin === true in app_metadata
  // app_metadata is set server-side only (Supabase service-role), so it cannot
  // be forged by client-supplied JWTs. raw_app_meta_data is read via getUser()
  // which re-validates with Supabase's auth service on every call.
  const isSuperAdmin = user.app_metadata?.super_admin === true

  if (!isSuperAdmin) {
    // Silent redirect — do NOT 403, do NOT render an error page.
    // The route's existence must not be revealed to non-admins.
    redirect('/')
  }

  // Reached only after both gates pass.
  return { id: user.id, email: user.email }
}
