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
import {
  renderTransactionalEmail,
  renderTransactionalEmailText,
  type TransactionalEmail,
} from '@/lib/email/render'
import { env } from '@/lib/env'
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
  // emailDelivered tells the UI whether the Resend send actually went out.
  // The DB row is always canonical (the invite exists); a false here means
  // the invitee will not receive an email until config is fixed — the UI
  // surfaces a warning instead of a misleading "Invitation sent".
  | { ok: true; emailDelivered: boolean }
  | { ok: false; fieldErrors: Record<string, string[] | undefined> }
  | { ok: false; formError: string }

// Resolves the request origin for building absolute accept-invite URLs.
//
// Quick task 260524-iav (B3): precedence is env → origin → forwarded-host.
// env.NEXT_PUBLIC_SITE_URL is the trusted source in production — it is
// server-controlled at deploy time and cannot be spoofed by an upstream
// proxy attaching a malicious X-Forwarded-Host (which would otherwise be
// echoed verbatim into the outbound accept-invite email and turn a benign
// owner-driven invite into a phishing link pointing at attacker.example).
// When unset (dev or single-env Vercel where the env is naturally correct),
// we fall back to the browser-supplied `origin` header (set by every
// same-origin fetch from a real browser; not present on cross-origin or
// non-browser callers), and finally to forwarded-host as a last resort.
// Operators MUST set NEXT_PUBLIC_SITE_URL in production. If none of these
// produce a value, the caller skips the email but still returns ok (the DB
// row is canonical — see CONTRACT in resend.ts).
async function resolveOrigin(): Promise<string | null> {
  if (env.NEXT_PUBLIC_SITE_URL) {
    // Strip any trailing slash so caller's `${origin}/accept-invite/...`
    // doesn't double up into `https://app.example.com//accept-invite/...`.
    return env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

// 260528-wdz: keep preheader text under ~90 chars so Gmail / Apple Mail show
// the full preview without truncation. Truncates with an ellipsis if longer.
function buildInvitePreheader(inviterName: string, orgName: string): string {
  const raw = `${inviterName} invited you to ${orgName} on Altus Recruit`
  return raw.length > 90 ? raw.slice(0, 89) + '…' : raw
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

  // Bonus: send the email. Best-effort — DB row is canonical. Track whether
  // delivery actually succeeded so the UI can warn instead of falsely
  // reporting "sent" when no email went out.
  let emailDelivered = false
  try {
    const origin = await resolveOrigin()
    if (!origin) {
      Sentry.captureMessage('invite_email_skipped_no_origin', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'resend' },
      })
      return { ok: true, emailDelivered: false }
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

    // HTML payload is safe: inviterName + orgName + acceptUrl pass through
    // escapeHtml/sanitiseUrl inside renderTransactionalEmail.
    // T-260524-bpy-06 mitigation upgraded for branded HTML (260528-wdz).
    const emailInput: TransactionalEmail = {
      preheader: buildInvitePreheader(inviterName, orgName),
      heading: `You're invited to ${orgName}`,
      paragraphs: [
        `${inviterName} invited you to join their team on Altus Recruit — the AI-first recruitment CRM.`,
      ],
      button: { label: 'Accept invitation', url: acceptUrl },
      footerNote: "Link expires in 7 days. If you weren't expecting this, you can ignore it.",
    }
    const html = renderTransactionalEmail(emailInput)
    const text = renderTransactionalEmailText(emailInput)

    const result = await sendResendEmail({
      to: inserted.email,
      subject: `${inviterName} invited you to Altus Recruit`,
      html,
      text,
    })
    emailDelivered = result.ok

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
    // Fall through — row is canonical; delivery failed.
    return { ok: true, emailDelivered: false }
  }

  return { ok: true, emailDelivered }
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
  // Revoke sends no email — emailDelivered is irrelevant here; report true
  // to satisfy the shared result type (the revoke UI ignores this field).
  return { ok: true, emailDelivered: true }
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

  // Always re-fire the email. Track whether delivery succeeded so the UI
  // warns instead of falsely reporting "resent" when nothing went out.
  let emailDelivered = false
  try {
    const origin = await resolveOrigin()
    if (!origin) {
      Sentry.captureMessage('invite_email_skipped_no_origin', {
        level: 'warning',
        tags: { feature: 'invitations', step: 'resend' },
      })
      revalidatePath('/settings/team')
      return { ok: true, emailDelivered: false }
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', me.organization_id)
      .maybeSingle()
    const orgName = org?.name ?? 'their team'
    const inviterName = me.full_name?.trim() || me.email || 'A teammate'

    const acceptUrl = `${origin}/accept-invite/${existing.token}`

    // HTML payload is safe: inviterName + orgName + acceptUrl pass through
    // escapeHtml/sanitiseUrl inside renderTransactionalEmail.
    // T-260524-bpy-06 mitigation upgraded for branded HTML (260528-wdz).
    const emailInput: TransactionalEmail = {
      preheader: buildInvitePreheader(inviterName, orgName),
      heading: `You're invited to ${orgName}`,
      paragraphs: [
        `${inviterName} invited you to join their team on Altus Recruit — the AI-first recruitment CRM.`,
      ],
      button: { label: 'Accept invitation', url: acceptUrl },
      footerNote: "Link expires in 7 days. If you weren't expecting this, you can ignore it.",
    }
    const html = renderTransactionalEmail(emailInput)
    const text = renderTransactionalEmailText(emailInput)

    const result = await sendResendEmail({
      to: existing.email,
      subject: `${inviterName} invited you to Altus Recruit`,
      html,
      text,
    })
    emailDelivered = result.ok

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
    revalidatePath('/settings/team')
    return { ok: true, emailDelivered: false }
  }

  revalidatePath('/settings/team')
  return { ok: true, emailDelivered }
}
