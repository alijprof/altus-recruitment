'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'

import { updateOrganization } from '@/lib/db/organizations'
import { updateProfile } from '@/lib/db/profiles'
import { setRequestScope } from '@/lib/observability/sentry'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

import {
  inviteTeammateSchema,
  updateOrganizationSchema,
  updateProfileSchema,
} from './schema'

// Settings server actions (Plan 5 Task 5.2).
//
// VERIFICATION R8 is the load-bearing rule in inviteTeammateAction: the role
// check uses the user-scoped SSR client (RLS scopes the SELECT on public.users
// to the caller's own row) BEFORE any service-role privilege escalation. The
// admin invite call only fires once role === 'owner' is verified.

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

export async function inviteTeammateAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = inviteTeammateSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  // VERIFICATION R8 — step 1: user-scoped client.
  const supabase = await createClient()
  // VERIFICATION R8 — step 2: identify the caller.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  // VERIFICATION R8 — step 3: RLS-scoped role check on public.users. The
  // SELECT here returns only the caller's own row by RLS — service-role is
  // NOT yet involved.
  const { data: me, error: meError } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (meError || !me) {
    return { ok: false, formError: 'Could not load your profile.' }
  }
  // VERIFICATION R8 — step 4: REJECT if caller is not an owner. Critical: do
  // not switch to service-role until this check has passed.
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can invite teammates.' }
  }

  setRequestScope(user.id, me.organization_id)

  // VERIFICATION R8 — step 5: ONLY now switch to service-role and call the
  // admin invite API.
  const admin = createServiceClient()
  const fullName = parsed.data.full_name?.trim() || null
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      // raw_user_meta_data — read by the handle_new_user_invite trigger
      // (supabase/migrations/20260517204503_handle_new_user_invite.sql) which
      // attaches the new auth.users row to me.organization_id with
      // role='recruiter'.
      data: {
        invited_to_org: me.organization_id,
        full_name: fullName,
      },
    },
  )

  if (inviteError || !invited.user) {
    Sentry.captureException(inviteError ?? new Error('inviteUserByEmail: no user returned'), {
      tags: { layer: 'action', helper: 'inviteTeammateAction' },
    })
    return {
      ok: false,
      formError: inviteError?.message ?? 'Invite failed. Please try again.',
    }
  }

  revalidatePath('/settings')
  return { ok: true }
}
