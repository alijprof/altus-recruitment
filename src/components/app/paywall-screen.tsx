import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PLANS, type PlanKey } from '@/lib/stripe/plans'
import type { SubscriptionStatus } from '@/types/billing'
import { ManageBillingButton } from '@/app/(app)/settings/billing/manage-billing-button'
import { StartCheckoutButton } from '@/app/(app)/settings/billing/start-checkout-button'
import { SignOutButton } from '@/components/app/sign-out-button'

// Private helper — mirrors the same function in settings/billing/page.tsx.
// Duplicated intentionally: that file treats it as module-private.
function formatPenceGbp(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

export interface PaywallScreenProps {
  orgName: string | null
  status: SubscriptionStatus
  isOwner: boolean
  userEmail: string
}

export function PaywallScreen({ orgName, status, isOwner, userEmail }: PaywallScreenProps) {
  const headingText =
    status === 'past_due'
      ? 'Payment failed — update your card'
      : status === 'cancelled'
        ? 'Your subscription has ended'
        : 'Start your 14-day free trial'

  // Sub-copy must match the status — the "14 days free" trial framing is only
  // correct for a brand-new (none) org, not a lapsed/failed subscriber.
  const descriptionText =
    status === 'past_due'
      ? "Your last payment failed. Update your payment method to restore access."
      : status === 'cancelled'
        ? 'Your subscription has ended. Start a plan again to regain access — 14 days free, cancel anytime before day 14.'
        : "14 days free, then billed per seat per month — cancel anytime before day 14 and you won't be charged."

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{headingText}</CardTitle>
          <CardDescription>{descriptionText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgName && <p className="text-muted-foreground text-sm">{orgName}</p>}

          {isOwner && (status === 'none' || status === 'cancelled') && (
            <div className="grid gap-3 sm:grid-cols-3">
              {(['starter', 'pro', 'scale'] as const).map((key: PlanKey) => {
                const plan = PLANS[key]
                return (
                  <div key={key} className="space-y-2 rounded-md border p-3">
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
          )}

          {isOwner && status === 'past_due' && (
            <div className="space-y-2">
              <p className="text-sm">Update your payment method to restore access.</p>
              <ManageBillingButton />
            </div>
          )}

          {!isOwner && (
            <p className="text-sm">
              Your workspace is paused. Ask your organisation owner to start a subscription.
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-muted-foreground text-sm">{userEmail}</span>
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
