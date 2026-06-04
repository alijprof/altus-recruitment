// Billing transactional emails — 05-01 Task 1.2 / Task 1.4
//
// All three helpers are BEST-EFFORT: they never throw into the caller.
// The pattern mirrors the invite-email helpers in settings/team/actions.ts:
// fire the Resend send, log failures to Sentry (without PII), and let the
// caller continue regardless of email delivery success.
//
// PII discipline (CLAUDE.md): never include customer email or org name in
// Sentry captures — org_id and event-type tags only.

import 'server-only'

import * as Sentry from '@sentry/nextjs'

import { sendResendEmail } from '@/lib/email/resend'
import { renderTransactionalEmail, renderTransactionalEmailText } from '@/lib/email/render'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Resolve the owner's email address for the given org so billing emails reach
// the right person. Uses service-role — these helpers are called from webhook
// context (no user session).
// Returns null if unresolvable (best-effort; caller skips the send).
// ---------------------------------------------------------------------------
async function resolveOwnerEmail(organizationId: string): Promise<string | null> {
  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient
    .from('users')
    .select('email')
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.email ?? null
}

// ---------------------------------------------------------------------------
// sendCapWarningEmail — fires when an org crosses the 80% soft cap on any
// AI usage bucket. Called ONLY after a successful INSERT into
// ai_cap_notifications (unique constraint guarantees once-per-bucket-per-month).
// ---------------------------------------------------------------------------
export async function sendCapWarningEmail(args: {
  organizationId: string
  bucket: string
  percentUsed: number
}): Promise<void> {
  try {
    const to = await resolveOwnerEmail(args.organizationId)
    if (!to) return // no owner email found — skip

    const bucketLabel: Record<string, string> = {
      matchScores: 'Match scoring',
      cvParses: 'CV parsing',
      searches: 'Semantic search',
      specMinutes: 'Spec call transcription',
      writingCalls: 'AI writing',
    }
    const label = bucketLabel[args.bucket] ?? args.bucket
    const pct = Math.round(args.percentUsed)

    const html = renderTransactionalEmail({
      preheader: `You've used ${pct}% of your ${label} allowance this month`,
      heading: `You're approaching your ${label} limit`,
      paragraphs: [
        `Your team has used ${pct}% of this month's ${label} allowance on Altus Recruit.`,
        'AI features continue to work, but you may want to upgrade your plan to avoid hitting the limit.',
      ],
      button: { label: 'Manage your plan', url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing` },
      footerNote: "You'll receive this notification at most once per feature per month.",
    })
    const text = renderTransactionalEmailText({
      preheader: `You've used ${pct}% of your ${label} allowance this month`,
      heading: `You're approaching your ${label} limit`,
      paragraphs: [
        `Your team has used ${pct}% of this month's ${label} allowance on Altus Recruit.`,
        'AI features continue to work, but you may want to upgrade your plan to avoid hitting the limit.',
      ],
      button: { label: 'Manage your plan', url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing` },
      footerNote: "You'll receive this notification at most once per feature per month.",
    })

    const result = await sendResendEmail({
      to,
      subject: `You've used ${pct}% of your ${label} allowance`,
      html,
      text,
    })

    if (!result.ok && result.reason === 'http_error') {
      Sentry.captureMessage('billing_email_failed', {
        level: 'warning',
        tags: {
          layer: 'email',
          helper: 'sendCapWarningEmail',
          organization_id: args.organizationId,
        },
      })
    }
  } catch (err) {
    // Never throw into caller — best-effort.
    Sentry.captureException(err, {
      tags: {
        layer: 'email',
        helper: 'sendCapWarningEmail',
        organization_id: args.organizationId,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// sendTrialEndingEmail — fires on customer.subscription.trial_will_end
// (Stripe sends this 3 days before trial end by default).
// ---------------------------------------------------------------------------
export async function sendTrialEndingEmail(args: {
  organizationId: string
  trialEnd: number | null
}): Promise<void> {
  try {
    const to = await resolveOwnerEmail(args.organizationId)
    if (!to) return

    const trialEndDate = args.trialEnd
      ? new Date(args.trialEnd * 1000).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'soon'

    const html = renderTransactionalEmail({
      preheader: `Your Altus Recruit trial ends on ${trialEndDate}`,
      heading: 'Your free trial is ending soon',
      paragraphs: [
        `Your 14-day free trial ends on ${trialEndDate}.`,
        'After that, your plan will continue and your card on file will be charged. You can manage or cancel your subscription at any time.',
      ],
      button: {
        label: 'Manage your plan',
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing`,
      },
    })
    const text = renderTransactionalEmailText({
      preheader: `Your Altus Recruit trial ends on ${trialEndDate}`,
      heading: 'Your free trial is ending soon',
      paragraphs: [
        `Your 14-day free trial ends on ${trialEndDate}.`,
        'After that, your plan will continue and your card on file will be charged.',
      ],
      button: {
        label: 'Manage your plan',
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing`,
      },
    })

    await sendResendEmail({
      to,
      subject: 'Your Altus Recruit trial is ending soon',
      html,
      text,
    })
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        layer: 'email',
        helper: 'sendTrialEndingEmail',
        organization_id: args.organizationId,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// sendPaymentFailedEmail — fires on invoice.payment_failed.
// ---------------------------------------------------------------------------
export async function sendPaymentFailedEmail(args: { organizationId: string }): Promise<void> {
  try {
    const to = await resolveOwnerEmail(args.organizationId)
    if (!to) return

    const html = renderTransactionalEmail({
      preheader: 'Action required: your Altus Recruit payment failed',
      heading: 'Payment failed',
      paragraphs: [
        'We were unable to process your Altus Recruit subscription payment.',
        'Please update your payment method to avoid any interruption to your service.',
      ],
      button: {
        label: 'Update payment method',
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing`,
      },
    })
    const text = renderTransactionalEmailText({
      preheader: 'Action required: your Altus Recruit payment failed',
      heading: 'Payment failed',
      paragraphs: [
        'We were unable to process your Altus Recruit subscription payment.',
        'Please update your payment method to avoid any interruption to your service.',
      ],
      button: {
        label: 'Update payment method',
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/settings/billing`,
      },
    })

    await sendResendEmail({
      to,
      subject: 'Action required: your Altus Recruit payment failed',
      html,
      text,
    })
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        layer: 'email',
        helper: 'sendPaymentFailedEmail',
        organization_id: args.organizationId,
      },
    })
  }
}
