import 'server-only'

// Handover cost guardrail — per-org monthly AI-spend ceiling.
//
// A hard backstop on an org's TOTAL month-to-date AI spend (sum of
// ai_usage.cost_pence across ALL purposes). Enforced in checkCap
// (cap-enforcement.ts) for every capped Claude call, so a comped org — whose
// AI the founder personally pays for on shared keys — cannot run unbounded
// cost. The per-org cap (plan_overrides.monthly_spend_cap_pence) is
// authoritative and takes precedence; a generous global env backstop applies
// when no per-org cap is set.
//
// CEILING SEMANTICS (kept unambiguous after review finding ceiling-1):
//   per-org cap = null  → no per-org cap; global backstop applies
//   per-org cap = 0      → ENFORCED: a £0 ceiling, i.e. block all AI (a freeze)
//   per-org cap = N > 0  → ENFORCED: hard ceiling of N pence
//   global env = 0       → global backstop disabled
// "0 disables" is true ONLY for the global env var, never for an explicit
// per-org cap.
//
// Every reader FAILS OPEN: a billing/DB glitch (or a pre-push schema) must
// never block the AI stack. The cost of a missed ceiling is bounded by the
// generous global default; the cost of failing closed is a broken product.

import * as Sentry from '@sentry/nextjs'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

// Sum of ai_usage.cost_pence for the org since the start of the current UTC
// month (all purposes). Computed SERVER-SIDE via the
// org_ai_spend_pence_this_month RPC (migration 20260624000300) so a busy/runaway
// org's spend is never truncated by the PostgREST row cap (config.toml sets
// max_rows = 1000) — a client-side row sum would silently under-count and fail
// the ceiling open, exactly the case it exists to catch (review finding ceiling-2).
export async function getOrgAiSpendThisMonthPence(orgId: string): Promise<number> {
  const supabase = createServiceClient()
  // org_ai_spend_pence_this_month is not in the generated RPC types until
  // db:types is regenerated post-push. Cast at the call boundary.
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: 'org_ai_spend_pence_this_month',
      args: { p_organization_id: string },
    ) => Promise<{ data: number | string | null; error: unknown }>
  }

  const { data, error } = await rpcClient.rpc('org_ai_spend_pence_this_month', {
    p_organization_id: orgId,
  })

  if (error) throw error
  // bigint is serialised as a string by PostgREST; Number() coerces both forms.
  return Number(data ?? 0)
}

// Per-org spend cap from plan_overrides (null = none / table-or-column absent).
async function getOrgSpendCapOverridePence(orgId: string): Promise<number | null> {
  const supabase = createServiceClient()
  // plan_overrides + monthly_spend_cap_pence are not in the generated types
  // until db:types is regenerated post-push. Same cast boundary as entitlement.ts.
  const overrideClient = supabase as unknown as {
    from: (table: 'plan_overrides') => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          maybeSingle: () => Promise<{
            data: { monthly_spend_cap_pence: number | null } | null
            error: unknown
          }>
        }
      }
    }
  }

  const { data, error } = await overrideClient
    .from('plan_overrides')
    .select('monthly_spend_cap_pence')
    .eq('organization_id', orgId)
    .maybeSingle()

  // Fail open: if the column/table doesn't exist yet (pre-push), treat as no cap.
  if (error) return null
  return data?.monthly_spend_cap_pence ?? null
}

// Effective ceiling in pence, or null when no ceiling is configured.
// A per-org cap (including an explicit 0) is authoritative and always enforced;
// it never raises the ceiling above the global backstop. With no per-org cap,
// the global env backstop applies (global 0 = disabled → null).
export async function getEffectiveSpendCeilingPence(orgId: string): Promise<number | null> {
  const perOrg = await getOrgSpendCapOverridePence(orgId)
  const globalBackstop = env.MAX_MONTHLY_AI_SPEND_PENCE

  if (perOrg != null && perOrg >= 0) {
    // Per-org cap wins. If a global backstop is also set, never allow more than
    // the lower of the two. A per-org 0 stays 0 (freeze).
    return globalBackstop > 0 ? Math.min(perOrg, globalBackstop) : perOrg
  }

  return globalBackstop > 0 ? globalBackstop : null
}

// True when the org has reached/exceeded its effective monthly AI-spend ceiling.
// FAILS OPEN (false) on any error.
export async function isOverMonthlyAiSpendCeiling(orgId: string): Promise<boolean> {
  try {
    const ceiling = await getEffectiveSpendCeilingPence(orgId)
    if (ceiling === null) return false // no ceiling configured
    const spent = await getOrgAiSpendThisMonthPence(orgId)
    return spent >= ceiling // a 0 ceiling blocks all AI (spent >= 0)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'billing', helper: 'isOverMonthlyAiSpendCeiling', organization_id: orgId },
    })
    return false
  }
}
