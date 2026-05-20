import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import type { DbResult } from './types'

// ---------------------------------------------------------------------------
// Plan 03-05 / Task E.1 — REPEAT-01.
//
// Thin wrapper over the `dormant_clients` RPC (D3-19). The RPC runs
// `security invoker` so org isolation is handled by RLS on the underlying
// tables — this helper does NOT filter by organization_id (and doing so would
// be a Conventions violation: "Application-level org filters are for
// performance hints, not security").
//
// Defaults (from D3-19):
//   - dormantDays: 60
//   - longDormantDays: 90
// ---------------------------------------------------------------------------

const DEFAULT_DORMANT_DAYS = 60
const DEFAULT_LONG_DORMANT_DAYS = 90

export type DormantClient = {
  client_id: string
  client_name: string
  last_contacted_at: string
  days_since: number
  is_long_dormant: boolean
  last_placement_summary: string | null
}

export type GetDormantClientsOpts = {
  dormantDays?: number
  longDormantDays?: number
}

/**
 * Fetch the dormant-clients list for the dashboard widget + /clients badge.
 *
 * Tenant isolation: enforced by `security invoker` on the `dormant_clients`
 * Postgres function — never appended client-side.
 */
export async function getDormantClients(
  supabase: SupabaseClient<Database>,
  opts: GetDormantClientsOpts = {},
): Promise<DbResult<DormantClient[]>> {
  // reason: the dormant_clients RPC is added by Plan 03-05's migration; the
  // generated Database type may not include it yet. Cast at the boundary —
  // RLS on companies/applications/jobs still enforces correctness server-side.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: DormantClient[] | null; error: unknown }>

  const { data, error } = await rpc('dormant_clients', {
    p_dormant_days: opts.dormantDays ?? DEFAULT_DORMANT_DAYS,
    p_long_dormant_days: opts.longDormantDays ?? DEFAULT_LONG_DORMANT_DAYS,
  })

  if (error) {
    Sentry.captureException(error, {
      tags: {
        phase: 'p3',
        layer: 'db',
        helper: 'getDormantClients',
      },
    })
    return { ok: false, code: 'internal' }
  }

  return { ok: true, data: data ?? [] }
}
