# Plan 4: Outlook (Microsoft 365) Integration

**Phase:** 2 — Search, Match & Intake
**Plan:** 4 of 4 (outlook)
**Depends on:** Plan 0 (encryption helper, `outlook_credentials` table, env vars, public-paths allowlist, Plan 1's `/settings/integrations` page skeleton — Plan 4 extends it with the "Connect Outlook" card).
**Requirements covered:** EMAIL-01
**Success criterion satisfied:** ROADMAP #4 — "Recruiter can connect Outlook via OAuth and see inbound emails to/from candidates and contacts logged to activity timelines automatically — no manual copy-paste"
**Mode:** mvp — vertical slice (Entra app registration → "Connect Outlook" UI → OAuth handshake → encrypted token storage → Microsoft Graph subscription → webhook → delta-sync Inngest function → activity-row writes → subscription renewal cron → disconnect flow)

## Goal

After this plan, a recruiter signs into the app, navigates to `/settings/integrations`, clicks "Connect Outlook", consents to Microsoft's OAuth dialog with `Mail.Read + offline_access + User.Read` scopes against the anchor's single-tenant Entra app, lands back in the app with a "Connected" card. Microsoft Graph then pushes change-notifications to `/api/outlook/webhook` whenever a message arrives in their Inbox; the webhook validates `clientState`, fires `outlook/history-changed`, and an Inngest function fetches the delta via `GET /me/mailFolders('Inbox')/messages/delta`. Each delta message is matched by from/to email against `candidates.email` + `contacts.email`; matches produce a `kind='email'` activity row (subject + 200-char `bodyPreview` snippet only — D2-18). A 6-hourly schedule renews the Graph subscription (cap ~3 days); 404-on-renew triggers automatic recreation with a fresh delta. Disconnect revokes the subscription, nulls the encrypted tokens, sets `revoked_at`.

## Required reading for executor

- `.planning/phases/02-search-match-intake/02-CONTEXT.md` — decisions **D2-15 (separate OAuth, single-tenant Entra), D2-16 (aes-256-gcm + EMAIL_TOKEN_ENCRYPTION_KEY), D2-17 (Graph subscriptions + delta-query + 6h renewal), D2-18 (subject + 200-char snippet only), D2-19 (exact-email match, orphans skipped)**
- `.planning/phases/02-search-match-intake/02-RESEARCH-OUTLOOK.md` — Microsoft Graph specifics. **The whole file.** Especially D.15 (libraries `@azure/msal-node` + `@microsoft/microsoft-graph-client`), D.17 (webhook validation handshake + `clientState`), D.21 (Entra single-tenant + scopes), D.23 (admin-consent + CA + sliding RT), D.24 (webhook security checklist).
- `.planning/phases/02-search-match-intake/02-PATTERNS.md` — Phase 2 conventions
- `.planning/phases/01-internal-ats/01-LEARNINGS.md` — invariants: single-wrapper rule, PII-scrubbed Sentry, FK-guard naming
- `CLAUDE.md` — non-negotiables
- Plan 0's `outlook_credentials` schema in `02-00-hardening-PLAN.md` Task 0.3 step 4
- Plan 0's middleware allowlist (`/api/outlook/callback`, `/api/outlook/webhook`) in Task 0.4 step 7
- Plan 1's `/settings/integrations` page skeleton (created during Task 1.3)

## Tasks

### Task 4.1: `src/lib/integrations/outlook.ts` — MSAL + Graph client wrapper + token helpers

**Files:**
- create `src/lib/integrations/outlook.ts` — single wrapper for all Microsoft OAuth + Graph calls
- modify `src/lib/env.ts` (no new envs — Plan 0 already declared them; this task validates they exist before Plan 4 runtime)

**Pattern to copy:** RESEARCH-OUTLOOK §D.15 + §D.16 for the `@azure/msal-node` wiring + `getValidAccessToken` flow. RESEARCH-OUTLOOK §D.17 for subscription create/renew/delete. `src/lib/ai/claude.ts` for the single-instance + service-only pattern. `src/lib/encryption.ts` (Plan 0) for the encrypt/decrypt boundary.

**Implementation:**

1. **`'server-only'` first line.** Module-scoped `ConfidentialClientApplication` instance lazily initialised — fail fast at construction if any required env (`OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REDIRECT_URI`) is missing. Use `cca.acquireTokenByCode` for the OAuth callback and `cca.acquireTokenByRefreshToken` for refresh.

2. **MSAL cache plugin** — Microsoft rotates refresh tokens on every refresh. Our wrapper takes the `refreshTokenEncrypted` from the DB row, decrypts to plaintext, calls `acquireTokenByRefreshToken`, and writes BOTH the new access token AND the new refresh token back to the DB via `updateOutlookAccessToken` (Plan 0 helper). The MSAL SDK returns a new refresh token in `response.refreshToken` whenever rotation happens — handle this explicitly.

3. **Exported functions:**
   - `getAuthorizationUrl(state: string): string` — builds the `/oauth2/v2.0/authorize` URL with `client_id`, `response_type=code`, `redirect_uri`, `response_mode=query`, `scope=Mail.Read offline_access User.Read`, `state`, `prompt=consent`.
   - `exchangeCodeForTokens(code: string): Promise<{ accessToken, refreshToken, expiresOn, account }>` — wraps `cca.acquireTokenByCode`. Throws on failure.
   - `getValidAccessToken(supabase, userId): Promise<string>` — pulls `outlook_credentials`, decrypts, checks expiry, refreshes if needed, persists rotated RT, returns plaintext access. Catches `invalid_grant`/`interaction_required` → revoke + throw `OutlookReconnectRequiredError`.
   - `createMailSubscription(accessToken, { notificationUrl, clientState }): Promise<{ subscriptionId, expirationDateTime }>` — POSTs `/v1.0/subscriptions` with `resource: "me/mailFolders('Inbox')/messages"`, `changeType: 'created'`, `expirationDateTime` = 4200 min from now (30 min margin under the 4230 cap).
   - `renewMailSubscription(accessToken, subscriptionId)` — PATCH with new `expirationDateTime`. Catches 404 → throws `SubscriptionExpiredError` so the cron caller recreates.
   - `deleteMailSubscription(accessToken, subscriptionId)` — DELETE; ignores 404.
   - `fetchDelta(accessToken, { deltaLink }): Promise<{ messages, nextDeltaLink }>` — initial sync via `/me/mailFolders('Inbox')/messages/delta?$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,internetMessageId,conversationId,parentFolderId`; subsequent calls use the saved deltaLink. Paginates via `@odata.nextLink`; returns final `@odata.deltaLink`. PII discipline: do NOT log message bodies.
   - `getUserProfile(accessToken): Promise<{ id, mail, userPrincipalName, tenantId }>` — GETs `/v1.0/me`; used during OAuth callback.

4. **`clientState` derivation** — `deriveClientState(purpose: string): string` = `crypto.createHmac('sha256', env.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET).update(purpose + ':' + crypto.randomBytes(16).toString('hex')).digest('hex')`. Stored per-row in `outlook_credentials.subscription_client_state`.

5. **PII-scrubbed Sentry catches** — every public function wraps its core in try/catch that re-throws AFTER `Sentry.captureException(new Error(\`outlook.${functionName}: ${error.name}: ${error.statusCode ?? 'unknown'}\`), { tags: { layer: 'integration', integration: 'outlook', fn: functionName } })`. NEVER pass the raw `error` (Microsoft errors can include request-body snippets).

6. **Single-instance invariant** — module-level lazy singletons for both `ConfidentialClientApplication` and the Graph `Client`. Grep test in plan-level verification: `grep -rn "new ConfidentialClientApplication\|new Client(" src/ --include='*.ts*'` returns exactly two lines (one each, both in `outlook.ts`).

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Unit test (mocked): given a known refresh token, `getValidAccessToken` returns a string; given an expired one, MSAL is called; given `invalid_grant`, throws `OutlookReconnectRequiredError`.
- Grep: only `src/lib/integrations/outlook.ts` imports `@azure/msal-node` and `@microsoft/microsoft-graph-client`.

### Task 4.2: OAuth callback route + "Connect Outlook" UI on `/settings/integrations`

**Files:**
- create `src/app/api/outlook/callback/route.ts` (GET handler — Microsoft redirects here after consent)
- create `src/app/(app)/settings/integrations/connect-outlook-card.tsx` (Client Component)
- modify `src/app/(app)/settings/integrations/page.tsx` (Plan 1's skeleton — add the Outlook card)
- create `src/app/(app)/settings/integrations/actions.ts` (`startOutlookOAuthAction`, `disconnectOutlookAction`)
- create `docs/outlook-integration-setup.md` (Entra app registration runbook)

**Pattern to copy:** Phase 1's `src/app/auth/callback/route.ts` for the route handler. Phase 1's `src/app/(app)/settings/profile-form.tsx` for Client-Component-calls-server-action. RESEARCH-OUTLOOK §D.21 + §D.23.

**Implementation:**

1. **`docs/outlook-integration-setup.md` — Entra runbook (commit FIRST so the executor has the path).** Steps:
   - Sign in to https://entra.microsoft.com → App registrations → New registration
   - Name: "Altus Recruitment (Anchor)"
   - Supported account types: **"Accounts in this organizational directory only (single tenant)"**
   - Redirect URI: Web → `https://altus-recruitment.vercel.app/api/outlook/callback` (and `http://localhost:3000/api/outlook/callback` for dev)
   - After creation: copy Application (client) ID → `OUTLOOK_CLIENT_ID`; Directory (tenant) ID → `OUTLOOK_TENANT_ID`
   - Certificates & secrets → New client secret → 24 months → copy value → `OUTLOOK_CLIENT_SECRET`
   - API permissions → Add → Microsoft Graph → Delegated → `Mail.Read`, `offline_access`, `User.Read` → Add → **Grant admin consent** (anchor's IT admin clicks once)
   - Generate `OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET`: `openssl rand -hex 32`
   - Reuse `EMAIL_TOKEN_ENCRYPTION_KEY` from Plan 0 dev or generate fresh
   - Set `OUTLOOK_REDIRECT_URI` (prod) + `OUTLOOK_WEBHOOK_NOTIFICATION_URL` in Vercel
   - Webhooks need publicly-reachable HTTPS. Vercel preview deploys work; local dev needs `ngrok http 3000`.

2. **`startOutlookOAuthAction()` server action:**
   - Generate `state = crypto.randomBytes(32).toString('hex')`. Store as HttpOnly cookie `__Host-outlook-oauth-state`, `path=/`, `secure`, `sameSite=lax`, 10-min expiry.
   - Call `getAuthorizationUrl(state)`; return `{ ok: true, url }`. Client navigates `window.location.href = url`.

3. **`/api/outlook/callback/route.ts`** — `GET(request)`:
   - Read `code` + `state` + `error` query params.
   - If `error` is set: redirect to `/settings/integrations?outlook_error=<error>`. For `error=invalid_grant&error_description=AADSTS65001` (admin-consent needed), page surfaces the admin-consent URL.
   - Validate `state` against cookie; mismatch → 400.
   - `getUser()` via user-scoped client; if not signed in, redirect `/sign-in?next=/settings/integrations`.
   - `exchangeCodeForTokens(code)` → tokens + account.
   - `getUserProfile(accessToken)` → microsoft_email. Confirm `account.tenantId === env.OUTLOOK_TENANT_ID` (single-tenant guard).
   - Encrypt both tokens via `src/lib/encryption.ts`.
   - `upsertOutlookCredentials(serviceClient, { userId, microsoftTenantId, microsoftUserId, microsoftEmail, refreshTokenEncrypted, accessTokenEncrypted, accessTokenExpiresAt, scopes })`.
   - Fire Inngest event `outlook/subscription-create-requested` `{ userId, organizationId }` (non-blocking).
   - Redirect to `/settings/integrations?outlook=connected`.
   - Catch every step; on failure, PII-safe Sentry-capture, redirect with `?outlook_error=unexpected`.

4. **`disconnectOutlookAction()`:**
   - Read existing `outlook_credentials`. If `subscription_id` present: `getValidAccessToken` + `deleteMailSubscription` (ignore 404).
   - `revokeOutlookCredentials(serviceClient, userId)` — sets `revoked_at = now()`, nulls all encrypted columns + subscription state.
   - `revalidatePath('/settings/integrations')`. Return `{ ok: true }`.

5. **`<ConnectOutlookCard>` Client Component** — props `{ status: 'connected' | 'disconnected' | 'revoked'; microsoftEmail?; connectedAt? }`. Three states:
   - **Disconnected**: `<Card>` "Outlook" / "Connect your Outlook inbox so emails to and from candidates appear on their timelines automatically." Button "Connect Outlook" → `startOutlookOAuthAction` → navigate. Footer: "Read-only access (Mail.Read). We never send email on your behalf."
   - **Connected**: heading shows `microsoftEmail`, badge "Active", "Disconnect" button → `<AlertDialog>` → `disconnectOutlookAction`.
   - **Revoked**: heading "Outlook (Disconnected)", "Reconnect" button.
   - URL-param handling: `?outlook=connected` → success toast. `?outlook_error=...` → error toast; for AADSTS65001 inline admin-consent block with copy-to-clipboard `https://login.microsoftonline.com/${env.OUTLOOK_TENANT_ID}/adminconsent?client_id=${env.OUTLOOK_CLIENT_ID}`.

6. **Page wiring** — `/settings/integrations/page.tsx` async RSC: `getOutlookCredentials(supabase, user.id)`; pass status + microsoftEmail to `<ConnectOutlookCard>`.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm build` pass
- Manual flow (requires Entra app + envs + ngrok or Vercel preview): sign in → `/settings/integrations` → "Connect Outlook" → Microsoft consent → approve → land back with toast "Outlook connected".
- DB row: `select user_id, microsoft_email, scopes, access_token_encrypted is not null, refresh_token_encrypted is not null, revoked_at from outlook_credentials` shows one row with encrypted columns NOT NULL and `revoked_at` NULL.
- Disconnect: `revoked_at` is now(); tokens NULL; subscription deleted from Graph.
- Negative: tamper with `state` cookie → 400.

### Task 4.3: Microsoft Graph webhook + `sync-outlook-history` Inngest function + `create-outlook-subscription` Inngest function

**Files:**
- create `src/app/api/outlook/webhook/route.ts` (GET for validationToken handshake + POST for change notifications)
- create `src/lib/inngest/functions/sync-outlook-history.ts`
- create `src/lib/inngest/functions/create-outlook-subscription.ts` (triggered post-OAuth)
- modify `src/app/api/inngest/route.ts` (register both)
- modify `src/lib/db/activities.ts` (`createEmailActivity` helper — service-role)
- modify `src/lib/db/candidates.ts` + `src/lib/db/contacts.ts` (`findCandidateByEmail` / `findContactByEmail` — service-role lookups with explicit `organization_id`)
- create `supabase/migrations/<ts>_contacts_email_idx.sql` (`create index if not exists contacts_email_idx on public.contacts (organization_id, lower(email))`)
- create `tests/unit/outlook-webhook.test.ts`

**Pattern to copy:** Phase 1's `src/lib/inngest/functions/parse-cv.ts` for the function shape. RESEARCH-OUTLOOK §D.17 + §D.24. RESEARCH-OUTLOOK §D.19 for email matching.

**Implementation:**

1. **`/api/outlook/webhook/route.ts`:**

   **GET — validationToken handshake (Graph subscription creation):**
   ```ts
   export async function GET(request: NextRequest) {
     const validationToken = request.nextUrl.searchParams.get('validationToken')
     if (!validationToken) return new Response(null, { status: 400 })
     return new Response(validationToken, {
       status: 200,
       headers: { 'Content-Type': 'text/plain' },
     })
   }
   ```

   **POST — change notifications:**
   ```ts
   export async function POST(request: NextRequest) {
     // FAIL-CLOSED ON MISSING ENV (VERIFICATION M-3 adapted to MS Graph):
     if (!env.OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET) {
       Sentry.captureMessage('outlook/webhook received without configured clientState secret', {
         level: 'error',
         tags: { layer: 'route-handler', route: '/api/outlook/webhook' },
       })
       return new Response(null, { status: 503 })
     }

     // Graph occasionally re-sends validationToken on POST during subscription renewal
     const validationToken = request.nextUrl.searchParams.get('validationToken')
     if (validationToken) {
       return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } })
     }

     const body = await request.json()
     if (!Array.isArray(body.value)) return new Response(null, { status: 400 })

     const serviceClient = createServiceClient()
     const subscriptionIds = [...new Set(body.value.map((n: { subscriptionId: string }) => n.subscriptionId))]

     for (const subscriptionId of subscriptionIds) {
       const credResult = await getOutlookCredentialsBySubscriptionId(serviceClient, subscriptionId)
       if (!credResult.ok || !credResult.data) continue // silently drop orphans

       const cred = credResult.data
       const notifications = body.value.filter(
         (n: { subscriptionId: string }) => n.subscriptionId === subscriptionId,
       )
       const allValid = notifications.every(
         (n: { clientState: string }) => n.clientState === cred.subscription_client_state,
       )
       if (!allValid) {
         Sentry.captureMessage('outlook/webhook clientState mismatch', {
           level: 'error',
           tags: { subscription_id: subscriptionId },
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
         Sentry.captureException(
           new Error(
             `outlook/webhook: inngest.send failed: ${(err as Error).name ?? 'unknown'}`,
           ),
           { tags: { layer: 'route-handler', route: '/api/outlook/webhook' } },
         )
       }
     }

     return new Response(null, { status: 202 })
   }
   ```

2. **`sync-outlook-history.ts`:**
   - `id: 'sync-outlook-history'`, `triggers: [{ event: 'outlook/history-changed' }]`, `concurrency: { limit: 1, key: 'event.data.user_id' }` (delta cursors are not parallel-safe per user), `retries: 3`.
   - Steps:
     1. `load-cred` — `getOutlookCredentials(serviceClient, event.data.user_id)`. If `!ok || !cred || cred.revoked_at`, return `{ skipped: 'revoked' }`.
     2. `get-access-token` — `await getValidAccessToken(serviceClient, event.data.user_id)`. Catches `OutlookReconnectRequiredError` → `revokeOutlookCredentials` + return `{ skipped: 'reconnect_required' }`.
     3. `fetch-delta` — `await fetchDelta(accessToken, { deltaLink: cred.delta_link })`. Cap at 200 messages per run; if `messages.length === 200` the next webhook picks up the cursor.
     4. `process-messages` — for each:
        - Dedupe: `select 1 from activities where metadata->>'internet_message_id' = $1 and organization_id = $2 limit 1`. Skip if present.
        - Normalise emails to lowercase. `fromEmail = message.from?.emailAddress?.address?.toLowerCase()`; `toEmails = (message.toRecipients ?? []).map(r => r.emailAddress.address?.toLowerCase()).filter(Boolean)`.
        - Direction: if `fromEmail === cred.microsoft_email.toLowerCase()` → `outbound`, participant in `toEmails`; else `inbound`, participant is `fromEmail`.
        - For each participant: `findCandidateByEmail(serviceClient, participantEmail, cred.organization_id)` + `findContactByEmail(...)`. Skip if both null (orphan — D2-19).
        - `createEmailActivity(serviceClient, { organizationId, entityType, entityId, subject: message.subject ?? '', snippet: (message.bodyPreview ?? '').slice(0, 200), graphMessageId: message.id, conversationId: message.conversationId, internetMessageId: message.internetMessageId, fromEmail, toEmails, direction, occurredAt: message.receivedDateTime, actorUserId: cred.user_id })`.
     5. `update-cursor` — `updateOutlookDeltaLink(serviceClient, { userId, deltaLink: nextDeltaLink, lastSyncedAt: now })`.
   - PII-scrubbed Sentry on any step failure.

3. **`create-outlook-subscription.ts`:**
   - `id: 'create-outlook-subscription'`, `triggers: [{ event: 'outlook/subscription-create-requested' }]`, `concurrency: { limit: 1, key: 'event.data.userId' }`.
   - Steps: load cred → get access token → `clientState = deriveClientState('mail-inbox')` → `createMailSubscription(accessToken, { notificationUrl: env.OUTLOOK_WEBHOOK_NOTIFICATION_URL, clientState })` → `updateOutlookSubscriptionState(...)` → send `outlook/history-changed` so the first delta query runs and the initial deltaLink is persisted.

4. **`createEmailActivity` helper** in `src/lib/db/activities.ts`:
   - Inserts into `activities` with `kind='email'`, `body=subject` (D2-18), `metadata={ snippet, graph_message_id, conversation_id, internet_message_id, from: fromEmail, to: toEmails, direction }`, plus `actor_user_id`, `entity_type`, `entity_id`, `occurred_at`, `organization_id`. Service-role caller.

5. **`findCandidateByEmail` / `findContactByEmail`** — extend with service-role-friendly lookup signature: `(supabase, email, organizationId)` → `DbResult<{ id } | null>`.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Unit test `tests/unit/outlook-webhook.test.ts`: (a) GET with `validationToken=xyz` returns 200 + `Content-Type: text/plain` + body `xyz`; (b) POST with missing `OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET` returns 503; (c) POST with mismatched `clientState` does NOT fire Inngest event + emits Sentry breadcrumb; (d) POST with valid notifications fires exactly one event per unique subscriptionId; (e) orphan subscriptionId (no credential row) is silently dropped.
- Integration test (manual, requires connected Outlook + ngrok): send a test email from a personal account where the address matches a seeded candidate. Within 60s: activity row appears with `kind='email'`, `body=subject`, `metadata.snippet ≤ 200`, `direction='inbound'`.
- Dedupe: re-fire `outlook/history-changed` → no duplicate activity row.
- Orphan: email to/from an unknown address → no activity row inserted, no Sentry noise.

### Task 4.4: 6-hourly subscription renewal + 404-recreate fallback + Sentry alerting

**Files:**
- create `src/lib/inngest/functions/refresh-outlook-subscription.ts`
- create `supabase/migrations/<ts>_outlook_credentials_renewal_tracking.sql` (additive: `last_renewal_error text, last_renewal_attempt_at timestamptz`)
- modify `src/lib/db/outlook-credentials.ts` (`listExpiringSubscriptions(supabase, withinHours)` + `recordRenewalAttempt(supabase, { userId, success, error? })`)
- modify `src/app/api/inngest/route.ts` (register `refresh-outlook-subscription`)

**Pattern to copy:** RESEARCH-OUTLOOK §D.17 (renewal model) + Phase 1 Inngest function shape.

**Implementation:**

1. **`refresh-outlook-subscription.ts`:**
   - `id: 'refresh-outlook-subscription'`, `triggers: [{ cron: '0 */6 * * *' }]` (every 6 hours), `concurrency: { limit: 1 }` (singleton sweep).
   - Body: `const expiring = await listExpiringSubscriptions(serviceClient, 12)` — anything expiring within 12h (cap is 70.5h; 12h gives 2 cycles of safety).
   - For each credential:
     - `step.run(\`renew-\${cred.user_id}\`, async () => {`
     - `const token = await getValidAccessToken(...)` (catches reconnect-required + revokes)
     - `try { const { expirationDateTime } = await renewMailSubscription(token, cred.subscription_id); await updateOutlookSubscriptionState(...); await recordRenewalAttempt(serviceClient, { userId, success: true }); }`
     - `catch (err) { if (err instanceof SubscriptionExpiredError) {  // 404 → recreate`
     - `    const clientState = deriveClientState('mail-inbox');`
     - `    const { subscriptionId, expirationDateTime } = await createMailSubscription(token, { notificationUrl: env.OUTLOOK_WEBHOOK_NOTIFICATION_URL, clientState });`
     - `    await updateOutlookSubscriptionState(serviceClient, { userId: cred.user_id, subscriptionId, subscriptionClientState: clientState, subscriptionExpiresAt: expirationDateTime });`
     - `    // Delta link is invalid after subscription recreation — force full resync`
     - `    await updateOutlookDeltaLink(serviceClient, { userId: cred.user_id, deltaLink: null, lastSyncedAt: new Date().toISOString() });`
     - `    await inngest.send({ name: 'outlook/history-changed', data: { user_id: cred.user_id, organization_id: cred.organization_id, microsoft_email: cred.microsoft_email } });`
     - `    await recordRenewalAttempt(serviceClient, { userId, success: true, error: 'recreated-after-expiry' });`
     - `  } else { await recordRenewalAttempt(serviceClient, { userId, success: false, error: \`\${err.name}: \${err.statusCode ?? 'unknown'}\` }); throw err; } })`
   - Per-user errors get PII-safe Sentry capture (not function-level failure — one user's revoked token shouldn't block others' renewals).

2. **`<ts>_outlook_credentials_renewal_tracking.sql`:**
   ```sql
   alter table public.outlook_credentials
     add column if not exists last_renewal_error text,
     add column if not exists last_renewal_attempt_at timestamptz;
   ```

3. **Sentry alert on persistent failure.** Inside `recordRenewalAttempt`, after the UPDATE: if `success=false` AND the previous attempt also failed, `Sentry.captureMessage(\`outlook subscription renewal failed twice for user \${userId}\`, { level: 'error', tags: { layer: 'inngest', function: 'refresh-outlook-subscription', user_id: userId } })`.

4. **Schedule-died secondary signal (VERIFICATION M-7 adapted)** — runbook section in `docs/outlook-integration-setup.md`: "Configure a Sentry Crons monitor for `refresh-outlook-subscription` (cron expression `0 */6 * * *`, 30-min tolerance). Without this, an Inngest schedule that silently stops firing is invisible until the first subscription expires." Manual-weekly-check fallback documented if Sentry Crons unavailable.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Manual cron trigger via Inngest dev UI with a connected mailbox: `subscription_expires_at` advances ~70h; no errors.
- Simulate near-expiry: `update outlook_credentials set subscription_expires_at = now() + interval '1 hour' where user_id = '<uid>'` → trigger → renewal succeeds.
- Simulate 404-on-renew: `update outlook_credentials set subscription_id = '00000000-0000-0000-0000-000000000000'` → trigger → expect (a) `SubscriptionExpiredError` Sentry breadcrumb, (b) new subscription created, (c) `delta_link` nulled, (d) follow-up `outlook/history-changed` fires full resync.
- Disconnect Outlook + run cron → that user skipped (`revoked_at` excludes them via `listExpiringSubscriptions`).
- Sentry Crons monitor (or manual-check fallback) documented in runbook.

## Plan-level verification

- [ ] `pnpm lint && pnpm typecheck && pnpm test --run && pnpm test:e2e && pnpm build` all pass
- [ ] Demo with REAL Entra app + ngrok-tunnelled local (or Vercel preview): connect Outlook; send a test email from a personal account to the connected mailbox where the address matches a seeded candidate's `email`; within ~60s the email appears as a new activity row on that candidate's timeline (ROADMAP success #4)
- [ ] `select kind, body, metadata->>'snippet', metadata->>'direction' from activities where kind='email' order by created_at desc limit 1` returns a row where `body = subject`, `snippet` length ≤ 200, `direction in ('inbound', 'outbound')`
- [ ] Orphan email: no activity row inserted
- [ ] Dedupe: same `internet_message_id` hit twice → exactly one activity row
- [ ] OAuth state CSRF: forged callback URL with bad `state` cookie → 400 + no DB mutation
- [ ] Webhook clientState mismatch: forged POST with bad clientState → no Inngest event, Sentry breadcrumb captured, no DB mutation
- [ ] Webhook missing-env fail-closed: with `OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET` unset, POST returns 503 (VERIFICATION M-3 adapted)
- [ ] Webhook validationToken handshake: GET with `?validationToken=xyz` returns 200 + `Content-Type: text/plain` + body `xyz`
- [ ] Encryption boundary: `grep -rn "decrypt(" src/ --include='*.ts*'` returns ONLY `src/lib/integrations/outlook.ts` and `src/lib/encryption.ts`
- [ ] Single-instance invariants: `grep -rn "new ConfidentialClientApplication\|new Client(" src/ --include='*.ts*'` = 2 lines in `outlook.ts`; `grep -rn "@azure/msal-node\|@microsoft/microsoft-graph-client" src/ --include='*.ts*'` confines imports to `outlook.ts`; Phase 1 + Plan 0 invariants (`new Anthropic`, `new VoyageAIClient`) still 1 line each
- [ ] Sentry payloads sampled after deliberate errors do NOT contain `subject`, `bodyPreview`, `snippet`, `graph_message_id`, `from`, `to`, `cc`, `body`, `refresh_token`, `access_token` keys
- [ ] `select * from outlook_credentials where revoked_at is not null limit 1` after a disconnect — `refresh_token_encrypted`, `access_token_encrypted`, `subscription_id` all NULL; `revoked_at` is now()
- [ ] 6-hourly renewal cron registered in Inngest dev UI; manual trigger advances `subscription_expires_at`
- [ ] Sentry Crons monitor configured (or manual-check fallback documented)
- [ ] `docs/outlook-integration-setup.md` covers: Entra app registration, scopes, admin consent, dev (ngrok) vs prod (Vercel) URLs, env-var checklist, Sentry Crons configuration, key rotation procedure deferral
- [ ] Refresh-token rotation: connect; force a refresh (set `access_token_expires_at = now() - interval '1 hour'`); call `getValidAccessToken`; verify `refresh_token_encrypted` column changed (the new RT was persisted)
- [ ] `outlook_credentials.encryption_key_version` is `1` for all rows; column exists for future rotation
- [ ] `select count(*) from ai_usage where purpose = 'outlook_sync'` is 0 (purpose reserved; Phase 2 doesn't write it — intentional)

## Cross-cutting open issues for the plan-checker

- **Single-tenant Entra app registration.** IT admin grants admin consent once for `Mail.Read`. Document both Workspace and individual-consent paths in the runbook.
- **Conditional Access policies.** If `getValidAccessToken` returns `interaction_required`, treat as revoked + surface reconnect. Acceptable for Phase 2.
- **Sliding refresh token rotation.** MUST persist the new RT on each refresh, or the cached one expires after 90 days of disuse. `updateOutlookAccessToken` updates BOTH access and refresh together. Documented invariant inline.
- **`EMAIL_TOKEN_ENCRYPTION_KEY` rotation deferred to Phase 5.** `outlook_credentials.encryption_key_version` column gives space; runbook documents manual rotation.
- **Multi-mailbox-per-user deferred.** `unique (user_id)` means one mailbox per recruiter. Phase 5 may lift.

## Out of scope for this plan (deferred or other plans)

- Outbound email sending (Phase 4 — Resend). `Mail.Read` does not allow send.
- Full-body email storage (Phase 4 if voice/marketing needs it).
- Auto-creation of candidates from orphan email senders — Phase 3.
- Gmail provider adapter — Phase 5 SaaS shell. Anchor is Outlook-only for Phase 2.
- Outlook on-prem Exchange / EWS support — out of scope.
- Multi-Outlook-account-per-user — Phase 5.
- Conversation/thread view aggregating multiple email activity rows by `conversation_id` — Phase 3 UI polish.
- Entra multi-tenant flip — Phase 5 (publisher verification for "External" apps).
- AI-summarisation of recent email threads — Phase 4 (requires full-body storage).
- `EMAIL_TOKEN_ENCRYPTION_KEY` rotation productionised — Phase 5; manual procedure documented in `docs/outlook-integration-setup.md`.
- Calendar / contacts sync — Phase 5+ (different Graph scopes + subscriptions).
