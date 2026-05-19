import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import {
  createEmailActivity,
  emailActivityExists,
} from '@/lib/db/activities'
import { findCandidateByEmail } from '@/lib/db/candidates'
import { findContactByEmail } from '@/lib/db/contacts'
import {
  getOutlookCredentials,
  revokeOutlookCredentials,
  setOutlookDeltaLink,
} from '@/lib/db/outlook-credentials'
import {
  fetchDelta,
  getValidAccessToken,
  OutlookReconnectRequiredError,
  type OutlookMessage,
} from '@/lib/integrations/outlook'
import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase/service'

// Plan 4 Task 4.3 — sync-outlook-history.
//
// Triggered by:
//   * /api/outlook/webhook when Graph pushes a change notification
//   * create-outlook-subscription right after a new subscription is
//     created (to seed delta_link)
//   * refresh-outlook-subscription right after a 404-recreate
//
// Steps:
//   1. load-cred — read outlook_credentials; bail if revoked.
//   2. get-access-token — refresh if needed (sliding RT rotation
//      handled inside getValidAccessToken).
//   3. fetch-delta — pull the delta page, capped at 5 pages by the
//      wrapper.
//   4. process-messages — for each message:
//        - skip dupes by internet_message_id
//        - skip orphan emails (no candidate AND no contact)
//        - insert one activity row per matching entity, attributed
//          to the connecting recruiter.
//   5. update-cursor — persist next deltaLink + last_synced_at.

type SyncEventData = {
  user_id: string
  organization_id: string
  microsoft_email: string
}

function asSyncData(value: unknown): SyncEventData {
  // reason: Inngest typings are deliberately wide. The webhook + the
  // subscription functions are the only producers; we validate fields
  // below.
  return value as SyncEventData
}

type DirectionMatch = {
  direction: 'inbound' | 'outbound'
  participant: string
}

function classifyMessage(
  message: OutlookMessage,
  connectedEmail: string,
): DirectionMatch[] {
  const fromEmail =
    message.from?.emailAddress?.address?.toLowerCase().trim() ?? null
  const toEmails = (message.toRecipients ?? [])
    .map((r) => r.emailAddress?.address?.toLowerCase().trim())
    .filter((s): s is string => Boolean(s))

  const connected = connectedEmail.toLowerCase().trim()

  if (fromEmail && fromEmail === connected) {
    // Outbound: connected user sent the email; participants are the recipients.
    return toEmails.map((p) => ({ direction: 'outbound' as const, participant: p }))
  }
  if (fromEmail) {
    // Inbound: participant is the sender.
    return [{ direction: 'inbound' as const, participant: fromEmail }]
  }
  return []
}

export const syncOutlookHistory = inngest.createFunction(
  {
    id: 'sync-outlook-history',
    triggers: [{ event: 'outlook/history-changed' }],
    // Per-user concurrency: delta cursors are NOT parallel-safe. Two
    // concurrent runs for the same user would double-fetch the same
    // delta and double-insert activity rows (the idempotency check
    // catches it, but at extra cost). Serialise per user.
    concurrency: { limit: 1, key: 'event.data.user_id' },
    retries: 3,
  },
  async ({ event, step }) => {
    const data = asSyncData(event.data)
    if (
      typeof data.user_id !== 'string' ||
      typeof data.organization_id !== 'string' ||
      typeof data.microsoft_email !== 'string'
    ) {
      throw new NonRetriableError('missing required fields')
    }

    const serviceClient = createServiceClient()

    // -------------------------------------------------------------
    // 1) Load credentials. Bail if missing/revoked.
    // -------------------------------------------------------------
    const cred = await step.run('load-cred', async () => {
      const result = await getOutlookCredentials(serviceClient, data.user_id)
      if (!result.ok) throw new NonRetriableError(`getOutlookCredentials: ${result.code}`)
      if (!result.data || result.data.revoked_at) {
        return null
      }
      // Cross-tenant guard — service role bypasses RLS. The webhook
      // looked the row up by subscription_id, but a forged Inngest
      // event could claim a different org_id.
      if (result.data.organization_id !== data.organization_id) {
        throw new NonRetriableError('credentials not in claimed organization')
      }
      return result.data
    })
    if (!cred) return { skipped: 'revoked' as const }

    // -------------------------------------------------------------
    // 2) Get a valid access token (refresh + rotate RT if needed).
    // -------------------------------------------------------------
    let accessToken: string
    try {
      accessToken = await step.run('get-access-token', () =>
        getValidAccessToken(serviceClient, data.user_id),
      )
    } catch (err) {
      if (err instanceof OutlookReconnectRequiredError) {
        // getValidAccessToken has already revoked the row; be defensive
        // and re-issue the revoke in case it races with another path.
        await revokeOutlookCredentials(serviceClient, data.user_id)
        return { skipped: 'reconnect_required' as const }
      }
      throw err
    }

    // -------------------------------------------------------------
    // 3) Fetch delta. Wrapper paginates internally up to MAX_DELTA_PAGES.
    // -------------------------------------------------------------
    const { messages, nextDeltaLink } = await step.run('fetch-delta', () =>
      fetchDelta(accessToken, { deltaLink: cred.delta_link }),
    )

    // -------------------------------------------------------------
    // 4) Process messages.
    // -------------------------------------------------------------
    let processed = 0
    let orphans = 0
    let dupes = 0

    for (const message of messages) {
      // step.run name has to be unique-per-step within an attempt;
      // include the Graph message id.
      await step.run(`process-${message.id}`, async () => {
        if (!message.internetMessageId) {
          // Graph sometimes returns interim items without one; safest
          // to skip until the next delta call returns the final form.
          return
        }
        const existsResult = await emailActivityExists(serviceClient, {
          organizationId: data.organization_id,
          internetMessageId: message.internetMessageId,
        })
        if (existsResult.ok && existsResult.data) {
          dupes++
          return
        }

        const classifications = classifyMessage(message, data.microsoft_email)
        if (classifications.length === 0) {
          // Couldn't determine direction (no from + no to). Skip.
          return
        }

        // For each participant email, look up candidate + contact;
        // skip orphans (D2-19).
        let matchedAny = false
        for (const { direction, participant } of classifications) {
          const [candResult, contactResult] = await Promise.all([
            findCandidateByEmail(serviceClient, participant, data.organization_id),
            findContactByEmail(serviceClient, participant, data.organization_id),
          ])
          const candidate = candResult.ok ? candResult.data : null
          const contact = contactResult.ok ? contactResult.data : null
          if (!candidate && !contact) continue
          matchedAny = true

          const fromEmail =
            message.from?.emailAddress?.address?.toLowerCase().trim() ?? ''
          const toEmails = (message.toRecipients ?? [])
            .map((r) => r.emailAddress?.address?.toLowerCase().trim())
            .filter((s): s is string => Boolean(s))

          const occurredAt = message.receivedDateTime ?? new Date().toISOString()
          const subject = message.subject ?? ''
          const snippet = (message.bodyPreview ?? '').slice(0, 200)

          await Promise.all(
            [candidate, contact]
              .filter((e): e is { id: string } => Boolean(e))
              .map((entity, idx) => {
                const entityType: 'candidate' | 'contact' =
                  idx === 0 && candidate ? 'candidate' : 'contact'
                return createEmailActivity(serviceClient, {
                  organizationId: data.organization_id,
                  entityType,
                  entityId: entity.id,
                  subject,
                  snippet,
                  graphMessageId: message.id,
                  conversationId: message.conversationId,
                  internetMessageId: message.internetMessageId,
                  fromEmail,
                  toEmails,
                  direction,
                  occurredAt,
                  actorUserId: data.user_id,
                })
              }),
          )
        }

        if (matchedAny) processed++
        else orphans++
      })
    }

    // -------------------------------------------------------------
    // 5) Persist cursor for next sync.
    // -------------------------------------------------------------
    if (nextDeltaLink) {
      await step.run('update-cursor', async () => {
        const result = await setOutlookDeltaLink(serviceClient, {
          userId: data.user_id,
          deltaLink: nextDeltaLink,
          lastSyncedAt: new Date().toISOString(),
        })
        if (!result.ok) {
          // Don't blow up the whole run — the next webhook will re-fetch
          // the same delta and the dedupe will catch us up. Capture for
          // ops visibility.
          Sentry.captureException(
            new Error(`sync-outlook-history: setOutlookDeltaLink: ${result.code}`),
            {
              tags: { layer: 'inngest', function: 'sync-outlook-history' },
            },
          )
        }
      })
    }

    return {
      messages_seen: messages.length,
      processed,
      orphans,
      dupes,
    }
  },
)
