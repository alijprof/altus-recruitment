import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { ConfidentialClientApplication, type Configuration } from '@azure/msal-node'
import { Client as GraphClient } from '@microsoft/microsoft-graph-client'
import { createHmac, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt, encrypt } from '@/lib/encryption'
import { env } from '@/lib/env'
import {
  getOutlookCredentials,
  revokeOutlookCredentials,
  updateOutlookAccessToken,
} from '@/lib/db/outlook-credentials'
import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// Outlook (Microsoft 365) integration wrapper.
//
// All MSAL + Microsoft Graph traffic flows through this one module. Two
// invariants enforced here and asserted by plan-level grep:
//   1. `new ConfidentialClientApplication` appears exactly once in src/
//      — module-scoped singleton in `getMsal()`.
//   2. `new Client(` (Graph SDK) appears exactly once — singleton in
//      `getGraph(accessToken)` (rebuilt per access token because the
//      auth provider closes over the token; the constructor call itself
//      is the one source).
//
// PII discipline: every public function wraps Microsoft errors in a
// scrubbed Error before handing to Sentry (`error.name + statusCode` —
// never the raw `error`, which can include request-body snippets). The
// caller never sees plaintext tokens — `getValidAccessToken` returns the
// access token, but it's expected to be used immediately and discarded.
//
// Sliding RT rotation: Microsoft rotates the refresh token on every
// refresh call. `getValidAccessToken` MUST persist the NEW refresh token
// via `updateOutlookAccessToken` or the cached RT silently expires after
// 90 days of disuse. This is the most important invariant in this file.
// ---------------------------------------------------------------------------

// Scopes locked to Phase 2 D2-15 (Outlook variant). `offline_access` is
// what gets us a refresh token; `User.Read` is mandatory for `/me` (used
// during OAuth callback to derive the user's email + Entra tenant + oid).
export const OUTLOOK_SCOPES = ['offline_access', 'Mail.Read', 'User.Read'] as const

// Graph mail subscriptions cap at 4230 minutes (~70.5h). Stay 30 min
// under the cap so a delayed-by-Inngest renewal still lands in-window.
const SUBSCRIPTION_LIFETIME_MIN = 4200

// Cap delta-page iteration so a runaway @odata.nextLink doesn't burn
// budget on a single Inngest run. ~5 pages × 50 messages = 250 max per
// invocation; the next webhook picks up the cursor where this left off.
const MAX_DELTA_PAGES = 5

/**
 * Thrown by `getValidAccessToken` when the refresh token is no longer
 * valid (Microsoft returns `invalid_grant` or `interaction_required`).
 * Callers MUST treat this as terminal — there's no automatic recovery;
 * the user has to reconnect through the UI. `getValidAccessToken`
 * itself revokes the row before throwing, so the DB state is consistent
 * by the time this surfaces.
 */
export class OutlookReconnectRequiredError extends Error {
  constructor(public readonly reason: string) {
    super(`Outlook reconnect required: ${reason}`)
    this.name = 'OutlookReconnectRequiredError'
  }
}

/**
 * Thrown by `renewMailSubscription` when Graph returns 404 — the
 * subscription has fully expired and cannot be PATCH-renewed. Caller
 * (the 6-hourly cron) catches this and recreates with a fresh delta.
 */
export class SubscriptionExpiredError extends Error {
  constructor() {
    super('Outlook subscription expired (404 on renew)')
    this.name = 'SubscriptionExpiredError'
  }
}

// ---------------------------------------------------------------------------
// MSAL + Graph singletons
// ---------------------------------------------------------------------------

let cachedMsal: ConfidentialClientApplication | null = null

function getMsal(): ConfidentialClientApplication {
  if (cachedMsal) return cachedMsal

  const tenantId = env.OUTLOOK_TENANT_ID
  const clientId = env.OUTLOOK_CLIENT_ID
  const clientSecret = env.OUTLOOK_CLIENT_SECRET
  const redirectUri = env.OUTLOOK_REDIRECT_URI

  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'outlook: missing required env (OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI). See docs/outlook-integration-setup.md.',
    )
  }

  const config: Configuration = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  }
  cachedMsal = new ConfidentialClientApplication(config)
  return cachedMsal
}

function getGraph(accessToken: string): GraphClient {
  // Build a fresh Graph client per access token — the SDK auth provider
  // closes over the token. The constructor call below is the ONLY
  // `new Client(` in src/.
  return GraphClient.init({
    authProvider: (done) => done(null, accessToken),
    defaultVersion: 'v1.0',
  })
}

// ---------------------------------------------------------------------------
// PII-scrubbed Sentry capture
// ---------------------------------------------------------------------------

type MicrosoftErrorLike = {
  name?: string
  statusCode?: number
  code?: string
}

function captureScrubbed(fn: string, err: unknown): void {
  const e = err as MicrosoftErrorLike
  const tag = `${e?.name ?? 'UnknownError'}:${e?.statusCode ?? e?.code ?? 'unknown'}`
  Sentry.captureException(new Error(`outlook.${fn}: ${tag}`), {
    tags: { layer: 'integration', integration: 'outlook', fn },
  })
}

// ---------------------------------------------------------------------------
// OAuth — authorize URL + code exchange
// ---------------------------------------------------------------------------

/**
 * Build the Microsoft authorize URL. `state` is generated by the caller
 * (the server action) and round-tripped via cookie — we don't store it
 * here.
 */
export function getAuthorizationUrl(state: string): string {
  const tenantId = env.OUTLOOK_TENANT_ID
  const clientId = env.OUTLOOK_CLIENT_ID
  const redirectUri = env.OUTLOOK_REDIRECT_URI
  if (!tenantId || !clientId || !redirectUri) {
    throw new Error('outlook: missing required env (tenant/client/redirect)')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: OUTLOOK_SCOPES.join(' '),
    state,
    prompt: 'consent',
  })
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`
}

export type CodeExchangeResult = {
  accessToken: string
  refreshToken: string
  expiresOn: Date
  account: {
    homeAccountId: string
    tenantId: string
    username: string
    localAccountId: string
  }
}

/**
 * Exchange a Microsoft OAuth `code` for tokens. The MSAL SDK does not
 * surface the refresh token via the standard `acquireTokenByCode`
 * response — we read it from the in-memory token cache.
 */
export async function exchangeCodeForTokens(code: string): Promise<CodeExchangeResult> {
  const msal = getMsal()
  const redirectUri = env.OUTLOOK_REDIRECT_URI as string
  try {
    const response = await msal.acquireTokenByCode({
      code,
      scopes: [...OUTLOOK_SCOPES],
      redirectUri,
    })
    if (!response || !response.accessToken || !response.account || !response.expiresOn) {
      throw new Error('acquireTokenByCode returned incomplete response')
    }

    // MSAL exposes the refresh token only via the cache serialiser. The
    // cache stores it under a key like:
    //   <homeAccountId>-login.microsoftonline.com-refreshtoken-<clientId>--
    const cacheBlob = msal.getTokenCache().serialize()
    const cacheJson = JSON.parse(cacheBlob) as {
      RefreshToken?: Record<string, { secret?: string; home_account_id?: string }>
    }
    const refreshEntries = Object.values(cacheJson.RefreshToken ?? {})
    const match = refreshEntries.find(
      (rt) => rt.home_account_id === response.account?.homeAccountId,
    )
    const refreshToken = match?.secret
    if (!refreshToken) {
      throw new Error('refresh token not present in MSAL cache after code exchange')
    }

    return {
      accessToken: response.accessToken,
      refreshToken,
      expiresOn: response.expiresOn,
      account: {
        homeAccountId: response.account.homeAccountId,
        tenantId: response.account.tenantId,
        username: response.account.username,
        localAccountId: response.account.localAccountId,
      },
    }
  } catch (err) {
    captureScrubbed('exchangeCodeForTokens', err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Token refresh + sliding-RT persistence (the most important function here)
// ---------------------------------------------------------------------------

/**
 * Return a valid access token for the given user, refreshing if needed.
 *
 * On every refresh, Microsoft may rotate the refresh token. This function
 * MUST persist the new refresh token (alongside the new access token)
 * back to outlook_credentials — otherwise the cached RT silently expires
 * after 90 days of disuse. The persistence happens via
 * `updateOutlookAccessToken` which writes both columns atomically.
 *
 * When the refresh fails terminally (`invalid_grant`,
 * `interaction_required`), the row is revoked and
 * `OutlookReconnectRequiredError` is thrown.
 */
export async function getValidAccessToken(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const credResult = await getOutlookCredentials(supabase, userId)
  if (!credResult.ok || !credResult.data) {
    throw new OutlookReconnectRequiredError('credentials not found')
  }
  const cred = credResult.data
  if (cred.revoked_at) {
    throw new OutlookReconnectRequiredError('credentials revoked')
  }
  if (!cred.refresh_token_encrypted) {
    throw new OutlookReconnectRequiredError('refresh token missing')
  }

  // Reuse cached access token when it's still valid for at least 60s.
  const now = Date.now()
  if (
    cred.access_token_encrypted &&
    cred.access_token_expires_at &&
    new Date(cred.access_token_expires_at).getTime() - now > 60_000
  ) {
    try {
      return decrypt(cred.access_token_encrypted)
    } catch (err) {
      // Decryption failure means key rotation or DB tampering — refresh
      // path below will overwrite cleanly.
      captureScrubbed('getValidAccessToken.decryptCached', err)
    }
  }

  // Refresh path. Decrypt the stored refresh token, hand to MSAL,
  // persist the new pair.
  let refreshTokenPlaintext: string
  try {
    refreshTokenPlaintext = decrypt(cred.refresh_token_encrypted)
  } catch (err) {
    captureScrubbed('getValidAccessToken.decryptRT', err)
    await revokeOutlookCredentials(supabase, userId)
    throw new OutlookReconnectRequiredError('refresh token decryption failed')
  }

  const msal = getMsal()
  let response: Awaited<ReturnType<typeof msal.acquireTokenByRefreshToken>>
  try {
    response = await msal.acquireTokenByRefreshToken({
      refreshToken: refreshTokenPlaintext,
      scopes: [...OUTLOOK_SCOPES],
    })
  } catch (err) {
    captureScrubbed('getValidAccessToken.refresh', err)
    const e = err as MicrosoftErrorLike & { errorCode?: string }
    const code = e?.code ?? e?.errorCode ?? ''
    if (
      code === 'invalid_grant' ||
      code === 'interaction_required' ||
      code === 'consent_required'
    ) {
      await revokeOutlookCredentials(supabase, userId)
      throw new OutlookReconnectRequiredError(code)
    }
    throw err
  }

  if (!response || !response.accessToken || !response.expiresOn) {
    await revokeOutlookCredentials(supabase, userId)
    throw new OutlookReconnectRequiredError('refresh returned no access token')
  }

  // Pull the rotated refresh token from the MSAL cache. Microsoft does
  // not surface it on the response object directly. If for some reason
  // no rotation happened (Microsoft sometimes returns the same RT),
  // we re-encrypt the plaintext we already have.
  let newRefreshToken = refreshTokenPlaintext
  try {
    const cacheBlob = msal.getTokenCache().serialize()
    const cacheJson = JSON.parse(cacheBlob) as {
      RefreshToken?: Record<string, { secret?: string; home_account_id?: string }>
    }
    const entries = Object.values(cacheJson.RefreshToken ?? {})
    const match = entries.find((rt) => rt.secret && rt.secret !== refreshTokenPlaintext)
    if (match?.secret) newRefreshToken = match.secret
  } catch (err) {
    captureScrubbed('getValidAccessToken.readCacheRT', err)
  }

  const encryptedAccess = encrypt(response.accessToken)
  const encryptedRefresh = encrypt(newRefreshToken)
  const writeResult = await updateOutlookAccessToken(supabase, {
    userId,
    encryptedAccessToken: encryptedAccess,
    encryptedRefreshToken: encryptedRefresh,
    expiresAt: response.expiresOn.toISOString(),
  })
  if (!writeResult.ok) {
    captureScrubbed('getValidAccessToken.persistRotated', writeResult.code)
    // Token still usable for this call — don't block the caller, but the
    // next refresh attempt may fail if we couldn't persist. Already
    // captured.
  }

  return response.accessToken
}

// ---------------------------------------------------------------------------
// Microsoft Graph: subscription lifecycle
// ---------------------------------------------------------------------------

export type CreatedSubscription = {
  subscriptionId: string
  expirationDateTime: string
}

/**
 * Create a Microsoft Graph change-notification subscription on
 * `me/mailFolders('Inbox')/messages`. Graph performs a synchronous
 * `validationToken` handshake on this POST — our webhook GET handler
 * must echo the token within 10s or this call returns 400.
 */
export async function createMailSubscription(
  accessToken: string,
  args: { notificationUrl: string; clientState: string },
): Promise<CreatedSubscription> {
  try {
    const expirationDateTime = new Date(
      Date.now() + SUBSCRIPTION_LIFETIME_MIN * 60_000,
    ).toISOString()
    const graph = getGraph(accessToken)
    const result = (await graph.api('/subscriptions').post({
      changeType: 'created',
      notificationUrl: args.notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime,
      clientState: args.clientState,
    })) as { id: string; expirationDateTime: string }
    return {
      subscriptionId: result.id,
      expirationDateTime: result.expirationDateTime,
    }
  } catch (err) {
    captureScrubbed('createMailSubscription', err)
    throw err
  }
}

/**
 * PATCH-renew a Microsoft Graph subscription. Mail subscriptions cap at
 * ~70.5h; we always set the new expiration to `now + SUBSCRIPTION_LIFETIME_MIN`.
 * Returns the new expiration time. Throws `SubscriptionExpiredError` on
 * 404 so the cron caller can recreate.
 */
export async function renewMailSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<{ expirationDateTime: string }> {
  try {
    const expirationDateTime = new Date(
      Date.now() + SUBSCRIPTION_LIFETIME_MIN * 60_000,
    ).toISOString()
    const graph = getGraph(accessToken)
    const result = (await graph
      .api(`/subscriptions/${subscriptionId}`)
      .patch({ expirationDateTime })) as { expirationDateTime: string }
    return { expirationDateTime: result.expirationDateTime }
  } catch (err) {
    const e = err as MicrosoftErrorLike
    if (e?.statusCode === 404) {
      throw new SubscriptionExpiredError()
    }
    captureScrubbed('renewMailSubscription', err)
    throw err
  }
}

/**
 * DELETE a Microsoft Graph subscription. 404 is treated as success
 * (idempotent disconnect).
 */
export async function deleteMailSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<void> {
  try {
    const graph = getGraph(accessToken)
    await graph.api(`/subscriptions/${subscriptionId}`).delete()
  } catch (err) {
    const e = err as MicrosoftErrorLike
    if (e?.statusCode === 404) return
    captureScrubbed('deleteMailSubscription', err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Microsoft Graph: profile + delta query
// ---------------------------------------------------------------------------

export type GraphUserProfile = {
  id: string
  mail: string
  userPrincipalName: string
}

/**
 * GET /me — used during OAuth callback to derive the user's email +
 * Entra object id. We do NOT trust the ID token here because the tokens
 * came over the wire seconds ago and we want a fresh authoritative
 * read.
 */
export async function getUserProfile(accessToken: string): Promise<GraphUserProfile> {
  try {
    const graph = getGraph(accessToken)
    const result = (await graph
      .api('/me')
      .select('id,mail,userPrincipalName')
      .get()) as GraphUserProfile
    return result
  } catch (err) {
    captureScrubbed('getUserProfile', err)
    throw err
  }
}

// Mail message slice we return from delta. Mirrors the `$select` query.
export type OutlookMessage = {
  id: string
  subject: string | null
  bodyPreview: string | null
  from?: { emailAddress?: { address?: string | null; name?: string | null } | null } | null
  toRecipients?: Array<{
    emailAddress?: { address?: string | null; name?: string | null } | null
  }> | null
  receivedDateTime: string | null
  internetMessageId: string | null
  conversationId: string | null
  parentFolderId: string | null
}

export type DeltaResult = {
  messages: OutlookMessage[]
  nextDeltaLink: string | null
}

/**
 * Run a delta query against the user's Inbox.
 *
 * On first sync, pass `deltaLink: null` — we hit the canonical delta URL
 * and Graph returns the head of changes plus a deltaLink we save for
 * next time. On subsequent syncs we hit the saved deltaLink directly,
 * which is opaque to us (Graph encodes the cursor in the URL itself).
 *
 * Pagination is bounded at MAX_DELTA_PAGES so a single Inngest run can't
 * burn the Graph rate budget; the next webhook re-fires and picks up.
 */
export async function fetchDelta(
  accessToken: string,
  args: { deltaLink: string | null },
): Promise<DeltaResult> {
  try {
    const graph = getGraph(accessToken)
    const select =
      '$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,internetMessageId,conversationId,parentFolderId'

    let url: string =
      args.deltaLink ??
      `/me/mailFolders('Inbox')/messages/delta?${select}`

    const messages: OutlookMessage[] = []
    let nextDeltaLink: string | null = null
    let pages = 0

    while (url && pages < MAX_DELTA_PAGES) {
      // Graph SDK can take either an absolute @odata URL or a relative
      // path — both are valid arguments to .api().
      const page = (await graph.api(url).get()) as {
        value?: OutlookMessage[]
        '@odata.nextLink'?: string
        '@odata.deltaLink'?: string
      }
      for (const msg of page.value ?? []) messages.push(msg)

      if (page['@odata.deltaLink']) {
        nextDeltaLink = page['@odata.deltaLink']
        break
      }
      if (!page['@odata.nextLink']) break
      url = page['@odata.nextLink']
      pages++
    }

    return { messages, nextDeltaLink }
  } catch (err) {
    captureScrubbed('fetchDelta', err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// clientState derivation
// ---------------------------------------------------------------------------

/**
 * Derive a per-subscription clientState. Stored in
 * `outlook_credentials.subscription_client_state` and matched on every
 * webhook notification.
 *
 * Construction:
 *   HMAC-SHA256(env.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET, purpose + ':' + 16-byte-hex-nonce)
 *
 * The nonce ensures every subscription gets a unique clientState even
 * if the purpose string is reused; the HMAC ensures an attacker who
 * knows our subscription IDs but not the secret can't forge clientStates.
 */
export function deriveClientState(purpose: string): string {
  const secret = env.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET
  if (!secret) {
    throw new Error('outlook: OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET is not set')
  }
  const nonce = randomBytes(16).toString('hex')
  return createHmac('sha256', secret).update(`${purpose}:${nonce}`).digest('hex')
}
