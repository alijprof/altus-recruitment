import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// outlook_credentials helpers (D2-15..D2-19).
//
// All token fields are CIPHERTEXT — base64-packed iv:authTag:ciphertext
// strings produced by src/lib/encryption.ts. The encryption boundary lives
// in src/lib/integrations/outlook.ts (created in Plan 4); this helper never
// sees plaintext.
//
// RLS gates `user_id = auth.uid()`, so the supabase argument can be either
// the SSR client (recruiter-facing settings page) OR a service-role client
// (Inngest sync function which holds no auth session). The
// service-role-only paths are flagged in the function docstrings.
// ---------------------------------------------------------------------------

// reason: pending regen — Plan 0 Task 0.3 adds the outlook_credentials
// table. Pre-regen Database type doesn't know about it; declare the row
// shape manually here and cast at the .from(...) boundary. Remove once
// `supabase gen types --linked` is run.
export type OutlookCredentialsRow = {
  id: string
  organization_id: string
  user_id: string
  microsoft_tenant_id: string
  microsoft_user_id: string
  microsoft_email: string
  access_token_encrypted: string | null
  access_token_expires_at: string | null
  refresh_token_encrypted: string | null
  scopes: string[]
  encryption_key_version: number
  subscription_id: string | null
  subscription_client_state: string | null
  subscription_expires_at: string | null
  subscription_resource: string | null
  delta_link: string | null
  revoked_at: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

type OutlookCredentialsTableClient = {
  from: (table: 'outlook_credentials') => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{
          data: OutlookCredentialsRow | null
          error: unknown
        }>
      }
    }
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: unknown }>
      }
    }
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: unknown }>
        }
      }
    }
  }
}

function asOutlookCredsClient(
  supabase: SupabaseClient<Database>,
): OutlookCredentialsTableClient {
  return supabase as unknown as OutlookCredentialsTableClient
}

/**
 * Fetch the calling user's credentials row. Returns null when the user has
 * never connected Outlook. RLS scopes the result to `user_id = auth.uid()`,
 * so callers do NOT pass the user id explicitly.
 */
export async function getOutlookCredentials(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DbResult<OutlookCredentialsRow | null>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getOutlookCredentials' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? null }
}

/**
 * Service-role-only: look up credentials by Graph subscription id during
 * webhook handling. The webhook path runs without a user session — RLS
 * would return no rows under `authenticated`. The Plan 4 webhook route
 * MUST instantiate `createServiceClient()` and pass it here.
 */
export async function getOutlookCredentialsBySubscriptionId(
  supabase: SupabaseClient<Database>,
  subscriptionId: string,
): Promise<DbResult<OutlookCredentialsRow | null>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, {
      tags: {
        layer: 'db',
        helper: 'getOutlookCredentialsBySubscriptionId',
      },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data ?? null }
}

/**
 * Insert the row on first OAuth success. Caller passes encrypted token
 * blobs (NEVER plaintext). organization_id is filled by the set_org
 * trigger.
 */
export async function upsertOutlookCredentials(
  supabase: SupabaseClient<Database>,
  input: {
    userId: string
    microsoftTenantId: string
    microsoftUserId: string
    microsoftEmail: string
    refreshTokenEncrypted: string
    accessTokenEncrypted: string
    accessTokenExpiresAt: string
    scopes: string[]
  },
): Promise<DbResult<{ id: string }>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .insert({
      user_id: input.userId,
      microsoft_tenant_id: input.microsoftTenantId,
      microsoft_user_id: input.microsoftUserId,
      microsoft_email: input.microsoftEmail,
      refresh_token_encrypted: input.refreshTokenEncrypted,
      access_token_encrypted: input.accessTokenEncrypted,
      access_token_expires_at: input.accessTokenExpiresAt,
      scopes: input.scopes,
    })
    .select('id')
    .single()
  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'upsertOutlookCredentials' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Token refresh path. Microsoft rotates the refresh token on every
 * refresh call, so we MUST update both columns (or risk holding a stale
 * refresh token that's been invalidated server-side).
 */
export async function updateOutlookAccessToken(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string
    encryptedAccessToken: string
    encryptedRefreshToken: string
    expiresAt: string
  },
): Promise<DbResult<{ id: string }>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .update({
      access_token_encrypted: args.encryptedAccessToken,
      refresh_token_encrypted: args.encryptedRefreshToken,
      access_token_expires_at: args.expiresAt,
    })
    .eq('user_id', args.userId)
    .select('id')
    .single()
  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateOutlookAccessToken' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Called after Plan 4 successfully creates or renews a Graph subscription.
 */
export async function updateOutlookSubscriptionState(
  supabase: SupabaseClient<Database>,
  args: {
    userId: string
    subscriptionId: string
    subscriptionClientState: string
    subscriptionExpiresAt: string
  },
): Promise<DbResult<{ id: string }>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .update({
      subscription_id: args.subscriptionId,
      subscription_client_state: args.subscriptionClientState,
      subscription_expires_at: args.subscriptionExpiresAt,
    })
    .eq('user_id', args.userId)
    .select('id')
    .single()
  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateOutlookSubscriptionState' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Called by the Plan 4 sync Inngest function after each delta query
 * succeeds.
 */
export async function updateOutlookDeltaLink(
  supabase: SupabaseClient<Database>,
  args: { userId: string; deltaLink: string; lastSyncedAt: string },
): Promise<DbResult<{ id: string }>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .update({
      delta_link: args.deltaLink,
      last_synced_at: args.lastSyncedAt,
    })
    .eq('user_id', args.userId)
    .select('id')
    .single()
  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'updateOutlookDeltaLink' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}

/**
 * Disconnect Outlook. Sets revoked_at and nulls every token + subscription
 * column so the row is preserved (for audit) but can no longer be used.
 */
export async function revokeOutlookCredentials(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DbResult<{ id: string }>> {
  const { data, error } = await asOutlookCredsClient(supabase)
    .from('outlook_credentials')
    .update({
      revoked_at: new Date().toISOString(),
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      access_token_expires_at: null,
      subscription_id: null,
      subscription_client_state: null,
      subscription_expires_at: null,
      delta_link: null,
    })
    .eq('user_id', userId)
    .select('id')
    .single()
  if (error || !data) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'revokeOutlookCredentials' },
    })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data }
}
