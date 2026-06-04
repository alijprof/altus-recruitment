import { redirect } from 'next/navigation'

import { CapWarningBanner } from '@/components/app/cap-warning-banner'
import { FloatingFeedbackButton } from '@/components/app/floating-feedback-button'
import { TopNav } from '@/components/app/top-nav'
import { getOrganization } from '@/lib/db/organizations'
import { getProfile } from '@/lib/db/profiles'
import { setRequestScope } from '@/lib/observability/sentry'
import { getEntitlement } from '@/lib/stripe/entitlement'
import { createClient } from '@/lib/supabase/server'

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

  // Entitlement for the cap-warning banner. Fetch in parallel with the page
  // content (layout renders concurrently with children in Next.js RSC).
  // Fail open: if getEntitlement throws, the banner simply doesn't show.
  let softCapBreached = false
  let hardCapBreached = false
  try {
    const entitlement = await getEntitlement(profile.data.organization_id)
    softCapBreached = entitlement.softCapBreached
    hardCapBreached = entitlement.hardCapBreached
  } catch {
    // Ignore — billing unavailable should not block the whole app.
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
