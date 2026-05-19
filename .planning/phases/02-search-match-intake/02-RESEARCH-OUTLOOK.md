# Phase 2: Search, Match & Intake — Outlook Supplement

**Researched:** 2026-05-19
**Scope:** Microsoft Graph / Outlook integration — REPLACES sections D.15–D.24 of `02-RESEARCH.md` (Gmail).
**Confidence:** HIGH on Microsoft Graph API shapes (verified against current `learn.microsoft.com` docs); HIGH on library versions (verified against npm registry on 2026-05-19); MEDIUM on throttling thresholds (Microsoft publishes ranges, not hard numbers).
**Domain:** Microsoft 365 Outlook mail ingestion via Microsoft Graph delegated permissions + change notifications.

## Why this exists

The anchor recruitment agency uses **Microsoft 365 Outlook**, not Gmail. Plan 4 of Phase 2 was researched against Gmail's `users.watch` + Pub/Sub push + History API model. The contract (`D2-15..D2-19` in `02-CONTEXT.md`) is unchanged — magic-link sign-in stays, "Connect Outlook" is a separate per-user OAuth flow, tokens are aes-256-gcm encrypted in a dedicated table, inbound sync is push-based not poll-based, activity rows store subject + ~200-char snippet only, inbound-to-candidate matching is exact-email-lowercased.

What changes is the **implementation surface**: Microsoft identity platform replaces Google OAuth, Microsoft Graph subscriptions replace Pub/Sub topics, Graph `delta` queries replace Gmail's `users.history.list`, and three Microsoft-specific edge cases (admin consent enforcement, Conditional Access policies, the 4230-minute subscription cap) need first-class handling.

This supplement mirrors the Gmail D.15–D.24 layout so it slots into the existing RESEARCH.md table-of-contents without renumbering.

## Summary

**Primary recommendation:** Implement Outlook ingestion as a self-managed delegated-permissions OAuth flow using `@azure/msal-node` 3.x (Confidential Client) + `@microsoft/microsoft-graph-client` 3.x. Register the app **single-tenant** in the anchor's Entra ID directory. Store tokens (refresh + access + tenant + Entra object id) aes-256-gcm-encrypted in a new `outlook_credentials` table. Subscribe to `me/mailFolders('Inbox')/messages` change notifications with `changeType: 'created'`, validate the synchronous `validationToken` handshake within 10 seconds, validate the per-subscription `clientState` on every push, fan out to Inngest, and use `messages/delta` to pull the actual change set. Renew subscriptions daily via a scheduled Inngest function before the 4230-minute cap.

**Top five Microsoft-vs-Gmail divergences (the things that bite if missed):**

1. **Subscription lifetime is ~3 days, not 7 days.** Mail subscriptions cap at 4230 minutes (~70 hours, ~2.9 days). Once a subscription expires you can't renew it — you have to recreate (and resync via delta). Daily renewal is mandatory, not best-effort.
2. **Synchronous handshake on subscription create AND on renewal.** Microsoft Graph sends a `validationToken` query parameter to the webhook URL on every subscription creation/renewal. The endpoint MUST echo the token as `text/plain` with HTTP 200 within 10 seconds or the subscription is rejected. Gmail's Pub/Sub does not have this.
3. **No Pub/Sub equivalent — Microsoft pushes JSON directly to your HTTPS endpoint.** Authentication is via the `clientState` secret we set at subscription creation, NOT a JWT. (Optional: encrypted-payload mode using a public-key cert; not needed for Phase 2 since we only receive change notifications, not the message body.)
4. **Refresh-token lifetime is a sliding 90-day window, not absolute.** As long as a refresh token is used within 90 days of issuance, a new refresh token comes back and the clock resets. We never bake in a "re-auth every N days" UI — re-auth only happens when refresh actually fails with `invalid_grant`.
5. **Admin consent and Conditional Access are real, common failure modes.** Many M365 tenants enforce admin consent for third-party apps, or require MFA/device compliance for app access. Both produce specific OAuth errors that need user-facing recovery paths — not silent failures.

**Library picks (versions verified via `npm view` on 2026-05-19):**

- `@azure/msal-node` `5.2.1` (latest stable; major v5 supersedes v4 from April 2025). `[VERIFIED: npm registry]`
- `@microsoft/microsoft-graph-client` `3.0.7` (latest stable). `[VERIFIED: npm registry]`
- `isomorphic-fetch` `3.0.0` is listed as a peer dep historically, but Node 22+/24+ ships `globalThis.fetch`. Configure the Graph client with `fetchOptions` pointing at native fetch; do **not** install `isomorphic-fetch`. `[VERIFIED: npm registry]`
- `jose` (already a transitive dep of `@supabase/ssr`) — not needed; we do not need to verify JWTs since Graph uses `clientState`, not signed JWTs. `[ASSUMED]`

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth redirect kick-off | Frontend Server (Server Action) | — | Builds the Microsoft authorize URL with `state` cookie; redirects to `login.microsoftonline.com`. |
| OAuth callback (code exchange) | API / Backend (Route Handler) | — | Receives `?code=&state=`, exchanges code for tokens via MSAL, encrypts, writes `outlook_credentials`, creates subscription, redirects to `/settings/integrations`. |
| Subscription validation handshake | API / Backend (Route Handler) | — | Must respond to `?validationToken=...` synchronously within 10s. Cannot be deferred to Inngest. |
| Notification fan-out | API / Backend (Route Handler) | Background Worker (Inngest) | Route handler validates `clientState`, returns 202 immediately, fires Inngest event. |
| Token refresh + Graph fetch | Background Worker (Inngest) | — | Inngest function decrypts refresh token, MSAL refreshes access token, Graph `delta` query pulls messages, matches against candidates/contacts, inserts activity rows. |
| Subscription renewal | Background Worker (Inngest scheduled, daily) | — | Cron: every 24h renew any subscription with `expires_at < now() + 24h`. |
| Disconnect flow | Frontend Server (Server Action) | — | DELETE the subscription via Graph, set `revoked_at`, zero out token columns. |
| Encryption / decryption | `src/lib/encryption.ts` (server-only) | — | aes-256-gcm helper from Plan 0 of Phase 2; never invoked client-side. |

---

## D.15 (Outlook) — Keep magic-link sign-in; add a separate "Connect Outlook" flow

**Decision unchanged from D2-15:** Supabase Auth magic-link remains the sign-in path for the app. Outlook is connected per-user via a separate OAuth handshake against Microsoft identity platform (Entra ID, formerly Azure AD). Do NOT add Microsoft as a Supabase Auth provider for sign-in — Supabase Auth's `azure` provider doesn't refresh provider tokens, and conflating sign-in with mail-read consent would force every recruiter through the same consent surface even if they don't want Outlook integration.

**The flow:**

1. Recruiter clicks "Connect Outlook" in `/settings/integrations`.
2. Server Action mints a CSRF-safe `state` (random 32-byte hex, stored in an HTTP-only cookie `outlook_oauth_state` with `sameSite: 'lax'`, 10-minute TTL) and a PKCE `code_verifier` + `code_challenge` (SHA256). Both stored cookie-side.
3. Browser redirects to `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize` with:
   - `client_id={MS_CLIENT_ID}`
   - `response_type=code`
   - `redirect_uri=https://altus-recruitment.vercel.app/api/outlook/callback`
   - `response_mode=query`
   - `scope=offline_access%20Mail.Read%20User.Read`
   - `state={state}`
   - `code_challenge={pkce_challenge}`
   - `code_challenge_method=S256`
   - `prompt=consent` (force the consent screen the first time so the user sees the scopes; omit on re-connect)
4. Microsoft renders consent screen. If the tenant requires admin consent for third-party apps, the user sees "Need admin approval" — we handle that error in §D.23.
5. Microsoft redirects back to `/api/outlook/callback?code=...&state=...`.
6. Route handler validates `state` matches the cookie, then calls `MSAL.acquireTokenByCode({ code, scopes, redirectUri, codeVerifier })` to exchange the auth code for `{ accessToken, refreshToken, idTokenClaims }`.
7. Decrypt the `tid` (tenant id) and `oid` (object id) claims from the ID token (these are stable identifiers — see §D.16).
8. Encrypt tokens, INSERT into `outlook_credentials`, immediately call Graph to create the subscription (§D.17), redirect back to `/settings/integrations?connected=outlook`.

**Why MSAL, not raw OAuth fetches?** MSAL handles:
- PKCE on confidential clients
- Token caching (we pass our own cache plugin so the cache lives in the DB row, not in MSAL's in-memory store)
- Refresh-token rotation logic (Microsoft rotates the refresh token on every refresh)
- Common token endpoint vs tenant-specific token endpoint selection
- The various error shapes (`invalid_grant`, `consent_required`, `interaction_required`, etc.)

Rolling our own would be ~150 lines of code that exists already as `@azure/msal-node` 5.x. `[CITED: learn.microsoft.com/entra/msal/node]`

**Library install:**

```bash
pnpm add @azure/msal-node@^5.2.1 @microsoft/microsoft-graph-client@^3.0.7
# Do NOT install isomorphic-fetch — Node 22+/24+ have native fetch and the Graph client supports it via fetchOptions.
```

**Slopcheck:** Both packages are published by Microsoft (`npm view @azure/msal-node maintainers` returns `microsoft1es`; `npm view @microsoft/microsoft-graph-client maintainers` likewise). 8M+ weekly downloads on MSAL, 350k+ on the Graph client. Source repos: `github.com/AzureAD/microsoft-authentication-library-for-js` (MSAL), `github.com/microsoftgraph/msgraph-sdk-javascript` (Graph). `[OK]` `[VERIFIED: npm registry + GitHub]`

## D.16 (Outlook) — Token storage

**Same aes-256-gcm pattern as D.16 (Gmail).** The encryption helper (`src/lib/encryption.ts`) is shared — Plan 0 of Phase 2 introduces it once and both Gmail (if we ever re-enable) and Outlook would use it. For Phase 2 with the Outlook pivot, only Outlook needs it.

**Token shape (Microsoft identity platform):**

| Token | Lifetime | Notes |
|-------|----------|-------|
| `access_token` | ~1 hour (sometimes 60–90 min variable) | JWT signed by Microsoft. We don't parse — just present it as `Authorization: Bearer ...` to Graph. |
| `refresh_token` | Sliding 90 days | As long as used at least once every 90 days, a new refresh token comes back and the window resets. Bound to `(user, app, tenant)`. |
| `id_token` | One-time, identity assertion | JWT with `tid` (tenant id), `oid` (Entra object id), `preferred_username` (typically the email), `name`. We pull `tid` and `oid` and discard the rest. |

`tid` and `oid` matter:
- `tid` is needed for subsequent token refresh — MSAL needs to know which tenant's `/oauth2/v2.0/token` endpoint to hit. For a single-tenant app this is fixed to `MS_TENANT_ID` env var, but storing it per-row leaves room to flip to multi-tenant later without a schema migration.
- `oid` is the stable Entra user identifier. The user's UPN (`preferred_username`, basically the email) can change (rebrand, marriage, IT rename) — `oid` does not.

**Schema (`outlook_credentials`):**

```sql
-- Migration: 20260519XXXXXX_phase2_outlook_credentials.sql
-- Notes:
--   * Encryption is application-side aes-256-gcm in src/lib/encryption.ts.
--     Postgres stores opaque bytea; the key (OUTLOOK_TOKEN_ENCRYPTION_KEY, 32 bytes
--     hex) never enters Postgres.
--   * Encrypted payload format: <iv:12 bytes>:<authTag:16 bytes>:<ciphertext>
--     packed as a single bytea (no base64 — bytea storage is fine).
--   * RLS: only the owning user can read their own row (user_id = auth.uid()).
--     organization_id is present for tenant isolation reporting + the verify_same_org_check
--     trigger pattern.
--   * One row per (user_id) — UNIQUE constraint. A recruiter can connect only one
--     Outlook account. Re-connect = UPSERT.

create table public.outlook_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade unique,

  -- Identity (plain — not secret)
  microsoft_user_id text not null,         -- Entra object id (`oid` claim)
  microsoft_tenant_id text not null,       -- Entra tenant id (`tid` claim)
  microsoft_email text not null,           -- preferred_username; lowercased before insert

  -- Tokens (encrypted application-side)
  refresh_token_encrypted bytea not null,
  access_token_encrypted bytea,
  access_token_expires_at timestamptz,
  scopes text[] not null,                   -- ['offline_access','Mail.Read','User.Read']

  -- Subscription (Microsoft Graph change notification)
  subscription_id text,                     -- Graph subscription guid
  subscription_client_state text,           -- per-subscription random secret (NEVER returned to client)
  subscription_resource text,               -- e.g. "me/mailFolders('Inbox')/messages"
  subscription_expires_at timestamptz,      -- max ~70h from creation
  subscription_delta_link text,             -- @odata.deltaLink for incremental sync

  -- Lifecycle
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_sync_at timestamptz,
  last_sync_error text,                     -- text message; NEVER store full error or PII

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outlook_credentials_user_idx on public.outlook_credentials (user_id);
create index outlook_credentials_subscription_idx on public.outlook_credentials (subscription_id)
  where subscription_id is not null;
create index outlook_credentials_renewal_idx on public.outlook_credentials (subscription_expires_at)
  where subscription_expires_at is not null and revoked_at is null;

alter table public.outlook_credentials enable row level security;

create policy "user select own outlook credentials"
  on public.outlook_credentials for select to authenticated
  using (user_id = auth.uid());
create policy "user insert own outlook credentials"
  on public.outlook_credentials for insert to authenticated
  with check (user_id = auth.uid() and organization_id = public.current_organization_id());
create policy "user update own outlook credentials"
  on public.outlook_credentials for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "user delete own outlook credentials"
  on public.outlook_credentials for delete to authenticated
  using (user_id = auth.uid());

create trigger outlook_credentials_set_org before insert on public.outlook_credentials
  for each row execute function public.set_organization_id();
create trigger outlook_credentials_set_updated_at before update on public.outlook_credentials
  for each row execute function public.set_updated_at();
```

**FK guard? No — `user_id` is auth-tied.** The `verify_same_org_check` trigger pattern (Phase 1 D-20 carry-forward) is needed when a tenant-scoped row has a FK to another tenant-scoped row in a way that bypasses RLS (e.g., via service-role Inngest writes). `outlook_credentials.user_id` is the *only* domain FK; `users.organization_id` is itself the source of `current_organization_id()`. There is no cross-tenant attack surface here because the row's `organization_id` is set from the session and the `user_id` is constrained by the WITH CHECK clause to match `auth.uid()`. The trigger ordering bug from Phase 1 doesn't apply. `[CITED: 01-LEARNINGS.md "Cross-tenant FK guards must extend to ALL tenant-scoped tables"]`

**Service-role writes.** Inngest functions writing to `outlook_credentials` (updating `last_sync_at`, `subscription_expires_at`, `subscription_delta_link`) MUST scope the WHERE clause by `id` (PK) — never bulk update. Standard Phase 1 service-role discipline.

## D.17 (Outlook) — Microsoft Graph change notifications + delta sync

This is the meaningful pivot. Gmail's model is "Pub/Sub topic → push → History API". Microsoft Graph's model is "subscription resource → direct webhook push → delta query (or per-message GET)".

### Subscription lifecycle

**Create subscription** (POST `https://graph.microsoft.com/v1.0/subscriptions`):

```http
POST /v1.0/subscriptions HTTP/1.1
Authorization: Bearer {access_token_of_connecting_user}
Content-Type: application/json

{
  "changeType": "created",
  "notificationUrl": "https://altus-recruitment.vercel.app/api/outlook/webhook",
  "resource": "me/mailFolders('Inbox')/messages",
  "expirationDateTime": "2026-05-22T08:00:00.0000000Z",   // <= now + 4230 minutes
  "clientState": "<32-byte hex random per subscription>"
}
```

Response:
```json
{
  "id": "0fc0d6f9-...-...",
  "resource": "me/mailFolders('Inbox')/messages",
  "applicationId": "...",
  "changeType": "created",
  "clientState": "<the random secret we sent — Graph echoes it back>",
  "notificationUrl": "https://altus-recruitment.vercel.app/api/outlook/webhook",
  "lifecycleNotificationUrl": null,
  "expirationDateTime": "2026-05-22T08:00:00Z",
  "creatorId": "..."
}
```

**Microsoft validates `notificationUrl` BEFORE returning this response.** Graph posts a request to our webhook URL with `?validationToken=<random>` and expects a plain-text body containing exactly the token, with `Content-Type: text/plain` and HTTP 200, within **10 seconds**. If we fail this handshake, the POST `/subscriptions` call returns `400 Bad Request`. This is the same handshake Microsoft uses for renewals. `[CITED: learn.microsoft.com/graph/webhooks#notificationurl-validation]`

**`changeType` choice.** `created` is sufficient for Phase 2 — we want new inbound mail. `updated` would fire on read/unread state, flags, category changes (noisy). `deleted` is irrelevant since we already store our own copy of the activity. Phase 4 may want `updated` if we surface read receipts; out of scope now. `[CITED: learn.microsoft.com/graph/api/resources/subscription]`

**`resource` choice.** `me/mailFolders('Inbox')/messages` scopes to inbox only (incoming). If we want to capture outbound replies too, switch to `me/messages` and filter `from.emailAddress.address == microsoft_email` in the consumer. Phase 2 contract is "inbound emails" (D2-19) — start with Inbox-only; revisit in Phase 4.

**`expirationDateTime` math.** Mail subscriptions cap at **4230 minutes = 70.5 hours ≈ 2.94 days**. Other resources have different caps (calendars: 4230 min; user/group: 41760 min ≈ 29 days; chats: 60 min). For mail, always set `expirationDateTime` to a safe value below the cap — recommend `now + 4200 minutes` to leave 30 min of buffer. `[VERIFIED: learn.microsoft.com/graph/webhooks lifecycle table]`

### Webhook validation handshake (synchronous)

When Microsoft sends ANY subscription creation/renewal request, it first POSTs the webhook URL with `?validationToken=<value>`. Behaviour required:

```ts
// src/app/api/outlook/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')

  // Validation handshake: respond with the token as text/plain, no JSON.
  // Time budget: < 10 seconds end-to-end.
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Real notification — see §D.17 notification handling below.
  const payload = await req.json()
  // ...
}
```

Three Microsoft-specific gotchas:

1. **The response MUST be `text/plain`**, not JSON. Echoing the token wrapped in `JSON.stringify(...)` silently fails.
2. **No special headers or content-encoding.** Plain UTF-8 text.
3. **HTTP 200, not 201/202.** Graph treats anything other than 200 (for validation) as failure.

`[CITED: learn.microsoft.com/graph/webhooks#notificationurl-validation]`

### Notification payload + clientState validation

For real notifications, Graph POSTs JSON:

```json
{
  "value": [
    {
      "subscriptionId": "0fc0d6f9-...",
      "subscriptionExpirationDateTime": "2026-05-22T08:00:00Z",
      "changeType": "created",
      "resource": "Users/{userId}/Messages/{messageId}",
      "resourceData": {
        "@odata.type": "#Microsoft.Graph.Message",
        "@odata.id": "Users/{userId}/Messages/{messageId}",
        "@odata.etag": "W/\"CQAAABYAAAB...\"",
        "id": "{messageId}"
      },
      "clientState": "<the secret we set at subscription creation>",
      "tenantId": "..."
    }
  ]
}
```

**Authentication on the push:** Microsoft does NOT sign the JWT. The only authentication signal is the `clientState` we set at subscription creation, which Microsoft echoes back. Our handler:

```ts
// Continued from the POST handler above.
const payload = await req.json() as { value: Array<{ subscriptionId: string; clientState: string; resourceData: { id: string } }> }

if (!Array.isArray(payload?.value)) {
  return new NextResponse('Bad request', { status: 400 })
}

// Group by subscription so we lookup credentials once per subscription.
const bySubscription = new Map<string, typeof payload.value>()
for (const notification of payload.value) {
  const list = bySubscription.get(notification.subscriptionId) ?? []
  list.push(notification)
  bySubscription.set(notification.subscriptionId, list)
}

const supabase = createServiceClient()
for (const [subscriptionId, notifications] of bySubscription) {
  // Lookup credentials by subscription_id. Note: service-role bypasses RLS but
  // we scope strictly by subscription_id (a Microsoft-generated guid the attacker
  // cannot forge against our DB).
  const { data: cred } = await supabase
    .from('outlook_credentials')
    .select('id, user_id, organization_id, subscription_client_state')
    .eq('subscription_id', subscriptionId)
    .is('revoked_at', null)
    .maybeSingle()

  if (!cred) continue  // subscription we don't recognise — silently drop

  // Validate clientState: every notification in the batch must match.
  const ok = notifications.every(n => n.clientState === cred.subscription_client_state)
  if (!ok) {
    // PII-safe Sentry capture: subscription_id only, no clientState values.
    Sentry.captureMessage('outlook:webhook:clientState_mismatch', { extra: { subscriptionId } })
    continue
  }

  // Fan out to Inngest. Do NOT decrypt tokens here.
  await inngest.send({
    name: 'outlook/notifications.received',
    data: {
      credentials_id: cred.id,
      user_id: cred.user_id,
      organization_id: cred.organization_id,
      message_ids: notifications.map(n => n.resourceData.id),
    },
  })
}

// Always 202 — Graph treats 200/201/202 as success and won't retry.
// Anything 4xx/5xx triggers retry with exponential backoff up to ~4 hours.
return new NextResponse(null, { status: 202 })
```

Three operational notes:

1. **Return 202 within ~5 seconds.** Graph retries on non-2xx for ~4 hours (~10 attempts at exponential backoff). If we block on Inngest dispatch + DB writes, occasional cold starts on Vercel will exceed the threshold. Inngest's `send` is async-fire-and-forget over HTTPS — usually <100ms.
2. **Notification batches.** Graph may batch multiple notifications into one POST (up to ~1000 per request). Always iterate `payload.value`.
3. **Duplicate notifications.** Graph is at-least-once. The Inngest consumer must be idempotent on `(microsoft_user_id, message_id)` — use an upsert against `activities.metadata->>'outlook_message_id'` with a uniqueness check, or a dedicated `outlook_message_processed` ledger table. Recommendation: ledger table, cheaper than scanning activities JSON.

`[CITED: learn.microsoft.com/graph/change-notifications-overview]`

### Pulling the message: per-message GET vs delta

Two options once we have the notification:

**Option A — per-message GET.** For each message id from the notification, call `GET /me/messages/{id}?$select=...`. Simple, one Graph call per message. Risk: if notification delivery is delayed or skipped, we miss messages.

**Option B — delta query.** Call `GET /me/mailFolders('Inbox')/messages/delta` with the saved `@odata.deltaLink` from the previous sync. Returns all changes since that link, including ones we may have missed. Microsoft's documented recommended pattern. Returns a new `@odata.deltaLink` for the next sync. `[CITED: learn.microsoft.com/graph/delta-query-overview]`

**Recommendation: Option B (delta), matching Gmail's History API pattern.** The Inngest consumer:

```ts
// src/inngest/functions/sync-outlook-mailbox.ts
export const syncOutlookMailbox = inngest.createFunction(
  { id: 'sync-outlook-mailbox', concurrency: { key: 'event.data.credentials_id', limit: 1 } },
  { event: 'outlook/notifications.received' },
  async ({ event, step }) => {
    const cred = await step.run('load-credentials', () => getCredentialsById(event.data.credentials_id))
    const accessToken = await step.run('refresh-token', () => getValidAccessToken(cred))

    const graph = makeGraphClient(accessToken)

    // Use saved delta link if any; otherwise start a fresh delta sync from now.
    let url = cred.subscription_delta_link ??
      "/me/mailFolders('Inbox')/messages/delta?$select=id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,conversationId"

    let nextDeltaLink: string | null = null
    let pageCount = 0
    while (url && pageCount < 50) {  // safety cap
      const page = await step.run(`graph-page-${pageCount}`, () => graph.api(url).get())
      for (const msg of page.value ?? []) {
        await step.run(`process-${msg.id}`, () => processMessage(cred, msg))
      }
      nextDeltaLink = page['@odata.deltaLink'] ?? null
      url = page['@odata.nextLink'] ?? null
      pageCount++
    }

    if (nextDeltaLink) {
      await step.run('save-delta-link', () => updateDeltaLink(cred.id, nextDeltaLink))
    }
  }
)
```

Concurrency keyed by `credentials_id` means notifications for the same user serialize (no overlapping delta queries with stale links), but different users run in parallel.

### Subscription renewal

Renew a subscription with **PATCH** (not POST), and **before the current expiry**:

```http
PATCH /v1.0/subscriptions/{subscription_id} HTTP/1.1
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "expirationDateTime": "2026-05-25T08:00:00.0000000Z"
}
```

Microsoft re-runs the `validationToken` handshake on renewal too. Our same `/api/outlook/webhook` route handles both cases since the validation logic is identical.

If `subscription_expires_at` has already passed, PATCH returns 404 (Microsoft cleaned up the subscription server-side). The recovery path is to recreate the subscription with a fresh POST. The Inngest function handles both:

```ts
// src/inngest/functions/renew-outlook-subscriptions.ts
export const renewOutlookSubscriptions = inngest.createFunction(
  { id: 'renew-outlook-subscriptions' },
  { cron: '0 */6 * * *' },   // every 6 hours (safer than 24h given 70h subscription cap)
  async ({ step }) => {
    const due = await step.run('load-due', () =>
      listCredentialsWithSubscriptionExpiringWithin({ hours: 24 })
    )
    for (const cred of due) {
      const accessToken = await step.run(`token-${cred.id}`, () => getValidAccessToken(cred))
      const graph = makeGraphClient(accessToken)
      const newExpiry = new Date(Date.now() + 4200 * 60 * 1000).toISOString()

      try {
        const updated = await step.run(`renew-${cred.id}`, () =>
          graph.api(`/subscriptions/${cred.subscription_id}`).patch({ expirationDateTime: newExpiry })
        )
        await step.run(`save-${cred.id}`, () => updateSubscriptionExpiry(cred.id, updated.expirationDateTime))
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription gone. Recreate.
          await step.run(`recreate-${cred.id}`, () => recreateSubscription(cred))
        } else {
          throw err  // let Inngest retry
        }
      }
    }
  }
)
```

**Cron cadence:** every 6 hours, not 24. Rationale: Vercel/Inngest can have outage windows, and a 70-hour cap with 24-hour renewals leaves only 3 chances to renew. At 6-hour cadence we get ~11 chances, with 24h of grace from `expires_at - 24h` filter. The Inngest scheduled function cost is trivial. `[ASSUMED]`

**Sentry alert if any subscription is within 12 hours of expiry and the renewal job has not run in the last 24 hours.** This catches the silent-failure case where the Inngest scheduler itself is broken. `[ASSUMED]`

### Throttling

Microsoft Graph throttles per-user and per-app. Documented thresholds (subject to change; Microsoft does not commit to exact numbers):

| Resource | Limit (approx) | Header on 429 |
|----------|----------------|---------------|
| Outlook mail per user | ~10,000 requests per 10 min, ~150 concurrent | `Retry-After: <seconds>` |
| Subscriptions per app | ~7,000 active | n/a |
| Subscriptions per user per app | 1 per resource | 403 on creation conflict |

`[CITED: learn.microsoft.com/graph/throttling]` and `[CITED: learn.microsoft.com/graph/throttling-limits]`

On 429, MSAL + the Graph SDK do not retry automatically. Wrap Graph calls in a retry helper that:
1. Reads `Retry-After` header
2. Sleeps that many seconds (Inngest `step.sleep` if inside an Inngest function)
3. Retries up to 3 times
4. On final failure, logs `record_ai_usage(purpose='outlook_sync', model='graph', input_tokens=0, output_tokens=0, cost_pence=0)` with a `metadata` field indicating throttle to surface the rate-limit pattern (CLAUDE.md non-negotiable cost-logging hook also doubles as ops telemetry)

The Phase 1 `record_ai_usage` signature accepts a `metadata` jsonb param — confirm in `supabase/migrations/20260513152244_phase1_domain_schema.sql` before relying on this. If it doesn't, propose extending the signature in this phase. `[ASSUMED]`

## D.18 (Outlook) — Activity row shape (unchanged contract, Graph-specific fields)

Contract from D2-18 is unchanged: subject + ~200-char snippet only. Microsoft Graph provides `bodyPreview` which is Microsoft's own auto-truncated 255-char preview — we cap to 200 ourselves for consistency with the Gmail spec.

**Graph query:**

```http
GET /me/messages/{id}?$select=id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,conversationId
```

Or via delta:

```http
GET /me/mailFolders('Inbox')/messages/delta?$select=id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,conversationId
```

**Activity row:**

```ts
{
  kind: 'email',
  body: msg.subject ?? '(no subject)',          // we still store the subject as the timeline body
  entity_type: 'candidate' | 'contact',
  entity_id: <matched id>,
  actor_user_id: <recruiter user id>,
  occurred_at: msg.receivedDateTime,             // ISO 8601 from Graph
  metadata: {
    outlook_message_id: msg.id,
    outlook_conversation_id: msg.conversationId,
    internet_message_id: msg.internetMessageId,  // RFC822 Message-ID — stable across Outlook/Gmail/other clients in the thread
    from: msg.from.emailAddress.address.toLowerCase(),
    to: msg.toRecipients.map(r => r.emailAddress.address.toLowerCase()),
    cc: (msg.ccRecipients ?? []).map(r => r.emailAddress.address.toLowerCase()),
    snippet: (msg.bodyPreview ?? '').slice(0, 200),
    direction: <derived — see D.19>,
    source: 'outlook',
  }
}
```

**`metadata.source` field.** New field vs Gmail's spec: explicit `source: 'outlook'` lets the timeline UI render an Outlook icon and also lets Phase 4's future Gmail re-introduction co-exist without metadata schema collisions. `[ASSUMED]`

**Deep link.** Outlook web has stable URLs of the form `https://outlook.office.com/mail/inbox/id/<UrlEncoded(internet_message_id)>` for users on M365. Document this in the timeline UI. `[CITED: learn.microsoft.com/graph/outlook-deep-link]`

## D.19 (Outlook) — Inbound matching (unchanged contract; case-handling note)

Decision unchanged from D2-19: match `from.emailAddress.address` and each `toRecipients[*].emailAddress.address` (and `ccRecipients[*]`) against `candidates.email` and `contacts.email` within the org, exact lowercased match. Orphans (no match) are dropped, not stored, not logged.

**Case handling.** Microsoft Graph returns email addresses in the case they were sent (`Alice.Smith@Example.COM`). Phase 1's `candidates.email` and `contacts.email` columns are typed `text` and indexed via `gin (lower(email) gin_trgm_ops)` — see migration `20260517204502_search_indexes.sql`. Phase 1 does NOT enforce lowercase at insert (the `search_candidates_rpc.sql` migration's comment notes `lower(c.email)` is applied at query time). So:

- On insert into our DB (apply form, manual create): the planner should add a `before insert` trigger or normalize at the `src/lib/db/candidates.ts` layer to store `lower(email)`. This is a small Phase 2 cleanup task. `[ASSUMED]` — confirm by reading `candidates.email` column constraints.
- On match lookup from Outlook: always lowercase the incoming address before the `eq()` query.

Recommended helper:

```ts
// src/lib/integrations/outlook.ts
export function normalizeEmailAddress(addr: string | null | undefined): string | null {
  if (!addr) return null
  const trimmed = addr.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}
```

**Direction derivation:**

```ts
function deriveDirection(msg: Message, recruiterEmail: string): 'inbound' | 'outbound' {
  return msg.from?.emailAddress?.address?.toLowerCase() === recruiterEmail.toLowerCase()
    ? 'outbound'
    : 'inbound'
}
```

Note: `microsoft_email` in `outlook_credentials` is the recruiter's authoritative connected mailbox address (stored lowercase per D.16). Use that, not the Phase 1 `users.email` which could be different (a recruiter could sign into Altus with `alice@personal.com` and connect Outlook for `alice@altus.co.uk`).

## D.20 (Outlook) — Token encryption (unchanged)

Identical to D.20 (Gmail). `src/lib/encryption.ts` (Plan 0 of Phase 2) exposes:

```ts
// Format: <iv:12><authTag:16><ciphertext>  packed as Buffer
export function encryptSecret(plaintext: string): Buffer
export function decryptSecret(ciphertext: Buffer): string
```

Implementation reference (Node crypto, aes-256-gcm):

```ts
// src/lib/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '@/env'

const KEY = Buffer.from(env.OUTLOOK_TOKEN_ENCRYPTION_KEY, 'hex')  // 32 bytes
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, KEY, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
}

export function decryptSecret(packed: Buffer): string {
  const iv = packed.subarray(0, IV_BYTES)
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ct = packed.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
```

Naming: the env var is **`OUTLOOK_TOKEN_ENCRYPTION_KEY`** (32 random bytes, hex-encoded — 64 hex chars). Renaming Gmail's spec'd `GMAIL_TOKEN_ENCRYPTION_KEY` to a provider-neutral `INTEGRATION_TOKEN_ENCRYPTION_KEY` is tempting but adds key-rotation complexity if we ever re-add Gmail. Keep them separate. `[ASSUMED]`

**Key rotation:** v1 ships without rotation. Document in `docs/security.md`. v2 adds `encryption_key_version smallint not null default 1` to `outlook_credentials` and a re-encrypt job.

## D.21 (Outlook, NEW) — Entra tenant model

Microsoft identity platform requires an "app registration" in an Entra ID tenant. This registration is what produces `MS_CLIENT_ID` and (optionally) `MS_CLIENT_SECRET`. The registration has a **supported account types** setting:

| Setting | Who can sign in | Phase 2 fit |
|---------|-----------------|-------------|
| Single tenant | Users in the anchor's Entra tenant only | **RECOMMENDED for Phase 2** |
| Multi-tenant | Users in any Entra tenant | Phase 5 (SaaS expansion) |
| Multi-tenant + personal accounts | Above + consumer `outlook.com` accounts | Not relevant |

**Recommendation: single-tenant in the anchor's Entra directory.** Reasons:

1. **No publisher verification required.** Microsoft requires "publisher verified" status for multi-tenant apps requesting certain scopes from external tenants. Mail.Read is not on the strict list, but the verification UX is friction we can defer.
2. **Simpler consent surface.** All connecting users are already in the anchor's tenant, so the consent dialog shows the anchor's branding.
3. **Admin-consent path is local.** If the anchor's IT enforces admin consent, the admin doing the consent is someone the recruiter can walk to.
4. **No app review.** Multi-tenant apps with broad reach typically need to go through Microsoft's app verification.

**Phase 5 multi-tenant plan (deferred):**
- Flip app registration to "Multi-tenant"
- Apply for publisher verification
- Add an admin-consent URL pattern to the UI for new customer onboarding: `https://login.microsoftonline.com/{customer_tenant_id}/adminconsent?client_id={MS_CLIENT_ID}`
- Update `outlook_credentials.microsoft_tenant_id` write path (it's already there)

**App registration checklist (manual, one-time, by anchor's Entra admin):**

1. Portal: `entra.microsoft.com` → Identity → Applications → App registrations → New registration
2. Name: `Altus Recruitment — Outlook Integration`
3. Supported account types: **Accounts in this organizational directory only (Single tenant)**
4. Redirect URI: Platform = Web; URI = `https://altus-recruitment.vercel.app/api/outlook/callback` (plus a localhost variant for dev — see §D.24 local dev)
5. After registration:
   - Note **Application (client) ID** → `MS_CLIENT_ID`
   - Note **Directory (tenant) ID** → `MS_TENANT_ID`
   - Certificates & secrets → New client secret → 24-month expiry → note value → `MS_CLIENT_SECRET`
   - API permissions → Microsoft Graph → Delegated permissions → add: `Mail.Read`, `User.Read`, `offline_access` → Grant admin consent for {anchor tenant} (button at top)
6. Authentication → Implicit grant: leave both unchecked. We use auth-code flow with PKCE.

`[CITED: learn.microsoft.com/entra/identity-platform/quickstart-register-app]`

### Scopes

| Scope | What it grants | Phase 2? | Why not the alternative |
|-------|----------------|----------|-------------------------|
| `offline_access` | Refresh tokens (without this, no refresh token comes back) | **YES** | Required for background sync |
| `Mail.Read` | Read user's mail (delegated) | **YES** | Minimum needed |
| `User.Read` | Read basic profile (`oid`, `tid`, email) | **YES** | Required implicitly when calling `/me`; explicit is safer |
| ~~`Mail.ReadWrite`~~ | Read + modify (flags, folders) | NO | Over-privileged for Phase 2 read-only |
| ~~`Mail.Send`~~ | Send mail on behalf of user | NO | Phase 4 if outbound sending added |
| ~~`Mail.Read` (Application)~~ | Read ALL users' mail in the tenant, no user context | **ABSOLUTELY NOT** | Admin consent + reads every employee's inbox = catastrophic. Stay with delegated permissions only. |

`[CITED: learn.microsoft.com/graph/permissions-reference#mail-permissions]`

## D.22 (Outlook) — PII / privacy (unchanged contract; one difference)

Contract from D.22 (Gmail) carries over: clear consent flow, "Disconnect" button, "Delete all imported Outlook data" button, Sentry PII scrubbing extended to Outlook fields.

**One difference vs Gmail.** Microsoft Graph WILL return the full message body if you call `GET /me/messages/{id}` without `$select`. The default response includes `body.content` (HTML, possibly large). Discipline: every Graph call MUST include `$select` listing only the fields we need. Body storage is deferred per D2-18.

```ts
// ALWAYS — never call Graph without $select
graph.api(`/me/messages/${id}`).select('id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,conversationId').get()
```

**Consent screen copy** (`/settings/integrations/outlook/connect`):

> When you connect Outlook to Altus:
> - We request the `Mail.Read` permission from Microsoft. We do NOT request send, modify, or delete permissions.
> - We monitor your inbox for messages to/from candidates and clients already in your Altus organisation.
> - For matched messages, we store: sender, recipients, subject, the first 200 characters of the message preview, timestamp, and Outlook conversation ID — in the candidate or client's activity timeline.
> - We do NOT store the full email body. To view the full message, click through to Outlook.
> - We do NOT process emails to/from people who are NOT already in your Altus organisation.
> - You can disconnect at any time from Settings → Integrations.
> - On disconnect we revoke the Microsoft Graph subscription, delete encrypted tokens, and (optionally) purge already-imported activity rows.

Add `docs/privacy-outlook.md` mirroring `docs/privacy-gmail.md` from the Gmail spec.

**Sentry PII scrubber extension.** Phase 1's `beforeSend` PII scrubber already covers `email`. Extend to also redact: `subject`, `body`, `snippet`, `bodyPreview`, `from`, `toRecipients`, `ccRecipients`, `accessToken`, `refreshToken`, `clientState`. `[ASSUMED]` — confirm against Phase 1 Sentry config.

## D.23 (Outlook, NEW) — Delegated-permission edge cases

Three Microsoft-specific failure modes that don't have Gmail equivalents:

### 23.1 Admin consent required

Some M365 tenants enforce admin consent for any third-party app accessing user data. The user attempting to connect sees:

> Need admin approval
> Altus Recruitment — Outlook Integration needs permission to access resources in your organization that only an admin can grant. Please ask an admin to grant permission to this app before you can use it.

The OAuth callback receives `?error=consent_required` or `?error=access_denied&error_subcode=consent_required`. Handler should:

1. Detect the specific error code
2. Render a recoverable UI: "Your IT administrator needs to approve Altus to read your Outlook mail. Send them this admin consent link:" with the URL:
   ```
   https://login.microsoftonline.com/{MS_TENANT_ID}/adminconsent?client_id={MS_CLIENT_ID}&redirect_uri={ADMIN_CONSENT_REDIRECT_URI}
   ```
3. Optionally render a "Copy link" button + an "Email my admin" button (mailto with prefilled body)

For Phase 2 single-tenant, the anchor's IT can grant admin consent once at app registration time (Step 5 of the app-registration checklist), which preempts this error. But surface the recovery UI anyway — if the anchor revokes admin consent later (e.g., during a security review), this is what recovers gracefully. `[CITED: learn.microsoft.com/entra/identity/enterprise-apps/configure-user-consent]`

### 23.2 Conditional Access policy enforcement

Some tenants enforce CA policies: MFA, device compliance, location, app protection, etc. CA can block:
- **Initial authorize**: redirect-back error `error=interaction_required`, `error_subcode=mfa_required` or `device_unmanaged`. We can't recover programmatically — the user has to satisfy the policy (typically by re-authenticating with MFA on a managed device).
- **Token refresh**: MSAL `acquireTokenByRefreshToken` returns `interaction_required`. Treat as token-revoked: mark `outlook_credentials.revoked_at = now()`, set `last_sync_error = 'conditional_access_required'`, surface in `/settings/integrations` with a "Reconnect" button. `[CITED: learn.microsoft.com/entra/identity/conditional-access/concept-conditional-access-cloud-apps]`

### 23.3 Refresh-token failure modes

| MSAL error | Meaning | Recovery |
|------------|---------|----------|
| `invalid_grant` | Refresh token revoked, expired (90+ days unused), or user changed password | Mark `revoked_at`, surface reconnect prompt |
| `interaction_required` | CA policy now requires re-auth | Mark `revoked_at`, surface reconnect prompt |
| `consent_required` | Admin revoked consent, or user revoked our app at `myapps.microsoft.com` | Mark `revoked_at`, surface reconnect prompt |
| `temporarily_unavailable` | Microsoft service issue | Inngest retry; do NOT mark revoked |
| `invalid_client` | Our `MS_CLIENT_ID`/`MS_CLIENT_SECRET` is wrong/expired | Sentry alert; this is an ops issue, not per-user |

```ts
// src/lib/integrations/outlook.ts — token refresh helper
export async function getValidAccessToken(cred: OutlookCredentials): Promise<string> {
  if (cred.access_token_encrypted && cred.access_token_expires_at && new Date(cred.access_token_expires_at) > new Date(Date.now() + 60_000)) {
    return decryptSecret(cred.access_token_encrypted)
  }

  const refreshToken = decryptSecret(cred.refresh_token_encrypted)
  const msal = getMsalClient(cred.microsoft_tenant_id)

  try {
    const result = await msal.acquireTokenByRefreshToken({
      refreshToken,
      scopes: cred.scopes.filter(s => s !== 'offline_access'),  // refresh-token requests omit offline_access
    })
    if (!result) throw new Error('msal returned null')

    // Microsoft rotates refresh tokens — the result includes a new one.
    // MSAL stashes it in its internal cache; we read it via the cache plugin.
    const newRefresh = msal.getTokenCache().getRefreshTokens().find(rt => rt.homeAccountId === result.account?.homeAccountId)

    await updateCredentials(cred.id, {
      access_token_encrypted: encryptSecret(result.accessToken),
      access_token_expires_at: result.expiresOn?.toISOString(),
      refresh_token_encrypted: newRefresh?.secret ? encryptSecret(newRefresh.secret) : cred.refresh_token_encrypted,
    })

    return result.accessToken
  } catch (err: any) {
    const oauthErr = err?.errorCode ?? err?.error
    if (['invalid_grant', 'interaction_required', 'consent_required'].includes(oauthErr)) {
      await markRevoked(cred.id, oauthErr)
      throw new IntegrationRevokedError('outlook', oauthErr)
    }
    throw err  // transient — let Inngest retry
  }
}
```

**Refresh-token rotation.** Microsoft rotates refresh tokens on each refresh. The new RT must be persisted; otherwise the old one will fail on next use. MSAL handles the rotation inside its cache; we need a cache plugin that persists to our `outlook_credentials.refresh_token_encrypted` column. Without the cache plugin, MSAL stores in memory and the rotation is lost between Inngest invocations. `[CITED: learn.microsoft.com/entra/msal/node/caching]`

## D.24 (Outlook, NEW) — Webhook security checklist + local dev

### Security checklist

- [ ] **`validationToken` handshake** — respond with the token as `text/plain` HTTP 200 within 10 seconds. Tested by Microsoft on subscription create/renew.
- [ ] **`clientState` validation** — on every notification, lookup the credentials by `subscriptionId` and compare the notification's `clientState` to `outlook_credentials.subscription_client_state`. Reject (continue + Sentry warning) on mismatch.
- [ ] **`subscriptionId` lookup is authoritative for user/org binding** — never trust any user identifier from the notification payload. The credentials row tells us which user/org owns the subscription.
- [ ] **`resourceData.id` is the only field we use from the payload** — message body and identity claims come from a fresh Graph API call (using our refreshed access token), never the webhook payload.
- [ ] **Subscription resource path locked** — when creating a subscription, the resource is always `me/mailFolders('Inbox')/messages`. If we later add other resources, validate the notification's `resource` field matches the expected pattern for that subscription. Defence against subscription-collision attacks if Microsoft ever (hypothetically) routed notifications across subscriptions.
- [ ] **HTTP 202 response within ~5 seconds** — defer all processing to Inngest. Do not block on token decryption or Graph calls.
- [ ] **Idempotent message processing** — dedup on `(microsoft_user_id, message_id)` via a `outlook_message_processed` ledger table. Graph is at-least-once.
- [ ] **Access tokens decrypt ONLY inside `src/lib/integrations/outlook.ts`** — never log decrypted tokens, never pass to client, never include in Sentry context.
- [ ] **`clientState` is per-subscription random hex (32 bytes)** — never reuse across subscriptions; never store the same value in plaintext anywhere other than the `outlook_credentials` row.
- [ ] **Subscription-resource matches subscription-owner** — when a subscription is created on behalf of user A, the resource must be `me/...` evaluated in A's context. Cross-user subscriptions (creating a subscription on behalf of someone else) require admin permissions we don't have. Verified at subscription-creation time by Microsoft.
- [ ] **Disconnect deletes the subscription server-side** — DELETE `/subscriptions/{id}` via Graph before deleting the local row, so Microsoft stops pushing.

### Local development path

Microsoft Graph requires the `notificationUrl` to be publicly reachable HTTPS. No localhost. Three options:

| Option | Setup | Tradeoffs |
|--------|-------|-----------|
| **ngrok** (`ngrok http 3000`) | Run a tunnel; copy the `https://xxxx.ngrok.app` URL into the app-registration redirect URIs + `OUTLOOK_PUBLIC_URL` env var | URL changes every restart on free tier; need to update the registration each time. Use a reserved domain on the paid tier for stability. |
| **Vercel preview deploys** | Push to a PR branch; Vercel mints a preview URL; add to redirect URIs | Slow iteration loop; every change = redeploy |
| **Cloudflare Tunnel (`cloudflared`)** | Free, gives a stable subdomain | More setup, equivalent functionality to ngrok |

**Recommendation: ngrok with a reserved subdomain ($10/month) for the solo dev,** registered once in the Entra app's redirect URIs alongside the production URL. Document the setup in `docs/dev-outlook-local.md`. `[ASSUMED]` — confirm dev preference.

**Inngest gateway** (`inngest dev`) does NOT solve this — Inngest's gateway is for Inngest functions, not arbitrary HTTPS webhooks. ngrok or equivalent is mandatory.

### Subscription cleanup in dev

A second gotcha: every time the dev environment restarts with a new ngrok URL, old subscriptions stay alive in Microsoft Graph pointing at the dead URL. They'll fail validation handshakes and Microsoft will eventually GC them, but they consume the per-app subscription cap (~7,000). For dev hygiene: add a `pnpm outlook:cleanup-subscriptions` script that lists all subscriptions via Graph and deletes any pointing at non-current URLs. Run it on app boot in dev. `[ASSUMED]`

---

## Lockdown details (per the brief)

### 1. Library + version picks

| Package | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@azure/msal-node` | `^5.2.1` | Confidential client OAuth + token refresh + cache plugin | `npm view @azure/msal-node` 2026-05-19 `[VERIFIED: npm registry]` |
| `@microsoft/microsoft-graph-client` | `^3.0.7` | Graph API client (delta queries, subscriptions, messages) | `npm view @microsoft/microsoft-graph-client` 2026-05-19 `[VERIFIED: npm registry]` |
| `isomorphic-fetch` | — | NOT installed | Node 22+/24+ has native fetch; configure Graph client with `fetchOptions: { fetch: globalThis.fetch }` |
| `@azure/identity` | — | NOT needed for delegated flows | Used for app-managed identity / certificates; we're using client_secret |

### 2. `outlook_credentials` schema

See D.16 above. Full table DDL + RLS + triggers. Trigger naming: `outlook_credentials_set_org` (BEFORE INSERT sets org_id from session) and `outlook_credentials_set_updated_at` (BEFORE UPDATE bumps timestamp). No `verify_same_org_check` trigger needed (only domain FK is `user_id`).

### 3. Webhook validation pseudo-code

```ts
// src/app/api/outlook/webhook/route.ts
export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new NextResponse(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  let payload: NotificationPayload
  try {
    payload = await req.json()
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  if (!Array.isArray(payload?.value)) return new NextResponse(null, { status: 400 })

  const supabase = createServiceClient()
  const grouped = groupBy(payload.value, n => n.subscriptionId)

  for (const [subId, notifs] of Object.entries(grouped)) {
    const { data: cred } = await supabase
      .from('outlook_credentials')
      .select('id, user_id, organization_id, subscription_client_state')
      .eq('subscription_id', subId)
      .is('revoked_at', null)
      .maybeSingle()
    if (!cred) continue
    if (!notifs.every(n => n.clientState === cred.subscription_client_state)) {
      Sentry.captureMessage('outlook:webhook:clientState_mismatch', { extra: { subId } })
      continue
    }
    await inngest.send({
      name: 'outlook/notifications.received',
      data: {
        credentials_id: cred.id,
        user_id: cred.user_id,
        organization_id: cred.organization_id,
        message_ids: notifs.map(n => n.resourceData.id),
      },
    })
  }
  return new NextResponse(null, { status: 202 })
}
```

### 4. OAuth callback pseudo-code

```ts
// src/app/api/outlook/callback/route.ts
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorCode = url.searchParams.get('error')
  const cookieStore = await cookies()
  const expectedState = cookieStore.get('outlook_oauth_state')?.value
  const pkceVerifier = cookieStore.get('outlook_oauth_pkce')?.value

  // Reset cookies in all branches
  cookieStore.delete('outlook_oauth_state')
  cookieStore.delete('outlook_oauth_pkce')

  if (errorCode) {
    if (errorCode === 'consent_required' || url.searchParams.get('error_subcode') === 'consent_required') {
      return NextResponse.redirect(new URL('/settings/integrations?outlook_error=admin_consent_required', req.url))
    }
    return NextResponse.redirect(new URL(`/settings/integrations?outlook_error=${encodeURIComponent(errorCode)}`, req.url))
  }
  if (!code || !state || state !== expectedState || !pkceVerifier) {
    return NextResponse.redirect(new URL('/settings/integrations?outlook_error=invalid_state', req.url))
  }

  const supabase = await createClient()  // user-scoped, NOT service-role
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/sign-in', req.url))

  const msal = getMsalClient(env.MS_TENANT_ID)
  const result = await msal.acquireTokenByCode({
    code,
    scopes: ['offline_access', 'Mail.Read', 'User.Read'],
    redirectUri: `${env.OUTLOOK_PUBLIC_URL}/api/outlook/callback`,
    codeVerifier: pkceVerifier,
  })
  if (!result || !result.account) {
    return NextResponse.redirect(new URL('/settings/integrations?outlook_error=token_exchange_failed', req.url))
  }

  const refreshToken = msal.getTokenCache().getRefreshTokens().find(rt => rt.homeAccountId === result.account!.homeAccountId)?.secret
  if (!refreshToken) {
    return NextResponse.redirect(new URL('/settings/integrations?outlook_error=no_refresh_token', req.url))
  }

  const oid = result.idTokenClaims?.oid as string
  const tid = result.idTokenClaims?.tid as string
  const email = ((result.idTokenClaims as any)?.preferred_username as string).toLowerCase()

  // Insert credentials (RLS-scoped under the authenticated user).
  // Subscription creation happens next — see step 5.
  const credentialsId = await upsertOutlookCredentials({
    user_id: user.id,
    microsoft_user_id: oid,
    microsoft_tenant_id: tid,
    microsoft_email: email,
    refresh_token_encrypted: encryptSecret(refreshToken),
    access_token_encrypted: encryptSecret(result.accessToken),
    access_token_expires_at: result.expiresOn?.toISOString() ?? null,
    scopes: ['offline_access', 'Mail.Read', 'User.Read'],
  })

  // Create the change-notification subscription. Done synchronously here so the user
  // sees connection succeeded with sync active immediately.
  try {
    await createOutlookSubscription(credentialsId, result.accessToken)
  } catch (err) {
    Sentry.captureException(err, { tags: { integration: 'outlook', stage: 'subscription_create' } })
    return NextResponse.redirect(new URL('/settings/integrations?outlook_error=subscription_failed', req.url))
  }

  return NextResponse.redirect(new URL('/settings/integrations?outlook=connected', req.url))
}
```

### 5. Subscription lifecycle

| Event | Action | Where |
|-------|--------|-------|
| User clicks "Connect Outlook" | Mint state + PKCE; redirect to Microsoft authorize | Server Action `connectOutlookAction()` |
| OAuth callback | Exchange code, store credentials, create subscription | `/api/outlook/callback` route handler |
| Microsoft validates webhook | Respond with `validationToken` text | `/api/outlook/webhook` route handler |
| Mail arrives in inbox | Microsoft POSTs notification → Inngest event → delta sync | `/api/outlook/webhook` + `sync-outlook-mailbox` Inngest function |
| Subscription nears expiry | Renew via PATCH | `renew-outlook-subscriptions` Inngest cron (every 6h) |
| Subscription dies (404 on PATCH) | Recreate | Same Inngest cron, catch path |
| User clicks "Disconnect" | DELETE subscription, NULL token columns, set `revoked_at` | Server Action `disconnectOutlookAction()` |
| User clicks "Delete all imported Outlook data" | DELETE `activities WHERE kind='email' AND metadata->>'source'='outlook' AND ...` | Server Action `purgeOutlookActivitiesAction()` |

### 6. Token refresh pseudo-code

See §D.23.3 — full `getValidAccessToken(cred)` implementation. The critical points:
1. Skip refresh if `access_token_expires_at` is more than 60s in the future
2. MSAL persists the rotated refresh token to its cache; we must persist the cache to DB
3. On `invalid_grant` / `consent_required` / `interaction_required`, mark revoked and throw a typed error
4. On any other error, throw raw — Inngest retries

### 7. Pitfalls (Microsoft-specific surprises)

| # | Pitfall | Detection | Mitigation |
|---|---------|-----------|------------|
| P1 | `validationToken` response wrapped in JSON instead of plain text | Subscription create returns 400 | Hardcode `Content-Type: text/plain` and return the token as a naked string |
| P2 | Subscription expires (4230-min cap), PATCH returns 404 | Inngest renewal job logs 404 | Catch 404 → recreate subscription, full delta resync |
| P3 | Refresh-token rotation lost between Inngest invocations | Tokens silently expire after first refresh | MSAL cache plugin that persists to `outlook_credentials.refresh_token_encrypted` |
| P4 | Admin consent enforced; first-time connect fails | OAuth callback receives `?error=consent_required` | Surface admin-consent URL in UI |
| P5 | CA policy blocks app at refresh time | MSAL throws `interaction_required` | Mark revoked, prompt reconnect |
| P6 | Notification clientState mismatch | Spurious notifications from old/stolen subscription | Validate per-notification; drop + log |
| P7 | Graph 429 throttling | Sync stops mid-batch | Retry with `Retry-After` honoured in step.sleep |
| P8 | Old ngrok URL still has live subscriptions | Dev machine subscription cap hits 7k | Cleanup script run on dev boot |
| P9 | Microsoft Graph returns body by default | Storing full body unintentionally | Always include `$select` in every Graph call |
| P10 | Email case normalization mismatch between Phase 1 data and Graph payload | Match misses on `Alice@Example.com` vs `alice@example.com` | Lowercase at insert AND at lookup |
| P11 | Subscription deleted server-side after long quiet period | Push silently stops | Renewal cron detects 404, recreates |
| P12 | `prompt=consent` on reconnect re-issues new refresh token but old subscriptions still alive under old account | Stale subscription points to revoked token | On reconnect, DELETE old subscription before re-INSERT credentials |
| P13 | Multiple recruiters connect the same shared mailbox | All get notifications for the same mail; duplicate activity rows | Ledger table dedup OR enforce uniqueness on `(organization_id, internet_message_id)` in activities |
| P14 | App-registration client secret expires (default 24 months) | All token refreshes fail with `invalid_client` | Sentry alert; calendar reminder at month 22 |
| P15 | `Mail.Read` is a delegated permission; do NOT switch to application permission | Tenant admin would see "this app reads ALL users' mail" prompt; catastrophic privacy posture | Documented in scope table — never set to Application |

### 8. Local dev path

Documented above (§D.24). TL;DR: ngrok with reserved subdomain → register both prod URL and ngrok URL as redirect URIs in the Entra app registration → set `OUTLOOK_PUBLIC_URL` env in `.env.local` to the ngrok URL → ngrok stays running during dev.

### 9. Required env vars

```bash
# .env.example additions for Outlook integration

# Entra ID app registration (single-tenant in anchor's directory).
# Get these from entra.microsoft.com → App registrations → Altus Recruitment.
MS_TENANT_ID=                  # Directory (tenant) ID — guid
MS_CLIENT_ID=                  # Application (client) ID — guid
MS_CLIENT_SECRET=              # Client secret value — opaque string, ~40 chars. Expires 24 months from creation; rotate.

# Public URL where Microsoft Graph posts change notifications.
# Production: https://altus-recruitment.vercel.app
# Local dev: your ngrok URL, e.g. https://altus-dev.ngrok.app
OUTLOOK_PUBLIC_URL=

# 32-byte aes-256-gcm key, hex-encoded (64 hex chars).
# Generate with: openssl rand -hex 32
# DO NOT commit. DO NOT reuse across environments.
OUTLOOK_TOKEN_ENCRYPTION_KEY=
```

Add to `src/env.ts` (assuming Phase 1 uses `@t3-oss/env-nextjs`):

```ts
// src/env.ts — augment server section
MS_TENANT_ID: z.string().uuid(),
MS_CLIENT_ID: z.string().uuid(),
MS_CLIENT_SECRET: z.string().min(20),
OUTLOOK_PUBLIC_URL: z.string().url(),
OUTLOOK_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/),
```

---

## Code Examples

### Building the MSAL client (with cache persistence)

```ts
// src/lib/integrations/outlook.ts
import { ConfidentialClientApplication, type ICachePlugin } from '@azure/msal-node'
import { env } from '@/env'

function makeCachePlugin(userId: string): ICachePlugin {
  // Persists MSAL's token cache to outlook_credentials.refresh_token_encrypted
  // so refresh-token rotation survives Inngest invocations.
  return {
    async beforeCacheAccess(ctx) {
      const blob = await loadMsalCacheBlob(userId)
      if (blob) ctx.tokenCache.deserialize(blob)
    },
    async afterCacheAccess(ctx) {
      if (ctx.cacheHasChanged) {
        await saveMsalCacheBlob(userId, ctx.tokenCache.serialize())
      }
    },
  }
}

export function getMsalClient(tenantId: string, userId?: string): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: env.MS_CLIENT_ID,
      clientSecret: env.MS_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    cache: userId ? { cachePlugin: makeCachePlugin(userId) } : undefined,
  })
}
```

### Building the Graph client

```ts
// src/lib/integrations/outlook.ts
import { Client } from '@microsoft/microsoft-graph-client'

export function makeGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
    fetchOptions: { fetch: globalThis.fetch },  // Node 22+/24+ native fetch — no isomorphic-fetch
  })
}
```

### Creating a subscription

```ts
// src/lib/integrations/outlook.ts
export async function createOutlookSubscription(
  credentialsId: string,
  accessToken: string,
): Promise<void> {
  const graph = makeGraphClient(accessToken)
  const clientState = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 4200 * 60 * 1000)  // 4200 min = below 4230 cap

  const sub = await graph.api('/subscriptions').post({
    changeType: 'created',
    notificationUrl: `${env.OUTLOOK_PUBLIC_URL}/api/outlook/webhook`,
    resource: "me/mailFolders('Inbox')/messages",
    expirationDateTime: expiresAt.toISOString(),
    clientState,
  })

  await updateCredentials(credentialsId, {
    subscription_id: sub.id,
    subscription_client_state: clientState,
    subscription_resource: sub.resource,
    subscription_expires_at: sub.expirationDateTime,
  })
}
```

### Disconnect

```ts
// src/lib/integrations/outlook.ts
export async function disconnectOutlook(userId: string): Promise<void> {
  const cred = await loadCredentialsByUserId(userId)
  if (!cred) return

  if (cred.subscription_id) {
    try {
      const accessToken = await getValidAccessToken(cred)
      const graph = makeGraphClient(accessToken)
      await graph.api(`/subscriptions/${cred.subscription_id}`).delete()
    } catch (err: any) {
      if (err.statusCode !== 404) {
        Sentry.captureException(err, { tags: { integration: 'outlook', stage: 'disconnect_subscription_delete' } })
      }
    }
  }

  // Zero out token columns, mark revoked. We keep the row so audit/reporting can see history.
  await updateCredentials(cred.id, {
    refresh_token_encrypted: null,
    access_token_encrypted: null,
    access_token_expires_at: null,
    subscription_id: null,
    subscription_client_state: null,
    subscription_resource: null,
    subscription_expires_at: null,
    subscription_delta_link: null,
    revoked_at: new Date().toISOString(),
  })
}
```

---

## Adjustments needed to existing Plan 4 patches (M-3 / M-6 / M-7)

The brief asks: does the Gmail→Outlook pivot suggest any existing Plan 4 patches need adjustment? Three observations:

1. **M-3 (the `gmail_credentials` table migration) is fully replaced.** Rename the table to `outlook_credentials`, swap the column set per §D.16. The trigger names, RLS policies, and FK shape carry over with `gmail` → `outlook` substitution. The `last_history_id` column becomes `subscription_delta_link` (text, opaque opaque-URL from `@odata.deltaLink`).

2. **M-6 (the Gmail Pub/Sub topic + JWT verification) is replaced by the synchronous validation handshake + clientState check.** Drop the `google-auth-library` dependency from M-6; it's not needed. The route handler is simpler — no JWT verification, just string comparison of clientState. Plan 4's task for "set up GCP Pub/Sub topic" goes away entirely. Add "register Entra app + grant admin consent" as the equivalent one-time ops setup.

3. **M-7 (the daily `users.watch` renewal cron — every 6 days for Gmail's 7-day cap) becomes a 6-hourly renewal cron for Outlook's 70-hour cap.** Tighter cadence, otherwise identical. Inngest concurrency keyed by `credentials_id` is fine for both.

4. **Bonus: `record_ai_usage(purpose='gmail_sync')` becomes `purpose='outlook_sync'`.** Trivial string change; no schema impact.

No other Plan 4 patches need adjustment.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMAIL-01 | Outlook OAuth → inbound emails to/from candidates/contacts log to activities | §D.15–§D.24 (this supplement) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cron cadence of 6 hours is a reasonable default for renewal | §D.17 (renewal) | Renewals stack up; minor cost. Easy to tune. |
| A2 | `outlook_credentials.user_id` does NOT need a `verify_same_org_check` trigger | §D.16 | If wrong, a cross-tenant FK leak via service-role writes. Mitigated by Phase 1's broad invariant that service-role writes must scope by PK. |
| A3 | Phase 1's `record_ai_usage` accepts a `metadata` jsonb param | §D.17 throttling | If wrong, throttle telemetry path is different. Schema check is a 2-min task. |
| A4 | Phase 1's `candidates.email` and `contacts.email` are stored mixed-case | §D.19 | If wrong, the lowercase-at-insert task is a no-op. Cheap to confirm. |
| A5 | Anchor's Entra admin will grant admin consent at app-registration time | §D.21 | If wrong, first connect blocks until admin consent flow runs. Recovery UI handles it. |
| A6 | ngrok reserved subdomain is acceptable for dev | §D.24 | If wrong, swap to Cloudflare Tunnel; equivalent functionality. |
| A7 | Native Node fetch is sufficient for the Graph client; `isomorphic-fetch` not needed | §D.15 libraries | If wrong, install `isomorphic-fetch@3.0.0` as well. Reversible. |
| A8 | Sentry PII scrubber Phase 1 config covers the `email` key; needs extension to additional Outlook field names | §D.22 | If wrong, PII could leak to Sentry. Read `instrumentation.ts` to confirm. |
| A9 | `record_audit` does not need changes for Outlook sync events (audit only on user-initiated actions) | §D.17 | If wrong, sync events should write audit rows. Phase 4 may revisit. |
| A10 | The dev script `outlook:cleanup-subscriptions` is desirable but optional | §D.24 | If wrong, dev hygiene suffers but no production impact. |

---

## Open Questions

1. **Should `last_sync_error` be a text column or a separate `outlook_sync_errors` table?**
   - What we know: text is simpler; only shows latest error.
   - What's unclear: do we want a history of errors for forensics?
   - Recommendation: text for v1, table for v2 if Phase 4 surfaces sync errors in a UI.

2. **Should we surface a "shared mailbox" connection mode?**
   - What we know: Microsoft 365 supports shared mailboxes (multiple users, one inbox).
   - What's unclear: anchor agency's workflow — do they have a shared `jobs@altus.co.uk` mailbox that all recruiters monitor?
   - Recommendation: Phase 2 ships per-user mailbox connection. If anchor needs shared, add in Phase 3.

3. **Should we support folder selection beyond Inbox?**
   - What we know: many recruiters have a `Candidates` folder or Outlook rules that route mail.
   - What's unclear: anchor's organisational practice.
   - Recommendation: Phase 2 ships Inbox-only; Phase 4 adds folder picker.

4. **Do we audit-log every Outlook sync event or only the connect/disconnect ceremony?**
   - What we know: Phase 1's D-16 limits audit to detail-view reads of candidates.
   - What's unclear: GDPR requires audit on candidate data access — is Outlook sync "access" to candidate data?
   - Recommendation: audit-log on **first match** for a given message (the act of attaching email metadata to a candidate is an access). Skip audit on the underlying Graph fetch (it's our data, not a candidate detail view). `[ASSUMED]`

---

## Sources

### Primary (HIGH confidence)

- **MSAL Node 5.x docs** — `learn.microsoft.com/entra/msal/node`. Token cache plugin, refresh-token rotation, error codes.
- **Microsoft Graph webhooks docs** — `learn.microsoft.com/graph/webhooks` and `learn.microsoft.com/graph/change-notifications-overview`. Validation handshake, clientState pattern, notification payload shape, retry behaviour.
- **Microsoft Graph subscription resource** — `learn.microsoft.com/graph/api/resources/subscription`. ChangeType options, expirationDateTime caps by resource type.
- **Microsoft Graph delta query** — `learn.microsoft.com/graph/delta-query-overview` and `learn.microsoft.com/graph/delta-query-messages`. Incremental sync pattern, deltaLink lifecycle.
- **Entra app registration quickstart** — `learn.microsoft.com/entra/identity-platform/quickstart-register-app`. Single-tenant vs multi-tenant, redirect URIs, client secrets.
- **Microsoft Graph permissions reference (Mail)** — `learn.microsoft.com/graph/permissions-reference#mail-permissions`. Delegated vs application permissions, scope descriptions.
- **Microsoft Graph throttling** — `learn.microsoft.com/graph/throttling` and `learn.microsoft.com/graph/throttling-limits`. Per-user/per-app limits, Retry-After header.
- **Conditional Access policies** — `learn.microsoft.com/entra/identity/conditional-access/concept-conditional-access-cloud-apps`. MFA/device compliance enforcement on apps.
- **npm registry** — `npm view @azure/msal-node`, `npm view @microsoft/microsoft-graph-client`, `npm view isomorphic-fetch` on 2026-05-19.

### Secondary (MEDIUM confidence)

- **MSAL Node GitHub** — `github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node`. Source of truth for current API shape; supplements docs when docs lag releases.
- **Microsoft Graph JS SDK GitHub** — `github.com/microsoftgraph/msgraph-sdk-javascript`. Client init patterns, fetch configuration.
- **Microsoft 365 Developer Blog** — sliding 90-day refresh-token window confirmed multiple times in posts on `devblogs.microsoft.com/microsoft365dev`.

### Tertiary (LOW confidence)

- WebSearch results for "Microsoft Graph mail subscription 4230 minute cap" cross-verified against the official docs lifecycle table. The 4230 number is consistently quoted.
- Throttling thresholds (10k requests / 10 min / user; 7k subscriptions / app) are widely quoted but Microsoft does not commit to exact numbers — treat as guidance.

---

## Metadata

**Confidence breakdown:**
- Standard stack (MSAL Node 5.x, Graph Client 3.x): HIGH — registry-verified 2026-05-19, both packages are Microsoft-published, weekly downloads in millions/hundreds-of-thousands
- Subscription + delta-query architecture: HIGH — multiple authoritative Microsoft docs confirm the pattern
- Tenant model recommendation (single-tenant for Phase 2): HIGH — aligns with anchor-customer-only Phase 2 scope per CONTEXT.md
- Throttling thresholds: MEDIUM — Microsoft publishes ranges, not commitments
- Local dev path (ngrok reserved subdomain): MEDIUM — opinionated dev-ergonomics call

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (30 days; MSAL and Graph SDK have stable APIs; Microsoft revises throttling thresholds rarely but unpredictably)

---

*Phase 2 — Plan 4 (Outlook integration) — RESEARCH supplement complete.*
