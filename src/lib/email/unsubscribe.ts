// PECR one-click unsubscribe helpers — Quick task 260612-0f4.
//
// Exports:
//   generateUnsubscribeToken — per-recipient unguessable token (randomBytes >=32, base64url)
//   buildUnsubscribeUrl      — SINGLE source-of-truth for the unsubscribe URL
//   maskEmail                — show enough of the address to recognise it without exposing PII
//   suppressByToken          — durable suppression write; idempotent, never throws
//
// SECURITY: this module is server-only. The token is the entire auth factor for
// the unsubscribe route — never log it, never send it to Sentry.

import 'server-only'

import { randomBytes } from 'node:crypto'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// generateUnsubscribeToken
// ---------------------------------------------------------------------------

/**
 * Generate a per-recipient unguessable token for the unsubscribe URL.
 * Uses node:crypto randomBytes(32) → base64url (no padding, no +//) for ~256 bits entropy.
 * NEVER use Math.random, Date.now, or a candidate UUID — all are explicitly forbidden.
 */
export function generateUnsubscribeToken(): string {
  return randomBytes(32).toString('base64url')
}

// ---------------------------------------------------------------------------
// buildUnsubscribeUrl
// ---------------------------------------------------------------------------

const FALLBACK_BASE = 'https://altusrecruit.com'

/**
 * Build the canonical https unsubscribe URL for a recipient token.
 *
 * This is the SINGLE source of truth for the URL shape. Both the email footer
 * link AND the List-Unsubscribe header call this with the SAME token, so the
 * header URL is byte-for-byte equal to the POST endpoint URL (RFC 8058 one-click
 * requirement).
 *
 * The token path segment is passed through encodeURIComponent as an open-redirect
 * / path-escape guard. Our generator always produces URL-safe chars, but this
 * defence-in-depth prevents a crafted token from escaping the path or injecting
 * query params (T-0f4-REDIRECT).
 *
 * @param token     The per-recipient token from generateUnsubscribeToken()
 * @param baseUrl   env.NEXT_PUBLIC_SITE_URL (optional — falls back to altusrecruit.com)
 */
export function buildUnsubscribeUrl(token: string, baseUrl: string | undefined): string {
  const base = (baseUrl ?? '').trim().replace(/\/$/, '') || FALLBACK_BASE
  return `${base}/unsubscribe/${encodeURIComponent(token)}`
}

// ---------------------------------------------------------------------------
// maskEmail
// ---------------------------------------------------------------------------

/**
 * Mask an email address for display on the unsubscribe confirm page.
 * Shows only the first and last character of the local part, rest asterisks.
 * The domain is shown intact so the recipient can recognise which address.
 *
 * Examples:
 *   'alasdairj8@gmail.com' → 'a*********8@gmail.com'
 *   'aj@example.com'       → 'a*j@example.com'
 *   'a@example.com'        → 'a***@example.com'
 *   'notanemail'           → 'n***l' (no-@ fallback, no throw)
 *   ''                     → '' (empty, no throw)
 *
 * PII discipline: never call with the full email in a Sentry tag or log line.
 */
export function maskEmail(email: string): string {
  if (!email) return ''

  const atIdx = email.indexOf('@')
  if (atIdx === -1) {
    // No @ — mask the whole string, keep first + last, pad with stars.
    if (email.length <= 1) return email
    return email[0] + '***' + email[email.length - 1]
  }

  const local = email.slice(0, atIdx)
  const domain = email.slice(atIdx) // includes the '@'

  if (local.length <= 1) {
    // Single char local — show the char and add stars for visual consistency.
    return (local[0] ?? '') + '***' + domain
  }

  if (local.length === 2) {
    // Two-char local — show both chars.
    return local[0] + '*' + local[1] + domain
  }

  // Normal case: first char + stars + last char.
  const stars = '*'.repeat(local.length - 2)
  return local[0] + stars + local[local.length - 1] + domain
}

// ---------------------------------------------------------------------------
// suppressByToken — durable suppression write
// ---------------------------------------------------------------------------

export type SuppressResult = { ok: true; alreadyUnsubscribed: boolean } | { ok: false }

// Narrowed table shape for the as-unknown-as escape hatch.
// email_campaign_recipients gains unsubscribe_token in migration 20260612000000
// but the generated Database type pre-dates the regen (Task 4 blocking checkpoint).
// candidates gains email_marketing_unsubscribed_at in the same migration.
// Both columns are referenced here via the escape hatch so typecheck passes
// before Task 4 runs the regen.
type RecipientTokenRow = {
  candidate_id: string
  organization_id: string
  email: string | null
}

type CandidateSuppressionRow = {
  email_marketing_unsubscribed_at: string | null
}

type SuppressionClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: RecipientTokenRow | null
          error: { message?: string } | null
        }>
      }
    }
    // Used for candidates fresh-read
  }
} & SupabaseClient<Database>

/**
 * Durably suppress a candidate from all future campaign emails by token.
 *
 * 1. Look up email_campaign_recipients by unsubscribe_token (indexed read).
 * 2. Re-read the candidate's current email_marketing_unsubscribed_at.
 * 3. If already set: return ok:true alreadyUnsubscribed:true (idempotent — T-0f4-IDEMPOTENT).
 * 4. Otherwise: set email_marketing_unsubscribed_at = now(), org-scoped (T-0f4-XTENANT).
 * 5. On ANY error: return ok:false — NEVER throw (callers must not distinguish
 *    "token not found" from "DB error" — both map to the same generic confirm page copy).
 *
 * Sentry tags are fixed strings only (layer/helper/subop) — never email or token (T-0f4-PII).
 *
 * Caller MUST await this to completion before returning the 2xx response (RFC 8058).
 */
export async function suppressByToken(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<SuppressResult> {
  try {
    // Step 1: look up recipient by token (single indexed read).
    // reason: unsubscribe_token column not yet in generated Database type (added by
    // migration 20260612000000, regenerated in Task 4). Cast to narrowed shape.
    const sb = supabase as unknown as {
      from: (table: 'email_campaign_recipients') => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: RecipientTokenRow | null
              error: { message?: string } | null
            }>
          }
        }
      }
    }

    const { data: recipient, error: recipientErr } = await sb
      .from('email_campaign_recipients')
      .select('candidate_id, organization_id, email')
      .eq('unsubscribe_token', token)
      .maybeSingle()

    if (recipientErr) {
      Sentry.captureException(new Error('suppressByToken: recipient lookup failed'), {
        tags: { layer: 'email', helper: 'suppressByToken', subop: 'lookup' },
      })
      return { ok: false }
    }

    if (!recipient) {
      // Unknown token — not found. Return ok:false so caller renders constant
      // generic copy. Do NOT distinguish "not found" from "DB error" (T-0f4-ENUM).
      return { ok: false }
    }

    // Step 2: re-read the candidate's current suppression flag to support idempotency.
    // reason: email_marketing_unsubscribed_at not yet in generated Database type.
    const sbCand = supabase as unknown as {
      from: (table: 'candidates') => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{
                data: CandidateSuppressionRow | null
                error: { message?: string } | null
              }>
            }
          }
        }
        update: (patch: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: { message?: string } | null }>
          }
        }
      }
    }

    const { data: candidateCurrent, error: candidateReadErr } = await sbCand
      .from('candidates')
      .select('email_marketing_unsubscribed_at')
      .eq('id', recipient.candidate_id)
      .eq('organization_id', recipient.organization_id)
      .maybeSingle()

    if (candidateReadErr) {
      Sentry.captureException(new Error('suppressByToken: candidate read failed'), {
        tags: { layer: 'email', helper: 'suppressByToken', subop: 'candidate_read' },
      })
      return { ok: false }
    }

    // Step 3: idempotency — if already suppressed, skip the write.
    if (candidateCurrent?.email_marketing_unsubscribed_at != null) {
      return { ok: true, alreadyUnsubscribed: true }
    }

    // Step 4: set suppression timestamp (org-scoped — T-0f4-XTENANT).
    const { error: updateErr } = await sbCand
      .from('candidates')
      .update({
        email_marketing_unsubscribed_at: new Date().toISOString(),
      } as unknown as Record<string, unknown>)
      .eq('id', recipient.candidate_id)
      .eq('organization_id', recipient.organization_id)

    if (updateErr) {
      Sentry.captureException(new Error('suppressByToken: suppression update failed'), {
        tags: { layer: 'email', helper: 'suppressByToken', subop: 'update' },
      })
      return { ok: false }
    }

    return { ok: true, alreadyUnsubscribed: false }
  } catch (err) {
    // Catch-all: suppressByToken MUST NEVER throw (callers rely on this contract).
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`suppressByToken: unexpected catch (${errName})`), {
      tags: { layer: 'email', helper: 'suppressByToken', subop: 'catch' },
    })
    return { ok: false }
  }
}
