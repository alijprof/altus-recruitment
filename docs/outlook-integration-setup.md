# Outlook (Microsoft 365) integration — setup runbook

> **Audience:** the anchor agency's IT admin + the Altus engineer.
> **Status:** Plan 4 of Phase 2. The Entra app, secrets, and Vercel env
> are configured once per environment (dev / staging / prod).

## 1. Register the Entra app (single-tenant)

1. Sign in to https://entra.microsoft.com with a Global Administrator
   account in the anchor's directory.
2. **Identity** → **Applications** → **App registrations** → **+ New
   registration**.
3. Fill in:
   - **Name**: `Altus Recruitment (Anchor)`
   - **Supported account types**: **Accounts in this organizational
     directory only (single tenant)**. This avoids publisher
     verification — multi-tenant flips happen in Phase 5.
   - **Redirect URI**: select **Web** and add
     `https://altus-recruitment.vercel.app/api/outlook/callback`.
     Add `http://localhost:3000/api/outlook/callback` as a second
     redirect URI for dev.
4. Click **Register**.

After creation, copy:

- **Application (client) ID** → `OUTLOOK_CLIENT_ID`
- **Directory (tenant) ID** → `OUTLOOK_TENANT_ID`

## 2. Issue a client secret

1. In the app blade → **Certificates & secrets** → **+ New client
   secret**.
2. Description: `altus-recruitment plan4`. Expiry: **24 months** (max
   allowed). Click **Add**.
3. **Copy the secret VALUE immediately** (it never re-displays) →
   `OUTLOOK_CLIENT_SECRET`.

Diary the expiry date into the engineering calendar. Rotating involves:
issuing a new secret, deploying the new value to Vercel, then deleting
the old secret. No code changes required.

## 3. Grant the API permissions + admin consent

1. App blade → **API permissions** → **+ Add a permission** →
   **Microsoft Graph** → **Delegated permissions**.
2. Tick:
   - `Mail.Read`
   - `offline_access`
   - `User.Read`
3. **Add permissions**.
4. Click **Grant admin consent for {Anchor Tenant}**. The Global Admin
   confirms once on behalf of the entire directory; individual
   recruiters never see the consent screen during sign-in.

If admin consent is NOT granted, recruiters connecting Outlook will see
a Microsoft error page (`AADSTS65001`) and the Connect-Outlook card
surfaces the admin-consent URL inline. Send that link to the admin and
click it once.

The admin-consent URL is:
```
https://login.microsoftonline.com/{OUTLOOK_TENANT_ID}/adminconsent?client_id={OUTLOOK_CLIENT_ID}
```

## 4. Generate the webhook + token-encryption secrets

```bash
# 32 random bytes hex-encoded — for OAuth token encryption at rest.
# Shared with any future Gmail adapter; the generalised name reflects that.
openssl rand -hex 32
# -> set EMAIL_TOKEN_ENCRYPTION_KEY=<the value>

# 32 random bytes hex-encoded — HMAC secret for per-subscription clientState.
# Rotation is online: change the env, then disconnect+reconnect each
# recruiter's mailbox (which also recreates the Graph subscription with a
# fresh clientState derived from the new secret).
openssl rand -hex 32
# -> set OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET=<the value>
```

## 5. Set Vercel env vars (Production + Preview)

```bash
# OAuth — required at runtime.
OUTLOOK_TENANT_ID=<uuid>
OUTLOOK_CLIENT_ID=<uuid>
OUTLOOK_CLIENT_SECRET=<secret value from step 2>
OUTLOOK_REDIRECT_URI=https://altus-recruitment.vercel.app/api/outlook/callback

# Webhook — required at runtime.
OUTLOOK_WEBHOOK_NOTIFICATION_URL=https://altus-recruitment.vercel.app/api/outlook/webhook
OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET=<hex value from step 4>

# Encryption — required at runtime.
EMAIL_TOKEN_ENCRYPTION_KEY=<hex value from step 4>
```

For Preview deployments, mirror the same values into the Preview
environment so feature-branch URLs can complete OAuth (Microsoft
validates `redirect_uri` exact-match against the registered URIs — add
preview wildcards via Entra's `https://*.vercel.app` if needed; not
recommended for production).

## 6. Local dev (ngrok)

Microsoft Graph webhooks require a public HTTPS endpoint. Local dev
needs a tunnel.

```bash
# Terminal 1 — Next.js
pnpm dev

# Terminal 2 — Inngest
pnpm inngest:dev

# Terminal 3 — ngrok
ngrok http 3000
# Copy the HTTPS Forwarding URL, e.g. https://abc123.ngrok-free.app

# Update .env.local:
OUTLOOK_REDIRECT_URI=https://abc123.ngrok-free.app/api/outlook/callback
OUTLOOK_WEBHOOK_NOTIFICATION_URL=https://abc123.ngrok-free.app/api/outlook/webhook

# Add the ngrok callback URL to Entra app's redirect URIs.
```

Restart `pnpm dev` after changing env vars.

## 7. Sentry Crons monitor (M-7 adapted)

The 6-hourly `refresh-outlook-subscription` Inngest schedule is the
only thing keeping subscriptions alive — Graph mail subscriptions cap
at ~70.5 hours and CANNOT be PATCH-renewed after expiry. A silently-
stopped Inngest schedule is invisible until the first subscription
fails to renew.

**Recommended:** configure a Sentry Crons monitor.

1. Sentry → Crons → **+ New Monitor**.
2. Name: `outlook-subscription-renewal`.
3. Cron expression: `0 */6 * * *`.
4. Schedule timezone: UTC.
5. Check-in margin: 10 minutes. Max runtime: 5 minutes.
6. Alert: page on **1 missed check-in**.

Inngest emits Sentry transactions automatically when our function
captures within them; pair the Sentry Crons monitor with an inline
`Sentry.captureMessage('outlook:cron:heartbeat')` in
`refresh-outlook-subscription.ts` for explicit liveness.

**Fallback (no Sentry Crons):** the engineer manually queries
`select user_id, subscription_expires_at from outlook_credentials where
revoked_at is null order by subscription_expires_at` every Monday. Any
row with `subscription_expires_at < now() + interval '1 day'` is a
renewal failure.

## 8. Key rotation procedure (deferred to Phase 5)

`EMAIL_TOKEN_ENCRYPTION_KEY` rotation requires re-encrypting every
`refresh_token_encrypted` and `access_token_encrypted` column with the
new key. The schema includes `encryption_key_version` to support a
dual-key window during the rotation, but the actual job is deferred
to Phase 5.

**Manual rotation (last resort, Phase 2):**

1. Generate the new key: `openssl rand -hex 32`.
2. Run a one-off script that, for every row in `outlook_credentials`:
   - decrypt with `EMAIL_TOKEN_ENCRYPTION_KEY_OLD`
   - encrypt with `EMAIL_TOKEN_ENCRYPTION_KEY_NEW`
   - UPDATE the row + bump `encryption_key_version`
3. Cut over `EMAIL_TOKEN_ENCRYPTION_KEY` to the new value in Vercel.
4. Verify by triggering a manual `outlook/history-changed` event for
   one user.

If you don't have time to write the script: nuke every row and force
every recruiter to reconnect. Tokens are user-resettable, not user-
sourced.

## 9. Disconnect / reconnect flow

A recruiter clicks **Disconnect** in `/settings/integrations`. This:

1. DELETEs the Graph subscription (Graph 404 is treated as success —
   idempotent).
2. Sets `outlook_credentials.revoked_at = now()` and NULLs every token
   + subscription column.

**No Microsoft-side revoke.** Microsoft refresh tokens cannot be
revoked by clients — they expire on first use after the
`offline_access` consent is withdrawn by the user, or via Entra's
**Sign-in logs → Revoke sessions** admin action. For Phase 2 this is
acceptable: the row is unusable from our side, and the upstream token
will expire naturally.

Reconnecting reuses the same row (`unique (user_id)` constraint — the
disconnect set tokens to NULL, the callback path UPDATEs them back).
