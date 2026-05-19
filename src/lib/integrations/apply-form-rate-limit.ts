import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

// Plan 3 Task 3.2 — Postgres-backed rate limiter for the public apply form.
// D2-12: per-IP per-org sliding window (default 5 min / 3 submissions per
// window). Backing table `apply_form_rate_limits` was created by Plan 0
// (migration 20260519092946_apply_form_rate_limits.sql).
//
// IP hashing happens in the caller (the action). We never store raw IPs —
// GDPR; the hash is sha-256 hex.
//
// Service-role caller only. The table has REVOKE all from authenticated /
// anon (Plan 0); the supabase argument is therefore the service-role
// client.
//
// Algorithm (select → insert/update):
//   1. SELECT count FROM (ip_hash, organization_id, window_start). If
//      missing, INSERT count=1 → ALLOWED (this is request #1 in window).
//   2. If present and count >= maxPerWindow, DENY (do NOT bump — DoS
//      avoidance).
//   3. Else INCREMENT count and ALLOW.
//
// PostgREST doesn't expose atomic INCREMENT; the select-then-update is a
// race window. For an MVP apply form (~few req/sec at most) this is fine.
// Phase 5 SaaS scale-up can swap in a SECURITY DEFINER plpgsql function.
//
// Failure mode: fail-OPEN on transient DB errors. We'd rather accept a
// bot's submission than block a legitimate candidate due to a transient
// DB hiccup. Sentry receives the error so we can spot patterns.

export type RateLimitArgs = {
  ipHash: string
  organizationId: string
  windowMinutes?: number
  maxPerWindow?: number
}

export type RateLimitResult = { allowed: boolean }

// Tight ad-hoc shape for the table since the generated Database type
// pre-dates the Plan 0 migration.
type RateLimitTableClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: { count: number } | null
              error: { message?: string } | null
            }>
          }
        }
      }
    }
    insert: (payload: Record<string, unknown>) => Promise<{
      error: { message?: string; code?: string } | null
    }>
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ error: { message?: string } | null }>
        }
      }
    }
  }
}

export async function checkApplyFormRateLimit(
  supabase: SupabaseClient<Database>,
  args: RateLimitArgs,
): Promise<RateLimitResult> {
  const { ipHash, organizationId } = args
  const windowMinutes = args.windowMinutes ?? 5
  const maxPerWindow = args.maxPerWindow ?? 3

  // Align the window bucket so concurrent submissions hit the SAME PK
  // (ip_hash, organization_id, window_start). Without alignment we'd
  // insert N rows instead of bumping one.
  const bucketMs = windowMinutes * 60 * 1000
  const windowStartMs = Math.floor(Date.now() / bucketMs) * bucketMs
  const windowStart = new Date(windowStartMs).toISOString()

  // reason: apply_form_rate_limits is not in the generated Database type
  // (Plan 0 migration shipped after the last regen). Cast to the local
  // shape; the SQL contract is the source of truth.
  const supabaseUntyped = supabase as unknown as RateLimitTableClient

  try {
    // 1. Read existing row for this bucket.
    const read = await supabaseUntyped
      .from('apply_form_rate_limits')
      .select('count')
      .eq('ip_hash', ipHash)
      .eq('organization_id', organizationId)
      .eq('window_start', windowStart)
      .maybeSingle()

    if (read.error) {
      Sentry.captureException(new Error('rate-limit: select failed'), {
        tags: {
          layer: 'integration',
          helper: 'checkApplyFormRateLimit',
          subop: 'select',
        },
      })
      return { allowed: true } // fail-open
    }

    if (!read.data) {
      // First hit in this bucket → INSERT count=1.
      const ins = await supabaseUntyped.from('apply_form_rate_limits').insert({
        ip_hash: ipHash,
        organization_id: organizationId,
        window_start: windowStart,
        count: 1,
      })
      if (ins.error) {
        // A concurrent insert may have raced us (23505). Treat as success —
        // the bucket exists; next call will see count and increment.
        Sentry.addBreadcrumb({
          category: 'rate-limit',
          message: `insert error code=${ins.error.code ?? 'none'}`,
          level: 'info',
        })
      }
      return { allowed: true }
    }

    // 2. Row exists. Check cap.
    const currentCount = read.data.count
    if (currentCount >= maxPerWindow) {
      return { allowed: false }
    }

    // 3. INCREMENT (select-then-update; race-window acceptable for MVP).
    const upd = await supabaseUntyped
      .from('apply_form_rate_limits')
      .update({ count: currentCount + 1 })
      .eq('ip_hash', ipHash)
      .eq('organization_id', organizationId)
      .eq('window_start', windowStart)
    if (upd.error) {
      Sentry.captureException(new Error('rate-limit: update failed'), {
        tags: {
          layer: 'integration',
          helper: 'checkApplyFormRateLimit',
          subop: 'update',
        },
      })
      // fail-open: we already verified the cap; allow this submission.
    }

    return { allowed: true }
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`rate-limit: ${errName}`), {
      tags: {
        layer: 'integration',
        helper: 'checkApplyFormRateLimit',
        subop: 'catch',
      },
    })
    return { allowed: true } // fail-open
  }
}
