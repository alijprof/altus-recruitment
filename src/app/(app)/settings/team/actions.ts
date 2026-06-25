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

import { getEntitlement } from '@/lib/stripe/entitlement'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
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
  removeMemberSchema,
  resendInviteSchema,
  revokeInviteSchema,
} from './schema'

// Remove-member returns a minimal shape (no email is sent), distinct from the
// invite ActionResult so the UI handler isn't forced to thread emailDelivered.
type RemoveMemberResult = { ok: true } | { ok: false; formError: string }

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

  // Entitlement gate — invites consume seats + send email; block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
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

  // VERIFICATION R8 — step 4.5: Seat enforcement (D-09).
  // Runs AFTER owner check (step 4), BEFORE the org_invitations insert (step 5).
  // Uses the RLS-scoped client (same `supabase` as getUser/role — no service-role
  // escalation for this read per the plan requirement).
  //
  // Prospective seats = activeSeats + pendingInvites + 1 (the invite we're about
  // to create). If this exceeds planSeats, block with a clear upgrade message.
  //
  // Pending = accepted_at IS NULL AND expires_at > now()
  // (org_invitations has no revoked_at column; revocation is a hard DELETE).
  try {
    const entitlement = await getEntitlement(me.organization_id, supabase)

    const { count: pendingCount, error: pendingErr } = await supabase
      .from('org_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', me.organization_id)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())

    if (!pendingErr) {
      const pending = pendingCount ?? 0
      const prospective = entitlement.activeSeats + pending + 1

      // For orgs on a real plan (active/trialing/past_due), gate against planSeats.
      // For orgs with status 'none' (trial/no plan), gate against Pro trial seats
      // so the anchor/trial isn't blocked but is still bounded.
      const seatLimit =
        entitlement.status !== 'none'
          ? entitlement.planSeats
          : entitlement.planSeats // planSeats for 'none' is already set to PLANS.pro.seats in getEntitlement

      if (prospective > seatLimit) {
        return {
          ok: false,
          formError:
            "You've reached your plan's seat limit. Upgrade your plan to add more teammates.",
        }
      }
    }
    // If the pending count query errors, we fail open (let the invite proceed).
    // A billing misconfiguration should not block team growth; Sentry captures
    // the underlying error via getEntitlement's own logging.
  } catch {
    // getEntitlement or seat count threw — fail open, log implicitly via Sentry
    // inside getEntitlement. The invite proceeds.
  }

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

// Batch B item 5 — remove a teammate (GDPR access-control).
//
// Owner-only. Deletes the member's Supabase AUTH user via the service-role
// admin API, which (a) invalidates their session and (b) cascades the
// public.users row (FK ON DELETE CASCADE). Their authored rows are preserved
// with created_by nulled (FK ON DELETE SET NULL — see migration
// 20260625130000). Guards: cannot remove yourself; cannot remove the last
// owner. Deliberately NOT entitlement-gated — revoking a departed teammate's
// access must work even on a lapsed subscription (it reduces cost/seats, and
// blocking it would be a security/GDPR regression).
//
// VERIFICATION R8 ordering: parse → user-scoped client → RLS role check →
// reject non-owner BEFORE any service-role escalation → then mutate.
export async function removeMemberAction(rawInput: unknown): Promise<RemoveMemberResult> {
  const parsed = removeMemberSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, formError: 'Invalid member id.' }
  }
  const { userId } = parsed.data

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
    return { ok: false, formError: 'Only owners can remove teammates.' }
  }

  setRequestScope(user.id, me.organization_id)

  // Cannot remove yourself — prevents accidental self-lockout and any
  // remove-self-into-no-owner race. Self-removal is also hidden in the UI.
  if (userId === user.id) {
    return { ok: false, formError: 'You cannot remove yourself.' }
  }

  // Confirm the target is in the caller's org. The user-scoped client's RLS
  // scopes SELECT to same-org rows, so a missing row means the member is in a
  // different org (forged id) or already gone — either way there is nothing to
  // do, so treat as a no-op success (no information leak, idempotent).
  const { data: target, error: targetError } = await supabase
    .from('users')
    .select('id, role, organization_id')
    .eq('id', userId)
    .maybeSingle()
  if (targetError) {
    Sentry.captureException(targetError, {
      tags: { feature: 'team_management', step: 'load_target' },
    })
    return { ok: false, formError: 'Could not load that teammate. Please try again.' }
  }
  if (!target) {
    return { ok: true }
  }

  // Last-owner guard: never leave the org with zero owners. (When the remover
  // is an owner and the target is a different owner, the count is already ≥2,
  // so this is defence-in-depth against races / future role changes.)
  if (target.role === 'owner') {
    const { count: ownerCount, error: ownerErr } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', me.organization_id)
      .eq('role', 'owner')
    if (ownerErr) {
      Sentry.captureException(ownerErr, {
        tags: { feature: 'team_management', step: 'owner_count' },
      })
      return { ok: false, formError: 'Could not verify owners. Please try again.' }
    }
    if ((ownerCount ?? 0) <= 1) {
      return {
        ok: false,
        formError: 'You cannot remove the last owner. Make someone else an owner first.',
      }
    }
  }

  // Service-role: delete the auth user. Cascades public.users; nulls created_by
  // on their spec_drafts / voice_notes / email_campaigns (migration 20260625130000).
  const admin = createServiceClient()
  const { error: deleteErr } = await admin.auth.admin.deleteUser(userId)
  if (deleteErr) {
    // NEVER log the email/id beyond Sentry's scoped tags (PII guard). If the
    // FK-relaxation migration hasn't been pushed yet, deleteUser fails on the
    // RESTRICT FK — surface a clear, non-leaky message.
    Sentry.captureException(deleteErr, {
      tags: { feature: 'team_management', step: 'delete_user' },
    })
    return { ok: false, formError: 'Could not remove the teammate. Please try again.' }
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

  // Entitlement gate — resend re-sends an invite email (spend); block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }
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
