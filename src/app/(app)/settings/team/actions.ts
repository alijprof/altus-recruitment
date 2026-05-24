'use server'

// Quick task 260524-bpy: Team page server actions (invite / revoke / resend).
//
// VERIFICATION R8 ordering (mirrored from inviteTeammateAction):
//   1. parse zod input
//   2. user-scoped SSR client + getUser()
//   3. RLS-scoped role check on public.users (RLS limits SELECT to caller's row)
//   4. REJECT if role !== 'owner' — do NOT escalate to service-role yet
//   5. THEN do whatever this action needs (insert / delete / fire email)
//
// PII / Sentry guard (CLAUDE.md): NEVER include invitee email or token in any
// Sentry capture. Only the error object + a static `feature: 'invitations'`
// tag and optional `step` discriminator.

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { sendResendEmail } from '@/lib/email/resend'
import { setRequestScope } from '@/lib/observability/sentry'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { TablesInsert } from '@/types/database'

import {
  inviteMemberSchema,
  resendInviteSchema,
  revokeInviteSchema,
} from './schema'

type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

// Resolves the request origin for building absolute accept-invite URLs. Next 16
// server actions can read the inbound request headers via `headers()`. We
// prefer `origin` (always present from the browser fetch), then fall back to
// `x-forwarded-host` + `x-forwarded-proto` for proxied environments. If
// neither is available we return null and the caller skips email but still
// returns ok (the DB row is canonical — see CONTRACT in resend.ts).
async function resolveOrigin(): Promise<string | null> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

export async function inviteMemberAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = inviteMemberSchema.safeParse(rawInput)
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    }
  }

  // VERIFICATION R8 — step 2: user-scoped client.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, formError: 'Not signed in.' }

  // VERIFICATION R8 — step 3: RLS-scoped role check.
  const { data: me, error: meError } = await supabase
    .from('users')
    .select('role, organization_id, full_name, email')
    .eq('id', user.id)
    .maybeSingle()
  if (meError || !me) return { ok: false, formError: 'Could not load your profile.' }

  // VERIFICATION R8 — step 4: REJECT non-owners BEFORE service-role.
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can invite teammates.' }
  }

  setRequestScope(user.id, me.organization_id)

  // Insert via the user-scoped client. RLS WITH CHECK + the two BEFORE INSERT
  // triggers (set_org + set_invited_by) auto-fill organization_id + invited_by.
  // We intentionally do NOT pass either field from the client — passing them
  // explicitly would be a defence-in-depth regression.
  //
  // reason: TablesInsert<'org_invitations'> declares organization_id +
  // invited_by as required even though the BEFORE INSERT triggers fill them.
  // Same pattern as src/app/(app)/_actions/submit-feedback.ts.
  const insertPayload = {
    email: parsed.data.email,
  } as unknown as TablesInsert<'org_invitations'>

  const { data: inserted, error: insertErr } = await supabase
    .from('org_invitations')
    .insert(insertPayload)
    .select('id, token, email')
    .single()

  if (insertErr) {
    // Friendly handling for the partial unique violation (pending duplicate).
    if (insertErr.code === '23505') {
      return {
        ok: false,
        fieldErrors: {
          email: ['An invitation is already pending for this email.'],
        },
      }
    }
    Sentry.captureException(insertErr, {
      tags: { feature: 'invitations', step: 'insert' },
    })
    return { ok: false, formError: 'Could not create the invitation. Please try again.' }
  }

  revalidatePath('/settings/team')

  // Bonus: send the email. Best-effort — DB row is canonical.
  try {
    const origin = await resolveOrigin()
    if (!origin) {
      Sentry.captureMessage('invite_email_skipped_no_origin', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'resend' },
      })
      return { ok: true }
    }

    // Look up the org name for the subject line. RLS scopes to caller's org.
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', me.organization_id)
      .maybeSingle()
    const orgName = org?.name ?? 'their team'
    const inviterName = me.full_name?.trim() || me.email || 'A teammate'

    const acceptUrl = `${origin}/accept-invite/${inserted.token}`

    // Plaintext only — never populate `html` with user-controlled strings
    // (inviter full_name, org name). T-260524-bpy-06 mitigation.
    const text = [
      `${inviterName} invited you to join ${orgName} on Altus.`,
      '',
      `Accept the invitation: ${acceptUrl}`,
      '',
      "Link expires in 7 days. Ignore this email if you weren't expecting it.",
    ].join('\n')

    const result = await sendResendEmail({
      to: inserted.email,
      subject: `${inviterName} invited you to Altus on ${orgName}`,
      text,
    })

    if (!result.ok && result.reason === 'http_error') {
      // no_api_key is expected in dev — only log real failures.
      Sentry.captureMessage('resend_send_failed', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'resend' },
        extra: { status: result.status },
      })
    }
  } catch (emailErr) {
    Sentry.captureException(emailErr, {
      tags: { feature: 'invitations', step: 'resend' },
    })
    // Fall through — row is canonical.
  }

  return { ok: true }
}

export async function revokeInviteAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = revokeInviteSchema.safeParse(rawInput)
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

  const { data: me, error: meError } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (meError || !me) return { ok: false, formError: 'Could not load your profile.' }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can revoke invitations.' }
  }

  setRequestScope(user.id, me.organization_id)

  // Delete via user-scoped client — RLS scopes the DELETE to the caller's org.
  // Idempotent: a missing row is treated as success (the caller doesn't care
  // whether someone else revoked it first).
  const { error: deleteErr } = await supabase
    .from('org_invitations')
    .delete()
    .eq('id', parsed.data.inviteId)

  if (deleteErr) {
    Sentry.captureException(deleteErr, {
      tags: { feature: 'invitations', step: 'revoke' },
    })
    return { ok: false, formError: 'Could not revoke. Please try again.' }
  }

  revalidatePath('/settings/team')
  return { ok: true }
}

export async function resendInviteAction(rawInput: unknown): Promise<ActionResult> {
  const parsed = resendInviteSchema.safeParse(rawInput)
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

  const { data: me, error: meError } = await supabase
    .from('users')
    .select('role, organization_id, full_name, email')
    .eq('id', user.id)
    .maybeSingle()
  if (meError || !me) return { ok: false, formError: 'Could not load your profile.' }
  if (me.role !== 'owner') {
    return { ok: false, formError: 'Only owners can resend invitations.' }
  }

  setRequestScope(user.id, me.organization_id)

  // Fetch the row via user-scoped client first (RLS = same-org guarantee).
  const { data: existing, error: existingErr } = await supabase
    .from('org_invitations')
    .select('id, token, email, expires_at, accepted_at')
    .eq('id', parsed.data.inviteId)
    .maybeSingle()

  if (existingErr) {
    Sentry.captureException(existingErr, {
      tags: { feature: 'invitations', step: 'resend' },
    })
    return { ok: false, formError: 'Could not load the invitation.' }
  }
  if (!existing) {
    return { ok: false, formError: 'Invitation not found.' }
  }
  if (existing.accepted_at) {
    return { ok: false, formError: 'That invitation has already been accepted.' }
  }

  // Refresh expires_at if it's already expired or expiring within 24h. RLS
  // has no UPDATE policy, so this MUST go through service-role. The same-org
  // guarantee was already established by the user-scoped SELECT above (R8).
  const expiresAt = new Date(existing.expires_at).getTime()
  const isStale = Number.isFinite(expiresAt) && expiresAt - Date.now() < 24 * 60 * 60 * 1000
  if (isStale) {
    const admin = createServiceClient()
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error: updateErr } = await admin
      .from('org_invitations')
      .update({ expires_at: newExpiry })
      .eq('id', existing.id)
    if (updateErr) {
      Sentry.captureException(updateErr, {
        tags: { feature: 'invitations', step: 'resend-refresh' },
      })
      // Fall through — re-firing the email with the old (still-valid) expiry
      // is acceptable; the user will see the row in /settings/team.
    }
  }

  // Always re-fire the email.
  try {
    const origin = await resolveOrigin()
    if (!origin) {
      Sentry.captureMessage('invite_email_skipped_no_origin', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'resend' },
      })
      return { ok: true }
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', me.organization_id)
      .maybeSingle()
    const orgName = org?.name ?? 'their team'
    const inviterName = me.full_name?.trim() || me.email || 'A teammate'

    const acceptUrl = `${origin}/accept-invite/${existing.token}`

    const text = [
      `${inviterName} invited you to join ${orgName} on Altus.`,
      '',
      `Accept the invitation: ${acceptUrl}`,
      '',
      "Link expires in 7 days. Ignore this email if you weren't expecting it.",
    ].join('\n')

    const result = await sendResendEmail({
      to: existing.email,
      subject: `${inviterName} invited you to Altus on ${orgName}`,
      text,
    })

    if (!result.ok && result.reason === 'http_error') {
      Sentry.captureMessage('resend_send_failed', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'resend' },
        extra: { status: result.status },
      })
    }
  } catch (emailErr) {
    Sentry.captureException(emailErr, {
      tags: { feature: 'invitations', step: 'resend' },
    })
  }

  revalidatePath('/settings/team')
  return { ok: true }
}
