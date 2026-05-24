import * as Sentry from '@sentry/nextjs'
import { NextResponse, type NextRequest } from 'next/server'

import { safeNext } from '@/lib/auth/safe-next'
import {
  INVITE_COOKIE_CLEAR_OPTIONS,
  INVITE_COOKIE_NAME,
} from '@/lib/invitations/cookie'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Handles the magic-link callback. Supabase redirects here with either
// `?code=...` (PKCE flow used by signInWithOtp) or `#access_token=...`
// (implicit flow — handled client-side by the SDK on landing, not here).
//
// Quick task 260524-bpy: if the `altus_invite_token` cookie is present after
// the PKCE exchange, attach the user to the inviter's organisation via the
// public.accept_invitation() RPC instead of letting them land in the
// auto-created fresh org from handle_new_user.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))
  const inviteCookie = request.cookies.get(INVITE_COOKIE_NAME)?.value ?? null

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
  }

  // Default path — no invite cookie. Existing behaviour preserved bit-for-bit.
  if (!inviteCookie) {
    return NextResponse.redirect(`${origin}${next}`)
  }

  // ----- Invite-cookie path -----
  // Get the authenticated user object for the email-match precondition.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // T-260524-bpy-11: Null-email precondition. PKCE-exchanged session lacks an
  // email — we cannot perform the email-match check that gates org
  // reassignment, so abort the invite flow entirely. The user keeps whatever
  // fresh-org bootstrap the handle_new_user trigger gave them; they can
  // re-request a new invite link. MUST run BEFORE any service-role lookup or
  // RPC call.
  if (!user?.email) {
    const response = NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`)
    response.cookies.set(INVITE_COOKIE_NAME, '', INVITE_COOKIE_CLEAR_OPTIONS)
    return response
  }

  // Canonical accept path. The RPC is the single source of truth for the
  // org-reassignment + orphan-cleanup transaction. The handler does NOT
  // orchestrate multiple statements, does NOT touch users/org_invitations/
  // organizations tables directly, and does NOT attempt orphan cleanup itself.
  try {
    const service = createServiceClient()
    const { data, error: rpcError } = await service.rpc('accept_invitation', {
      p_token: inviteCookie,
      p_user_id: user.id,
      p_user_email: user.email,
    })

    if (rpcError) {
      Sentry.captureException(rpcError, {
        tags: { feature: 'invitations', step: 'callback' },
      })
      const response = NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`)
      response.cookies.set(INVITE_COOKIE_NAME, '', INVITE_COOKIE_CLEAR_OPTIONS)
      return response
    }

    // The RPC returns a single-row table; supabase-js surfaces it as an
    // array of { ok, reason }.
    const result = Array.isArray(data) ? data[0] : null
    if (!result?.ok) {
      if (result?.reason === 'email_mismatch') {
        // Never log the actual email or token — only a static tag.
        Sentry.captureMessage('invite_email_mismatch', {
          level: 'warning',
          tags: { feature: 'invitations', step: 'callback' },
        })
      }
      const response = NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`)
      response.cookies.set(INVITE_COOKIE_NAME, '', INVITE_COOKIE_CLEAR_OPTIONS)
      return response
    }

    // Success — clear the cookie and redirect to the dashboard (or ?next=).
    const response = NextResponse.redirect(`${origin}${next}`)
    response.cookies.set(INVITE_COOKIE_NAME, '', INVITE_COOKIE_CLEAR_OPTIONS)
    return response
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: 'invitations', step: 'callback' },
    })
    const response = NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`)
    response.cookies.set(INVITE_COOKIE_NAME, '', INVITE_COOKIE_CLEAR_OPTIONS)
    return response
  }
}
