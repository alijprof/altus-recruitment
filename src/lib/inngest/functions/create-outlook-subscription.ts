import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import {
  getOutlookCredentials,
  revokeOutlookCredentials,
  updateOutlookSubscriptionState,
} from '@/lib/db/outlook-credentials'
import {
  createMailSubscription,
  deriveClientState,
  getValidAccessToken,
  OutlookReconnectRequiredError,
} from '@/lib/integrations/outlook'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase/service'

// Plan 4 Task 4.3 — create-outlook-subscription.
//
// Triggered by the OAuth callback right after the credential row is
// persisted. Creates the Microsoft Graph mail subscription + persists
// (subscription_id, client_state, expires_at), then kicks off a
// first delta sync so the cursor is seeded.

type CreateSubEventData = {
  user_id: string
  organization_id: string
}

function asEventData(value: unknown): CreateSubEventData {
  // reason: Inngest typings are deliberately wide; the OAuth callback +
  // refresh cron are the only producers. We validate below.
  return value as CreateSubEventData
}

export const createOutlookSubscription = inngest.createFunction(
  {
    id: 'create-outlook-subscription',
    triggers: [{ event: 'outlook/subscription-create-requested' }],
    concurrency: { limit: 1, key: 'event.data.user_id' },
    retries: 3,
  },
  async ({ event, step }) => {
    const data = asEventData(event.data)
    if (
      typeof data.user_id !== 'string' ||
      typeof data.organization_id !== 'string'
    ) {
      throw new NonRetriableError('missing required fields')
    }

    if (!env.OUTLOOK_WEBHOOK_NOTIFICATION_URL) {
      throw new NonRetriableError(
        'OUTLOOK_WEBHOOK_NOTIFICATION_URL is not configured — see docs/outlook-integration-setup.md',
      )
    }

    const serviceClient = createServiceClient()

    const cred = await step.run('load-cred', async () => {
      const result = await getOutlookCredentials(serviceClient, data.user_id)
      if (!result.ok) {
        throw new NonRetriableError(`getOutlookCredentials: ${result.code}`)
      }
      if (!result.data || result.data.revoked_at) {
        return null
      }
      // Cross-tenant guard — same defence as sync-outlook-history.
      if (result.data.organization_id !== data.organization_id) {
        throw new NonRetriableError('credentials not in claimed organization')
      }
      return result.data
    })
    if (!cred) return { skipped: 'revoked' as const }

    // If a subscription already exists for this row, skip creation.
    // This makes the function idempotent across retries.
    if (cred.subscription_id) {
      // But still seed a sync so we catch anything that landed between
      // OAuth and now.
      try {
        await inngest.send({
          name: 'outlook/history-changed',
          data: {
            user_id: cred.user_id,
            organization_id: cred.organization_id,
            microsoft_email: cred.microsoft_email,
          },
        })
      } catch (err) {
        const e = err as { name?: string }
        Sentry.captureException(
          new Error(
            `create-outlook-subscription: inngest.send (seed) failed: ${e?.name ?? 'unknown'}`,
          ),
          {
            tags: {
              layer: 'inngest',
              function: 'create-outlook-subscription',
              subop: 'inngest.send',
            },
          },
        )
      }
      return { skipped: 'already_subscribed' as const, subscription_id: cred.subscription_id }
    }

    let accessToken: string
    try {
      accessToken = await step.run('get-access-token', () =>
        getValidAccessToken(serviceClient, data.user_id),
      )
    } catch (err) {
      if (err instanceof OutlookReconnectRequiredError) {
        await revokeOutlookCredentials(serviceClient, data.user_id)
        return { skipped: 'reconnect_required' as const }
      }
      throw err
    }

    const clientState = deriveClientState('mail-inbox')

    const { subscriptionId, expirationDateTime } = await step.run(
      'create-subscription',
      () =>
        createMailSubscription(accessToken, {
          notificationUrl: env.OUTLOOK_WEBHOOK_NOTIFICATION_URL as string,
          clientState,
        }),
    )

    await step.run('persist-subscription', async () => {
      const result = await updateOutlookSubscriptionState(serviceClient, {
        userId: data.user_id,
        subscriptionId,
        subscriptionClientState: clientState,
        subscriptionExpiresAt: expirationDateTime,
      })
      if (!result.ok) {
        throw new Error(`updateOutlookSubscriptionState: ${result.code}`)
      }
    })

    // Seed a first delta query so the cursor is established.
    try {
      await inngest.send({
        name: 'outlook/history-changed',
        data: {
          user_id: cred.user_id,
          organization_id: cred.organization_id,
          microsoft_email: cred.microsoft_email,
        },
      })
    } catch (err) {
      const e = err as { name?: string }
      Sentry.captureException(
        new Error(
          `create-outlook-subscription: inngest.send (initial seed) failed: ${e?.name ?? 'unknown'}`,
        ),
        {
          tags: {
            layer: 'inngest',
            function: 'create-outlook-subscription',
            subop: 'inngest.send',
          },
        },
      )
    }

    return {
      subscription_id: subscriptionId,
      expires_at: expirationDateTime,
    }
  },
)
