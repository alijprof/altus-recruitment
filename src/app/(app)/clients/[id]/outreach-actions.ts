'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { sendMail } from '@/lib/integrations/outlook'
import { inngest } from '@/lib/inngest/client'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Plan 03-05 / Task E.2 — REPEAT-01 + D3-20 + D3-21.
//
// Two server actions:
//   1. requestOutreachDraftAction({ clientId })
//        Fires `outreach-draft/requested` Inngest event. Returns immediately
//        with { ok: true, draftPending: true }. The UI polls
//        getLatestOutreachDraftAction until the draft activity row appears.
//   2. sendOutreachAction({ clientId, subject, body_html })
//        Synchronous (recruiter is at the keyboard). Resolves the primary
//        contact email, calls outlook.sendMail. On needs_consent surfaces
//        the consentUrl so the modal can render a banner link. On success
//        flips the prior email_draft activity row to kind='email' and
//        stamps metadata.sent_at = now() (D3-21).
//
// Pattern per PATTERNS §5 (mirror jobs/[id]/actions.ts):
//   - Zod safeParse
//   - await createClient + auth.getUser defensive check
//   - call DB helper or integration
//   - surface generic error string
//   - revalidatePath for every affected surface
//   - discriminated union return
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid()

// ---------------------------------------------------------------------------
// 1. Request a Sonnet draft (fire-and-forget)
// ---------------------------------------------------------------------------

const requestDraftSchema = z.object({ clientId: idSchema })

export type RequestOutreachDraftResult =
  | { ok: true; draftPending: true }
  | { ok: false; error: string }

export async function requestOutreachDraftAction(
  rawInput: unknown,
): Promise<RequestOutreachDraftResult> {
  const parsed = requestDraftSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid client id.' }
  }

  // Entitlement gate — outreach draft drives Sonnet spend; block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Not signed in.' }
  }

  // Resolve the recruiter's organization_id from the users row. The Inngest
  // function uses service-role and needs organization_id passed explicitly
  // (HARD RULE 4 tenant boundary).
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr || !profile) {
    Sentry.captureException(profileErr, {
      tags: {
        phase: 'p3',
        layer: 'action',
        helper: 'requestOutreachDraftAction',
        subop: 'resolve-profile',
      },
    })
    return { ok: false, error: 'Could not resolve your organization.' }
  }

  try {
    await inngest.send({
      name: 'outreach-draft/requested',
      data: {
        organization_id: profile.organization_id,
        company_id: parsed.data.clientId,
        user_id: user.id,
      },
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${name}: outreach-draft/requested dispatch failed`), {
      tags: {
        phase: 'p3',
        layer: 'action',
        helper: 'requestOutreachDraftAction',
        subop: 'inngest.send',
      },
    })
    return { ok: false, error: 'Could not start the draft. Please try again.' }
  }

  return { ok: true, draftPending: true }
}

// ---------------------------------------------------------------------------
// 2. Get the latest email_draft activity for a client (polling target)
// ---------------------------------------------------------------------------

const getDraftSchema = z.object({ clientId: idSchema })

export type LatestOutreachDraft = {
  activity_id: string
  subject: string
  body_html: string
  created_at: string
}

export type GetLatestOutreachDraftResult =
  | { ok: true; data: LatestOutreachDraft | null }
  | { ok: false; error: string }

export async function getLatestOutreachDraftAction(
  rawInput: unknown,
): Promise<GetLatestOutreachDraftResult> {
  const parsed = getDraftSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid client id.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Not signed in.' }
  }

  // reason: 'email_draft' enum value is added in this plan's migration; the
  // generated Database types may not include it yet — cast at the boundary.
  const filterKind = 'email_draft' as unknown as 'email'

  const { data, error } = await supabase
    .from('activities')
    .select('id, occurred_at, metadata')
    .eq('entity_type', 'company')
    .eq('entity_id', parsed.data.clientId)
    .eq('kind', filterKind)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, {
      tags: {
        phase: 'p3',
        layer: 'action',
        helper: 'getLatestOutreachDraftAction',
      },
    })
    return { ok: false, error: 'Could not fetch the draft.' }
  }

  if (!data) {
    return { ok: true, data: null }
  }

  const meta = (data.metadata ?? {}) as { subject?: string; body_html?: string }
  if (typeof meta.subject !== 'string' || typeof meta.body_html !== 'string') {
    return { ok: true, data: null }
  }

  return {
    ok: true,
    data: {
      activity_id: data.id,
      subject: meta.subject,
      body_html: meta.body_html,
      created_at: data.occurred_at,
    },
  }
}

// ---------------------------------------------------------------------------
// 3. Send the (recruiter-edited) draft via Outlook + flip the activity row
// ---------------------------------------------------------------------------

const sendSchema = z.object({
  clientId: idSchema,
  subject: z.string().trim().min(1).max(200),
  body_html: z.string().trim().min(1).max(50_000),
})

export type SendOutreachResult =
  | { ok: true }
  | { ok: false; error: 'reconnect_required'; consentUrl: string }
  | { ok: false; error: string }

export async function sendOutreachAction(rawInput: unknown): Promise<SendOutreachResult> {
  const parsed = sendSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid email content.' }
  }
  const { clientId, subject, body_html } = parsed.data

  // Entitlement gate — sending outreach is a paid action; block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Not signed in.' }
  }

  // Resolve the caller's org up-front so the service-role activity write below
  // can be scoped to it. Service-role bypasses RLS, so without an
  // organization_id predicate a forged activity id could touch another
  // tenant's row (M-6a).
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr || !profile) {
    Sentry.captureException(profileErr, {
      tags: { phase: 'p3', layer: 'action', helper: 'sendOutreachAction', subop: 'resolve-profile' },
    })
    return { ok: false, error: 'Could not resolve your organization.' }
  }

  // Resolve recipient email — first contact on the company with a non-null
  // email. The /clients/[id] page already enforces contacts must exist for
  // dormant outreach to be meaningful; we surface a friendly error if the
  // recruiter hasn't added one yet.
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('id, email, full_name')
    .eq('company_id', clientId)
    .not('email', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (contactErr) {
    Sentry.captureException(contactErr, {
      tags: { phase: 'p3', layer: 'action', helper: 'sendOutreachAction', subop: 'contact' },
    })
    return { ok: false, error: 'Could not resolve a contact email for this client.' }
  }
  if (!contact?.email) {
    return {
      ok: false,
      error: 'No contact with an email on file for this client. Add a contact first.',
    }
  }

  // Send via Microsoft Graph. The helper handles the needs_consent branch
  // (cached scope missing) and the Pitfall 9 branch (Graph 403 mid-session).
  const sendResult = await sendMail(supabase, {
    userId: user.id,
    to: contact.email,
    subject,
    html: body_html,
  })

  if (!sendResult.ok) {
    if (sendResult.code === 'needs_consent') {
      return { ok: false, error: 'reconnect_required', consentUrl: sendResult.consentUrl }
    }
    if (sendResult.code === 'not_connected') {
      return { ok: false, error: 'Connect Outlook first in Settings before sending.' }
    }
    return { ok: false, error: 'Could not send the email. Please try again.' }
  }

  // Flip the most recent email_draft activity row to kind='email' and stamp
  // metadata.sent_at = now(). Service-role write because we have a stable
  // user-scoped path and need to update metadata atomically — RLS would
  // permit it as the recruiter, but the helper composes the metadata patch
  // explicitly so we keep it simple.
  // Single send timestamp shared by the activity metadata AND the company
  // last_contacted_at bump so the timeline and the Dormant badge agree.
  const sentAt = new Date().toISOString()
  try {
    const service = createServiceClient()
    const filterKind = 'email_draft' as unknown as 'email'
    const { data: existing } = await service
      .from('activities')
      .select('id, metadata')
      .eq('entity_type', 'company')
      .eq('entity_id', clientId)
      .eq('kind', filterKind)
      .eq('organization_id', profile.organization_id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      const prevMeta = (existing.metadata ?? {}) as Record<string, unknown>
      // Capture the flip UPDATE error instead of discarding it — a silent
      // failure here leaves the timeline showing a draft for a sent email.
      const { error: flipError } = await service
        .from('activities')
        .update({
          // 'email' is part of the enum from Phase 1 — no cast needed.
          kind: 'email',
          body: subject,
          metadata: {
            ...prevMeta,
            subject,
            body_html,
            sent_at: sentAt,
            sent_to: contact.email,
          },
        })
        // Defence-in-depth: scope the service-role write to the caller's org
        // (resolved up-front) so a forged id can't cross tenants (M-6a).
        .eq('id', existing.id)
        .eq('organization_id', profile.organization_id)
      if (flipError) {
        // Name-only Sentry capture (no email/body PII). The email already
        // sent, so a flip failure is logged, not fatal.
        const name = flipError instanceof Error ? flipError.name : 'PostgrestError'
        Sentry.captureException(new Error(`${name}: outreach draft flip failed`), {
          tags: {
            phase: 'p3',
            layer: 'action',
            helper: 'sendOutreachAction',
            subop: 'flip-draft',
          },
        })
      }
    } else {
      // No prior draft row — create a fresh email activity so the timeline
      // reflects the send. This branch only triggers if the recruiter sent
      // before the draft row landed (unlikely but defensive). Reuse the org +
      // user already resolved above rather than re-fetching.
      await service.from('activities').insert({
        organization_id: profile.organization_id,
        kind: 'email',
        entity_type: 'company',
        entity_id: clientId,
        body: subject,
        actor_user_id: user.id,
        metadata: { subject, body_html, sent_at: sentAt, sent_to: contact.email },
      })
    }

    // The activities_bump_last_contacted trigger fires AFTER INSERT only, so
    // flipping the draft via UPDATE never bumps companies.last_contacted_at and
    // the Dormant badge never clears. Bump it explicitly, org-scoped. Failure
    // is logged name-only, not fatal — the email already sent.
    const { error: bumpError } = await service
      .from('companies')
      .update({ last_contacted_at: sentAt })
      .eq('id', clientId)
      .eq('organization_id', profile.organization_id)
    if (bumpError) {
      const name = bumpError instanceof Error ? bumpError.name : 'PostgrestError'
      Sentry.captureException(new Error(`${name}: last_contacted_at bump failed`), {
        tags: {
          phase: 'p3',
          layer: 'action',
          helper: 'sendOutreachAction',
          subop: 'bump-last-contacted',
        },
      })
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${name}: post-send activity update failed`), {
      tags: {
        phase: 'p3',
        layer: 'action',
        helper: 'sendOutreachAction',
        subop: 'activity-update',
      },
    })
    // Don't block — the email did send. The activity log is best-effort.
  }

  revalidatePath('/')
  revalidatePath(`/clients/${clientId}`)
  return { ok: true }
}
