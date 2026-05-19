import 'server-only'

import { env } from '@/lib/env'

// ---------------------------------------------------------------------------
// Cloudflare Turnstile server-side token verification.
//
// Tokens are issued by the widget and posted alongside the form. The server
// MUST verify each token against Cloudflare before trusting it (single-use,
// 300s validity). Failure to verify is a hard error — never accept a
// submission without a verified token.
//
// Fail-closed posture: if TURNSTILE_SECRET_KEY is absent (dev/local before
// the Cloudflare account is set up), `verifyTurnstileToken` returns
// `{ success: false, errorCodes: ['missing-config'] }`. Plan 3's
// submitApplyAction inspects the error codes and surfaces a clear "form
// temporarily unavailable" message rather than silently accepting spam.
// ---------------------------------------------------------------------------

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerifyResult = {
  success: boolean
  errorCodes?: string[]
}

/**
 * POST the token (and optionally the remote IP) to Cloudflare's siteverify
 * endpoint. Returns a discriminated result; never throws on a network
 * failure (Cloudflare downtime should be treated as a verification failure,
 * not a server crash — same fail-closed posture as the missing-config case).
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) {
    return { success: false, errorCodes: ['missing-config'] }
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  })
  if (remoteIp) body.set('remoteip', remoteIp)

  let response: Response
  try {
    response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    return { success: false, errorCodes: ['network-error'] }
  }
  if (!response.ok) {
    return { success: false, errorCodes: [`http-${response.status}`] }
  }

  const json = (await response.json().catch(() => null)) as {
    success?: unknown
    'error-codes'?: unknown
  } | null
  if (!json) {
    return { success: false, errorCodes: ['invalid-response'] }
  }

  const errorCodes = Array.isArray(json['error-codes'])
    ? (json['error-codes'].filter((c) => typeof c === 'string') as string[])
    : undefined
  return { success: json.success === true, errorCodes }
}
