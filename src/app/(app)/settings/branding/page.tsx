import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getOrganization } from '@/lib/db/organizations'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

import { BrandingForm } from './branding-form'

// Branding settings page — 05-02 BRAND-01.
//
// Owner-only in practice (the form disables for non-owners), but any
// authenticated org member may view the current branding values.
// Data reads are RLS-scoped via the user-scoped Supabase client.

export default async function BrandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/sign-in')
  }

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) {
    redirect('/sign-in')
  }

  const organization = await getOrganization(supabase, profile.data.organization_id)
  const isOwner = profile.data.role === 'owner'

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Settings
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Branding</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Customise your candidate-facing apply page with your agency&apos;s logo and colours.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Brand colours &amp; logo</CardTitle>
          <CardDescription>
            {isOwner
              ? 'Set the colours and logo shown on your public apply page.'
              : 'Branding is managed by your organisation owner.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm
            initialBrandPrimary={organization.ok ? organization.data.brand_primary : null}
            initialBrandSecondary={organization.ok ? organization.data.brand_secondary : null}
            initialLogoUrl={organization.ok ? organization.data.logo_url : null}
            isOwner={isOwner}
          />
        </CardContent>
      </Card>
    </div>
  )
}
