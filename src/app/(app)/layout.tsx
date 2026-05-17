import { redirect } from 'next/navigation'

import { TopNav } from '@/components/app/top-nav'
import { getOrganization } from '@/lib/db/organizations'
import { getProfile } from '@/lib/db/profiles'
import { setRequestScope } from '@/lib/observability/sentry'
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

  return (
    <div className="flex min-h-svh flex-col">
      <TopNav
        userEmail={profile.data.email ?? user.email ?? ''}
        userName={profile.data.full_name ?? null}
        organizationName={organization.ok ? organization.data.name : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
