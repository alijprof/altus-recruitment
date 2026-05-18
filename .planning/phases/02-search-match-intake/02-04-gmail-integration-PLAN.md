# Plan 4: Gmail Integration

**Phase:** 2 — Search, Match & Intake
**Plan:** 4 of 4 (gmail-integration)
**Depends on:** Plan 0 (`src/lib/encryption.ts`, `gmail_credentials` table + RLS + triggers, Gmail env vars declared, `(public)` middleware allowlist for `/api/gmail/callback` and `/api/gmail/push`, `googleapis` + `google-auth-library` installed, `src/lib/db/gmail-credentials.ts` helpers). Independent of Plans 1 / 2 / 3 — Gmail sync writes to `activities`, which already exists from Phase 1.
**Requirements covered:** EMAIL-01
**Success criterion satisfied:** ROADMAP #4 — "Recruiter can connect Gmail via OAuth and see inbound emails to/from candidates and contacts logged to activity timelines automatically — no manual copy-paste"
**Mode:** mvp — vertical slice (Connect Gmail button on `/settings/integrations` → OAuth handshake → token storage → Pub/Sub `watch` registered → first inbound message from a known candidate appears in their activity timeline within ~60 s, with daily watch renewal scheduled)

## Goal

After this plan, an authenticated recruiter on `/settings/integrations` sees a "Connect Gmail" card. Clicking it kicks off Google's OAuth consent flow with scope `gmail.readonly` (plus `openid email profile` for identity verification). On success the user lands back on `/settings/integrations` with a green "Connected as <email>" status, a "Disconnect" button, and a "Delete imported Gmail data" button. Inbound Gmail messages with from/to addresses matching candidates or contacts in the same org are silently logged to the appropriate entity's activity timeline as `kind='email'` rows containing subject + 200-char snippet + Gmail thread ID metadata (D2-18). Pub/Sub push notifications trigger near-real-time sync; a daily Inngest schedule re-registers the 7-day `watch` so sync never silently stops. Disconnecting revokes the watch, NULLs the encrypted tokens, and sets `revoked_at`.

## Phase Goal (MVP user story)

**As a** recruiter who corresponds with candidates and clients via Gmail, **I want to** connect my mailbox once and have every relevant inbound email appear on the right candidate or contact timeline automatically — **so that** I never have to copy-paste an email into the CRM again and a colleague picking up the desk sees the full conversation history.

## Required reading for executor

- `.planning/phases/02-search-match-intake/02-CONTEXT.md` — decisions **D2-15 (separate Connect Gmail flow), D2-16 (encryption + key in env), D2-17 (History API + Pub/Sub push), D2-18 (subject + 200-char snippet only), D2-19 (inbound-to-candidate matching), D2-22 (`purpose='gmail_sync'` reserved if useful)**
- `.planning/phases/02-search-match-intake/02-RESEARCH.md` — **§D.18 (OAuth flow + library choice), §D.19 (scopes — `gmail.readonly`), §D.20 (token storage; encryption — wrappers already exist), §D.21 (email matching: exact match only), §D.22 (sync strategy: History API + push; daily watch renewal; JWT verification on push), §D.23 (activity row shape — exact metadata keys), §D.24 (PII / privacy + Sentry deny-list extension), Security Domain "OAuth callback CSRF" + "Pub/Sub webhook spoofing"**
- `.planning/phases/02-search-match-intake/02-PATTERNS.md` — rows under "Core libs (Plan 1+)" for `src/lib/integrations/gmail.ts`; "App routes — recruiter-facing" rows for `/settings/integrations` and the OAuth start button; "App routes — public" rows for the OAuth callback + Pub/Sub push routes; "Pub/Sub webhook route" cheat-sheet
- `.planning/phases/01-internal-ats/01-LEARNINGS.md` — **R8 ("Invite role check uses USER-SCOPED client BEFORE service-role admin call"** — the OAuth start path is recruiter-authenticated; do NOT use service-role to mint the OAuth URL or set the state cookie); Sentry PII-safe error capture; the "Service-role ONLY in Inngest functions" rule (the Pub/Sub push route is the legitimate exception per PATTERNS.md service-role decision matrix)
- `CLAUDE.md` — Inngest for >2s AI/external calls (Gmail History API list is occasionally slow → must be in Inngest); never log email bodies/subjects/PII to Sentry
- `src/lib/inngest/functions/parse-cv.ts` — canonical Inngest pattern (the `sync-gmail-history` function follows it exactly)
- `src/lib/encryption.ts` (Plan 0) — `encrypt(plaintext)` + `decrypt(packed)` — the boundary into `gmail_credentials`
- `src/lib/db/gmail-credentials.ts` (Plan 0) — `get/upsert/updateAccessToken/updateWatchState/revokeGmailCredentials`
- `src/app/(app)/settings/page.tsx` + `src/app/(app)/settings/actions.ts` — existing settings shell + the canonical action shape we mirror
- `src/app/auth/callback/route.ts` — canonical OAuth-callback shape (we mirror its `GET(request)` + searchParams + redirect handling for `/api/gmail/callback`)
- `src/app/api/inngest/route.ts` — register the two new Gmail Inngest functions
- `supabase/migrations/<ts>_gmail_credentials.sql` (Plan 0) — review the column list including `last_history_id text`, `watch_expires_at timestamptz`, `scopes text[]`, `revoked_at timestamptz`

## Tasks

### Task 4.1: `src/lib/integrations/gmail.ts` — Google OAuth + Gmail API wrapper

**Files:**
- create `src/lib/integrations/gmail.ts`
- create `tests/unit/lib/integrations/gmail.test.ts` (mock-based tests of `getValidAccessToken` refresh logic + `createOAuth2Client` config)
- modify `src/lib/observability/sentry-pii.ts` (or wherever the Phase 1 `beforeSend` scrubber lives — likely `sentry.server.config.ts`): extend the deny-list to strip `subject`, `body`, `snippet`, `gmail_message_id`, `from`, `to`, `cc` keys from event payloads (RESEARCH §D.24 last bullet)

**Pattern to copy:** PATTERNS.md row `src/lib/integrations/gmail.ts` — the seven named exports. RESEARCH §D.18 (OAuth library) + §D.20 (token refresh round-trip) + §D.22 (watch + history APIs). `src/lib/ai/voyage.ts` is the closest shape: `import 'server-only'`, a single SDK client, named function exports, careful error handling.

**Implementation:**

1. **`src/lib/integrations/gmail.ts`** — first line `import 'server-only'`. Imports: `google` + `gmail_v1` from `googleapis`, `OAuth2Client` from `google-auth-library`, `env` from `@/lib/env`, `encrypt` / `decrypt` from `@/lib/encryption`, `createServiceClient` from `@/lib/supabase/service`, db helpers from `@/lib/db/gmail-credentials`, `* as Sentry` from `@sentry/nextjs`.

2. **`export function createOAuth2Client(): google.auth.OAuth2`** — returns a configured client:
   - `new google.auth.OAuth2(env.GMAIL_OAUTH_CLIENT_ID, env.GMAIL_OAUTH_CLIENT_SECRET, env.GMAIL_OAUTH_REDIRECT_URI)`.
   - Throw a descriptive Error if any of the three env vars is missing (per Plan 0 they're `.optional()`, so the function fails-closed at call time rather than at boot).

3. **`export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; accessToken: string; expiresAt: string; email: string; scopes: string[] }>`:**
   - `const client = createOAuth2Client()`.
   - `const { tokens } = await client.getToken(code)`.
   - Validate: `tokens.refresh_token` MUST be present. If missing (recruiter previously authorised — Google omits the refresh token unless `prompt: 'consent'`), throw a typed Error `'Refresh token missing — revoke at https://myaccount.google.com/permissions and reconnect.'` The OAuth start path will pass `prompt: 'consent'` and `access_type: 'offline'` (step 5 below) to ensure the refresh token is always issued.
   - Fetch the user's Google email: `client.setCredentials(tokens); const oauth2 = google.oauth2({ version: 'v2', auth: client }); const userinfo = await oauth2.userinfo.get(); const email = userinfo.data.email`.
   - Return shape with `expiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000).toISOString()`.

4. **`export async function getValidAccessToken(userId: string): Promise<string>`:**
   - `const supabase = createServiceClient(); const cred = await getGmailCredentials(supabase, userId)`.
   - If `!cred.ok || !cred.data || cred.data.revoked_at`, throw `Error('Gmail not connected for user ' + userId)`.
   - If `cred.data.access_token_expires_at` is in the future by > 60 s, decrypt `cred.data.access_token_encrypted` and return.
   - Otherwise refresh: `const client = createOAuth2Client(); client.setCredentials({ refresh_token: decrypt(cred.data.refresh_token_encrypted) }); const { credentials } = await client.refreshAccessToken();` (or use the newer `client.getAccessToken()` per googleapis v144 — verify in the SDK docs at implementation time; either works).
   - Encrypt the new access token; persist via `updateGmailAccessToken(supabase, { userId, encryptedAccessToken: encrypt(credentials.access_token), expiresAt: new Date(credentials.expiry_date).toISOString() })`. **Never log the plaintext token.** Return the plaintext to the caller (used in-memory only).
   - If Google returns 401 on refresh (token revoked from Google's side), call `revokeGmailCredentials(supabase, userId)` and throw `Error('Gmail refresh token revoked. Reconnect from Settings.')`. The UI catches this and surfaces a reconnect prompt.

5. **`export function buildAuthUrl(state: string): string`** (synchronous):
   - `const client = createOAuth2Client(); return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/gmail.readonly', 'openid', 'email', 'profile'], state, include_granted_scopes: true })`.
   - Per RESEARCH §D.18 + §D.19 + Security Domain "OAuth callback CSRF": the `state` parameter MUST be a cryptographically random nonce, cookie-bound, validated on callback.

6. **`export async function startWatch(userId: string, accessToken: string): Promise<{ historyId: string; expiration: string }>`:**
   - `const gmail = google.gmail({ version: 'v1', auth: createOAuth2Client_with_token(accessToken) })`.
   - `const res = await gmail.users.watch({ userId: 'me', requestBody: { labelIds: ['INBOX', 'SENT'], topicName: \`projects/\${env.GCP_PROJECT_ID}/topics/\${env.GMAIL_PUBSUB_TOPIC}\`, labelFilterAction: 'include' } })`.
   - **Plan 0 declared only `GMAIL_PUSH_AUDIENCE` + `GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL`.** Add two more env vars in this task's `src/lib/env.ts` edit: `GCP_PROJECT_ID: z.string().min(1).optional()` and `GMAIL_PUBSUB_TOPIC: z.string().min(1).optional()` (server-side, optional). Also bump `.env.example`. Document the values for the cloud-config runbook (step 4.5 below).
   - Returns `{ historyId: res.data.historyId, expiration: new Date(Number(res.data.expiration)).toISOString() }`.

7. **`export async function stopWatch(userId: string, accessToken: string): Promise<void>`** — `gmail.users.stop({ userId: 'me' })`.

8. **`export async function listHistorySince(userId: string, startHistoryId: string, accessToken: string): Promise<Array<{ messageId: string; historyId: string }>>`:**
   - Paginate `gmail.users.history.list({ userId: 'me', startHistoryId, historyTypes: ['messageAdded'] })`. Extract message IDs from `messagesAdded` per page. Cap at 500 messages per sync to bound work; if `nextPageToken` is set and the cap is reached, log a warning and process the remainder on the next push.
   - On 404 (historyId too old; Gmail keeps ~7 days of history): swallow the error, return `[]`, and Sentry-warn — the watch should be re-registered to reset `historyId`. The recruiter loses any messages older than the gap, which is acceptable for a freshly-connected mailbox.

9. **`export async function getMessageMetadata(messageId: string, accessToken: string): Promise<gmail_v1.Schema$Message>`** — `gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID'] })`. We DO NOT fetch `format='full'` — D2-18 forbids storing the body.

10. **Sentry deny-list extension.** Locate the Phase 1 `beforeSend` scrubber (likely `sentry.server.config.ts`). Add to the keys-to-strip array: `'subject', 'body', 'snippet', 'gmail_message_id', 'thread_id', 'from', 'to', 'cc', 'refresh_token', 'access_token'`. Per RESEARCH §D.24. Add a unit test covering at least the `subject` key.

11. **Tests:** mock googleapis modules; assert `getValidAccessToken` refreshes when expired and returns the cached token otherwise; assert `exchangeCodeForTokens` throws when `refresh_token` is missing; assert `buildAuthUrl` returns a URL containing `prompt=consent` and `access_type=offline`.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run` pass
- `grep -rn "from 'googleapis'\|from 'google-auth-library'" src/ --include='*.ts*'` returns `src/lib/integrations/gmail.ts` AND `src/app/api/gmail/push/route.ts` (Task 4.3) and nothing else (one wrapper invariant analogous to claude/voyage)
- `head -1 src/lib/integrations/gmail.ts` shows `import 'server-only'`
- Mock-test verifying `beforeSend` strips `subject` from a captured event payload

**Done:**
- All Google API surface area lives behind a single typed wrapper
- Encryption boundary holds: db helpers see ciphertext only; gmail.ts is the only decryption site

### Task 4.2: Settings Connect-Gmail UI + OAuth start server action + `/api/gmail/callback` route

**Files:**
- modify `src/app/(app)/settings/integrations/page.tsx` (Plan 1 created this — extend with Gmail Connect card)
- create `src/app/(app)/settings/integrations/connect-gmail-button.tsx` (Client Component)
- create `src/app/(app)/settings/integrations/disconnect-gmail-button.tsx` (Client Component)
- create `src/app/(app)/settings/integrations/delete-gmail-data-button.tsx` (Client Component — the "delete all imported Gmail data" affordance per RESEARCH §D.24)
- create `src/app/(app)/settings/integrations/actions.ts` — `startGmailOAuthAction`, `disconnectGmailAction`, `deleteImportedGmailDataAction`
- create `src/app/api/gmail/callback/route.ts`

**Pattern to copy:** `src/app/auth/callback/route.ts` (Phase 1 magic-link callback) — same `export async function GET(request: NextRequest)` shape. PATTERNS.md "Service-role decision matrix" row "Gmail OAuth callback route → server (recruiter is signed in) → Standard authenticated write". `src/app/(app)/settings/invite-form.tsx` for the canonical "Client Component → Server Action → toast" pattern.

**Implementation:**

1. **`/settings/integrations/page.tsx` extension.** Read `getGmailCredentials(supabase, user.id)`. Render:
   - If `!cred || cred.revoked_at`: a `<Card>` "Connect Gmail" with text "Connect your Gmail account so inbound emails from candidates and contacts appear automatically in their activity timeline. We use the `gmail.readonly` scope — we never send, modify, or delete email." Plus a `<ConnectGmailButton>` (Client Component).
   - If `cred && !cred.revoked_at`: a `<Card>` "Gmail Connected" showing `cred.google_email`, the last `cred.watch_expires_at` ("Watch expires in 5 days"), and a `<DisconnectGmailButton>` + `<DeleteGmailDataButton>` row.
   - Always render a small "What data we store" disclosure: bullet list per RESEARCH §D.24 privacy text — "sender, recipients, subject, first 200 characters, timestamp, thread ID" + "We never store the full body".

2. **`startGmailOAuthAction()`:**
   - `'use server'`. `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser()`. Bail if no user.
   - Generate `state` = `crypto.randomUUID()` (Node's). Set as HTTP-only cookie `gmail_oauth_state` with `maxAge: 600` (10 min), `path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production'`. Use `cookies()` from `next/headers`.
   - `const url = buildAuthUrl(state)`. Return `{ ok: true, url }`. The button does `window.location.href = url`. (Cannot `redirect()` from a Server Action that needs to set a cookie AND return JSON; pattern: return URL, client navigates.)

3. **`<ConnectGmailButton>`** — `'use client'`. `useTransition`. On click: `startGmailOAuthAction()` → `window.location.href = result.url`. Toast on error.

4. **`/api/gmail/callback/route.ts`** — `export async function GET(request: NextRequest)`:
   - Read `code`, `state`, `error` from `request.nextUrl.searchParams`.
   - If `error` is present (Google denied), redirect to `/settings/integrations?error=oauth_denied`.
   - **State validation.** `const cookieStore = await cookies(); const stateCookie = cookieStore.get('gmail_oauth_state')?.value`. If `!stateCookie || stateCookie !== state`, redirect to `/settings/integrations?error=oauth_state_mismatch` — Sentry-warn. **Do NOT mutate the DB before state validation.**
   - Get the signed-in user via `createClient()` (the recruiter completed the dance while authenticated). If no user (session expired during OAuth), redirect to `/sign-in?next=/settings/integrations`.
   - `const { refreshToken, accessToken, expiresAt, email, scopes } = await exchangeCodeForTokens(code)`. Wrap in try/catch; on failure redirect to `/settings/integrations?error=oauth_exchange_failed` + Sentry-capture (name + status only).
   - **Encrypt and upsert.** `const supabase = createServiceClient()` (the FIRST step in this route where service-role is justified — the next two writes both bypass RLS deliberately because we're touching `gmail_credentials` with `with check` constraints; OR alternatively use the authenticated `supabase` from above and let RLS enforce `user_id = auth.uid()` — **PREFERRED**, use authenticated client; service-role only for the watch-state update path inside Inngest later). Call `upsertGmailCredentials(supabase, { userId: user.id, googleEmail: email, refreshTokenEncrypted: encrypt(refreshToken), accessTokenEncrypted: encrypt(accessToken), accessTokenExpiresAt: expiresAt, scopes })`.
   - **Start watch.** `const { historyId, expiration } = await startWatch(user.id, accessToken)`. Persist via `updateGmailWatchState(supabase, { userId: user.id, lastHistoryId: historyId, watchExpiresAt: expiration })`.
   - **Clear state cookie.** `cookieStore.delete('gmail_oauth_state')`.
   - Redirect to `/settings/integrations?connected=1`. The page surfaces a success toast on this query param.

5. **`disconnectGmailAction()`:** authenticated client. Read cred for current user; if connected, fetch a valid access token via `getValidAccessToken`, call `stopWatch`, then `revokeGmailCredentials(supabase, user.id)` (sets `revoked_at`, NULLs both encrypted columns, NULLs `last_history_id`, NULLs `watch_expires_at`). Idempotent — calling twice is safe. `revalidatePath('/settings/integrations')`.

6. **`deleteImportedGmailDataAction()`:** authenticated client.
   - Hard-delete: `delete from activities where organization_id = current_organization_id() and kind = 'email' and metadata->>'gmail_message_id' is not null and actor_user_id = auth.uid()` — scope to the user's own imports so a teammate's data isn't deleted. (Activities have `actor_user_id` per Phase 1 schema; the Gmail sync function in Task 4.3 sets it to the user whose mailbox was synced.)
   - Returns `{ ok: true, deleted: <count> }`. `revalidatePath` candidate timelines aren't reachable from here without enumerating; rely on natural re-renders. Add a toast "Imported Gmail data deleted (N rows)".
   - **Audit row**: `record_audit('delete', 'activity', '<bulk>', { source: 'gmail_disconnect_purge', count })`. Use the org's existing `record_audit` (authenticated, attributes to the user).

7. **Cloud config runbook.** Append a section to `README.md` (or new `docs/gmail-integration-setup.md`) listing:
   - GCP project creation + enable Gmail API + Pub/Sub API
   - Service-account JSON for the push subscription
   - `gcloud pubsub topics create altus-gmail-events` + `gcloud pubsub subscriptions create altus-gmail-push --topic altus-gmail-events --push-endpoint https://altus.co.uk/api/gmail/push --push-auth-service-account altus-pubsub@<project>.iam.gserviceaccount.com`
   - Granting `roles/pubsub.publisher` to `gmail-api-push@system.gserviceaccount.com` on the topic per Google docs
   - OAuth consent screen approval workflow (1-6 weeks for `gmail.readonly` per RESEARCH §D.19; for the anchor, set Workspace app type to "Internal" if the agency uses Workspace)
   - The env vars to populate

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- **Live OAuth flow.** With real GCP project + OAuth client provisioned: click Connect Gmail; complete Google's consent; land back on `/settings/integrations?connected=1` with a success toast. `select google_email, scopes, watch_expires_at, last_history_id from gmail_credentials where user_id = '<my-user-id>'` returns the expected row; `refresh_token_encrypted` is a base64-packed string starting with the `<iv>:<authTag>:` prefix.
- Click Disconnect; refresh; "Connect Gmail" card returns. `select revoked_at, refresh_token_encrypted, access_token_encrypted from gmail_credentials where user_id = '<my-user-id>'` shows `revoked_at` set and both token columns NULL.
- **OAuth state CSRF.** Manually tamper with the `state` query param by visiting `/api/gmail/callback?code=foo&state=evil` directly. Expect a redirect to `?error=oauth_state_mismatch` and Sentry-warn breadcrumb.
- Click "Delete imported Gmail data" with synthetic activity rows in place; row count drops to zero; audit log shows the bulk delete.

**Done:**
- Recruiter can Connect / Disconnect / Delete-data through clean UX
- Tokens encrypted at rest; OAuth state CSRF protected; refresh-token-missing edge case handled

### Task 4.3: Pub/Sub push webhook + `sync-gmail-history` Inngest function

**Files:**
- create `src/app/api/gmail/push/route.ts`
- create `src/lib/inngest/functions/sync-gmail-history.ts`
- modify `src/app/api/inngest/route.ts` (register `syncGmailHistory`)
- modify `src/lib/db/gmail-credentials.ts` (add `getGmailCredentialsByGoogleEmail(supabase, email): Promise<DbResult<GmailCredentialsRow | null>>`)
- modify `src/lib/db/candidates.ts` + `src/lib/db/contacts.ts` (add `findByEmail(supabase, { organizationId, email })` for inbound match lookup)
- modify `src/lib/db/activities.ts` (add `createGmailActivity(supabase, { ... })` with the exact metadata shape from D2-18 + dedupe lookup)
- create `tests/unit/app/api/gmail/push.test.ts` (JWT verification edge cases)
- create `tests/unit/inngest/sync-gmail.test.ts` (matching + dedupe + history-id cursor advance)

**Pattern to copy:** PATTERNS.md "Pub/Sub webhook route" cheat-sheet — JWT verification BEFORE any state change, return 200 immediately after dispatching the Inngest event. RESEARCH §D.22 + §D.23 for sync semantics + activity row shape. `src/lib/inngest/functions/parse-cv.ts` for the Inngest function structure.

**Implementation:**

1. **`/api/gmail/push/route.ts`** — `export async function POST(request: NextRequest)`:
   - **FAIL-CLOSED ON MISSING ENV (per VERIFICATION M-3 — BLOCKER):** the first lines of the handler must reject with 503 if either Pub/Sub env is unset, BEFORE reading any header or body:
     ```ts
     if (!env.GMAIL_PUSH_AUDIENCE || !env.GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL) {
       Sentry.captureMessage('gmail/push received without configured audience', {
         level: 'error',
         tags: { layer: 'route-handler', route: '/api/gmail/push' },
       })
       return new Response(null, { status: 503 })
     }
     ```
     Plan 0 declared both env vars as `.optional()` in the Zod schema (so the build succeeds without them, since the rest of Plan 4 can't be smoke-tested locally without GCP setup). At runtime in production, `verifyIdToken({ audience: undefined })` would silently accept any audience — a fundamental auth bypass. The fail-closed check enforces that both envs ARE set before any verification logic runs. Document `GMAIL_PUSH_AUDIENCE` + `GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL` as REQUIRED in production in `docs/gmail-integration-setup.md` (runbook).
   - Read `Authorization` header; expect `Bearer <JWT>`. If missing → 401.
   - **JWT verification FIRST.** `const client = new OAuth2Client(); const ticket = await client.verifyIdToken({ idToken, audience: env.GMAIL_PUSH_AUDIENCE })`. `const payload = ticket.getPayload()`. If `payload?.email !== env.GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL`, return 401. **Do not read the body before this check.** RESEARCH §D.22 + PATTERNS.md cheat-sheet.
   - Read body: `const body = await request.json()`. Pub/Sub envelope shape: `{ message: { data: '<base64-encoded-json>', messageId, publishTime }, subscription }`. Decode: `const decoded = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf-8'))` — yields `{ emailAddress: '<gmail-user-email>', historyId: '12345' }`.
   - Look up the credentials by Google email: `const cred = await getGmailCredentialsByGoogleEmail(serviceClient, decoded.emailAddress)`. If `!cred.ok || !cred.data || cred.data.revoked_at`, return 200 (silently drop — the watch was probably orphaned).
   - **Fire Inngest event.** `await inngest.send({ name: 'gmail/history-changed', data: { user_id: cred.data.user_id, organization_id: cred.data.organization_id, history_id: decoded.historyId, google_email: decoded.emailAddress } })`. Wrap in try/catch + Sentry (PII-safe).
   - Return `new Response(null, { status: 200 })` IMMEDIATELY. Pub/Sub retries on non-2xx; long handlers cause duplicate deliveries.
   - Middleware: `/api/gmail/push` was added to `PUBLIC_PATHS` in Plan 0; confirm.

2. **`src/lib/inngest/functions/sync-gmail-history.ts`:**
   - `id: 'sync-gmail-history'`
   - `triggers: [{ event: 'gmail/history-changed' }]`
   - `concurrency: { limit: 1, key: 'event.data.user_id' }` — per-user serialisation so concurrent pushes for the same mailbox don't race the `last_history_id` cursor.
   - `retries: 5` — RESEARCH §E.26: Google API transient errors are more common than Anthropic's.
   - Event-shape guards: every payload field present; `user_id` and `organization_id` are not empty strings.
   - Tenant-boundary check: re-read `gmail_credentials` for `user_id`, assert `organization_id` matches the event payload, else `NonRetriableError('credentials org mismatch')` and Sentry-warn (this would indicate a stale event after an org migration).
   - Step 1 `get-token` — `await getValidAccessToken(user_id)`. If it throws revoke-error, mark `revoked_at` and abort the chain.
   - Step 2 `list-history` — `await listHistorySince(user_id, cred.last_history_id, accessToken)`. The returned message IDs are the work queue.
   - Step 3 `process-messages` — loop the message IDs (sequential per the concurrency model). For each:
     1. `step.run(\`msg-\${messageId}\`, async () => { const msg = await getMessageMetadata(messageId, accessToken); const headers = parseHeaders(msg.payload?.headers ?? []); ... })`
     2. `parseHeaders(headers)` extracts `from`, `to`, `cc`, `subject`, `date` from the array shape Gmail returns. Return `{ from: string, to: string[], cc: string[], subject: string, internalDate: Date }`. Helper in `gmail.ts`.
     3. **Match emails.** For each address in `[from, ...to, ...cc]` (deduplicated, lowercased): look up `findByEmail(supabase, { organizationId, email })` in candidates first, then contacts. If either matches, append `{ entityType: 'candidate' | 'contact', entityId, address }` to a matches list. Skip orphans (D2-19).
     4. **Direction.** If `cred.google_email === from` → direction = 'outbound'; else direction = 'inbound'.
     5. **Activity row per match.** Dedupe on `(gmail_message_id, entity_id)` — if `createGmailActivity` finds an existing row with the same metadata pair, skip. Insert:
        ```
        kind: 'email',
        body: subject.slice(0, 500),
        entity_type: 'candidate' | 'contact',
        entity_id: <match>,
        actor_user_id: user_id,
        occurred_at: internalDate,
        metadata: {
          gmail_message_id: msg.id,
          thread_id: msg.threadId,
          from: from,
          to: to,
          cc: cc,
          snippet: (msg.snippet ?? '').slice(0, 200),
          direction: direction,
        }
        ```
        (D2-18 + RESEARCH §D.23 — subject + 200-char snippet only.)
   - Step 4 `update-cursor` — `updateGmailWatchState(supabase, { userId: user_id, lastHistoryId: <largest historyId observed>, watchExpiresAt: cred.watch_expires_at })`. The watch expiry doesn't change here; the renewal Inngest function (Task 4.4) handles that.
   - `onFailure`: PII-safe Sentry capture; do NOT advance the cursor (so the next push retries the missed range). Belt-and-braces: history-id 404 (older than 7-day retention) → reset to "current" via `getProfile` API and Sentry-warn — the recruiter loses the missed window but the sync resumes.

3. **`createGmailActivity(supabase, ...)`** in `activities.ts`:
   - Dedupe FIRST: `select id from activities where organization_id = $1 and kind = 'email' and entity_type = $2 and entity_id = $3 and metadata->>'gmail_message_id' = $4`. If exists, return `{ ok: true, data: { id, deduped: true } }`.
   - Else insert. `set_organization_id` trigger fills `organization_id` if the caller doesn't pass it (service-role caller passes explicitly per the Inngest pattern).

4. **`findByEmail` helpers.** Cheap lowercased-email SELECT against the canonical column. Index hint: `candidates_email_idx` exists. `contacts.email` was NOT indexed in Phase 1; **add a tiny migration** `<ts>_contacts_email_idx.sql`: `create index if not exists contacts_email_idx on public.contacts (organization_id, lower(email)); -- supports Gmail inbound matching`.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- **JWT spoof check.** Visit `/api/gmail/push` with a bogus `Authorization: Bearer fake.jwt.token` body — expect 401, no Inngest event sent, no DB write.
- **Synthetic push.** Use the Inngest dev UI to fire `gmail/history-changed` manually with `{ user_id, organization_id, history_id, google_email }`. The function fetches history, retrieves a message, finds a matching candidate (use seed data with a candidate whose `email` equals an address present in a real Gmail message), inserts an activity row. The candidate detail page shows the new "Email · subject…" row in their timeline.
- **Dedupe.** Re-fire the same push. The function processes the same message; the dedupe check skips the insert. Activity row count unchanged.
- **Orphan.** Fire a push for a message whose addresses don't match any candidate/contact. NO activity row inserted; Sentry breadcrumb counts it.
- `select metadata->>'snippet' from activities where kind='email' order by created_at desc limit 1` — string length ≤ 200.
- `select metadata->>'subject' from activities where kind='email'` — **does not exist**; subject lives in `body`, snippet in `metadata.snippet`. (Confirms the shape per D2-18.)
- Sentry deny-list smoke (from Task 4.1): force an error inside `sync-gmail-history`; the captured event has no `subject` / `snippet` / `gmail_message_id` keys in its payload.

**Done:**
- Inbound Gmail messages from candidates/contacts appear in the right timeline within ~60 s
- No bodies stored; tokens never logged; dedupe holds

### Task 4.4: Daily `renew-gmail-watch` schedule + revocation safety + verification

**Files:**
- create `src/lib/inngest/functions/refresh-gmail-watch.ts`
- modify `src/app/api/inngest/route.ts` (register `refreshGmailWatch`)
- modify `src/lib/db/gmail-credentials.ts` (add `listExpiringWatches(supabase, withinHours: number)`)

**Pattern to copy:** RESEARCH §D.22 last paragraph ("Gmail watch expires after 7 days. If we forget to renew, push notifications silently stop.") + the "scheduled cron" Inngest pattern from `embed-candidates-batch.ts` (Plan 1).

**Implementation:**

1. **`refresh-gmail-watch.ts`:**
   - `id: 'refresh-gmail-watch'`
   - `triggers: [{ cron: 'TZ=Europe/London 0 3 * * *' }]` (daily, 03:00 BST)
   - `concurrency: { limit: 1 }`
   - `retries: 1`
   - Body: `const expiring = await listExpiringWatches(supabase, 36)` (anything expiring in the next 36h — gives a day's grace if one run fails). For each:
     - `step.run(\`renew-\${userId}\`, async () => { const token = await getValidAccessToken(userId); const { historyId, expiration } = await startWatch(userId, token); await updateGmailWatchState(supabase, { userId, lastHistoryId: historyId, watchExpiresAt: expiration }); })`. **Critical:** the new historyId from `startWatch` is the "current" id at watch time. We persist it so the next push picks up from there; if we used the old cursor we'd miss anything between the failed sync and the renewal.
     - On per-user error: PII-safe Sentry capture per row (not function-level failure — one user's revoked token shouldn't block other users' renewals). The user's UI surfaces a reconnect prompt on next /settings/integrations render (the action sees `revoked_at` or a 401-revoke-error).
   - **Sentry alert on persistent failure.** If a user's watch is `< 24h` from expiry AND the renewal has already failed N=2 times (track via a Sentry tag), capture a Sentry `level: 'error'` event. This is the "alert if not renewed in 6 days" requirement from CONTEXT.md `<specifics>`. Implementation note: store the failure count in `gmail_credentials.last_renewal_error` (text column) — **needs a small migration** `<ts>_gmail_credentials_last_renewal_error.sql`: `alter table public.gmail_credentials add column last_renewal_error text, add column last_renewal_attempt_at timestamptz`. (Plan 0 didn't ship this; this plan adds it as a small additive migration.)

2. **`listExpiringWatches(supabase, withinHours)`:** SELECT `user_id, organization_id, google_email, watch_expires_at, last_renewal_attempt_at` FROM `gmail_credentials` WHERE `revoked_at IS NULL AND watch_expires_at < now() + (withinHours * interval '1 hour')`.

3. **End-to-end flow check.** Document a runbook in the plan's commit message: connect Gmail; verify `watch_expires_at` is ~7 days out; manually fast-forward by 6 days via SQL (`update gmail_credentials set watch_expires_at = now() + interval '12 hours' where ...`); fire the cron manually from Inngest dev UI; expect `watch_expires_at` to refresh to ~7 days out again.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Manually trigger the scheduled function from Inngest dev UI with a connected mailbox in the database; `watch_expires_at` advances; no errors.
- Sentry receives an `error` event when a watch fails to renew on the 2nd attempt (simulate by revoking the OAuth token from Google's side: `https://myaccount.google.com/permissions`, click Altus, Remove access, then run the renewal).
- Disconnect Gmail; run the renewal — that user is skipped (revoked_at is set).
- **(VERIFICATION M-7 — schedule-died fallback):** confirm one of the following secondary signals for the schedule-itself-failing case (Inngest down, function bug, cron regression silently stops firing): (a) Sentry Crons monitor configured for `refresh-gmail-watch` with an expected interval of 24h + 30min tolerance, OR (b) a manual weekly check-in step documented in `docs/gmail-integration-setup.md` operator runbook. Pick (a) if Sentry Crons is set up; otherwise commit (b) into the runbook. Without one of these, a stopped cron is invisible until a watch silently expires.

**Done:**
- Pub/Sub watch is renewed daily without manual intervention; failure-mode alerting is in place

## Plan-level verification

- [ ] `pnpm lint && pnpm typecheck && pnpm test --run && pnpm test:e2e && pnpm build` all pass
- [ ] Demo with REAL GCP project: connect Gmail; send a test email from a personal account to the connected mailbox where the personal account's email matches a seeded candidate's `email`; within ~60 s the email appears as a new activity row on that candidate's timeline (ROADMAP success #4 verbatim)
- [ ] `select kind, body, metadata->>'snippet', metadata->>'direction' from activities where kind='email' order by created_at desc limit 1` returns a row where `body = subject`, `snippet` length ≤ 200, `direction in ('inbound', 'outbound')`
- [ ] Orphan email (sent to/from an unknown address): no activity row inserted
- [ ] Dedupe: same message ID hit twice → exactly one activity row
- [ ] OAuth state CSRF: forged callback URL → 4xx + Sentry-warn, no DB mutation
- [ ] Pub/Sub JWT spoof: forged Bearer token → 401, no Inngest event, no DB mutation
- [ ] Encryption boundary: `grep -rn "decrypt(" src/ --include='*.ts*'` returns ONLY `src/lib/integrations/gmail.ts` (and `src/lib/encryption.ts` itself). DB helpers see ciphertext only.
- [ ] One-Anthropic-instance + one-Voyage-instance + one-Gmail-wrapper invariants all hold
- [ ] Sentry payloads sampled after deliberate errors do NOT contain `subject`, `snippet`, `gmail_message_id`, `from`, `to`, `cc`, `body`, `refresh_token`, `access_token` keys
- [ ] `select * from gmail_credentials where revoked_at is not null limit 1` after a disconnect — `refresh_token_encrypted` and `access_token_encrypted` are NULL; `revoked_at` is now()
- [ ] Daily renewal cron registered in Inngest dev UI; manual trigger advances `watch_expires_at`
- [ ] `docs/gmail-integration-setup.md` (or README section) covers the GCP runbook

## Cross-cutting open issues for the plan-checker

(Surfaced for the checker; not blocking plan emission.)

- **`gmail.readonly` Google verification lead time.** Per RESEARCH §D.19, public apps requesting this scope go through Google's 1–6-week verification. The anchor agency can sidestep with "Internal" workspace app type if they're on Workspace. Decide which path the anchor uses BEFORE Plan 4 ships; if external verification is needed, the plan still ships but is non-functional in production until Google approves. Recommendation in plan: ship with Internal app type for the anchor; SaaS roll-out (Phase 5) will need verification.
- **Refresh token can be silently dropped by Google.** If a user revokes Altus's access from `https://myaccount.google.com/permissions`, the next `getValidAccessToken` call returns 401. Our handling: NULL the encrypted token + set `revoked_at` + surface reconnect UI. Tested in Task 4.4.
- **`gmail_credentials.last_renewal_error` column added by Plan 4.** Plan 0 didn't anticipate this. Small additive migration; not a Plan 0 revision needed.
- **`contacts_email_idx` migration added by Plan 4.** Same reasoning — Plan 0 didn't anticipate; small additive.
- **Cost-logging for Gmail sync.** No AI cost per se. CONTEXT D2-22 reserves `purpose='gmail_sync'` if useful for ops. Not written in this plan; can be added later if we want per-tenant Gmail-API usage in the same ledger.

## Out of scope for this plan (deferred or other plans)

- Outbound email sending (Phase 4 — Resend integration). `gmail.readonly` does not allow send.
- Full-body email storage (REQUIREMENTS.md "Out of Scope" → Phase 4 may revisit if voice / marketing needs it).
- Auto-creation of candidates from orphan email senders ("looks like a new candidate — create one?") — Phase 3 ergonomics.
- Outlook integration — Phase 5+ (the anchor uses Gmail; Outlook is a SaaS-customer ask later).
- Multi-Gmail-account-per-user (separate work + personal) — Phase 5 if needed.
- "Thread view" inside the CRM that aggregates multiple email activity rows — Phase 3 UI polish.
- Pub/Sub project setup automation via Terraform/Pulumi — out-of-band ops; this plan ships a manual runbook.
- AI-summarisation of recent email threads on a candidate timeline — Phase 4 (would require full-body storage).
- **`GMAIL_TOKEN_ENCRYPTION_KEY` rotation procedure (per VERIFICATION M-6).** Plan 0's `gmail_credentials.encryption_key_version smallint` column gives space for a future migration, but no executor task implements key rotation in Phase 2. If rotation is needed on the anchor during Phase 2, follow the manual procedure documented in `docs/gmail-integration-setup.md`: (1) mint key v2 (32 random bytes hex), (2) ship a one-shot helper that decrypts rows where `encryption_key_version=1` using env `GMAIL_TOKEN_ENCRYPTION_KEY_V1` and re-encrypts with env `GMAIL_TOKEN_ENCRYPTION_KEY` (v2), bumping `encryption_key_version` to 2, (3) flip env to v2-only, (4) delete v1 secret. Productionising the rotation tooling itself is deferred to Phase 5 SaaS shell.
