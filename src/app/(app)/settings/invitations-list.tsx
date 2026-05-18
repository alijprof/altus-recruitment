import { Badge } from '@/components/ui/badge'
import { formatDateLong, formatTimeAgo, nowMillis } from '@/lib/date'
import { createClient } from '@/lib/supabase/server'
import type { Enums } from '@/types/database'

// Phase 1 simplification (per VERIFICATION open issue #5 / R10): list every
// user attached to the calling org, no pending/accepted distinction. Pending
// detection via auth.users.last_sign_in_at requires service-role access to
// auth.users and is deferred to Phase 2 along with the Revoke button.
//
// "Recently invited" pill is purely based on created_at being inside the
// 7-day window. RLS scopes the SELECT to this org.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

type UserRow = {
  id: string
  email: string
  full_name: string | null
  role: Enums<'user_role'>
  created_at: string
}

export async function InvitationsList() {
  const supabase = await createClient()
  // Capture "now" at fetch time via the dedicated helper so the React
  // compiler's purity check doesn't flag Date.now() inside render — and so
  // the "Recently invited" cut-off is deterministic for the rest of the
  // function's work.
  const nowMs = nowMillis()
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <p className="text-destructive text-sm font-normal">
        Could not load team members. Please refresh.
      </p>
    )
  }
  const rows = (data ?? []) as UserRow[]

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm font-normal">
        No team members yet. Invitations you send appear here.
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-md border">
      {rows.map((row) => {
        const created = new Date(row.created_at).getTime()
        const isRecent = Number.isFinite(created) && nowMs - created < SEVEN_DAYS_MS
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {row.full_name?.trim() || row.email}
              </p>
              <p className="text-muted-foreground truncate text-xs font-normal">{row.email}</p>
              <p className="text-muted-foreground text-xs font-normal">
                Joined {formatDateLong(row.created_at)} ({formatTimeAgo(row.created_at)})
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-normal capitalize">
                {row.role}
              </Badge>
              {isRecent ? (
                <Badge
                  variant="outline"
                  className="border-transparent bg-amber-100 font-normal text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                >
                  Recently invited
                </Badge>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
