import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { safeNext } from '@/lib/auth/safe-next'
import { env } from '@/lib/env'
import type { Database } from '@/types/database'

const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/auth/callback',
  '/auth/auth-code-error',
  // Inngest webhook — guarded by Inngest signing key, not Supabase auth.
  '/api/inngest',
  // Public apply form (Plan 3) — `/apply/[orgSlug]` and any nested success
  // page. The startsWith branch in `isPublic` below matches `/apply/...`.
  '/apply',
  // Outlook OAuth callback (Plan 4) — the user is mid-flight; we have no
  // Supabase session yet, only an `oauth_state` cookie + Microsoft auth
  // code. Route handler validates state + completes the token exchange.
  '/api/outlook/callback',
  // Microsoft Graph change-notification webhook (Plan 4) — guarded by the
  // `clientState` echoed in every notification, NOT by Supabase auth.
  '/api/outlook/webhook',
  // Org invitation accept route (Quick 260524-bpy + 260527-x2q P0 fix) —
  // invitees are by definition unauthenticated when they first click the
  // emailed link. The route validates the token via service-role lookup,
  // sets the `altus_invite_token` httpOnly cookie, and redirects to
  // /sign-in?email=... so the magic-link round-trip can complete and
  // /auth/callback can attach the invitee to the inviter's org instead
  // of bootstrapping a fresh one. Gating this behind auth here would
  // create the bug it was added to fix.
  '/accept-invite',
]

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: do not put any logic between createServerClient and getUser.
  // The auth refresh happens inside getUser; anything that touches the
  // request between can cause the session to silently drop.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    // Defensive symmetry — pathname is server-derived so always safe, but using
    // safeNext() prevents future drift if the source ever changes.
    url.searchParams.set('next', safeNext(pathname))
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/sign-in' || pathname === '/sign-up')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
