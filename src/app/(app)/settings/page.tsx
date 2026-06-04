import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getOrganization } from '@/lib/db/organizations'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

import { ApplyFormToggle } from './apply-form-toggle'
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

      {/* Owner-only entry to the Team page: invite colleagues (via the audited
          org_invitations table), revoke/resend pending invites, and see who's
          joined. The legacy inline invite form that used Supabase Auth
          admin-invite (bypassing org_invitations) was removed in the
          launch-readiness cleanup — /settings/team is the single source of
          truth. (260603-gdz: merged the duplicate Team/Invite cards into one.) */}
      {isOwner ? (
        <Link href="/settings/team" className="block">
          <Card className="hover:bg-accent/40 transition-colors">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold">Invite your team</CardTitle>
                  <CardDescription>
                    Bring colleagues into Altus so they can add candidates and work the pipeline.
                    Invite, resend, or revoke invitations, and see who&apos;s joined.
                  </CardDescription>
                </div>
                <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
              </div>
            </CardHeader>
          </Card>
        </Link>
      ) : null}

      <Separator />

      {/* Role explainer — visible to all users (owners and recruiters).
          Plain-English description so team members know what each role can do
          without needing to read documentation. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Roles</CardTitle>
          <CardDescription>
            <strong className="text-foreground font-semibold">Owners</strong> manage organisation
            settings and can invite or remove teammates.{' '}
            <strong className="text-foreground font-semibold">Recruiters</strong> add candidates,
            clients, and jobs, and work the pipeline — but can&apos;t change org settings or manage
            the team.
          </CardDescription>
        </CardHeader>
      </Card>

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

      <Separator />

      {/* Phase 5 Plan 05-01 — billing + plan management (owner-only). */}
      {isOwner ? (
        <Link href="/settings/billing" className="block">
          <Card className="transition-colors hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold">Billing</CardTitle>
                  <CardDescription>
                    Manage your plan, seats, and payment details. View AI usage against
                    your plan limits.
                  </CardDescription>
                </div>
                <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
              </div>
            </CardHeader>
          </Card>
        </Link>
      ) : null}
    </div>
  )
}
