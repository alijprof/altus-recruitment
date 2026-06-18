'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'

import { updateOrganization } from '@/lib/db/organizations'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'

// Plan 3 Task 3.3 — owner-only toggle for the public apply form.
// Per VERIFICATION R8: the role-check uses the user-scoped SSR client (RLS
// scopes the SELECT on public.users to the caller's own row) BEFORE any
// privilege-escalating call. Service-role is NOT used here — updates on
// organizations are allowed via the authenticated client when RLS permits.

export type ToggleApplyFormResult =
  | { ok: true; enabled: boolean }
  | { ok: false; formError: string }

export async function toggleApplyFormEnabledAction(
  enabled: boolean,
): Promise<ToggleApplyFormResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  // Entitlement gate — block CRM/org mutations for non-entitled orgs (audit blocker 1).
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  // R8: role-scoped read of public.users. RLS returns only the caller's
  // own row; non-owners are rejected before any write.
  const { data: me, error: meErr } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (meErr || !me) {
    return { ok: false, formError: 'Could not load your profile.' }
  }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can toggle the apply form.' }
  }

  const updateRes = await updateOrganization(supabase, me.organization_id, {
    apply_form_enabled: enabled,
  })
  if (!updateRes.ok) {
    Sentry.captureException(
      new Error(`toggleApplyFormEnabledAction: update failed`),
      {
        tags: { layer: 'action', helper: 'toggleApplyFormEnabledAction' },
      },
    )
    return {
      ok: false,
      formError: 'Could not update the apply form. Please try again.',
    }
  }

  // Revalidate so the recruiter UI re-reads the toggle state immediately.
  revalidatePath('/settings')
  return { ok: true, enabled }
}
