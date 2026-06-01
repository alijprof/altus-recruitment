'use server'

import { revalidatePath } from 'next/cache'

import { updateOrganization } from '@/lib/db/organizations'
import { updateProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'

import { updateOrganizationSchema, updateProfileSchema } from './schema'

// Settings server actions (Plan 5 Task 5.2).
//
// Team invitations live entirely on the /settings/team page and its
// org_invitations-backed actions (quick task 260524-bpy). The legacy
// Supabase-Auth admin-invite action that used to live here was removed in the
// launch-readiness cleanup (M-4) because it bypassed the audited
// org_invitations table and its invites never appeared on the new Team page.

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

export async function updateProfileAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = updateProfileSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  const result = await updateProfile(supabase, user.id, {
    full_name: parsed.data.full_name,
    email: parsed.data.email,
  })

  if (!result.ok) {
    return { ok: false, formError: 'Could not save your profile. Please try again.' }
  }

  revalidatePath('/settings')
  revalidatePath('/', 'layout') // top nav re-reads name
  return { ok: true }
}

export async function updateOrganizationAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = updateOrganizationSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  // Only owners can edit org-level fields. The user-scoped client + RLS
  // already prevents reading another org's row, but a non-owner could still
  // attempt to PATCH their own org via the client. Block it explicitly here.
  const { data: me } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!me) return { ok: false, formError: 'Profile not found.' }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can edit organisation settings.' }
  }

  const result = await updateOrganization(supabase, me.organization_id, {
    name: parsed.data.name,
    logo_url: parsed.data.logo_url && parsed.data.logo_url.length > 0 ? parsed.data.logo_url : null,
  })

  if (!result.ok) {
    return { ok: false, formError: 'Could not save organisation. Please try again.' }
  }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { ok: true }
}
