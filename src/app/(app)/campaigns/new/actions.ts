'use server'

import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import {
  getCampaignSegment,
  createCampaign,
  insertCampaignRecipients,
  findRecentDuplicateCampaign,
} from '@/lib/db/campaigns'
import { getProfile } from '@/lib/db/profiles'
import { inngest } from '@/lib/inngest/client'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Campaign server actions (Plan 04-04 / MARKET-03).
//
// Two actions:
//   previewCampaignAction — read-only: returns consented segment count + sample.
//     Performs NO writes and emits NO Inngest event. Preview is idempotent.
//
//   approveCampaignAction — MARKET-03 gate: the ONLY place the send event fires.
//     Re-queries the segment server-side (ignores any client-supplied recipient
//     list), creates the campaign row, inserts recipient rows, THEN emits
//     'campaign/send-approved'. No auto-send path exists (T-04-12).
//
// Input validation: marketStatuses is constrained to the market_status enum.
// Zod validates all inputs before any DB access.
// ---------------------------------------------------------------------------

const MARKET_STATUS_ENUM = z.enum([
  'actively_looking',
  'passively_looking',
  'hot',
  'placed',
  'cold',
])

const marketStatusesSchema = z
  .array(MARKET_STATUS_ENUM)
  .min(1, 'At least one market status must be selected')

// ---------------------------------------------------------------------------
// previewCampaignAction — read-only segment preview (MARKET-01, MARKET-03)
// ---------------------------------------------------------------------------

export type PreviewCampaignResult =
  | {
      ok: true
      count: number
      sample: Array<{
        id: string
        full_name: string
        email: string
        market_status: string
        current_role_title: string | null
        current_company: string | null
      }>
    }
  | { ok: false; error: string }

/**
 * Return the count and a sample (up to 5) of GDPR-consented candidates
 * matching the given market statuses.
 *
 * PERFORMS NO WRITES and emits NO Inngest events — preview only (MARKET-03).
 */
export async function previewCampaignAction(input: {
  marketStatuses: string[]
}): Promise<PreviewCampaignResult> {
  // Zod-validate marketStatuses to enum values.
  const parsed = marketStatusesSchema.safeParse(input.marketStatuses)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid market statuses' }
  }
  const marketStatuses = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }

  const segmentResult = await getCampaignSegment(
    supabase,
    profileResult.data.organization_id,
    marketStatuses,
  )
  if (!segmentResult.ok) {
    return { ok: false, error: 'Could not load segment. Please try again.' }
  }

  const candidates = segmentResult.data
  const sample = candidates.slice(0, 5).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    market_status: c.market_status,
    current_role_title: c.current_role_title,
    current_company: c.current_company,
  }))

  return { ok: true, count: candidates.length, sample }
}

// ---------------------------------------------------------------------------
// approveCampaignAction — MARKET-03 explicit approval gate
// ---------------------------------------------------------------------------

const approveInputSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  subject: z.string().min(1, 'Subject line is required').max(500),
  bodyTemplate: z.string().min(1, 'Body template is required'),
  marketStatuses: marketStatusesSchema,
})

export type ApproveCampaignResult =
  | { ok: true; campaignId: string; recipientCount: number }
  | { ok: false; error: string }

/**
 * Create and queue a campaign for sending.
 *
 * Validates inputs, re-queries the GDPR-consented segment server-side
 * (does NOT trust any client-supplied recipient list), creates the campaign +
 * recipient rows, then emits 'campaign/send-approved'.
 *
 * This is the SOLE place the send event is emitted (MARKET-03, T-04-12).
 * The event NEVER fires on segment change, preview, or any other path.
 */
export async function approveCampaignAction(input: {
  name: string
  subject: string
  bodyTemplate: string
  marketStatuses: string[]
}): Promise<ApproveCampaignResult> {
  // Zod-validate all inputs.
  const parsed = approveInputSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return { ok: false, error: firstError?.message ?? 'Invalid input' }
  }
  const { name, subject, bodyTemplate, marketStatuses } = parsed.data

  // Entitlement gate — campaign send drives email + AI spend; block non-entitled orgs.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const profileResult = await getProfile(supabase, user.id)
  if (!profileResult.ok) return { ok: false, error: 'Profile not found.' }
  const organizationId = profileResult.data.organization_id

  // Idempotency guard (audit rank 7) — if an identical campaign (same name +
  // segment) was approved in the last few minutes, return it instead of
  // creating + sending a SECOND copy. Without this, a double-submit / retry /
  // second tab emails the whole consented UK segment twice — a PECR breach plus
  // doubled Resend + Sonnet spend that cannot be un-sent. Short-circuits BEFORE
  // the segment re-query, create, and send.
  const duplicateResult = await findRecentDuplicateCampaign(
    supabase,
    organizationId,
    name,
    marketStatuses,
  )
  if (duplicateResult.ok && duplicateResult.data) {
    return {
      ok: true,
      campaignId: duplicateResult.data.id,
      recipientCount: duplicateResult.data.recipientCount ?? 0,
    }
  }

  // Re-query the segment server-side — do NOT trust any client-supplied list.
  // This ensures the final recipients are always the current consented set (MARKET-03).
  const segmentResult = await getCampaignSegment(supabase, organizationId, marketStatuses)
  if (!segmentResult.ok) {
    return { ok: false, error: 'Could not load segment. Please try again.' }
  }

  const candidates = segmentResult.data
  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'No eligible candidates found. Candidates must have GDPR consent and a valid email.',
    }
  }

  // Create the campaign row (status='approved', approved_at=now()).
  const campaignResult = await createCampaign(supabase, {
    organizationId,
    createdBy: user.id,
    name,
    subjectTemplate: subject,
    bodyTemplate,
    segmentMarketStatuses: marketStatuses,
    recipientCount: candidates.length,
  })
  if (!campaignResult.ok) {
    return { ok: false, error: 'Could not create campaign. Please try again.' }
  }
  const campaignId = campaignResult.data.id

  // Insert all recipient rows from the freshly-queried consented segment.
  const recipientsResult = await insertCampaignRecipients(
    supabase,
    candidates.map((c) => ({
      campaignId,
      organizationId,
      candidateId: c.id,
      email: c.email,
    })),
  )
  if (!recipientsResult.ok) {
    // Best-effort cleanup — the campaign row is in 'approved' status but
    // orphaned; the Inngest function will fail gracefully if recipients are
    // missing (empty loop).
    Sentry.captureException(new Error('insertCampaignRecipients failed after createCampaign'), {
      tags: {
        phase: 'p4',
        layer: 'action',
        helper: 'approveCampaignAction',
        campaign_id: campaignId,
      },
    })
    return { ok: false, error: 'Could not create recipients. Please try again.' }
  }

  // MARKET-03 gate: emit the send event ONLY here, ONLY after status='approved'.
  // This is the SOLE trigger for the campaign send engine — no other code path
  // emits 'campaign/send-approved' (T-04-12).
  try {
    await inngest.send({
      name: 'campaign/send-approved',
      data: {
        organization_id: organizationId,
        campaign_id: campaignId,
        user_id: user.id,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`${errName}: inngest.send failed`), {
      tags: {
        phase: 'p4',
        layer: 'action',
        helper: 'approveCampaignAction',
        subop: 'inngest.send',
        campaign_id: campaignId,
      },
    })
    // Mark the campaign failed so it doesn't sit at 'approved' indefinitely.
    await supabase
      .from('email_campaigns')
      .update({ status: 'failed' })
      .eq('id', campaignId)
    return { ok: false, error: 'Could not queue campaign for sending. Please try again.' }
  }

  return { ok: true, campaignId, recipientCount: candidates.length }
}
