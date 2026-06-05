// Billing settings page — 05-01 Task 1.3
//
// Owner-only. Shows:
//   - Current plan (label, price), status (trialing/active/past_due/cancelled),
//     trial end or next renewal date
//   - Seat usage: active vs allowed
//   - AI cap usage per bucket vs effective cap (progress bars)
//
// Actions:
//   - "Manage billing" button → POST /api/stripe/portal → redirect to URL
//   - "Choose a plan" link → /pricing (when status is 'none')
//
// Graceful degradation: when Stripe env is absent, shows "Billing not
// configured" notice rather than crashing.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'
import { getEntitlement } from '@/lib/stripe/entitlement'
import { PLANS, type PlanKey } from '@/lib/stripe/plans'
import { stripe } from '@/lib/stripe/client'
import type { SubscriptionStatus } from '@/types/billing'

import { ManageBillingButton } from './manage-billing-button'
import { StartCheckoutButton } from './start-checkout-button'

// ---- Helpers ----------------------------------------------------------------

function statusLabel(status: SubscriptionStatus): string {
  const labels: Record<SubscriptionStatus, string> = {
    trialing: 'Trial',
    active: 'Active',
    past_due: 'Payment overdue',
    cancelled: 'Cancelled',
    none: 'No subscription',
  }
  return labels[status] ?? status
}

function statusVariant(
  status: SubscriptionStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active' || status === 'trialing') return 'default'
  if (status === 'past_due') return 'destructive'
  return 'secondary'
}

function formatPenceGbp(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100)
}

// Format an ISO date string as a UK-locale date, or null if absent/invalid.
function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const CAP_LABELS: Record<string, string> = {
  matchScores: 'Match scoring',
  cvParses: 'CV parsing',
  searches: 'Semantic search',
  specMinutes: 'Spec call minutes',
  writingCalls: 'AI writing',
}

// ---- Page -------------------------------------------------------------------

export default async function BillingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) redirect('/sign-in')

  // Owner-only.
  if (profile.data.role !== 'owner') {
    redirect('/settings')
  }

  const stripeConfigured = !!stripe

  // Get entitlement — graceful even without Stripe configured.
  const entitlement = await getEntitlement(profile.data.organization_id, supabase)

  const planDetails =
    entitlement.planKey !== 'none' ? PLANS[entitlement.planKey] : PLANS.pro

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm"
        >
          <ChevronLeft className="mr-1 size-4" />
          Back to settings
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Manage your plan, view usage, and update payment details.
        </p>
      </header>

      {/* Stripe not configured notice */}
      {!stripeConfigured && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-amber-900">
              Billing not configured
            </CardTitle>
            <CardDescription className="text-amber-800">
              Stripe environment variables are not set. Billing is unavailable until{' '}
              <code>STRIPE_SECRET_KEY</code> is configured.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Plan summary card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold">
                {entitlement.planKey !== 'none' ? planDetails.label : 'No active plan'}
              </CardTitle>
              <CardDescription>
                {entitlement.planKey !== 'none'
                  ? `${formatPenceGbp(planDetails.pricePence)} / seat / month`
                  : 'Start a subscription to unlock full access'}
              </CardDescription>
            </div>
            <Badge variant={statusVariant(entitlement.status)}>
              {statusLabel(entitlement.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {entitlement.status === 'trialing' && (
            <p className="text-muted-foreground text-sm">
              Trial ends:{' '}
              <span className="text-foreground font-medium">
                {formatDate(entitlement.trialEnd) ?? 'soon'}
              </span>
            </p>
          )}

          <Separator />

          {/* Seat usage */}
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Seats used</span>
              <span className="tabular-nums">
                {entitlement.activeSeats} / {entitlement.planSeats}
              </span>
            </div>
            <Progress
              value={Math.min(100, Math.round((entitlement.activeSeats / Math.max(1, entitlement.planSeats)) * 100))}
              aria-label="seat usage"
            />
          </div>

          <Separator />

          {/* Actions */}
          <div className="pt-1">
            {stripeConfigured && entitlement.status !== 'none' ? (
              <ManageBillingButton />
            ) : stripeConfigured && entitlement.status === 'none' ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  {(['starter', 'pro', 'scale'] as const).map((key: PlanKey) => {
                    const plan = PLANS[key]
                    return (
                      <div key={key} className="rounded-md border p-3 space-y-2">
                        <div>
                          <p className="text-sm font-semibold">{plan.label}</p>
                          <p className="text-muted-foreground text-xs">
                            {formatPenceGbp(plan.pricePence)} / seat / month
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {key === 'scale' ? 'Unlimited seats' : `Up to ${plan.seats} seats`}
                          </p>
                        </div>
                        <StartCheckoutButton planKey={key} label="Start 14-day trial" />
                      </div>
                    )
                  })}
                </div>
                <Link
                  href="/pricing"
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  Compare all plans
                </Link>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* AI usage caps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">AI usage this month</CardTitle>
          <CardDescription>
            Effective limits are per-seat × seats. Soft cap at 80%, hard behaviour at 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(Object.keys(CAP_LABELS) as Array<keyof typeof CAP_LABELS>).map((bucket) => {
            const used = entitlement.aiUsageThisMonth[bucket as keyof typeof entitlement.aiUsageThisMonth]
            const cap = entitlement.aiCaps[bucket as keyof typeof entitlement.aiCaps]
            const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0
            const atHard = cap > 0 && used >= cap
            const atSoft = !atHard && cap > 0 && used / cap >= 0.8

            return (
              <div key={bucket} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>
                    {CAP_LABELS[bucket]}{' '}
                    {atHard && (
                      <span className="ml-1 text-destructive font-medium text-xs">at limit</span>
                    )}
                    {atSoft && !atHard && (
                      <span className="ml-1 text-amber-600 font-medium text-xs">near limit</span>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {used} / {cap}
                  </span>
                </div>
                <Progress
                  value={pct}
                  aria-label={`${CAP_LABELS[bucket]} usage`}
                  className={atHard ? '[&>div]:bg-destructive' : atSoft ? '[&>div]:bg-amber-500' : ''}
                />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Overage note */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">About overages</CardTitle>
          <CardDescription>
            When a cap is reached, AI features degrade gracefully: match scoring falls back to
            cached results, CV parsing queues for overnight processing. Overages are tracked and
            reflected in future billing cycles. No features are hard-blocked.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
