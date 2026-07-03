import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { AiUsageAggregate } from '@/types/billing'

// ---------------------------------------------------------------------------
// PURPOSE_CAP_BUCKETS — authoritative mapping from ai_usage.purpose values to
// the AiUsageAggregate / AiCaps bucket keys.
//
// This is the single source of truth. Both cap enforcement (Task 1.4,
// cap-enforcement.ts) and the entitlement helper reuse this map directly.
// Adding a new purpose = add one line here.
//
// Purposes not in this map are ignored for cap purposes (e.g. internal
// diagnostics or one-off admin purposes that should not count against billing).
// ---------------------------------------------------------------------------
export const PURPOSE_CAP_BUCKETS: Record<string, keyof AiUsageAggregate> = {
  cv_parse: 'cvParses',
  match_score: 'matchScores',
  search_query_embed: 'searches',
  spec_transcribe: 'specMinutes',
  ad_generate: 'writingCalls',
  outreach_draft: 'writingCalls',
  dormant_outreach_draft: 'writingCalls',
  jd_extract: 'writingCalls',
  // Handover cost guardrail: these two purposes were previously absent from
  // this map and so bypassed checkCap entirely (the unknown-purpose branch
  // returns allow:true unconditionally). spec_jd_extract = spec-call JD
  // extraction (Sonnet); ad_inclusivity_score = the ad inclusivity scorer
  // (Sonnet, loopable). Both now count + cap under writingCalls.
  spec_jd_extract: 'writingCalls',
  ad_inclusivity_score: 'writingCalls',
  // Phase 4 additions (D4-09 / 04-01-PLAN.md):
  // voice_note_transcribe shares the specMinutes meter with spec_transcribe —
  // both are Whisper audio minutes billed per minute. Resolved in 04-RESEARCH.md Q2.
  voice_note_transcribe: 'specMinutes',
  voice_note_extract: 'writingCalls',
  // campaign_intro_outro: Sonnet call per recipient — can be large for big campaigns
  campaign_intro_outro: 'writingCalls',
  nl_template_match: 'writingCalls',
}

// ---------------------------------------------------------------------------
// getAiUsageThisMonth — aggregates the current calendar month's ai_usage rows
// for a given org, grouped by purpose, and maps them into AiUsageAggregate.
//
// Mirrors the month-to-date aggregation pattern from:
//   src/lib/db/ai-summaries.ts → getOrgMatchSpendThisMonth
//   src/app/(app)/settings/usage/page.tsx → byPurpose Map
//
// Uses the COUNT per purpose (not cost_pence) because the plan caps are unit
// counts (e.g. 800 match_score calls/month × seats), not £ amounts.
//
// The passed client can be either the RLS-scoped client (entitlement in a
// server action/route) or the service-role client (Inngest cap check).
// Both are safe — ai_usage rows are naturally tenant-scoped by organisation_id
// at insert time (via record_ai_usage RPC which stamps org from session context).
// ---------------------------------------------------------------------------

type AiUsageRow = {
  purpose: string
  cost_pence: number
  created_at: string
  // Whisper stores audio SECONDS here; other purposes store real token counts.
  input_tokens: number
}

type PurposeAggregateRow = {
  purpose: string
  call_count: number
  input_tokens_sum: number
}

function emptyAggregate(): AiUsageAggregate {
  return { matchScores: 0, cvParses: 0, searches: 0, specMinutes: 0, writingCalls: 0 }
}

// Fold per-purpose (count, input_tokens) pairs into the bucket aggregate.
// specMinutes is derived from audio SECONDS (Whisper's input_tokens), NOT the
// call-row count, so a 60-minute recording counts as 60 minutes not 1 call
// (audit min-17/21). All other buckets count call rows.
function foldByPurpose(
  entries: ReadonlyArray<{ purpose: string; count: number; inputTokens: number }>,
): AiUsageAggregate {
  const aggregate = emptyAggregate()
  let specSeconds = 0
  for (const e of entries) {
    const bucket = PURPOSE_CAP_BUCKETS[e.purpose]
    if (!bucket) continue
    if (bucket === 'specMinutes') {
      specSeconds += e.inputTokens
    } else {
      aggregate[bucket] += e.count
    }
  }
  aggregate.specMinutes = Math.ceil(specSeconds / 60)
  return aggregate
}

export async function getAiUsageThisMonth(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<AiUsageAggregate> {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  // Prefer the server-side aggregate RPC (audit MAJOR-2). A client-side row
  // scan is silently truncated at PostgREST max_rows (1000), so a busy org's
  // bucket counts plateau at 1000 and caps above that become unenforceable.
  // The RPC groups in the DB with no row cap. It is service_role-only, so on the
  // RLS/display path (permission denied) or before this migration is applied in
  // an environment, we fall through to the scoped row scan below.
  // reason: the RPC name isn't in the narrow generated overloads for every
  // client generic; cast to the exact call shape.
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: 'ai_usage_month_by_purpose',
      args: { p_organization_id: string },
    ) => Promise<{ data: PurposeAggregateRow[] | null; error: unknown }>
  }
  try {
    const { data, error } = await rpcClient.rpc('ai_usage_month_by_purpose', {
      p_organization_id: orgId,
    })
    if (!error && data) {
      return foldByPurpose(
        data.map((r) => ({
          purpose: r.purpose,
          count: Number(r.call_count) || 0,
          inputTokens: Number(r.input_tokens_sum) || 0,
        })),
      )
    }
  } catch {
    // RPC unavailable (not yet applied) or permission-denied on the RLS path —
    // fall through to the row scan.
  }

  // Fallback: client-side scan. May truncate at 1000 rows for the RLS/display
  // path (the enforcement path in checkCap uses the service-role RPC above), but
  // still applies the specMinutes-as-minutes fix.
  // reason: ai_usage is in the generated schema but the TS inference through
  // PostgREST is narrow on the select shape. The cast keeps this helper
  // compatible with both the RLS client and the service-role client.
  const usageClient = supabase as unknown as {
    from: (table: 'ai_usage') => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          gte: (col: string, val: string) => Promise<{ data: AiUsageRow[] | null; error: unknown }>
        }
      }
    }
  }

  const { data, error } = await usageClient
    .from('ai_usage')
    .select('purpose, cost_pence, created_at, input_tokens')
    .eq('organization_id', orgId)
    .gte('created_at', monthStart)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getAiUsageThisMonth', organization_id: orgId },
    })
    // Fail open — return zero usage rather than blocking the entire AI stack.
    return emptyAggregate()
  }

  const rows: AiUsageRow[] = data ?? []

  return foldByPurpose(
    rows.map((r) => ({
      purpose: r.purpose,
      count: 1,
      inputTokens: Number(r.input_tokens) || 0,
    })),
  )
}
