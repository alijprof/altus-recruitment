import * as Sentry from '@sentry/nextjs'
import { type NextRequest, NextResponse } from 'next/server'

import { env } from '@/lib/env'
import { getOutlookCredentialsBySubscriptionId } from '@/lib/db/outlook-credentials'
import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase/service'

// Plan 4 Task 4.3 — Microsoft Graph change-notification webhook.
//
// Two entrypoints share this route:
//   * GET /api/outlook/webhook?validationToken=xyz — fired by Graph
//     during subscription creation/renewal. We MUST echo the token in
//     `text/plain` within 10 seconds or the subscription POST fails.
//   * POST /api/outlook/webhook — real change notifications. Body is
//     `{ value: [{ subscriptionId, clientState, resourceData, ... }] }`.
//     Auth signal is clientState ONLY (Graph does NOT sign these).
//
// Fail-closed: VERIFICATION M-3 adapted from Gmail → MS Graph. If the
// clientState secret env is missing at the moment a real notification
// lands, we cannot validate the payload — so we 503 immediately,
// BEFORE reading the body, BEFORE touching the DB, BEFORE Inngest.

// ---------------------------------------------------------------------------
// validationToken handshake — must be sub-10s.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const validationToken = request.nextUrl.searchParams.get('validationToken')
  if (!validationToken) {
    return new NextResponse(null, { status: 400 })
  }
  // CRITICAL: text/plain, body is the literal token, no quoting/JSON.
  return new NextResponse(validationToken, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// ---------------------------------------------------------------------------
// Change-notification handler
// ---------------------------------------------------------------------------

type Notification = {
  subscriptionId: string
  subscriptionExpirationDateTime?: string
  changeType?: string
  resource?: string
  resourceData?: { id?: string } | null
  clientState?: string
  tenantId?: string
}

const ALLOWED_RESOURCE_PREFIXES = ['Users/', 'users/']
const ALLOWED_RESOURCE_FRAGMENT = "mailFolders('Inbox')/Messages"
const ALLOWED_RESOURCE_FRAGMENT_LOWER = ALLOWED_RESOURCE_FRAGMENT.toLowerCase()

function isAllowedResource(resource: string | undefined): boolean {
  if (!resource) return false
  const startsOk = ALLOWED_RESOURCE_PREFIXES.some((p) => resource.startsWith(p))
  if (!startsOk) return false
  // Match the Inbox/Messages fragment case-insensitively to handle the
  // capitalization variants Graph uses (Inbox vs inbox, Messages vs messages).
  return resource.toLowerCase().includes(ALLOWED_RESOURCE_FRAGMENT_LOWER)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ---------------------------------------------------------------
  // M-3 fail-closed: if the clientState secret is missing we cannot
  // distinguish a real Graph push from a forged one. Return 503 BEFORE
  // touching the body, headers, or DB. Graph will retry on 5xx; an
  // operator alarm fires before the retries exhaust.
  // ---------------------------------------------------------------
  if (!env.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET) {
    Sentry.captureMessage(
      'outlook/webhook received without configured clientState secret',
      {
        level: 'error',
        tags: { layer: 'route-handler', route: '/api/outlook/webhook' },
      },
    )
    return new NextResponse(null, { status: 503 })
  }

  // Graph may re-send the validationToken handshake on POST during
  // subscription renewal — accept it here too for robustness.
  const validationTokenOnPost = request.nextUrl.searchParams.get('validationToken')
  if (validationTokenOnPost) {
    return new NextResponse(validationTokenOnPost, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  let body: { value?: unknown } | null = null
  try {
    body = (await request.json()) as { value?: unknown }
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  if (!body || !Array.isArray(body.value)) {
    return new NextResponse(null, { status: 400 })
  }

  const notifications = body.value as Notification[]
  if (notifications.length === 0) {
    return new NextResponse(null, { status: 202 })
  }

  const serviceClient = createServiceClient()
  const seenSubscriptions = new Set<string>()
  for (const n of notifications) {
    if (n?.subscriptionId) seenSubscriptions.add(n.subscriptionId)
  }

  for (const subscriptionId of seenSubscriptions) {
    const credResult = await getOutlookCredentialsBySubscriptionId(
      serviceClient,
      subscriptionId,
    )
    // Silently drop notifications for subscriptions we don't recognise
    // (could be stale after a recreate, or — much less likely — a
    // forged subscriptionId we don't have a row for). No Sentry noise
    // for these; they're routine.
    if (!credResult.ok || !credResult.data) continue
    const cred = credResult.data
    if (cred.revoked_at) continue

    // Filter the notifications down to this subscription.
    const forSub = notifications.filter((n) => n.subscriptionId === subscriptionId)

    // clientState must match on EVERY notification — a single mismatch
    // means the whole batch is suspect. We refuse to fire any event for
    // this subscription.
    const allClientStateOk = forSub.every(
      (n) => n.clientState === cred.subscription_client_state,
    )
    if (!allClientStateOk) {
      Sentry.captureMessage('outlook/webhook clientState mismatch', {
        level: 'error',
        tags: {
          layer: 'route-handler',
          route: '/api/outlook/webhook',
          subscription_id: subscriptionId,
        },
      })
      continue
    }

    // Subscription-resource defence: ensure every notification claims a
    // resource under `Users/…/mailFolders('Inbox')/Messages`. Defends
    // against a future Graph quirk that lets a third party re-target a
    // subscription we own at a different resource.
    const allResourcesOk = forSub.every((n) => isAllowedResource(n.resource))
    if (!allResourcesOk) {
      Sentry.captureMessage('outlook/webhook unexpected resource', {
        level: 'error',
        tags: {
          layer: 'route-handler',
          route: '/api/outlook/webhook',
          subscription_id: subscriptionId,
        },
      })
      continue
    }

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
        new Error(`outlook/webhook: inngest.send failed: ${e?.name ?? 'unknown'}`),
        {
          tags: {
            layer: 'route-handler',
            route: '/api/outlook/webhook',
            subop: 'inngest.send',
            subscription_id: subscriptionId,
          },
        },
      )
      // Don't fail the whole webhook — Graph retries on non-2xx and we
      // still want to ack what we can.
    }
  }

  return new NextResponse(null, { status: 202 })
}
