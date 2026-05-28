'use server'

// Quick task 260524-b6v: in-app feedback widget server action.
//
// Persists a feedback row to public.feedback (tenant-scoped via RLS + the
// feedback_set_org trigger), then fires a best-effort email notification via
// Resend. The DB write is canonical — if Resend fails (no key set, transport
// error, non-2xx) we still return ok:true to the user because the row is
// safely stored and an internal operator can read it from the dashboard.
//
// PII guard (CLAUDE.md): we NEVER pass the feedback `body` text into Sentry.
// Only the error object + a static `feature: 'feedback'` tag are captured.

import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { sendResendEmail } from '@/lib/email/resend'
import { getProfile } from '@/lib/db/profiles'
import { createClient } from '@/lib/supabase/server'
import type { TablesInsert } from '@/types/database'

// Resend's `onboarding@resend.dev` sender can only deliver to the email
// registered on the Resend account. Until a real sending domain is verified
// (e.g. `altus-consultancy.com` -> `feedback@altus-consultancy.com`), this
// must match the Resend account email or sends will silently 403.
//
// TODO: once a sending domain is verified in Resend, switch this to
// aj@altus-consultancy.com (or make it RESEND_FEEDBACK_RECIPIENT env var).
const FEEDBACK_RECIPIENT = 'professorparpinsons@outlook.com'

const submitFeedbackSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Please enter some feedback')
    .max(2000, 'Max 2000 characters'),
  page_url: z.string().max(2000).optional().nullable(),
  user_agent: z.string().max(1000).optional().nullable(),
})

export type SubmitFeedbackResult =
  | { ok: true }
  | { ok: false; formError: string }
  | { ok: false; fieldErrors: { body?: string[] } }

export async function submitFeedbackAction(input: unknown): Promise<SubmitFeedbackResult> {
  const parsed = submitFeedbackSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    return {
      ok: false,
      fieldErrors: {
        body: fieldErrors.body,
      },
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Middleware should have already redirected unauthenticated traffic; this
  // is defence in depth for any path the matcher doesn't cover.
  if (!user) {
    return { ok: false, formError: 'Not signed in' }
  }

  // Profile is used purely to enrich the outbound email. If it fails we still
  // attempt the insert — the row is the canonical record.
  const profile = await getProfile(supabase, user.id)
  const profileData = profile.ok ? profile.data : null

  // Do NOT pass organization_id from the client — the feedback_set_org trigger
  // auto-fills it from auth context and RLS WITH CHECK validates correctness.
  //
  // reason: TablesInsert<'feedback'> declares organization_id as required
  // (regen reflects the `not null` column even though the BEFORE-INSERT
  // trigger fills it for authenticated callers). Pattern matches
  // src/lib/db/spec-drafts.ts:106–116.
  const payload = {
    submitted_by: user.id,
    body: parsed.data.body,
    page_url: parsed.data.page_url ?? null,
    user_agent: parsed.data.user_agent ?? null,
  } as unknown as TablesInsert<'feedback'>

  const { error: insertErr } = await supabase.from('feedback').insert(payload)

  if (insertErr) {
    // PII guard: only the static tag + the error object. Never include `body`.
    Sentry.captureException(insertErr, { tags: { feature: 'feedback' } })
    return { ok: false, formError: 'Could not save feedback. Please try again.' }
  }

  // Bonus: email a human-readable copy. Best-effort — failure does not change
  // the user-visible outcome.
  try {
    let orgName: string | null = null
    if (profileData?.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', profileData.organization_id)
        .maybeSingle()
      orgName = org?.name ?? null
    }

    const fullName = profileData?.full_name ?? '(no name)'
    const userEmail = profileData?.email ?? user.email ?? '(no email)'
    const pageUrl = parsed.data.page_url ?? '(no page url)'

    // Plaintext only — never populate `html` with user-controlled strings.
    // T-260524-b6v-05: HTML injection mitigation.
    const text = [
      `From: ${fullName} <${userEmail}>`,
      `Org: ${orgName ?? '(unknown)'}`,
      `Page: ${pageUrl}`,
      '',
      '----------------------------------------',
      '',
      parsed.data.body,
    ].join('\n')

    const result = await sendResendEmail({
      to: FEEDBACK_RECIPIENT,
      subject: `Altus feedback — ${orgName ?? 'unknown org'}`,
      text,
    })

    if (!result.ok && result.reason === 'http_error') {
      // no_api_key is expected in dev — don't log it. Only log real failures.
      Sentry.captureMessage('resend_send_failed', {
        level: 'warning',
        tags: { feature: 'feedback', step: 'resend' },
        extra: { status: result.status, message: result.message },
      })
    }
  } catch (emailErr) {
    Sentry.captureException(emailErr, {
      tags: { feature: 'feedback', step: 'resend' },
    })
    // Fall through — DB row is canonical.
  }

  return { ok: true }
}
