import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  INVITE_COOKIE_NAME,
  INVITE_COOKIE_OPTIONS,
} from '@/lib/invitations/cookie'
import { isInvitationUsable, lookupInvitationByToken } from '@/lib/invitations/lookup'
import { createServiceClient } from '@/lib/supabase/service'

// Quick task 260524-bpy: invitation accept-link handler.
//
// Flow:
//   1. Validate token shape (uuid). Anything else → /sign-in?error=invalid-invite.
//   2. Service-role lookup of the invitation row (no auth required — token IS
//      the authority for this step; the /auth/callback handler later re-checks
//      email-match inside the SECURITY DEFINER RPC).
//   3. If not found → invalid; if accepted → expired (bucketed); if past
//      expires_at → expired.
//   4. Else set the altus_invite_token cookie (httpOnly + Lax + 1h max-age,
//      host-only — `domain` intentionally omitted, see cookie.ts) and redirect
//      to /sign-in?email={encoded}&invite=1 so the form pre-fills.

const tokenSchema = z.string().uuid()

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await context.params
  const { origin } = new URL(request.url)

  // Probing defence: anything that isn't a uuid bounces immediately.
  const parsed = tokenSchema.safeParse(rawToken)
  if (!parsed.success) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`)
  }
  const token = parsed.data

  const service = createServiceClient()
  const invitation = await lookupInvitationByToken(service, token)
  if (!invitation) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid-invite`)
  }

  const usability = isInvitationUsable(invitation)
  if (!usability.ok) {
    // Accepted + expired both map to the same UI bucket ("expired-invite") so
    // the sign-in banner copy stays simple. Comment intentional: a second
    // click on a successfully accepted link should land the user on the same
    // friendly "this invitation is no longer valid" message rather than
    // leaking the fact that the invitation was already accepted.
    return NextResponse.redirect(`${origin}/sign-in?error=expired-invite`)
  }

  const redirectUrl = `${origin}/sign-in?email=${encodeURIComponent(invitation.email)}&invite=1`
  const response = NextResponse.redirect(redirectUrl)
  response.cookies.set(INVITE_COOKIE_NAME, token, INVITE_COOKIE_OPTIONS)
  return response
}
