import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Quick task 260524-cwd — REPORT-02 (buyer-value dashboards).
//
// Typed helpers for the four net-new RPCs added by
// `20260524000200_buyer_value_rpcs.sql`:
//   * placements_by_recruiter_quarter    → getPlacementsByRecruiterQuarter
//   * time_to_fill_by_sector              → getTimeToFillBySector
//   * pipeline_value_sparkline             → getPipelineValueSparkline
//   * commission_summary_by_recruiter     → getCommissionSummary
//
// Source ROI on the same page REUSES the existing `getSourceAttribution`
// helper — do not add a wrapper here.
//
// Tenant isolation: every RPC runs `security invoker`; the underlying RLS on
// applications/jobs/users decides what rows the caller sees. These helpers
// must use the cookie-bound server SSR client (NOT the service role) — they
// import `'server-only'` to make accidental client-side use a build error.
//
// `.rpc.call(supabase, ...)` cast pattern: the generated `Database` type lags
// the migration inside the executor's working copy until the orchestrator
// runs `pnpm db:types` post-push. Cast at the boundary instead of waiting on
// regenerated types. Also: bare `supabase.rpc` loses its `this` binding —
// always invoke via `.call(supabase, ...)` to preserve it. Pattern lifted
// from `source-attribution.ts` lines 48-62.
// ---------------------------------------------------------------------------

export type PlacementsByRecruiterQuarterRow = {
  quarter: string
  recruiter_id: string
  recruiter_name: string
  placements_count: number
}

export type TimeToFillBySectorRow = {
  sector: string
  median_days: number
  p90_days: number
  placements_count: number
}

export type PipelineValueSparklineRow = {
  bucket_date: string
  pipeline_value_pence: number
}

export type CommissionSummaryRow = {
  recruiter_id: string
  recruiter_name: string
  placements_count: number
  total_fee_pence: number
  estimated_commission_pence: number
}

export type BuyerValueRangeArgs = {
  from: string
  to: string
}

// Shared internal: cast `supabase.rpc` at the boundary while preserving
// `this` binding via `.call(supabase, ...)`. Returns a discriminated DbResult
// after Sentry-tagging any error with the helper name.
//
// reason: the new RPCs landed in 20260524000200_buyer_value_rpcs.sql but the
// generated Database types do not yet include them in the executor's working
// copy (the orchestrator regenerates types post-push). Casting at the boundary
// keeps the rest of the codebase strict.
async function callRpc<TRow>(
  supabase: SupabaseClient<Database>,
  fn: string,
  args: { p_from: string; p_to: string },
  helper: string,
): Promise<DbResult<TRow[]>> {
  // reason: untyped rpc surface (see file-header note).
  const { data, error } = (await (
    supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: TRow[] | null; error: unknown }>
  ).call(supabase, fn, args)) as { data: TRow[] | null; error: unknown }

  if (error) {
    Sentry.captureException(error, {
      tags: {
        phase: 'quick-260524-cwd',
        layer: 'db',
        helper,
      },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: data ?? [] }
}

/**
 * Fetch placement counts grouped by (quarter, recruiter) over the date range.
 *
 * Tenant isolation: enforced by `security invoker` on the RPC + RLS on
 * `applications` / `users`.
 */
export async function getPlacementsByRecruiterQuarter(
  supabase: SupabaseClient<Database>,
  args: BuyerValueRangeArgs,
): Promise<DbResult<PlacementsByRecruiterQuarterRow[]>> {
  return callRpc<PlacementsByRecruiterQuarterRow>(
    supabase,
    'placements_by_recruiter_quarter',
    { p_from: args.from, p_to: args.to },
    'getPlacementsByRecruiterQuarter',
  )
}

/**
 * Fetch median + p90 time-to-fill per sector over the date range. v1 always
 * returns a single 'Unspecified' bucket because `jobs` has no sector column.
 */
export async function getTimeToFillBySector(
  supabase: SupabaseClient<Database>,
  args: BuyerValueRangeArgs,
): Promise<DbResult<TimeToFillBySectorRow[]>> {
  return callRpc<TimeToFillBySectorRow>(
    supabase,
    'time_to_fill_by_sector',
    { p_from: args.from, p_to: args.to },
    'getTimeToFillBySector',
  )
}

/**
 * Fetch a daily pipeline-value series across the date range. Last row gives
 * the current pipeline value for the headline big number — reuse it instead
 * of a second RPC call.
 */
export async function getPipelineValueSparkline(
  supabase: SupabaseClient<Database>,
  args: BuyerValueRangeArgs,
): Promise<DbResult<PipelineValueSparklineRow[]>> {
  return callRpc<PipelineValueSparklineRow>(
    supabase,
    'pipeline_value_sparkline',
    { p_from: args.from, p_to: args.to },
    'getPipelineValueSparkline',
  )
}

/**
 * Fetch per-recruiter commission summary (GBP placements only) over the
 * date range. Commission rate is a 20% placeholder until per-recruiter rates
 * land in the schema.
 */
export async function getCommissionSummary(
  supabase: SupabaseClient<Database>,
  args: BuyerValueRangeArgs,
): Promise<DbResult<CommissionSummaryRow[]>> {
  return callRpc<CommissionSummaryRow>(
    supabase,
    'commission_summary_by_recruiter',
    { p_from: args.from, p_to: args.to },
    'getCommissionSummary',
  )
}

/**
 * Pivot the long-format `placements_by_recruiter_quarter` rows into the wide
 * `{ quarter, [recruiterName]: count }` shape Recharts' stacked BarChart
 * expects. Zero-fills missing (quarter, recruiter) cells so the stack renders
 * cleanly when a recruiter has no placements in a given quarter.
 *
 * Quarter label format: `YYYY-Q#` derived from the RPC's quarter-start date
 * (e.g. `2026-01-01` → `2026-Q1`).
 *
 * `recruiters` is sorted alphabetically so colour assignment is stable across
 * navigations within the same window.
 */
export function pivotRecruiterQuarters(
  rows: PlacementsByRecruiterQuarterRow[],
): {
  data: Array<{ quarter: string } & Record<string, string | number>>
  recruiters: string[]
} {
  const recruiterSet = new Set<string>()
  for (const r of rows) recruiterSet.add(r.recruiter_name)
  const recruiters = Array.from(recruiterSet).sort((a, b) => a.localeCompare(b))

  const byQuarter = new Map<string, { quarter: string } & Record<string, string | number>>()
  for (const r of rows) {
    const label = quarterLabel(r.quarter)
    let bucket = byQuarter.get(label)
    if (!bucket) {
      bucket = { quarter: label }
      byQuarter.set(label, bucket)
    }
    bucket[r.recruiter_name] = r.placements_count
  }

  for (const bucket of byQuarter.values()) {
    for (const name of recruiters) {
      if (!(name in bucket)) bucket[name] = 0
    }
  }

  const data = Array.from(byQuarter.values()).sort((a, b) =>
    a.quarter.localeCompare(b.quarter),
  )

  return { data, recruiters }
}

function quarterLabel(ymd: string): string {
  // RPC returns YYYY-MM-DD quarter-start. month is 1-12 → q is 1-4.
  const parts = ymd.split('-')
  const year = parts[0] ?? '????'
  const monthStr = parts[1] ?? '01'
  const month = Number.parseInt(monthStr, 10)
  const safeMonth = Number.isFinite(month) ? month : 1
  const quarter = Math.floor((safeMonth - 1) / 3) + 1
  return `${year}-Q${quarter}`
}
