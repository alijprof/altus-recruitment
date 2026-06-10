import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { draftCampaignIntroOutro } from '@/lib/ai/campaign-personalise'
import { CapExceededError } from '@/lib/ai/claude'
import {
  getCampaignWithRecipients,
  updateRecipientStatus,
} from '@/lib/db/campaigns'
import { assembleCampaignHtml } from '@/lib/email/resend'
import { sendResendEmail } from '@/lib/email/resend'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// send-email-campaign — Plan 04-04 / MARKET-01/02/03.
//
// Event: 'campaign/send-approved'
// Emitted ONLY by approveCampaignAction after setting status='approved'.
// No auto-send path exists — this is the sole trigger (MARKET-03, T-04-12).
//
// Fan-out strategy: SEQUENTIAL loop (NOT Promise.all). Resend rate limit is
// 2 req/s. Each step.run gets ~1s natural gap from Inngest step execution.
// This is intentional per Research §Pattern 3 + Pitfall.
//
// Idempotency: each recipient's step is keyed by recipient.id. On retry,
// already-sent recipients are detected by status='sent' and skipped.
//
// CapExceededError handling: caught per-recipient, marks 'failed_cap_exceeded',
// loop continues. The campaign is NOT crashed by a billing cap hit (T-04-17).
//
// HARD RULE 4 (tenant boundary): before any personalisation call, assert
// candidate.organization_id === organization_id from the event. Service-role
// bypasses RLS — this assertion is the only guard against cross-tenant data
// leakage (Research §Pitfall 4, T-04-13).
//
// Concurrency: { limit: 2, key: event.data.organization_id } — max 2 concurrent
// campaigns per org. NEVER keyed on user_id — campaigns are org-level.
// Retries: 1 — campaigns are expensive; avoid double-send.
// ---------------------------------------------------------------------------

type CampaignSendApprovedEventData = {
  organization_id: string
  campaign_id: string
  user_id: string
}

function asEventData(value: unknown): CampaignSendApprovedEventData {
  // reason: Inngest typings are deliberately wide. HARD RULE 4 tenant assertion
  // below catches any event payload forgery before service-role DB access.
  return value as CampaignSendApprovedEventData
}

async function markCampaignFailed(campaignId: string, organizationId: string): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase
      .from('email_campaigns')
      .update({ status: 'failed' })
      .eq('id', campaignId)
      .eq('organization_id', organizationId)
  } catch {
    // Best-effort — the onFailure handler already has Sentry context.
  }
}

export const sendEmailCampaign = inngest.createFunction(
  {
    id: 'send-email-campaign',
    triggers: [{ event: 'campaign/send-approved' }],
    // Only 2 concurrent campaigns per org to avoid spamming Resend.
    // NEVER concurrency key on user_id — campaigns are org-level actions (T-04-16).
    concurrency: { limit: 2, key: 'event.data.organization_id' },
    // retries: 1 — campaigns are expensive; limit retries to avoid double-send (T-04-16).
    retries: 1,
    onFailure: async ({ event, error }) => {
      const original = asEventData(event.data.event.data)
      const status = readStatus(error)
      Sentry.captureException(
        new Error(`${error.name}: ${status} (onFailure handler)`),
        {
          tags: {
            phase: 'p4',
            layer: 'inngest',
            function: 'send-email-campaign',
            handler: 'onFailure',
            campaign_id: original.campaign_id,
          },
        },
      )
      await markCampaignFailed(original.campaign_id, original.organization_id)
    },
  },
  async ({ event, step }) => {
    const { organization_id, campaign_id, user_id } = asEventData(event.data)

    // Step 1 — load campaign + recipients (service-role, bypasses RLS).
    const campaignData = await step.run('load-campaign', async () => {
      const supabase = createServiceClient()
      const result = await getCampaignWithRecipients(supabase, campaign_id)
      if (!result.ok) {
        if (result.code === 'not_found') {
          throw new NonRetriableError(`campaign-not-found:${campaign_id}`)
        }
        throw new Error(`load-campaign: ${result.code}`)
      }
      // Verify campaign belongs to the event's organization (defence in depth).
      if (result.data.organization_id !== organization_id) {
        throw new NonRetriableError('cross-tenant-campaign')
      }
      return result.data
    })

    // Step 2 — mark campaign as 'sending'.
    await step.run('mark-sending', async () => {
      const supabase = createServiceClient()
      await supabase
        .from('email_campaigns')
        .update({ status: 'sending' })
        .eq('id', campaign_id)
        .eq('organization_id', organization_id)
    })

    // Steps 3..N — sequential per-recipient send loop.
    // NOT Promise.all — Resend rate limit is 2 req/s (Research §Pattern 3).
    let sentCount = 0
    let failedCount = 0

    for (const [index, recipient] of campaignData.recipients.entries()) {
      // WR-04: explicit inter-send throttle — Resend's limit is 2 req/s and
      // the "natural gap" between steps is an implementation artifact, not a
      // guarantee. 600ms keeps us safely under the limit deterministically.
      if (index > 0) {
        await step.sleep(`gap-${recipient.id}`, '600ms')
      }

      // Each recipient has its own Inngest step for idempotency on retry.
      const result = await step.run(`send-to-${recipient.id}`, async () => {
        // Idempotency: skip if already sent (handles Inngest retry path, T-04-16).
        if (recipient.status === 'sent') {
          return { skipped: true, status: 'sent' as const }
        }

        const supabase = createServiceClient()

        // WR-03: the snapshot above comes from the memoized load-campaign
        // step and can be stale on retry. Re-read the recipient's CURRENT
        // status so a retry after the DB update (but before the step output
        // was recorded) cannot double-send.
        const { data: freshRecipient, error: freshErr } = await supabase
          .from('email_campaign_recipients')
          .select('status')
          .eq('id', recipient.id)
          .eq('organization_id', organization_id)
          .maybeSingle()
        if (freshErr) {
          throw new Error(`fresh-recipient-read: ${freshErr.message}`)
        }
        if (freshRecipient?.status === 'sent') {
          return { skipped: true, status: 'sent' as const }
        }

        // Fetch the full candidate row to assert tenant boundary before Sonnet
        // (HARD RULE 4 — T-04-13 cross-tenant candidate data in personalisation).
        const { data: candidate, error: candidateErr } = await supabase
          .from('candidates')
          .select('id, organization_id, full_name, current_role_title, current_company, market_status')
          .eq('id', recipient.candidate_id)
          .maybeSingle()

        if (candidateErr) {
          throw new Error(`fetch-candidate: ${candidateErr.message}`)
        }
        if (!candidate) {
          throw new NonRetriableError(`candidate-not-found:${recipient.candidate_id}`)
        }

        // HARD RULE 4 — cross-tenant candidate check (T-04-13).
        // Service-role bypasses RLS; this assertion is the only guard.
        if (candidate.organization_id !== organization_id) {
          throw new NonRetriableError('cross-tenant-candidate')
        }

        // Personalise with Sonnet — catch CapExceededError per-recipient (T-04-17).
        let introParagraph: string
        let outroParagraph: string
        try {
          const personalised = await draftCampaignIntroOutro({
            organizationId: organization_id,
            userId: user_id,
            candidate: {
              full_name: candidate.full_name,
              current_role_title: candidate.current_role_title,
              current_company: candidate.current_company,
              market_status: candidate.market_status,
            },
            subject: campaignData.subject_template,
          })
          introParagraph = personalised.introParagraph
          outroParagraph = personalised.outroParagraph
        } catch (err) {
          if (err instanceof CapExceededError) {
            // Mark recipient failed_cap_exceeded and continue loop — do NOT throw.
            await updateRecipientStatus(supabase, recipient.id, 'failed_cap_exceeded', {
              errorMessage: 'AI usage cap exceeded',
            })
            return { skipped: true, status: 'failed_cap_exceeded' as const }
          }
          throw err
        }

        // Assemble HTML (body_template is NOT passed through the model — D4-07).
        // Unsubscribe URL is a placeholder — the 04-05 builder UI will wire the
        // real per-candidate URL. For now use a mailto fallback.
        const unsubscribeUrl = `mailto:unsubscribe@altusmove.com?subject=Unsubscribe&body=${encodeURIComponent(recipient.email)}`
        const html = assembleCampaignHtml({
          intro: introParagraph,
          bodyTemplate: campaignData.body_template,
          outro: outroParagraph,
          unsubscribeUrl,
        })

        // Send via Resend — sendResendEmail never throws.
        // Idempotency-Key (WR-03): closes the pre-DB-update double-send
        // window — Resend dedupes a retried request for the same key.
        const sendResult = await sendResendEmail({
          to: recipient.email,
          subject: campaignData.subject_template,
          html,
          idempotencyKey: `${campaign_id}:${recipient.id}`,
        })

        // Always update the recipient row regardless of send outcome.
        if (sendResult.ok) {
          await updateRecipientStatus(supabase, recipient.id, 'sent', {
            resendEmailId: sendResult.id,
          })
          return { skipped: false, status: 'sent' as const }
        } else {
          // WR-04: a 429 is transient rate limiting, not a permanent
          // failure. Throw so Inngest retries this step (the Idempotency-Key
          // makes the retry safe) instead of burying the recipient as failed.
          if (sendResult.reason === 'http_error' && sendResult.status === 429) {
            throw new Error('resend-429')
          }
          const errMsg =
            sendResult.reason === 'http_error'
              ? `http_error:${sendResult.status ?? 'unknown'} ${sendResult.message ?? ''}`
              : sendResult.reason
          await updateRecipientStatus(supabase, recipient.id, 'failed', {
            errorMessage: errMsg,
          })
          return { skipped: false, status: 'failed' as const }
        }
      })

      // Tally on status alone — 'sent' counts whether fresh or an
      // idempotency skip; everything else ('failed', 'failed_cap_exceeded')
      // is a recipient who was never emailed and MUST surface in
      // failed_count (WR-02: cap-exceeded recipients previously vanished
      // from the totals, reporting a fully successful send).
      if (result.status === 'sent') {
        sentCount++
      } else {
        failedCount++
      }
    }

    // Final step — update campaign counts + status.
    await step.run('finalise-campaign', async () => {
      const supabase = createServiceClient()
      await supabase
        .from('email_campaigns')
        .update({
          status: 'sent',
          sent_count: sentCount,
          failed_count: failedCount,
          sent_at: new Date().toISOString(),
        })
        .eq('id', campaign_id)
        .eq('organization_id', organization_id)
    })

    return { campaignId: campaign_id, sentCount, failedCount }
  },
)
