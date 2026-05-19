'use server'

import * as Sentry from '@sentry/nextjs'
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

import {
  deleteMailSubscription,
  getAuthorizationUrl,
  getValidAccessToken,
  OutlookReconnectRequiredError,
} from '@/lib/integrations/outlook'
import {
  getOutlookCredentials,
  revokeOutlookCredentials,
} from '@/lib/db/outlook-credentials'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Plan 4 Task 4.2 — Outlook OAuth-start + disconnect server actions.
//
// Kept in a dedicated file so the existing integrations/actions.ts
// (Plan 1's embed-backfill + HNSW-build) stays untouched — surgical
// addition per parallel-execution rules.

export type OutlookActionResult = { ok: true; url?: string } | { ok: false; error: string }

const STATE_COOKIE = '__Host-outlook-oauth-state'

/**
 * Generate the authorize URL + set the HttpOnly state cookie.
 *
 * The client navigates to the returned `url`. Microsoft renders the
 * consent screen (or skips it if admin consent + previous user consent
 * both granted), then redirects to /api/outlook/callback?code=...&state=...
 */
export async function startOutlookOAuthAction(): Promise<OutlookActionResult> {
  try {
    const supabase = await createSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }

    const state = randomBytes(32).toString('hex')
    const url = getAuthorizationUrl(state)

    const cookieJar = await cookies()
    cookieJar.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10, // 10 minutes
    })

    return { ok: true, url }
  } catch (err) {
    const e = err as { name?: string; message?: string }
    Sentry.captureException(
      new Error(`startOutlookOAuthAction: ${e?.name ?? 'UnknownError'}`),
      { tags: { layer: 'action', helper: 'startOutlookOAuthAction' } },
    )
    return {
      ok: false,
      error:
        e?.message?.includes('missing required env') === true
          ? 'Outlook integration is not configured. Contact support.'
          : 'Could not start the Outlook sign-in flow.',
    }
  }
}

/**
 * Disconnect Outlook. Best-effort:
 *   1. DELETE the Microsoft Graph subscription (404 = already gone).
 *   2. UPDATE the row → revoked_at + null tokens/subscription state.
 *
 * If step 1 throws because the access token is unreachable
 * (`OutlookReconnectRequiredError`), we still complete step 2 — the
 * row is unusable from our side regardless.
 */
export async function disconnectOutlookAction(): Promise<OutlookActionResult> {
  try {
    const supabase = await createSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in.' }

    const serviceClient = createServiceClient()
    const credResult = await getOutlookCredentials(serviceClient, user.id)
    if (!credResult.ok) {
      return { ok: false, error: 'Could not read your Outlook connection.' }
    }
    const cred = credResult.data
    // If already disconnected, just say ok.
    if (!cred || cred.revoked_at) {
      revalidatePath('/settings/integrations')
      return { ok: true }
    }

    if (cred.subscription_id) {
      try {
        const accessToken = await getValidAccessToken(serviceClient, user.id)
        await deleteMailSubscription(accessToken, cred.subscription_id)
      } catch (err) {
        if (!(err instanceof OutlookReconnectRequiredError)) {
          // Graph-side delete failed; we still proceed to revoke
          // the row. Already captured in the wrapper.
          const e = err as { name?: string }
          Sentry.captureException(
            new Error(`disconnectOutlookAction.delete: ${e?.name ?? 'UnknownError'}`),
            { tags: { layer: 'action', helper: 'disconnectOutlookAction', subop: 'delete-sub' } },
          )
        }
      }
    }

    const revokeResult = await revokeOutlookCredentials(serviceClient, user.id)
    if (!revokeResult.ok) {
      return { ok: false, error: 'Could not revoke your Outlook tokens.' }
    }

    revalidatePath('/settings/integrations')
    return { ok: true }
  } catch (err) {
    const e = err as { name?: string }
    Sentry.captureException(
      new Error(`disconnectOutlookAction: ${e?.name ?? 'UnknownError'}`),
      { tags: { layer: 'action', helper: 'disconnectOutlookAction' } },
    )
    return { ok: false, error: 'Disconnect failed. Try again.' }
  }
}
