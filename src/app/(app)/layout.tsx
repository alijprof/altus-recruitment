import * as Sentry from '@sentry/nextjs'
import { redirect } from 'next/navigation'

import { CapWarningBanner } from '@/components/app/cap-warning-banner'
import { FloatingFeedbackButton } from '@/components/app/floating-feedback-button'
import { PaywallScreen } from '@/components/app/paywall-screen'
import { TopNav } from '@/components/app/top-nav'
import { getOrganization } from '@/lib/db/organizations'
import { getProfile } from '@/lib/db/profiles'
import { setRequestScope } from '@/lib/observability/sentry'
import { getEntitlement } from '@/lib/stripe/entitlement'
import { createClient } from '@/lib/supabase/server'
import type { EntitlementStatus } from '@/types/billing'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Middleware already redirects unauthenticated traffic; this is a defence in
  // depth for any path the matcher doesn't cover.
  if (!user) {
    redirect('/sign-in')
  }

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) {
    redirect('/sign-in')
  }

  const organization = await getOrganization(supabase, profile.data.organization_id)

  setRequestScope(user.id, profile.data.organization_id)

  // Entitlement for the access gate and cap-warning banner.
  // Fail open: defaults ensure a billing blip never locks paying customers out.
  let softCapBreached = false
  let hardCapBreached = false
  // Gate defaults — MUST be "entitled" so a DB/billing error fails open.
  let entitled = true
  let entitlementStatus: EntitlementStatus['status'] = 'active'
  try {
    const entitlement = await getEntitlement(profile.data.organization_id)
    softCapBreached = entitlement.softCapBreached
    hardCapBreached = entitlement.hardCapBreached
    entitlementStatus = entitlement.status
    entitled = entitlement.status === 'trialing' || entitlement.status === 'active'
  } catch (err) {
    // Fail open — billing unavailable must not lock paying customers out of
    // the whole app — but capture the error so a silent billing outage is
    // observable (audit rank 22). The entitled=true defaults above are kept.
    Sentry.captureException(err, {
      tags: { layer: 'billing', helper: 'AppLayout', step: 'getEntitlement' },
    })
  }

  // Return the paywall instead of the CRM for gated orgs.
  // Do NOT redirect — /settings/billing lives under this layout; redirecting
  // would create an infinite loop. Rendering in place lets owners check out
  // directly from the paywall.
  if (!entitled) {
    return (
      <PaywallScreen
        orgName={organization.ok ? organization.data.name : null}
        status={entitlementStatus}
        isOwner={profile.data.role === 'owner'}
        userEmail={profile.data.email ?? user.email ?? ''}
      />
    )
  }

  return (
    <div className="flex min-h-svh flex-col">
      <TopNav
        userEmail={profile.data.email ?? user.email ?? ''}
        userName={profile.data.full_name ?? null}
        organizationName={organization.ok ? organization.data.name : null}
      />
      {/* AI cap warning — shown when org crosses 80% or 100% of any AI cap */}
      <CapWarningBanner softCapBreached={softCapBreached} hardCapBreached={hardCapBreached} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <FloatingFeedbackButton />
    </div>
  )
}
