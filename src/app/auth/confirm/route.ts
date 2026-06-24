import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

import { safeNext } from '@/lib/auth/safe-next'
import { createClient } from '@/lib/supabase/server'

// Magic-link confirmation for admin-generated login links (SSR token_hash flow).
//
// The /admin "Provision external customer" tool creates the customer's user +
// org, comps it, then generates a login link via supabase.auth.admin.generateLink
// and emails it through Resend (bypassing Supabase's built-in auth-email SMTP
// throttle). That link points here:
//   /auth/confirm?token_hash=<hash>&type=magiclink&next=/
// verifyOtp() exchanges the token_hash for a session and sets the auth cookies on
// the redirect response — the same cookie mechanism the PKCE /auth/callback relies
// on.
//
// This is deliberately SEPARATE from /auth/callback (which handles the PKCE
// `?code=` flow used by the normal in-app signInWithOtp), so neither path's logic
// can regress the other.

const ALLOWED_TYPES: EmailOtpType[] = ['magiclink', 'email', 'signup', 'invite', 'recovery']

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNext(searchParams.get('next'))

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
