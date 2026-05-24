import { redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatDateLong, formatTimeAgo } from '@/lib/date'
import { getProfile } from '@/lib/db/profiles'
import { setRequestScope } from '@/lib/observability/sentry'
import { createClient } from '@/lib/supabase/server'

import { InviteMemberDialog } from './invite-member-dialog'
import { ResendInviteButton } from './resend-invite-button'
import { RevokeInviteButton } from './revoke-invite-button'

// Quick task 260524-bpy: Owner-facing Team settings page. Owner-only — non-owners
// hitting this route are redirected to /settings (mirrors the existing inline
// owner gate on /settings/page.tsx).

type MemberRow = {
  id: string
  full_name: string | null
  email: string
  role: string
  created_at: string
}

type PendingInvite = {
  id: string
  email: string
  expires_at: string
  created_at: string
  invited_by: string
}

export default async function TeamSettingsPage() {
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
  if (profile.data.role !== 'owner') {
    redirect('/settings')
  }

  setRequestScope(user.id, profile.data.organization_id)

  // Parallel fetch of members + pending invites. Both RLS-scoped to the
  // caller's org by the policies on `users` and `org_invitations`.
  const [membersResult, invitesResult] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('org_invitations')
      .select('id, email, expires_at, created_at, invited_by')
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ])

  const members = (membersResult.data ?? []) as MemberRow[]
  const pending = (invitesResult.data ?? []) as PendingInvite[]

  // Inviter-name lookup via the members array we already fetched (saves a
  // round-trip; same-org guarantee from RLS).
  const memberById = new Map(members.map((m) => [m.id, m]))

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-muted-foreground text-sm font-normal">
            Invite teammates and manage pending invitations.
          </p>
        </div>
        <InviteMemberDialog />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Members</CardTitle>
          <CardDescription>Everyone currently in your organisation.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm font-normal">No team members yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {members.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {row.full_name?.trim() || row.email}
                    </p>
                    <p className="text-muted-foreground truncate text-xs font-normal">
                      {row.email}
                    </p>
                    <p className="text-muted-foreground text-xs font-normal">
                      Joined {formatDateLong(row.created_at)} ({formatTimeAgo(row.created_at)})
                    </p>
                  </div>
                  <Badge variant="outline" className="font-normal capitalize">
                    {row.role}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Pending invitations</CardTitle>
          <CardDescription>
            Invitations awaiting acceptance. Links expire after 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-sm font-normal">No pending invitations.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {pending.map((row) => {
                const inviter = memberById.get(row.invited_by)
                const inviterLabel = inviter?.full_name?.trim() || inviter?.email || 'a teammate'
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.email}</p>
                      <p className="text-muted-foreground truncate text-xs font-normal">
                        Invited by {inviterLabel} · {formatTimeAgo(row.created_at)}
                      </p>
                      <p className="text-muted-foreground text-xs font-normal">
                        Expires {formatDateLong(row.expires_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ResendInviteButton inviteId={row.id} />
                      <RevokeInviteButton inviteId={row.id} email={row.email} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
