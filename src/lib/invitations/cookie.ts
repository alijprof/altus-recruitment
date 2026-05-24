import 'server-only'

// Quick task 260524-bpy: shared cookie + URL helpers for the invitation flow.
// Used by /accept-invite/[token]/route.ts (sets the cookie) and
// /auth/callback/route.ts (reads + clears the cookie).

export const INVITE_COOKIE_NAME = 'altus_invite_token'

// `domain` is intentionally omitted so the cookie is host-only. This prevents
// production cookies from being sent to staging subdomains (or vice versa) and
// keeps invite cookies scoped strictly to the host that issued them. Adding
// `domain` later would be a security regression unless the env is
// single-host-only.
//
// `maxAge: 3600` (1h) is the window between clicking the email link and
// signing in via magic link. If the user takes longer than that they can
// re-click the original /accept-invite link.
export const INVITE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60,
}

// Cookie-clear sentinel: same options, but maxAge=0 so the browser drops the
// cookie immediately. Used by /auth/callback after a successful or failed
// accept to prevent token replay across sessions.
export const INVITE_COOKIE_CLEAR_OPTIONS = {
  ...INVITE_COOKIE_OPTIONS,
  maxAge: 0,
}

export function getInviteAcceptUrl(origin: string, token: string): string {
  return `${origin}/accept-invite/${token}`
}
