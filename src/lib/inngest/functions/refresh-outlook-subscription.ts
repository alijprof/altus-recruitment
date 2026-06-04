import * as Sentry from '@sentry/nextjs'

import {
  listExpiringSubscriptions,
  recordRenewalAttempt,
  setOutlookDeltaLink,
  updateOutlookSubscriptionState,
} from '@/lib/db/outlook-credentials'
import {
  createMailSubscription,
  deriveClientState,
  getValidAccessToken,
  OutlookReconnectRequiredError,
  renewMailSubscription,
  SubscriptionExpiredError,
} from '@/lib/integrations/outlook'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase/service'

// Plan 4 Task 4.4 — 6-hourly subscription renewal.
//
// Microsoft Graph mail subscriptions cap at 4230 minutes (~70.5h) and
// CANNOT be PATCH-renewed after expiry. A silent Inngest schedule stop
// is invisible until the first subscription dies. Hence the heartbeat
// Sentry.captureMessage at the top of the run — pair with a Sentry
// Crons monitor in production (see docs/outlook-integration-setup.md).
//
// Strategy:
//   * pull every row with subscription_expires_at < now()+12h AND not revoked
//   * for each: refresh access token → PATCH renew → record success
//   * on 404 (SubscriptionExpiredError): create a new subscription,
//     null delta_link (force full resync), fire outlook/history-changed
//     so the next sync rebuilds the cursor
//   * any other failure: recordRenewalAttempt(success=false). Don't
//     bubble — one user's revoked token shouldn't block others.

export const refreshOutlookSubscription = inngest.createFunction(
  {
    id: 'refresh-outlook-subscription',
    triggers: [{ cron: '0 */6 * * *' }],
    concurrency: { limit: 1 },
    retries: 1,
  },
  async ({ step }) => {
    // VERIFICATION M-7 heartbeat — emits a Sentry breadcrumb on every
    // cron tick so an out-of-band Sentry Crons monitor can confirm
    // liveness even if the run does nothing (no expiring subscriptions).
    Sentry.captureMessage('outlook:cron:heartbeat', {
      level: 'info',
      tags: {
        layer: 'inngest',
        function: 'refresh-outlook-subscription',
      },
    })

    if (!env.OUTLOOK_WEBHOOK_NOTIFICATION_URL) {
      // No notification URL → we can't recreate on 404. Skip the run
      // cleanly so we don't pile up renewal-attempt failures.
      Sentry.captureMessage(
        'outlook:cron:OUTLOOK_WEBHOOK_NOTIFICATION_URL missing — skipped',
        {
          level: 'warning',
          tags: {
            layer: 'inngest',
            function: 'refresh-outlook-subscription',
          },
        },
      )
      return { skipped: 'missing_notification_url' as const }
    }

    const serviceClient = createServiceClient()

    const expiringResult = await step.run('list-expiring', () =>
      listExpiringSubscriptions(serviceClient, 12),
    )
    if (!expiringResult.ok) {
      Sentry.captureMessage('outlook:cron:listExpiringSubscriptions failed', {
        level: 'error',
        tags: {
          layer: 'inngest',
          function: 'refresh-outlook-subscription',
        },
      })
      return { skipped: 'list_failed' as const }
    }

    const expiring = expiringResult.data
    if (expiring.length === 0) {
      return { renewed: 0, recreated: 0, failed: 0 }
    }

    let renewed = 0
    let recreated = 0
    let failed = 0

    for (const cred of expiring) {
      await step.run(`renew-${cred.user_id}`, async () => {
        // Token refresh: this also handles the reconnect-required
        // case by revoking the row and throwing — we catch it as a
        // soft skip.
        let accessToken: string
        try {
          accessToken = await getValidAccessToken(serviceClient, cred.user_id)
        } catch (err) {
          if (err instanceof OutlookReconnectRequiredError) {
            await recordRenewalAttempt(serviceClient, {
              userId: cred.user_id,
              success: false,
              error: 'reconnect_required',
            })
            failed++
            return
          }
          const e = err as { name?: string; statusCode?: number }
          await recordRenewalAttempt(serviceClient, {
            userId: cred.user_id,
            success: false,
            error: `${e?.name ?? 'UnknownError'}:${e?.statusCode ?? 'unknown'}`,
          })
          Sentry.captureException(
            new Error(
              `refresh-outlook-subscription.getValidAccessToken: ${e?.name ?? 'UnknownError'}`,
            ),
            {
              tags: {
                layer: 'inngest',
                function: 'refresh-outlook-subscription',
                user_id: cred.user_id,
              },
            },
          )
          failed++
          return
        }

        // No subscription on file? Treat as a recreate (this row was
        // disconnected mid-flight, but we caught it here because
        // subscription_expires_at hasn't been nulled yet).
        if (!cred.subscription_id) {
          await tryRecreate(serviceClient, cred.user_id, cred.organization_id, cred.microsoft_email, accessToken, 'no_subscription_id')
          recreated++
          return
        }

        // Phase 2 review H1 fix — refuse to renew with a null clientState.
        // `?? ''` here would persist empty-string clientState back to the
        // row, and the webhook's `clientState === cred.subscription_client_state`
        // check would then accept forged notifications with literal
        // `clientState: ''`. Fail closed: log + recreate from scratch (a
        // recreate generates a fresh HMAC-derived clientState via
        // deriveClientState).
        if (!cred.subscription_client_state) {
          await recordRenewalAttempt(serviceClient, {
            userId: cred.user_id,
            success: false,
            error: 'missing_client_state',
          })
          Sentry.captureMessage(
            'refresh-outlook-subscription: row missing clientState — forcing recreate',
            {
              level: 'warning',
              tags: {
                layer: 'inngest',
                function: 'refresh-outlook-subscription',
                subop: 'missing-client-state',
                user_id: cred.user_id,
              },
            },
          )
          try {
            await tryRecreate(
              serviceClient,
              cred.user_id,
              cred.organization_id,
              cred.microsoft_email,
              accessToken,
              'missing_client_state',
            )
            recreated++
            return
          } catch (recreateErr) {
            const e = recreateErr as { name?: string; statusCode?: number }
            Sentry.captureException(
              new Error(
                `refresh-outlook-subscription.recreate-on-missing-clientState: ${e?.name ?? 'UnknownError'}`,
              ),
              {
                tags: {
                  layer: 'inngest',
                  function: 'refresh-outlook-subscription',
                  user_id: cred.user_id,
                },
              },
            )
            failed++
            return
          }
        }

        try {
          const { expirationDateTime } = await renewMailSubscription(
            accessToken,
            cred.subscription_id,
          )
          const writeResult = await updateOutlookSubscriptionState(serviceClient, {
            userId: cred.user_id,
            subscriptionId: cred.subscription_id,
            subscriptionClientState: cred.subscription_client_state,
            subscriptionExpiresAt: expirationDateTime,
          })
          if (!writeResult.ok) {
            await recordRenewalAttempt(serviceClient, {
              userId: cred.user_id,
              success: false,
              error: `updateOutlookSubscriptionState:${writeResult.code}`,
            })
            failed++
            return
          }
          await recordRenewalAttempt(serviceClient, {
            userId: cred.user_id,
            success: true,
          })
          renewed++
        } catch (err) {
          if (err instanceof SubscriptionExpiredError) {
            // 404 → recreate path
            try {
              await tryRecreate(
                serviceClient,
                cred.user_id,
                cred.organization_id,
                cred.microsoft_email,
                accessToken,
                'recreated-after-expiry',
              )
              recreated++
              return
            } catch (recreateErr) {
              const e = recreateErr as { name?: string; statusCode?: number }
              await recordRenewalAttempt(serviceClient, {
                userId: cred.user_id,
                success: false,
                error: `recreate:${e?.name ?? 'UnknownError'}:${e?.statusCode ?? 'unknown'}`,
              })
              Sentry.captureException(
                new Error(
                  `refresh-outlook-subscription.recreate: ${e?.name ?? 'UnknownError'}`,
                ),
                {
                  tags: {
                    layer: 'inngest',
                    function: 'refresh-outlook-subscription',
                    user_id: cred.user_id,
                  },
                },
              )
              failed++
              return
            }
          }
          const e = err as { name?: string; statusCode?: number }
          await recordRenewalAttempt(serviceClient, {
            userId: cred.user_id,
            success: false,
            error: `renew:${e?.name ?? 'UnknownError'}:${e?.statusCode ?? 'unknown'}`,
          })
          Sentry.captureException(
            new Error(
              `refresh-outlook-subscription.renew: ${e?.name ?? 'UnknownError'}`,
            ),
            {
              tags: {
                layer: 'inngest',
                function: 'refresh-outlook-subscription',
                user_id: cred.user_id,
              },
            },
          )
          failed++
        }
      })
    }

    return { renewed, recreated, failed, examined: expiring.length }
  },
)

// ---------------------------------------------------------------------------
// Recreate helper
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createServiceClient>

async function tryRecreate(
  serviceClient: ServiceClient,
  userId: string,
  organizationId: string,
  microsoftEmail: string,
  accessToken: string,
  reason: string,
): Promise<void> {
  const clientState = deriveClientState('mail-inbox')
  const { subscriptionId, expirationDateTime } = await createMailSubscription(
    accessToken,
    {
      notificationUrl: env.OUTLOOK_WEBHOOK_NOTIFICATION_URL as string,
      clientState,
    },
  )
  // Capture the write result and THROW on failure BEFORE recording success.
  // Previously the result was discarded and recordRenewalAttempt(success:true)
  // fired even if the subscription_id write failed — reporting "healthy" while
  // sync was dead. The throw propagates to the per-user loop's catch, which
  // records a failed attempt and Sentry-tags it (one user's failure does not
  // block the rest of the cron).
  const subWrite = await updateOutlookSubscriptionState(serviceClient, {
    userId,
    subscriptionId,
    subscriptionClientState: clientState,
    subscriptionExpiresAt: expirationDateTime,
  })
  if (!subWrite.ok) {
    throw new Error('tryRecreate: failed to persist subscription_id')
  }
  // Delta link is invalid after a subscription recreate — Graph treats
  // each subscription's delta query as independent. Force full resync.
  const deltaWrite = await setOutlookDeltaLink(serviceClient, {
    userId,
    deltaLink: null,
    lastSyncedAt: new Date().toISOString(),
  })
  if (!deltaWrite.ok) {
    throw new Error('tryRecreate: failed to reset delta link')
  }
  // Fire follow-up sync so the resync runs immediately rather than
  // waiting for the next inbound email push.
  try {
    await inngest.send({
      name: 'outlook/history-changed',
      data: {
        user_id: userId,
        organization_id: organizationId,
        microsoft_email: microsoftEmail,
      },
    })
  } catch (err) {
    const e = err as { name?: string }
    Sentry.captureException(
      new Error(
        `refresh-outlook-subscription.recreate-seed: ${e?.name ?? 'UnknownError'}`,
      ),
      {
        tags: {
          layer: 'inngest',
          function: 'refresh-outlook-subscription',
          subop: 'inngest.send',
        },
      },
    )
  }
  await recordRenewalAttempt(serviceClient, {
    userId,
    success: true,
    error: reason,
  })
}
