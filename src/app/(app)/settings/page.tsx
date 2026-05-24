import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getOrganization } from '@/lib/db/organizations'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

import { ApplyFormToggle } from './apply-form-toggle'
import { InvitationsList } from './invitations-list'
import { InviteForm } from './invite-form'
import { OrganizationForm } from './organization-form'
import { ProfileForm } from './profile-form'

// Plan 5 Task 5.2 — Settings shell. Single-column max-w-2xl per UI-SPEC
// Layout Patterns for settings; Card per section with Separator between.

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // Layout guard already redirects, but belt-and-braces for direct hits.
    redirect('/sign-in')
  }

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) {
    redirect('/sign-in')
  }

  const organization = await getOrganization(supabase, profile.data.organization_id)
  const isOwner = profile.data.role === 'owner'

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm font-normal">
          Profile, organisation, and team.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Profile</CardTitle>
          <CardDescription>Your name and contact details.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initialFullName={profile.data.full_name}
            initialEmail={profile.data.email ?? user.email ?? ''}
          />
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Organisation</CardTitle>
          <CardDescription>
            {isOwner
              ? 'Edit your organisation name and logo URL.'
              : 'Organisation settings are managed by your owner.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrganizationForm
            initialName={organization.ok ? organization.data.name : ''}
            initialLogoUrl={organization.ok ? organization.data.logo_url : null}
            isOwner={isOwner}
          />
        </CardContent>
      </Card>

      <Separator />

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Team</CardTitle>
            <CardDescription>
              Invite teammates by email. They&apos;ll join with the recruiter role.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <InviteForm />
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Current team</h3>
              <InvitationsList />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Quick task 260524-bpy — owner-only link to the full Team page (list +
          revoke + resend). Legacy inline Team card above stays for now so we
          don't break ongoing flows; cleanup deferred to a follow-up. */}
      {isOwner ? (
        <>
          <Separator />
          <Link href="/settings/team" className="block">
            <Card className="hover:bg-accent/40 transition-colors">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold">Team</CardTitle>
                    <CardDescription>
                      Invite teammates, revoke pending invitations, and see who&apos;s joined.
                    </CardDescription>
                  </div>
                  <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
                </div>
              </CardHeader>
            </Card>
          </Link>
        </>
      ) : null}

      <Separator />

      {/* Plan 3 Task 3.3 — public apply form discoverability + owner toggle. */}
      {organization.ok ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Public apply form</CardTitle>
            <CardDescription>
              The shareable URL that lets candidates apply directly to your
              organisation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyFormToggle
              slug={organization.data.slug}
              initialEnabled={organization.data.apply_form_enabled}
              isOwner={isOwner}
            />
          </CardContent>
        </Card>
      ) : null}

      <Separator />

      {/* Plan 2 Task 2.3 — per-org AI spend dashboard, linked from settings. */}
      <Link href="/settings/usage" className="block">
        <Card className="transition-colors hover:bg-accent/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold">Usage</CardTitle>
                <CardDescription>
                  Month-to-date AI spend, per-feature breakdown, and the match-scoring
                  ceiling indicator.
                </CardDescription>
              </div>
              <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
            </div>
          </CardHeader>
        </Card>
      </Link>
    </div>
  )
}
