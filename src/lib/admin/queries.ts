import 'server-only'

// ---------------------------------------------------------------------------
// src/lib/admin/queries.ts — Super-admin cross-org query helpers.
//
// SECURITY: Every exported function calls requireSuperAdmin() FIRST, before
// calling createServiceClient(). This is the absolute ordering invariant (05-05
// plan Section: Admin gate ordering). Non-super-admins will never reach a
// service-role call in this module.
//
// The service-role client bypasses RLS. Every function in this file is the
// ONLY deliberate cross-tenant read path in the application — reachable ONLY
// after requireSuperAdmin() passes.
//
// PII discipline: surface org names + aggregate numbers only. Never surface
// candidate-level data. Never log PII to Sentry (tags only: org_id, layer).
// ---------------------------------------------------------------------------

import * as Sentry from '@sentry/nextjs'

import { requireSuperAdmin } from '@/lib/admin/guard'
import { createServiceClient } from '@/lib/supabase/service'
import { PLANS } from '@/lib/stripe/plans'
import type { PlanKey } from '@/lib/stripe/plans'
import { formatPence } from '@/lib/format'

// ---------------------------------------------------------------------------
// Local row types — used as cast boundaries while plan_overrides is not yet
// in the generated database.ts (Task 5.3 [BLOCKING] push + type regen removes
// the need for these casts on plan_overrides; subscriptions and ai_usage types
// already exist in database.ts via Wave 0 / Phase 1 schema).
// ---------------------------------------------------------------------------

type OrgRow = {
  id: string
  name: string
  slug: string
}

type SubscriptionRow = {
  organization_id: string
  plan_key: string
  plan_seats: number
  status: string
  trial_end: string | null
  current_period_end: string | null
  stripe_subscription_id: string | null
}

type AiUsageRow = {
  organization_id: string
  purpose: string
  cost_pence: number
  created_at: string
}

type PlanOverrideRow = {
  organization_id: string
  trial_end_override: string | null
  cap_multiplier: number | null
  note: string | null
  updated_by: string | null
  updated_at: string
}

// Cross-org client cast for service-role queries against tables whose TS types
// are either pre-regen (plan_overrides) or require cross-table aggregation
// (ai_usage cross-org). The service-role client bypasses RLS — only reachable
// after requireSuperAdmin() has returned.
//
// reason: using `as unknown as` cast boundary pattern (same as organizations.ts)
// for pre-push table (plan_overrides) + for cross-org usage queries where the
// type inference through PostgREST needs help with OR-clause shapes.
type AdminServiceClient = {
  from: (table: 'organizations') => {
    select: (cols: string) => Promise<{ data: OrgRow[] | null; error: unknown }>
  }
}

// ---------------------------------------------------------------------------
// Month boundary helpers
// ---------------------------------------------------------------------------

// Month boundary is intentionally UTC while display formatting is en-GB local
// (known minor TZ seam — internal admin tool only, no customer-facing impact).
function currentMonthStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

// ---------------------------------------------------------------------------
// OrgBillingOverview — returned per-org in the admin overview list.
// ---------------------------------------------------------------------------

export type OrgBillingOverview = {
  orgId: string
  orgName: string
  orgSlug: string
  planKey: PlanKey | 'none'
  planLabel: string
  status: string
  trialEnd: string | null
  planSeats: number
  activeSeats: number
  monthAiCostPence: number
  monthAiCostFormatted: string
  hasOverride: boolean
  overrideNote: string | null
}

// Wrapper carrying the overview rows plus a flag indicating whether any
// sub-query (subscriptions, ai_usage, seats) errored — so the page can warn
// that displayed figures may be incomplete without blocking the whole table.
export type AllOrgsBillingOverview = {
  rows: OrgBillingOverview[]
  dataIncomplete: boolean
}

// ---------------------------------------------------------------------------
// getAllOrgsBillingOverview — cross-org overview for the admin /admin page.
//
// Fetches all orgs + their subscription state + current-month AI cost.
// Sorted by monthAiCostPence descending (margin-outlier view — founder sees
// the most expensive orgs first).
//
// GATE: requireSuperAdmin() runs first, service-role after.
// ---------------------------------------------------------------------------
export async function getAllOrgsBillingOverview(): Promise<AllOrgsBillingOverview> {
  // GATE — must be first; createServiceClient() must not be called before this.
  await requireSuperAdmin()

  const serviceClient = createServiceClient()

  // Cast to AdminServiceClient for orgs query (basic shape, orgs is in DB types
  // but the generic SupabaseClient doesn't infer select shapes narrowly enough).
  const adminClient = serviceClient as unknown as AdminServiceClient

  // Tracks whether any non-orgs sub-query (subscriptions, ai_usage, seats)
  // errored — surfaced to the page so it can flag incomplete figures.
  let dataIncomplete = false

  // Fetch all organisations.
  const { data: orgsData, error: orgsError } = await adminClient
    .from('organizations')
    .select('id, name, slug')

  if (orgsError) {
    Sentry.captureException(orgsError, {
      tags: { layer: 'admin', helper: 'getAllOrgsBillingOverview' },
    })
    return { rows: [], dataIncomplete: true }
  }
  const orgs: OrgRow[] = orgsData ?? []
  if (orgs.length === 0) return { rows: [], dataIncomplete: false }

  const orgIds = orgs.map((o) => o.id)
  const monthStart = currentMonthStart()

  // Fetch subscriptions for all orgs (service-role bypasses RLS).
  // reason: cross-org; service-role cast boundary.
  const subsClient = serviceClient as unknown as {
    from: (table: 'subscriptions') => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{
          data: SubscriptionRow[] | null
          error: unknown
        }>
      }
    }
  }

  const { data: subsData, error: subsError } = await subsClient
    .from('subscriptions')
    .select(
      'organization_id, plan_key, plan_seats, status, trial_end, current_period_end, stripe_subscription_id',
    )
    .in('organization_id', orgIds)

  if (subsError) {
    dataIncomplete = true
    Sentry.captureException(subsError, {
      tags: { layer: 'admin', helper: 'getAllOrgsBillingOverview.subscriptions' },
    })
  }
  const subs: SubscriptionRow[] = subsData ?? []
  const subByOrg = new Map<string, SubscriptionRow>(subs.map((s) => [s.organization_id, s]))

  // Fetch current-month AI usage (cost_pence) for all orgs.
  // reason: cross-org ai_usage read via service-role.
  const usageClient = serviceClient as unknown as {
    from: (table: 'ai_usage') => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => {
          gte: (col: string, val: string) => Promise<{
            data: AiUsageRow[] | null
            error: unknown
          }>
        }
      }
    }
  }

  const { data: usageData, error: usageError } = await usageClient
    .from('ai_usage')
    .select('organization_id, purpose, cost_pence, created_at')
    .in('organization_id', orgIds)
    .gte('created_at', monthStart)

  if (usageError) {
    dataIncomplete = true
    Sentry.captureException(usageError, {
      tags: { layer: 'admin', helper: 'getAllOrgsBillingOverview.ai_usage' },
    })
  }
  const usageRows: AiUsageRow[] = usageData ?? []

  // Aggregate cost per org.
  const costByOrg = new Map<string, number>()
  for (const row of usageRows) {
    costByOrg.set(row.organization_id, (costByOrg.get(row.organization_id) ?? 0) + row.cost_pence)
  }

  // Fetch plan_overrides (fail-open — table may not exist pre-push).
  // reason: plan_overrides is pre-push (Task 5.3 [BLOCKING]); cast boundary.
  const overridesClient = serviceClient as unknown as {
    from: (table: 'plan_overrides') => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{
          data: PlanOverrideRow[] | null
          error: unknown
        }>
      }
    }
  }

  let overridesByOrg = new Map<string, PlanOverrideRow>()
  const { data: overrideData, error: overrideError } = await overridesClient
    .from('plan_overrides')
    .select('organization_id, trial_end_override, cap_multiplier, note, updated_by, updated_at')
    .in('organization_id', orgIds)

  if (overrideError) {
    // supabase-js returns { error } rather than throwing on PostgREST errors.
    // Only treat "relation does not exist" (42P01) as fail-open — the table is
    // not pushed yet (Task 5.3 [BLOCKING]). Any other error (permissions,
    // transient) must be reported, not silently swallowed.
    const code = (overrideError as { code?: string }).code
    if (code !== '42P01') {
      Sentry.captureException(overrideError, {
        tags: { layer: 'admin', helper: 'getAllOrgsBillingOverview.plan_overrides' },
      })
    }
  } else if (overrideData) {
    overridesByOrg = new Map<string, PlanOverrideRow>(
      overrideData.map((o) => [o.organization_id, o]),
    )
  }

  // Fetch active seat counts for all orgs.
  // reason: cross-org users read via service-role.
  // For seat counts, we fetch the rows and aggregate in JS (Supabase does not
  // support GROUP BY directly via the JS client without a custom RPC).
  const seatsClient = serviceClient as unknown as {
    from: (table: 'users') => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{
          data: { organization_id: string }[] | null
          error: unknown
        }>
      }
    }
  }

  const { data: usersData, error: usersError } = await seatsClient
    .from('users')
    .select('organization_id')
    .in('organization_id', orgIds)

  if (usersError) {
    dataIncomplete = true
    Sentry.captureException(usersError, {
      tags: { layer: 'admin', helper: 'getAllOrgsBillingOverview.seats' },
    })
  }

  const seatsByOrg = new Map<string, number>()
  for (const u of usersData ?? []) {
    seatsByOrg.set(u.organization_id, (seatsByOrg.get(u.organization_id) ?? 0) + 1)
  }

  // Build overview rows.
  const overview: OrgBillingOverview[] = orgs.map((org) => {
    const sub = subByOrg.get(org.id)
    const rawPlanKey = sub?.plan_key ?? 'none'
    const planKey: PlanKey | 'none' = rawPlanKey in PLANS ? (rawPlanKey as PlanKey) : 'none'
    const planLabel = planKey !== 'none' ? PLANS[planKey].label : 'None'
    const monthCost = costByOrg.get(org.id) ?? 0
    const override = overridesByOrg.get(org.id)

    return {
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      planKey,
      planLabel,
      status: sub?.status ?? 'none',
      trialEnd: sub?.trial_end ?? null,
      planSeats: sub?.plan_seats ?? 0,
      activeSeats: seatsByOrg.get(org.id) ?? 0,
      monthAiCostPence: monthCost,
      monthAiCostFormatted: formatPence(monthCost),
      hasOverride: override !== undefined,
      overrideNote: override?.note ?? null,
    }
  })

  // Sort by AI cost descending (margin-outlier view).
  overview.sort((a, b) => b.monthAiCostPence - a.monthAiCostPence)
  return { rows: overview, dataIncomplete }
}

// ---------------------------------------------------------------------------
// OrgAdminDetail — per-org detail for /admin/[orgId].
// ---------------------------------------------------------------------------

export type AiPurposeBreakdown = {
  purpose: string
  callCount: number
  costPence: number
  costFormatted: string
}

export type OrgAdminDetail = {
  orgId: string
  orgName: string
  orgSlug: string
  // Subscription state
  planKey: PlanKey | 'none'
  planLabel: string
  status: string
  trialEnd: string | null
  currentPeriodEnd: string | null
  planSeats: number
  activeSeats: number
  stripeSubscriptionId: string | null
  // AI usage
  monthAiCostPence: number
  monthAiCostFormatted: string
  aiByPurpose: AiPurposeBreakdown[]
  // Override state
  override: {
    trialEndOverride: string | null
    capMultiplier: number | null
    note: string | null
    updatedAt: string | null
  } | null
  // True if any sub-query (subscription, ai_usage, seats, overrides) errored —
  // the org row itself loaded but some figures below may be incomplete.
  dataIncomplete: boolean
}

// ---------------------------------------------------------------------------
// getOrgAdminDetail — full per-org detail for the admin detail page.
//
// GATE: requireSuperAdmin() runs first, service-role after.
// ---------------------------------------------------------------------------
export async function getOrgAdminDetail(orgId: string): Promise<OrgAdminDetail | null> {
  // GATE — must be first.
  await requireSuperAdmin()

  const serviceClient = createServiceClient()

  // Fetch org, subscription, AI usage, and overrides concurrently.
  const orgClient = serviceClient as unknown as {
    from: (table: 'organizations') => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: OrgRow | null; error: unknown }>
        }
      }
    }
  }

  const subDetailClient = serviceClient as unknown as {
    from: (table: 'subscriptions') => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: SubscriptionRow | null; error: unknown }>
        }
      }
    }
  }

  const usageDetailClient = serviceClient as unknown as {
    from: (table: 'ai_usage') => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          gte: (col: string, val: string) => Promise<{
            data: AiUsageRow[] | null
            error: unknown
          }>
        }
      }
    }
  }

  const overrideDetailClient = serviceClient as unknown as {
    from: (table: 'plan_overrides') => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: PlanOverrideRow | null; error: unknown }>
        }
      }
    }
  }

  const seatsDetailClient = serviceClient as unknown as {
    from: (table: 'users') => {
      select: (cols: string) => {
        eq: (col: string, val: string) => Promise<{
          data: { id: string }[] | null
          error: unknown
        }>
      }
    }
  }

  const monthStart = currentMonthStart()

  const [orgResult, subResult, usageResult, seatsResult] = await Promise.all([
    orgClient.from('organizations').select('id, name, slug').eq('id', orgId).maybeSingle(),
    subDetailClient
      .from('subscriptions')
      .select(
        'organization_id, plan_key, plan_seats, status, trial_end, current_period_end, stripe_subscription_id',
      )
      .eq('organization_id', orgId)
      .maybeSingle(),
    usageDetailClient
      .from('ai_usage')
      .select('organization_id, purpose, cost_pence, created_at')
      .eq('organization_id', orgId)
      .gte('created_at', monthStart),
    seatsDetailClient.from('users').select('id').eq('organization_id', orgId),
  ])

  // Tracks whether any sub-query (subscription, ai_usage, seats, overrides)
  // errored — surfaced to the page so it can flag incomplete figures.
  let dataIncomplete = false

  // Fetch override separately (fail-open for pre-push state).
  let overrideRow: PlanOverrideRow | null = null
  const { data: od, error: overrideError } = await overrideDetailClient
    .from('plan_overrides')
    .select('organization_id, trial_end_override, cap_multiplier, note, updated_by, updated_at')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (overrideError) {
    // supabase-js returns { error } rather than throwing on PostgREST errors.
    // Only treat "relation does not exist" (42P01) as fail-open — the table is
    // not pushed yet. Any other error must be reported, not swallowed.
    const code = (overrideError as { code?: string }).code
    if (code !== '42P01') {
      dataIncomplete = true
      Sentry.captureException(overrideError, {
        tags: { layer: 'admin', helper: 'getOrgAdminDetail.plan_overrides', org_id: orgId },
      })
    }
  } else {
    overrideRow = od
  }

  if (orgResult.error || !orgResult.data) {
    if (orgResult.error) {
      Sentry.captureException(orgResult.error, {
        tags: { layer: 'admin', helper: 'getOrgAdminDetail', org_id: orgId },
      })
    }
    return null
  }

  // Capture sub-query errors (org loaded, but these figures may be incomplete).
  if (subResult.error) {
    dataIncomplete = true
    Sentry.captureException(subResult.error, {
      tags: { layer: 'admin', helper: 'getOrgAdminDetail.subscription', org_id: orgId },
    })
  }
  if (usageResult.error) {
    dataIncomplete = true
    Sentry.captureException(usageResult.error, {
      tags: { layer: 'admin', helper: 'getOrgAdminDetail.ai_usage', org_id: orgId },
    })
  }
  if (seatsResult.error) {
    dataIncomplete = true
    Sentry.captureException(seatsResult.error, {
      tags: { layer: 'admin', helper: 'getOrgAdminDetail.seats', org_id: orgId },
    })
  }

  const org = orgResult.data
  const sub = subResult.data ?? null
  const usageRows: AiUsageRow[] = usageResult.data ?? []
  const activeSeats = seatsResult.data?.length ?? 0

  // Aggregate by purpose.
  const byPurpose = new Map<string, { count: number; pence: number }>()
  let totalCost = 0
  for (const row of usageRows) {
    const entry = byPurpose.get(row.purpose) ?? { count: 0, pence: 0 }
    entry.count += 1
    entry.pence += row.cost_pence
    totalCost += row.cost_pence
    byPurpose.set(row.purpose, entry)
  }

  const aiByPurpose: AiPurposeBreakdown[] = Array.from(byPurpose.entries())
    .map(([purpose, v]) => ({
      purpose,
      callCount: v.count,
      costPence: v.pence,
      costFormatted: formatPence(v.pence),
    }))
    .sort((a, b) => b.costPence - a.costPence)

  const rawPlanKey = sub?.plan_key ?? 'none'
  const planKey: PlanKey | 'none' = rawPlanKey in PLANS ? (rawPlanKey as PlanKey) : 'none'

  return {
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    planKey,
    planLabel: planKey !== 'none' ? PLANS[planKey].label : 'None',
    status: sub?.status ?? 'none',
    trialEnd: sub?.trial_end ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    planSeats: sub?.plan_seats ?? 0,
    activeSeats,
    stripeSubscriptionId: sub?.stripe_subscription_id ?? null,
    monthAiCostPence: totalCost,
    monthAiCostFormatted: formatPence(totalCost),
    aiByPurpose,
    override: overrideRow
      ? {
          trialEndOverride: overrideRow.trial_end_override,
          capMultiplier: overrideRow.cap_multiplier,
          note: overrideRow.note,
          updatedAt: overrideRow.updated_at,
        }
      : null,
    dataIncomplete,
  }
}
