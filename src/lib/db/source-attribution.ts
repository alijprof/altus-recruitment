import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Plan 03-06 / Task F.2 — REPEAT-02 (D3-22).
//
// Thin wrapper over the `source_attribution_summary(p_from, p_to)` RPC.
// The RPC runs `security invoker`, so org isolation is enforced by RLS on
// `applications` + `candidates` — the helper does NOT filter by
// organization_id (and doing so would violate the Conventions rule
// "application-level org filters are for performance hints, not security").
//
// The helper threads supplied { from, to } strings directly through as the
// RPC's p_from / p_to date arguments. Date parsing happens server-side via
// PostgREST / Postgres — keeping the contract string-based here keeps the
// page (`/reports/source-attribution`) free to pass URL searchParams
// verbatim without owning Date->ISO serialization.
// ---------------------------------------------------------------------------

export type SourceAttributionRow = {
  source: Database['public']['Enums']['candidate_source']
  placements_count: number
  total_fee_pence: number
  avg_time_to_place_days: number
}

export type GetSourceAttributionArgs = {
  from: string
  to: string
}

/**
 * Fetch placement aggregates per `candidates.source` for the date range.
 *
 * Tenant isolation: enforced by `security invoker` on the underlying
 * Postgres function — never appended client-side.
 */
export async function getSourceAttribution(
  supabase: SupabaseClient<Database>,
  args: GetSourceAttributionArgs,
): Promise<DbResult<SourceAttributionRow[]>> {
  // reason: the source_attribution_summary RPC is added by Plan 03-06's
  // migration; the generated Database type may not include it yet. Cast at
  // the boundary — RLS on applications + candidates still enforces
  // correctness server-side regardless of the call-site shape.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: SourceAttributionRow[] | null; error: unknown }>

  const { data, error } = await rpc('source_attribution_summary', {
    p_from: args.from,
    p_to: args.to,
  })

  if (error) {
    Sentry.captureException(error, {
      tags: {
        phase: 'p3',
        layer: 'db',
        helper: 'getSourceAttribution',
      },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: data ?? [] }
}
