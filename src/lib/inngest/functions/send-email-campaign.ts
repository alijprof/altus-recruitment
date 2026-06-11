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
import { buildUnsubscribeUrl, generateUnsubscribeToken } from '@/lib/email/unsubscribe'
import { inngest } from '@/lib/inngest/client'
import { env } from '@/lib/env'
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

    // Step 3 — load sender identity for the greeting/sign-off block (WR-09).
    // Best-effort: fall back to the org name (or a generic team sign-off) if
    // the user row is missing a display name.
    const sender = await step.run('load-sender-identity', async () => {
      const supabase = createServiceClient()
      const { data: senderUser } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', user_id)
        .eq('organization_id', organization_id)
        .maybeSingle()
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organization_id)
        .maybeSingle()
      return {
        senderName: senderUser?.full_name ?? org?.name ?? 'The team',
        organizationName: org?.name ?? '',
      }
    })

    // Steps 4..N — sequential per-recipient send loop.
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
        // status AND unsubscribe_token so a retry after the DB update (but
        // before the step output was recorded) cannot double-send.
        // Also select email + email_marketing_unsubscribed_at for the
        // send-time suppression re-check (braces for the getCampaignSegment belt).
        // reason: unsubscribe_token not yet in generated Database type.
        const sbFresh = supabase as unknown as {
          from: (t: 'email_campaign_recipients') => {
            select: (c: string) => {
              eq: (c: string, v: string) => {
                eq: (c: string, v: string) => {
                  maybeSingle: () => Promise<{
                    data: {
                      status: string | null
                      unsubscribe_token: string | null
                    } | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
        const { data: freshRecipient, error: freshErr } = await sbFresh
          .from('email_campaign_recipients')
          .select('status, unsubscribe_token')
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
        // Also select email + email_marketing_unsubscribed_at for send-time
        // suppression re-check (T-0f4 braces for the getCampaignSegment belt).
        // reason: email_marketing_unsubscribed_at not yet in generated Database type.
        const sbCand = supabase as unknown as {
          from: (t: 'candidates') => {
            select: (c: string) => {
              eq: (c: string, v: string) => {
                maybeSingle: () => Promise<{
                  data: {
                    id: string
                    organization_id: string
                    full_name: string
                    current_role_title: string | null
                    current_company: string | null
                    market_status: string
                    email: string | null
                    email_marketing_unsubscribed_at: string | null
                  } | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
        const { data: candidate, error: candidateErr } = await sbCand
          .from('candidates')
          .select('id, organization_id, full_name, current_role_title, current_company, market_status, email, email_marketing_unsubscribed_at')
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

        // Send-time suppression re-check (T-0f4 braces for getCampaignSegment belt).
        // Long campaigns can run for minutes — a candidate may have unsubscribed
        // via a parallel session between segment-load and this recipient's turn.
        if (candidate.email_marketing_unsubscribed_at != null) {
          await updateRecipientStatus(supabase, recipient.id, 'failed', {
            errorMessage: 'suppressed_unsubscribed',
          })
          return { skipped: true, status: 'failed' as const }
        }

        // -----------------------------------------------------------------------
        // Token handling (T-0f4-TOKENGAP): every email MUST carry a real https
        // unsubscribe URL. Legacy recipients (rows created before 260612-0f4)
        // may have unsubscribe_token = NULL (insertCampaignRecipients now sets it
        // at insert time, but old rows don't have it yet).
        // -----------------------------------------------------------------------
        let unsubscribeToken = freshRecipient?.unsubscribe_token ?? null

        if (!unsubscribeToken) {
          // Generate a fresh token and persist it BEFORE building the URL.
          // If the persist fails we MUST NOT send (would ship a broken URL).
          const generatedToken = generateUnsubscribeToken()

          // reason: unsubscribe_token not yet in generated Database type.
          const sbTokenPersist = supabase as unknown as {
            from: (t: 'email_campaign_recipients') => {
              update: (p: Record<string, unknown>) => {
                eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
              }
            }
          }
          const { error: persistErr } = await sbTokenPersist
            .from('email_campaign_recipients')
            .update({ unsubscribe_token: generatedToken })
            .eq('id', recipient.id)

          if (persistErr) {
            // Persist failed — do NOT send; mark and continue (T-0f4-TOKENGAP).
            Sentry.captureException(new Error('send-loop: token persist failed'), {
              tags: { layer: 'inngest', function: 'send-email-campaign', subop: 'token_persist' },
            })
            await updateRecipientStatus(supabase, recipient.id, 'failed', {
              errorMessage: 'token_persist_error',
            })
            return { skipped: true, status: 'failed' as const }
          }

          unsubscribeToken = generatedToken
        }

        // Build the https unsubscribe URL — single source of truth (RFC 8058).
        // Both the footer link and the List-Unsubscribe header use this same value
        // so the header URL equals the POST endpoint URL byte-for-byte.
        const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken, env.NEXT_PUBLIC_SITE_URL)

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
              market_status: candidate.market_status as Parameters<typeof draftCampaignIntroOutro>[0]['candidate']['market_status'],
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
        // PRE-LAUNCH BLOCKER (WR-09) — RESOLVED by Quick task 260612-0f4:
        // real per-recipient https token URL replaces the mailto placeholder.
        // List-Unsubscribe-Post header added for Gmail/Yahoo bulk-sender compliance.
        const firstName =
          candidate.full_name.trim().split(/\s+/)[0] ?? candidate.full_name
        const html = assembleCampaignHtml({
          recipientFirstName: firstName,
          intro: introParagraph,
          bodyTemplate: campaignData.body_template,
          outro: outroParagraph,
          senderName: sender.senderName,
          organizationName: sender.organizationName,
          unsubscribeUrl,
        })

        // Send via Resend — sendResendEmail never throws.
        // Idempotency-Key (WR-03): closes the pre-DB-update double-send window.
        // List-Unsubscribe: real https token URL (RFC 8058 one-click).
        // List-Unsubscribe-Post: required by Gmail/Yahoo bulk-sender rules.
        // The List-Unsubscribe URL is byte-for-byte identical to the POST
        // endpoint URL — RFC 8058 §3 one-click requirement.
        const sendResult = await sendResendEmail({
          to: recipient.email,
          subject: campaignData.subject_template,
          html,
          idempotencyKey: `${campaign_id}:${recipient.id}`,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })

        // Always update the recipient row regardless of send outcome.
        if (sendResult.ok) {
          // IN-02 (260612-0f4): persist personalised_intro + personalised_outro
          // on the sent path. These columns exist in the DB since phase4_hardening
          // but were never written — updateRecipientStatus now accepts them via
          // the `as unknown as` escape hatch (see campaigns.ts).
          await updateRecipientStatus(supabase, recipient.id, 'sent', {
            resendEmailId: sendResult.id,
            personalisedIntro: introParagraph,
            personalisedOutro: outroParagraph,
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
