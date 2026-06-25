'use server'

// ---------------------------------------------------------------------------
// src/app/admin/actions.ts — Super-admin plan override server actions.
//
// SECURITY INVARIANT (defence in depth):
//   Every action calls requireSuperAdmin() FIRST, before touching createServiceClient().
//   This re-checks the gate at the action level — the layout gate is the page
//   boundary, but mutations must never rely solely on layout rendering to gate them.
//   A direct action invocation (e.g. from a crafted fetch) must be independently
//   blocked by the requireSuperAdmin() call inside the action.
//
// MUTATION DISCIPLINE:
//   - Mutations return a discriminated result (not fire-and-forget).
//   - Callers must display success/error via toast (sonner) — no silent success.
//   - revalidatePath('/admin') + revalidatePath(`/admin/${orgId}`) after writes.
//
// D-14 NOTE: No impersonation, no audit log in v1 — explicitly descoped.
//   updated_by is recorded on the plan_overrides row for traceability.
// ---------------------------------------------------------------------------

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { requireSuperAdmin } from '@/lib/admin/guard'
import { deleteAllOrgStorage, deleteOrgAuthUsers } from '@/lib/admin/org-erasure'
import { sendResendEmail } from '@/lib/email/resend'
import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Shared action result type.
// ---------------------------------------------------------------------------
export type AdminActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// PlanOverrideRow cast boundary (pre-push plan_overrides table).
// reason: plan_overrides is added by 20260604130000_phase5_admin_overrides.sql
// which has NOT been pushed yet (Task 5.3 [BLOCKING] Wave 2 push). The cast
// boundary pattern matches src/lib/db/organizations.ts.
// ---------------------------------------------------------------------------
type PlanOverridesWriteClient = {
  from: (table: 'plan_overrides') => {
    upsert: (
      payload: {
        organization_id: string
        trial_end_override?: string | null
        cap_multiplier?: number | null
        note?: string | null
        updated_by: string
        updated_at: string
      },
      opts: { onConflict: string },
    ) => {
      select: (cols: string) => Promise<{ data: unknown; error: unknown }>
    }
    delete: () => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>
    }
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: {
            trial_end_override: string | null
            cap_multiplier: number | null
          } | null
          error: unknown
        }>
      }
    }
  }
}

// ---------------------------------------------------------------------------
// extendTrialAction — set/update trial_end_override for an org.
//
// Input: orgId (uuid), newTrialEnd (ISO datetime string)
// Effect: upserts plan_overrides row with trial_end_override = newTrialEnd
//
// GATE: requireSuperAdmin() → only then createServiceClient()
// ---------------------------------------------------------------------------

const extendTrialSchema = z.object({
  orgId: z.string().uuid(),
  newTrialEnd: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: 'Trial end must be in the future.',
    }),
})

export async function extendTrialAction(
  orgId: string,
  newTrialEnd: string,
): Promise<AdminActionResult> {
  // GATE — must be first; service-role client only created after this passes.
  const admin = await requireSuperAdmin()

  const parsed = extendTrialSchema.safeParse({ orgId, newTrialEnd })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }

  const serviceClient = createServiceClient()
  const writeClient = serviceClient as unknown as PlanOverridesWriteClient

  try {
    const { error } = await writeClient
      .from('plan_overrides')
      .upsert(
        {
          organization_id: orgId,
          trial_end_override: newTrialEnd,
          updated_by: admin.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      )
      .select('organization_id, trial_end_override')

    if (error) {
      Sentry.captureException(error, {
        tags: { layer: 'admin', action: 'extendTrialAction', org_id: orgId },
      })
      return { ok: false, error: 'Database write failed. Check Sentry for details.' }
    }
  } catch (err) {
    // Catches the case where plan_overrides table does not exist yet (pre-push).
    Sentry.captureException(err, {
      tags: { layer: 'admin', action: 'extendTrialAction', org_id: orgId },
    })
    return {
      ok: false,
      error:
        'Could not write override — migration may not be pushed yet. Push 20260604130000_phase5_admin_overrides.sql first.',
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${orgId}`)

  return { ok: true, message: `Trial extended to ${new Date(newTrialEnd).toLocaleDateString('en-GB')}` }
}

// ---------------------------------------------------------------------------
// setCapOverrideAction — set/clear the cap_multiplier for an org.
//
// Input: orgId (uuid), capMultiplier (number > 0, or null to clear the override)
// Effect: upserts plan_overrides row with cap_multiplier = capMultiplier
//
// GATE: requireSuperAdmin() → only then createServiceClient()
// ---------------------------------------------------------------------------

const capOverrideSchema = z.object({
  orgId: z.string().uuid(),
  capMultiplier: z.number().positive().max(10).nullable(),
  note: z.string().max(500).optional(),
})

export async function setCapOverrideAction(
  orgId: string,
  capMultiplier: number | null,
  note?: string,
): Promise<AdminActionResult> {
  // GATE — must be first.
  const admin = await requireSuperAdmin()

  const parsed = capOverrideSchema.safeParse({ orgId, capMultiplier, note })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }

  const serviceClient = createServiceClient()
  const writeClient = serviceClient as unknown as PlanOverridesWriteClient

  try {
    if (capMultiplier === null) {
      // Clearing the cap. Read the current row to decide whether anything
      // meaningful remains. If the row has no trial_end_override either, there
      // is no reason to keep an empty shell with a stale note — DELETE it so
      // queries.ts hasOverride (computed from row existence / fields) stays
      // consistent. Otherwise, upsert with cap_multiplier=null AND note=null —
      // clearing the cap also clears the note (the note describes the cap).
      const { data: current, error: readError } = await writeClient
        .from('plan_overrides')
        .select('trial_end_override, cap_multiplier')
        .eq('organization_id', orgId)
        .maybeSingle()

      if (readError) {
        Sentry.captureException(readError, {
          tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
        })
        return { ok: false, error: 'Database read failed. Check Sentry for details.' }
      }

      if (!current || current.trial_end_override === null) {
        // Nothing meaningful left — remove the row entirely.
        const { error: deleteError } = await writeClient
          .from('plan_overrides')
          .delete()
          .eq('organization_id', orgId)

        if (deleteError) {
          Sentry.captureException(deleteError, {
            tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
          })
          return { ok: false, error: 'Database write failed. Check Sentry for details.' }
        }
      } else {
        // Trial override remains — keep the row but clear cap_multiplier and note.
        const { error } = await writeClient
          .from('plan_overrides')
          .upsert(
            {
              organization_id: orgId,
              cap_multiplier: null,
              note: null,
              updated_by: admin.id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'organization_id' },
          )
          .select('organization_id, cap_multiplier')

        if (error) {
          Sentry.captureException(error, {
            tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
          })
          return { ok: false, error: 'Database write failed. Check Sentry for details.' }
        }
      }
    } else {
      const { error } = await writeClient
        .from('plan_overrides')
        .upsert(
          {
            organization_id: orgId,
            cap_multiplier: capMultiplier,
            ...(note !== undefined ? { note } : {}),
            updated_by: admin.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id' },
        )
        .select('organization_id, cap_multiplier')

      if (error) {
        Sentry.captureException(error, {
          tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
        })
        return { ok: false, error: 'Database write failed. Check Sentry for details.' }
      }
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'admin', action: 'setCapOverrideAction', org_id: orgId },
    })
    return {
      ok: false,
      error:
        'Could not write override — migration may not be pushed yet. Push 20260604130000_phase5_admin_overrides.sql first.',
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${orgId}`)

  const label =
    capMultiplier === null
      ? 'Cap override cleared (reverted to plan default)'
      : `Cap multiplier set to ${capMultiplier}× (${Math.round((capMultiplier - 1) * 100)}% above plan default)`

  return { ok: true, message: label }
}

// ---------------------------------------------------------------------------
// grantManualAccessAction — give an org full access WITHOUT Stripe.
//
// For customers billed by invoice / bank transfer (no card). Writes an `active`
// subscription row with NO Stripe IDs — the entitlement gate treats `active` as
// entitled regardless of Stripe, so the org gets the full app and never sees the
// card paywall. This is the same "comp" mechanism used to grandfather existing
// orgs. Billing the customer (invoice + bank details) is a manual, out-of-app
// step; this action only grants access.
//
// GUARD: refuses to overwrite a LIVE Stripe subscription (stripe_subscription_id
// set) so a real paying org's billing can never be clobbered from here.
//
// GATE: requireSuperAdmin() → only then createServiceClient(). Writes to the
// subscriptions table are service-role only (RLS); subscriptions IS in the
// generated types, so no untyped cast is needed (unlike plan_overrides above).
// ---------------------------------------------------------------------------

const MANUAL_PLAN_KEYS = ['starter', 'pro', 'scale'] as const

const grantManualAccessSchema = z.object({
  orgId: z.string().uuid(),
  planKey: z.enum(MANUAL_PLAN_KEYS),
  seats: z.number().int().positive().max(500),
})

export async function grantManualAccessAction(
  orgId: string,
  planKey: string,
  seats: number,
): Promise<AdminActionResult> {
  // GATE — must be first, before any service-role client is created.
  await requireSuperAdmin()

  const parsed = grantManualAccessSchema.safeParse({ orgId, planKey, seats })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }

  const serviceClient = createServiceClient()

  // Never clobber a live Stripe subscription.
  const { data: existing, error: readError } = await serviceClient
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (readError) {
    Sentry.captureException(readError, {
      tags: { layer: 'admin', action: 'grantManualAccessAction', org_id: orgId },
    })
    return { ok: false, error: 'Database read failed. Check Sentry for details.' }
  }
  if (existing?.stripe_subscription_id) {
    return {
      ok: false,
      error: 'This org has a live Stripe subscription — manage it in Stripe, not here.',
    }
  }

  const { error } = await serviceClient.from('subscriptions').upsert(
    {
      organization_id: parsed.data.orgId,
      plan_key: parsed.data.planKey,
      plan_seats: parsed.data.seats,
      status: 'active',
      // Invoice-billed access — no Stripe subscription. We deliberately OMIT the
      // stripe_* columns: on a NEW row they default to null; on an existing row
      // (guarded above to have no live subscription) they're preserved, so we
      // never null an org's stripe_customer_id out from under the billing tables.
      trial_end: null,
      current_period_end: null,
    },
    { onConflict: 'organization_id' },
  )

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'admin', action: 'grantManualAccessAction', org_id: orgId },
    })
    return { ok: false, error: 'Database write failed. Check Sentry for details.' }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${orgId}`)

  const seatLabel = `${parsed.data.seats} seat${parsed.data.seats === 1 ? '' : 's'}`
  return {
    ok: true,
    message: `Manual access granted — ${parsed.data.planKey} plan, ${seatLabel} (invoice-billed, no Stripe).`,
  }
}

// ---------------------------------------------------------------------------
// revokeManualAccessAction — end an org's manual/invoice access.
//
// Resets the manual subscription row to `none` (the entitlement gate then treats
// the org as not-entitled, so it returns to the paywall). We use `none` rather
// than `cancelled` so the paywall offers the start-subscription path cleanly
// instead of a Stripe "manage billing" button that would dead-end for an org
// that never had a Stripe customer. Refuses to touch a Stripe-billed org —
// cancel those in Stripe.
// ---------------------------------------------------------------------------

const revokeManualAccessSchema = z.object({ orgId: z.string().uuid() })

export async function revokeManualAccessAction(orgId: string): Promise<AdminActionResult> {
  await requireSuperAdmin()

  const parsed = revokeManualAccessSchema.safeParse({ orgId })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }

  const serviceClient = createServiceClient()

  const { data: existing, error: readError } = await serviceClient
    .from('subscriptions')
    .select('stripe_subscription_id, status')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (readError) {
    Sentry.captureException(readError, {
      tags: { layer: 'admin', action: 'revokeManualAccessAction', org_id: orgId },
    })
    return { ok: false, error: 'Database read failed. Check Sentry for details.' }
  }
  if (!existing) {
    return { ok: false, error: 'This org has no subscription to revoke.' }
  }
  if (existing.stripe_subscription_id) {
    return { ok: false, error: 'This org is on Stripe billing — cancel it in Stripe, not here.' }
  }
  if (existing.status !== 'active') {
    return { ok: false, error: 'This org has no active manual access to revoke.' }
  }

  const { error } = await serviceClient
    .from('subscriptions')
    .update({ status: 'none' })
    .eq('organization_id', orgId)

  if (error) {
    Sentry.captureException(error, {
      tags: { layer: 'admin', action: 'revokeManualAccessAction', org_id: orgId },
    })
    return { ok: false, error: 'Database write failed. Check Sentry for details.' }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/${orgId}`)

  return { ok: true, message: 'Manual access revoked — the org will see the paywall on next load.' }
}

// ---------------------------------------------------------------------------
// provisionExternalOrgAction — one-click onboarding of a NEW external customer
// (handover blocker 3).
//
// Creates the customer's auth user (the on_auth_user_created trigger builds
// their isolated org + owner row from the metadata), comps the org with
// invoice-billed access, sets a per-org monthly AI-spend cap, and emails them a
// login link via Resend. Because the comp + cap are written BEFORE the link is
// sent, the customer never hits the first-login paywall/card screen, and the
// Resend-sent link bypasses Supabase's auth-email throttle entirely.
//
// GATE: requireSuperAdmin() first, before any service-role client.
// ---------------------------------------------------------------------------

const provisionExternalOrgSchema = z.object({
  email: z.string().email(),
  orgName: z.string().min(1).max(200),
  fullName: z.string().max(200).optional(),
  planKey: z.enum(MANUAL_PLAN_KEYS),
  seats: z.number().int().positive().max(500),
  // null = no per-org cap (global backstop still applies). 0 = freeze all AI.
  monthlySpendCapPence: z.number().int().min(0).max(10_000_000).nullable(),
})

// Absolute origin for building the login link. Prefers the configured public
// site URL; falls back to the request host (safe on Vercel).
async function resolveSiteUrl(): Promise<string> {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'altusrecruit.com'
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

function provisionWelcomeHtml(args: { orgName: string; loginUrl: string; siteUrl: string }): string {
  // Minimal branded welcome email. The orgName is operator-entered (trusted),
  // but escape it anyway for defence in depth in email clients.
  const safeOrg = args.orgName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h1 style="font-size:20px;color:#0A3D5C;margin:0 0 16px">Welcome to Altus</h1>
  <p style="margin:0 0 16px">Your workspace for <strong>${safeOrg}</strong> is ready. Click below to sign in — no password needed.</p>
  <p style="margin:0 0 24px">
    <a href="${args.loginUrl}" style="display:inline-block;background:#0A3D5C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Sign in to Altus</a>
  </p>
  <p style="font-size:13px;color:#6b7280;margin:0 0 8px">This link signs you in directly and expires after a short while. If it has expired, you can request a fresh link any time at <a href="${args.siteUrl}/sign-in" style="color:#0A3D5C">${args.siteUrl}/sign-in</a> using this email address.</p>
  <p style="font-size:12px;color:#9ca3af;margin:16px 0 0">If you weren't expecting this, you can ignore this email.</p>
</body></html>`
}

export async function provisionExternalOrgAction(input: {
  email: string
  orgName: string
  fullName?: string
  planKey: string
  seats: number
  monthlySpendCapPence: number | null
}): Promise<AdminActionResult> {
  // GATE — must be first.
  const admin = await requireSuperAdmin()

  const parsed = provisionExternalOrgSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input: ' + parsed.error.message }
  }
  const { email, orgName, fullName, planKey, seats, monthlySpendCapPence } = parsed.data

  const serviceClient = createServiceClient()

  // 1. Create the confirmed auth user. The on_auth_user_created trigger
  //    (handle_new_user) creates the isolated org + owner row from the metadata,
  //    inside the same transaction — so the org exists once this resolves.
  const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      organization_name: orgName,
      ...(fullName ? { full_name: fullName } : {}),
    },
  })
  if (createErr || !created?.user) {
    const alreadyExists = (createErr?.message ?? '').toLowerCase().includes('already')
    if (!alreadyExists) {
      Sentry.captureException(createErr ?? new Error('provision: createUser returned no user'), {
        tags: { layer: 'admin', action: 'provisionExternalOrgAction', step: 'createUser' },
      })
    }
    return {
      ok: false,
      error: alreadyExists
        ? `A user with ${email} already exists — this tool is for brand-new customers only.`
        : 'Could not create the user. Check Sentry for details.',
    }
  }
  const userId = created.user.id

  // 2. Resolve the org the trigger just created for this user.
  const { data: userRow, error: userErr } = await serviceClient
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle()
  if (userErr || !userRow?.organization_id) {
    Sentry.captureException(userErr ?? new Error('provision: org row missing after createUser'), {
      tags: { layer: 'admin', action: 'provisionExternalOrgAction', step: 'resolveOrg' },
    })
    return {
      ok: false,
      error: 'User created, but their organisation could not be resolved. Check /admin and Supabase.',
    }
  }
  const orgId = userRow.organization_id

  // 3. Comp the org: active, invoice-billed, no Stripe (same shape as
  //    grantManualAccessAction). This lifts the paywall + allows AI.
  const { error: subErr } = await serviceClient.from('subscriptions').upsert(
    {
      organization_id: orgId,
      plan_key: planKey,
      plan_seats: seats,
      status: 'active',
      trial_end: null,
      current_period_end: null,
    },
    { onConflict: 'organization_id' },
  )
  if (subErr) {
    Sentry.captureException(subErr, {
      tags: { layer: 'admin', action: 'provisionExternalOrgAction', step: 'subscription', org_id: orgId },
    })
    return {
      ok: false,
      error: 'User + org created, but granting access failed. Use Manual access on the org page.',
    }
  }

  // 4. Set the per-org monthly AI-spend ceiling (cost guardrail). Non-fatal:
  //    if it fails, access is still granted and the global env backstop applies.
  if (monthlySpendCapPence !== null) {
    const overrideClient = serviceClient as unknown as {
      from: (table: 'plan_overrides') => {
        upsert: (
          payload: {
            organization_id: string
            monthly_spend_cap_pence: number
            note: string
            updated_by: string
            updated_at: string
          },
          opts: { onConflict: string },
        ) => Promise<{ error: unknown }>
      }
    }
    const { error: capErr } = await overrideClient.from('plan_overrides').upsert(
      {
        organization_id: orgId,
        monthly_spend_cap_pence: monthlySpendCapPence,
        note: `External trial — £${(monthlySpendCapPence / 100).toFixed(2)}/mo AI cap (provisioned)`,
        updated_by: admin.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    )
    if (capErr) {
      Sentry.captureException(capErr, {
        tags: { layer: 'admin', action: 'provisionExternalOrgAction', step: 'spendCap', org_id: orgId },
      })
    }
  }

  // 5. Generate a magic login link and email it via Resend (bypasses the
  //    Supabase auth-email throttle). Non-fatal: if it fails, the account
  //    already exists, so the customer can sign in at /sign-in instead.
  const siteUrl = await resolveSiteUrl()
  let emailed = false
  const { data: linkData, error: linkErr } = await serviceClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (!linkErr && tokenHash) {
    const loginUrl = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink&next=%2F`
    const sendResult = await sendResendEmail({
      to: email,
      subject: 'Your Altus account is ready',
      html: provisionWelcomeHtml({ orgName, loginUrl, siteUrl }),
    })
    emailed = sendResult.ok
    if (!sendResult.ok) {
      Sentry.captureMessage('provision: welcome email send failed', {
        level: 'warning',
        tags: { layer: 'admin', action: 'provisionExternalOrgAction', reason: sendResult.reason },
      })
    }
  } else if (linkErr) {
    Sentry.captureException(linkErr, {
      tags: { layer: 'admin', action: 'provisionExternalOrgAction', step: 'generateLink', org_id: orgId },
    })
  }

  revalidatePath('/admin')

  const capLabel =
    monthlySpendCapPence !== null ? `, £${(monthlySpendCapPence / 100).toFixed(2)}/mo AI cap` : ''
  return {
    ok: true,
    message: emailed
      ? `Provisioned "${orgName}" (${planKey}${capLabel}) and emailed a login link to ${email}.`
      : `Provisioned "${orgName}" (${planKey}${capLabel}), but the login email could NOT be sent — have them sign in at ${siteUrl}/sign-in (their account already exists).`,
  }
}

// ---------------------------------------------------------------------------
// eraseOrganizationAction — IRREVERSIBLY erase an org (GDPR Art.17, item 6).
//
// Deletes, in order:
//   1. ALL Storage objects under <org_id>/ in the cvs / spec-audio /
//      voice-note-audio buckets (storage is NOT cascade-deleted by the DB).
//   2. ALL Supabase auth users in the org (cascades public.users; nulls
//      created_by on their authored rows — needs migration 20260625130000).
//   3. The organizations row — which CASCADE-deletes every org-scoped table.
//
// Storage runs FIRST so a storage failure aborts before any DB destruction
// (the org is left intact and the admin can retry). The global
// stripe_webhook_events ledger is intentionally untouched.
//
// SAFETY GUARDS:
//   - requireSuperAdmin() first.
//   - `confirmation` must EXACTLY equal the org slug (type-to-confirm).
//   - Refuses to erase the calling admin's OWN org.
//   - Refuses an org with a LIVE Stripe subscription (cancel in Stripe first,
//     so erasure can never leave a dangling paid subscription).
// ---------------------------------------------------------------------------

const eraseOrgSchema = z.object({
  orgId: z.string().uuid(),
  confirmation: z.string().min(1).max(200),
})

export async function eraseOrganizationAction(
  orgId: string,
  confirmation: string,
): Promise<AdminActionResult> {
  // GATE — must be first.
  const admin = await requireSuperAdmin()

  const parsed = eraseOrgSchema.safeParse({ orgId, confirmation })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input.' }
  }

  const serviceClient = createServiceClient()

  // Load the org (name + slug) for confirmation matching + the success message.
  const { data: org, error: orgErr } = await serviceClient
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .maybeSingle()
  if (orgErr) {
    Sentry.captureException(orgErr, {
      tags: { layer: 'admin', action: 'eraseOrganizationAction', step: 'load_org', org_id: orgId },
    })
    return { ok: false, error: 'Database read failed. Check Sentry for details.' }
  }
  if (!org) {
    return { ok: false, error: 'Organisation not found — it may already be erased.' }
  }

  // Type-to-confirm: the typed value must match the slug exactly.
  if (parsed.data.confirmation.trim() !== org.slug) {
    return {
      ok: false,
      error: `Confirmation does not match. Type the org slug exactly to erase: ${org.slug}`,
    }
  }

  // Never let an admin erase the org they themselves belong to. Fail CLOSED if
  // the admin's own users row can't be resolved — for an irreversible op we
  // must positively confirm this isn't a self-erase before proceeding.
  const { data: adminRow, error: adminRowErr } = await serviceClient
    .from('users')
    .select('organization_id')
    .eq('id', admin.id)
    .maybeSingle()
  if (adminRowErr || !adminRow) {
    Sentry.captureException(adminRowErr ?? new Error('erase: admin users row missing'), {
      tags: { layer: 'admin', action: 'eraseOrganizationAction', step: 'admin_org', org_id: orgId },
    })
    return { ok: false, error: 'Could not verify your own organisation. Sign out and back in, then retry.' }
  }
  if (adminRow.organization_id === orgId) {
    return { ok: false, error: 'You cannot erase your own organisation.' }
  }

  // Refuse a live Stripe subscription — erasing the org would NOT cancel it in
  // Stripe, leaving a dangling paid subscription. Cancel in Stripe first.
  const { data: sub } = await serviceClient
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (sub?.stripe_subscription_id) {
    return {
      ok: false,
      error: 'This org has a live Stripe subscription — cancel it in Stripe before erasing.',
    }
  }

  // 1. Storage FIRST (so a storage failure leaves the DB intact + retryable).
  let storageDeleted = 0
  try {
    storageDeleted = await deleteAllOrgStorage(serviceClient, orgId)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'admin', action: 'eraseOrganizationAction', step: 'storage', org_id: orgId },
    })
    return {
      ok: false,
      error: 'Could not delete the org files. Nothing was erased — please try again.',
    }
  }

  // 2. Auth users (cascades public.users). Needs migration 20260625130000 so the
  //    created_by RESTRICT FKs don't block deletion.
  let usersResult: { deleted: number; failed: number }
  try {
    usersResult = await deleteOrgAuthUsers(serviceClient, orgId)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { layer: 'admin', action: 'eraseOrganizationAction', step: 'users', org_id: orgId },
    })
    return {
      ok: false,
      error: 'Files were deleted, but removing the org users failed. Re-run erase to finish.',
    }
  }
  if (usersResult.failed > 0) {
    return {
      ok: false,
      error: `Removed ${usersResult.deleted} user(s) but ${usersResult.failed} failed (the org record was NOT deleted). This usually means migration 20260625130000 has not been pushed. Push it, then re-run erase.`,
    }
  }

  // 3. Delete the org row — CASCADE removes all remaining org-scoped tables.
  const { error: delErr } = await serviceClient.from('organizations').delete().eq('id', orgId)
  if (delErr) {
    Sentry.captureException(delErr, {
      tags: { layer: 'admin', action: 'eraseOrganizationAction', step: 'delete_org', org_id: orgId },
    })
    return {
      ok: false,
      error: 'Files + users were removed, but deleting the org record failed. Check Sentry.',
    }
  }

  revalidatePath('/admin')
  return {
    ok: true,
    message: `Erased "${org.name}" — ${storageDeleted} file(s), ${usersResult.deleted} user(s), and all org data deleted.`,
  }
}
