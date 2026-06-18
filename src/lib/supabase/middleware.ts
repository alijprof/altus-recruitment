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
  // LinkedIn capture ingest (Phase 3 extension). The request originates from
  // a `chrome-extension://` origin which carries NO Supabase cookies, so the
  // cookie-based middleware would 307-redirect it to /sign-in before the
  // route ever runs (the extension then sees a redirect, not JSON). The route
  // does its OWN bearer-token auth via `supabase.auth.getUser(token)` and
  // runs queries token-scoped under RLS. Gating it here breaks capture
  // entirely — same rationale as the /api/outlook/* entries above.
  '/api/linkedin/ingest',
  // Org invitation accept route (Quick 260524-bpy + 260527-x2q P0 fix) —
  // invitees are by definition unauthenticated when they first click the
  // emailed link. The route validates the token via service-role lookup,
  // sets the `altus_invite_token` httpOnly cookie, and redirects to
  // /sign-in?email=... so the magic-link round-trip can complete and
  // /auth/callback can attach the invitee to the inviter's org instead
  // of bootstrapping a fresh one. Gating this behind auth here would
  // create the bug it was added to fix.
  '/accept-invite',
  // --- Phase 5: Stripe webhook (Plan 05-01) --------------------------------
  // Stripe POSTs carry NO Supabase cookies — the middleware 307-redirect
  // would eat the request body and break billing sync entirely (same class
  // of bug as 260527-x2q / 260528-0rd). The route handler verifies the
  // Stripe-Signature header before touching any data.
  //
  // NOTE: /api/stripe/checkout and /api/stripe/portal are NOT here — those
  // endpoints are called by authenticated users and MUST stay gated.
  '/api/stripe/webhook',
  // --- Phase 5: Marketing / public surfaces (Plan 05-04) -------------------
  // Pre-decided in Wave 0 so 05-04 only creates route files and never
  // needs to touch this file again (mirrors the 260527-x2q lesson: add
  // public paths at foundation time, not reactively).
  //
  // `/welcome` is the marketing landing page. It intentionally lives at
  // /welcome (NOT at /) so `/` remains the authenticated dashboard — no
  // blanket-allow on the root required.
  '/welcome',
  '/pricing',
  '/features',
  '/docs',
  '/status',
  // Public legal pages (audit blocker 3). Unauthenticated job applicants on the
  // /apply/<slug> form link to /privacy from the consent block, so it MUST be
  // reachable without a session. /terms is public for the same footer-link reason.
  '/privacy',
  '/terms',
  // PECR one-click unsubscribe (Quick 260612-0f4).
  // Recipients who click the unsubscribe link in a campaign email carry NO
  // Supabase session cookie — they are fully unauthenticated by design.
  // The route is protected by a per-recipient unguessable token (randomBytes
  // >=32, base64url, ~256 bits entropy) so there is no meaningful auth gap.
  // GET returns a confirm page (safe idempotent read); POST performs the
  // durable suppression write. Same rationale as /apply and /accept-invite.
  // The startsWith branch in `isPublic` below matches `/unsubscribe/{token}`.
  '/unsubscribe',
  // IMPORTANT: `/admin` is NOT here. The admin area is authenticated +
  // role-gated in the layout (05-05 Task 5.1). Adding it to PUBLIC_PATHS
  // would create a cross-tenant read gate (Pitfall 8 from 05-RESEARCH).
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
