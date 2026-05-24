import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

// Quick task 260524-bpy: invitation token lookup helper.
//
// Used by /accept-invite/[token]/route.ts for the pre-sign-in validity check
// (so we can redirect to /sign-in?error=expired-invite vs. ?error=invalid-invite
// with a helpful message). The canonical accept path on /auth/callback goes
// through the public.accept_invitation() RPC, NOT this helper — this helper
// MUST NOT be used to mutate state.

export type InvitationRow = {
  id: string
  organization_id: string
  email: string
  expires_at: string
  accepted_at: string | null
  invited_by: string
}

export async function lookupInvitationByToken(
  serviceClient: SupabaseClient<Database>,
  token: string,
): Promise<InvitationRow | null> {
  const { data, error } = await serviceClient
    .from('org_invitations')
    .select('id, organization_id, email, expires_at, accepted_at, invited_by')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) return null
  return data as InvitationRow
}

export type InvitationUsability =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'accepted' }

export function isInvitationUsable(row: InvitationRow): InvitationUsability {
  if (row.accepted_at !== null) {
    return { ok: false, reason: 'accepted' }
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}
