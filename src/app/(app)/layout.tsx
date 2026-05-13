import { redirect } from 'next/navigation'

import { TopNav } from '@/components/app/top-nav'
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

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, email, organization_id')
    .eq('id', user.id)
    .maybeSingle()

  const { data: organization } = profile
    ? await supabase
        .from('organizations')
        .select('name')
        .eq('id', profile.organization_id)
        .maybeSingle()
    : { data: null }

  return (
    <div className="flex min-h-svh flex-col">
      <TopNav
        userEmail={profile?.email ?? user.email ?? ''}
        userName={profile?.full_name ?? null}
        organizationName={organization?.name ?? null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
