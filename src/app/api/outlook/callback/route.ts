import * as Sentry from '@sentry/nextjs'
import { type NextRequest, NextResponse } from 'next/server'

import { encrypt } from '@/lib/encryption'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import {
  exchangeCodeForTokens,
  getUserProfile,
  OUTLOOK_SCOPES,
} from '@/lib/integrations/outlook'
import { upsertOutlookCredentials } from '@/lib/db/outlook-credentials'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Plan 4 Task 4.2 — Microsoft OAuth callback.
//
// Allowlisted in src/lib/supabase/middleware.ts because the recruiter
// is mid-OAuth-flight when Microsoft redirects here — they may or may
// not still have a Supabase session cookie (they should; the consent
// roundtrip is sub-minute), but the middleware guard would loop them
// back to /sign-in unnecessarily. We re-verify the session manually
// below and bounce to /sign-in?next=... if absent.

const STATE_COOKIE = '__Host-outlook-oauth-state'

function redirectToSettings(
  request: NextRequest,
  params: Record<string, string> = {},
): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/settings/integrations'
  url.search = ''
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Microsoft puts EITHER (code+state) on success or (error+error_description)
  // on failure. Both arrive as query params.
  const code = request.nextUrl.searchParams.get('code')
  const stateParam = request.nextUrl.searchParams.get('state')
  const errorParam = request.nextUrl.searchParams.get('error')
  const errorDescription =
    request.nextUrl.searchParams.get('error_description') ?? ''

  // ---------------------------------------------------------------------
  // Microsoft-side error path
  // ---------------------------------------------------------------------
  if (errorParam) {
    // AADSTS65001 = admin consent required. Surface a specific code so
    // the page can render the admin-consent link inline.
    const isAdminConsent =
      errorDescription.includes('AADSTS65001') ||
      errorParam === 'consent_required'
    return redirectToSettings(request, {
      outlook_error: isAdminConsent ? 'admin_consent_required' : errorParam,
    })
  }

  if (!code || !stateParam) {
    return redirectToSettings(request, { outlook_error: 'missing_params' })
  }

  // ---------------------------------------------------------------------
  // CSRF: state must match the HttpOnly cookie set by startOutlookOAuthAction
  // ---------------------------------------------------------------------
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value
  if (!stateCookie || stateCookie !== stateParam) {
    Sentry.captureMessage('outlook/callback state mismatch', {
      level: 'warning',
      tags: { layer: 'route-handler', route: '/api/outlook/callback' },
    })
    // Clear the (possibly stale) cookie before bouncing.
    const res = redirectToSettings(request, { outlook_error: 'state_mismatch' })
    res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return new NextResponse(res.body, {
      status: 400,
      headers: res.headers,
    })
  }

  // ---------------------------------------------------------------------
  // Identify the recruiter we're connecting Outlook for
  // ---------------------------------------------------------------------
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.search = ''
    url.searchParams.set('next', '/settings/integrations')
    return NextResponse.redirect(url)
  }

  // ---------------------------------------------------------------------
  // Code exchange + profile fetch + persistence
  // ---------------------------------------------------------------------
  try {
    const tokens = await exchangeCodeForTokens(code)

    // Single-tenant guard — D2-15. If somehow a multi-tenant Entra
    // misconfig lets a foreign-tenant user through, refuse.
    if (
      env.OUTLOOK_TENANT_ID &&
      tokens.account.tenantId !== env.OUTLOOK_TENANT_ID
    ) {
      Sentry.captureMessage('outlook/callback foreign tenant rejected', {
        level: 'warning',
        tags: { layer: 'route-handler', route: '/api/outlook/callback' },
      })
      return redirectToSettings(request, { outlook_error: 'foreign_tenant' })
    }

    const profile = await getUserProfile(tokens.accessToken)
    const microsoftEmail = (
      profile.mail ??
      profile.userPrincipalName ??
      tokens.account.username
    ).toLowerCase()

    const encryptedRefresh = encrypt(tokens.refreshToken)
    const encryptedAccess = encrypt(tokens.accessToken)

    // Service-role write — RLS would let an authenticated user
    // upsert their own row, but we want the audit trail of "the
    // server completed the OAuth handshake on behalf of this user",
    // and Inngest functions need to read this same row using service
    // role anyway.
    const serviceClient = createServiceClient()

    // Resolve organization_id for the user (so the trigger doesn't
    // need to call current_organization_id() — service role has no
    // session). We could also rely on the set_org trigger; reading
    // explicitly removes ambiguity and lets us include it in the row
    // we send up.
    const { data: profileRow } = await serviceClient
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle()
    const organizationId = profileRow?.organization_id
    if (!organizationId) {
      throw new Error('users row missing organization_id')
    }

    const writeResult = await upsertOutlookCredentials(serviceClient, {
      userId: user.id,
      microsoftTenantId: tokens.account.tenantId,
      microsoftUserId: profile.id,
      microsoftEmail,
      refreshTokenEncrypted: encryptedRefresh,
      accessTokenEncrypted: encryptedAccess,
      accessTokenExpiresAt: tokens.expiresOn.toISOString(),
      scopes: [...OUTLOOK_SCOPES],
    })
    if (!writeResult.ok) {
      // If a row already exists (re-connect), upsert it by hand via
      // UPDATE — `outlook_credentials.user_id` is UNIQUE so the
      // insert path collides. We don't bother with onConflict
      // because the Plan 0 helper signature is plain INSERT.
      const { error: updErr } = await serviceClient
        .from('outlook_credentials')
        .update({
          microsoft_tenant_id: tokens.account.tenantId,
          microsoft_user_id: profile.id,
          microsoft_email: microsoftEmail,
          refresh_token_encrypted: encryptedRefresh,
          access_token_encrypted: encryptedAccess,
          access_token_expires_at: tokens.expiresOn.toISOString(),
          scopes: [...OUTLOOK_SCOPES],
          revoked_at: null,
        })
        .eq('user_id', user.id)
      if (updErr) {
        Sentry.captureException(updErr, {
          tags: { layer: 'route-handler', route: '/api/outlook/callback', subop: 'upsert-update' },
        })
        const res = redirectToSettings(request, { outlook_error: 'persist_failed' })
        res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
        return res
      }
    }

    // Fire subscription-create event. Failure here is non-fatal —
    // the 6-hourly cron sweeps anyone without a live subscription
    // (recordRenewalAttempt + retry).
    try {
      await inngest.send({
        name: 'outlook/subscription-create-requested',
        data: {
          user_id: user.id,
          organization_id: organizationId,
        },
      })
    } catch (sendErr) {
      const e = sendErr as { name?: string }
      Sentry.captureException(
        new Error(`outlook/callback: inngest.send failed: ${e?.name ?? 'unknown'}`),
        { tags: { layer: 'route-handler', route: '/api/outlook/callback', subop: 'inngest.send' } },
      )
    }

    // Clear the OAuth state cookie + redirect.
    const res = redirectToSettings(request, { outlook: 'connected' })
    res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  } catch (err) {
    // PII-safe: rely on captureScrubbed from the wrapper for the
    // Microsoft-error path; here we only emit a generic surface.
    const e = err as { name?: string }
    Sentry.captureException(
      new Error(`outlook/callback: ${e?.name ?? 'UnknownError'}`),
      { tags: { layer: 'route-handler', route: '/api/outlook/callback' } },
    )
    const res = redirectToSettings(request, { outlook_error: 'unexpected' })
    res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }
}
