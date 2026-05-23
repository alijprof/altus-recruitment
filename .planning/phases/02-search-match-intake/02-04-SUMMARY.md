---
phase: 02-search-match-intake
plan: "04"
subsystem: api
tags: [outlook, microsoft-graph, msal, oauth, inngest, encryption, webhook, typescript]

# Dependency graph
requires:
  - phase: 02-search-match-intake/02-00
    provides: "encryption.ts, outlook_credentials table, EMAIL_TOKEN_ENCRYPTION_KEY, middleware /api/outlook/* allowance"
  - phase: 02-search-match-intake/02-01
    provides: "/settings/integrations page skeleton"
provides:
  - "src/lib/integrations/outlook.ts — MSAL + Graph client wrapper, getValidAccessToken, subscription CRUD"
  - "OAuth callback /api/outlook/callback + Connect Outlook card on /settings/integrations"
  - "Microsoft Graph webhook /api/outlook/webhook — clientState validation + Inngest dispatch"
  - "sync-outlook-history Inngest function — delta query, email-to-candidate/contact matching, activity rows"
  - "create-outlook-subscription Inngest function — fired post-OAuth"
  - "refresh-outlook-subscription Inngest cron (6-hourly) — renew or recreate subscription"
  - "contacts_email_idx migration"
  - "outlook_credentials_renewal_tracking migration"
  - "docs/outlook-integration-setup.md — Entra app registration runbook"
affects: [03-linkedin-capture-spec-workflow-shortlists, 05-saas-shell]

# Tech tracking
tech-stack:
  added:
    - "@azure/msal-node@^5 — MSAL for Outlook OAuth (installed in Plan 0)"
    - "@microsoft/microsoft-graph-client@^3 — Graph API client (installed in Plan 0)"
  patterns:
    - "Single ConfidentialClientApplication instance in outlook.ts (grep invariant)"
    - "Single Graph Client instance in outlook.ts"
    - "clientState = HMAC-SHA256(secret, purpose+randomBytes) — per-subscription webhook auth"
    - "getValidAccessToken: decrypt → check expiry → MSAL refresh → persist rotated RT → return plaintext"
    - "Sliding RT rotation: acquireTokenByRefreshToken returns new RT in MSAL cache; persisted atomically"
    - "webhook fail-closed: 503 if OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET missing"
    - "delta-link cursor: null = full resync; set = incremental fetch"

key-files:
  created:
    - "src/lib/integrations/outlook.ts"
    - "src/app/api/outlook/callback/route.ts"
    - "src/app/api/outlook/webhook/route.ts"
    - "src/app/(app)/settings/integrations/connect-outlook-card.tsx"
    - "src/app/(app)/settings/integrations/actions.ts"
    - "src/lib/inngest/functions/sync-outlook-history.ts"
    - "src/lib/inngest/functions/create-outlook-subscription.ts"
    - "src/lib/inngest/functions/refresh-outlook-subscription.ts"
    - "supabase/migrations/20260519120000_contacts_email_idx.sql"
    - "supabase/migrations/<ts>_outlook_credentials_renewal_tracking.sql"
    - "docs/outlook-integration-setup.md"
  modified:
    - "src/app/(app)/settings/integrations/page.tsx — Connect Outlook card wired"
    - "src/lib/db/activities.ts — createEmailActivity helper"
    - "src/lib/db/candidates.ts — findCandidateByEmail with explicit org filter"
    - "src/lib/db/contacts.ts — findContactByEmail with explicit org filter"
    - "src/lib/db/outlook-credentials.ts — listExpiringSubscriptions, recordRenewalAttempt"
    - "src/app/api/inngest/route.ts — three new Outlook functions registered"

key-decisions:
  - "D2-15: Separate OAuth (not Supabase Auth) for Outlook; single-tenant Entra app for anchor"
  - "D2-16: EMAIL_TOKEN_ENCRYPTION_KEY (generalised) — shared by any future email provider in Phase 5"
  - "D2-17: Graph subscription cap ~3 days; 6-hourly renewal cron with 12h lookahead; 404 = recreate"
  - "D2-18: Store subject + 200-char bodyPreview snippet only; full body never stored"
  - "D2-19: Exact email match via findCandidateByEmail/findContactByEmail; orphans skipped"
  - "clientState is SOLE auth signal for webhook — must be non-null, non-empty, HMAC-derived"
  - "H1 REVIEW fix: fail closed on null clientState during PATCH-renew (commit 864bbc7)"
  - "Sliding RT rotation: MSAL returns new RT on each refresh; both access + refresh tokens persisted atomically"

patterns-established:
  - "outlook.ts: single-instance grep invariant for both ConfidentialClientApplication and Graph Client"
  - "captureScrubbed pattern: Sentry wraps Microsoft errors to lift name+statusCode only"
  - "webhook validates clientState BEFORE reading body; fail-closed on missing env"
  - "delta_link = null triggers full resync (subscription recreation or first sync)"

requirements-completed:
  - EMAIL-01

# Metrics
duration: "unknown — backfilled"
completed: "2026-05-19"
---

# Phase 2 Plan 4: Outlook (Microsoft 365) Integration Summary

_Backfilled on 2026-05-23 from VERIFICATION/LEARNINGS/REVIEW + git log; some execution-time detail (exact durations, granular deviation list) is approximate._

**Full Microsoft 365 OAuth → Graph subscription → delta-sync → activity-row pipeline with encrypted token storage, 6-hourly subscription renewal with 404-recreate fallback — ROADMAP success criterion #4 delivered (requires Entra app + cloud setup)**

## Performance

- **Duration:** unknown — backfilled
- **Started:** unknown
- **Completed:** 2026-05-19
- **Tasks:** 4
- **Files modified:** ~20

## Accomplishments
- outlook.ts wraps MSAL + Graph Client as singletons with encrypted token round-trip and sliding refresh-token rotation
- /api/outlook/callback handles code exchange, single-tenant guard, token encryption, subscription creation trigger
- /api/outlook/webhook validates clientState (HMAC-derived per-subscription secret) and dispatches sync-outlook-history Inngest event
- sync-outlook-history fetches delta, matches emails by address to candidates/contacts (exact .eq() lookup), creates activity rows (kind='email', subject + 200-char snippet)
- 6-hourly refresh cron renews expiring subscriptions; 404 triggers automatic recreation + delta_link null + full resync

## Task Commits

1. **Task 4.1: Outlook MSAL+Graph wrapper** — `c8d5afb` (feat)
2. **Task 4.2: OAuth callback + Connect Outlook UI** — `2b99d05` (feat)
3. **Task 4.3 + 4.4 (orphaned work)** — `82c21aa` (fix — also contains Phase 2 code review report)

## Files Created/Modified
- `src/lib/integrations/outlook.ts` — MSAL/Graph singletons, getValidAccessToken, subscription CRUD, fetchDelta, deriveClientState
- `src/app/api/outlook/callback/route.ts` — OAuth PKCE callback, state cookie validation, single-tenant guard
- `src/app/api/outlook/webhook/route.ts` — GET validationToken handshake + POST clientState validation + Inngest dispatch
- `src/lib/inngest/functions/sync-outlook-history.ts` — delta query → email matching → activity inserts
- `src/lib/inngest/functions/create-outlook-subscription.ts` — post-OAuth subscription creation
- `src/lib/inngest/functions/refresh-outlook-subscription.ts` — 6-hourly cron, renew or recreate
- `src/app/(app)/settings/integrations/connect-outlook-card.tsx` — Connected/Disconnected/Revoked states
- `docs/outlook-integration-setup.md` — Entra app registration runbook + Sentry Crons guidance

## Decisions Made
- Email matching uses .eq() with lower() (not .ilike()) to avoid PostgreSQL _ wildcard false-positives (REVIEW M1 fix, commit 267f550)
- clientState is HMAC-SHA256 derived: `createHmac('sha256', secret).update(purpose+':'+randomBytes).digest('hex')` — never empty string
- Sliding RT rotation: MSAL cache must be read after acquireTokenByRefreshToken to extract new RT; both persisted atomically
- Outlook subscription cap ~4230 min; cron runs every 6h with 12h lookahead; 404 = subscription recreated + delta_link nulled for full resync

## Deviations from Plan
Backfilled summary — full deviation detail not recoverable. Known fixes from REVIEW:

**1. [Rule 1 - Bug] H1 null clientState during PATCH-renew**
- **Found during:** Code review
- **Issue:** renewal path used `cred.subscription_client_state ?? ''` — null clientState became empty string; webhook validator accepted forged notifications with clientState: ''
- **Fix:** Fail closed on null clientState: route to recreate path instead of renewing; webhook also rejects empty clientState explicitly (commit 864bbc7)
- **Files modified:** src/lib/inngest/functions/refresh-outlook-subscription.ts, src/app/api/outlook/webhook/route.ts

**2. [Rule 1 - Bug] M1 .ilike() wildcard injection on email lookup**
- **Found during:** Code review
- **Issue:** findCandidateByEmail/.findContactByEmail used .ilike() — emails with _ in local-part could false-match
- **Fix:** Switched to .eq() with lowercase normalisation (commit 267f550)
- **Files modified:** src/lib/db/candidates.ts, src/lib/db/contacts.ts

---

**Total deviations:** 2 security-relevant bugs fixed post-execution from code review (H1 webhook auth bypass, M1 wildcard injection)

## Issues Encountered
- Tasks 4.3 and 4.4 were committed as an "orphaned work" commit alongside the Phase 2 code review report (82c21aa) — all code shipped but commit boundary is not clean per-task
- Sentry Crons for refresh-outlook-subscription: documented in runbook but not configured (requires Sentry project access — out-of-band step for operator)
- Security rotation 2026-05-19: Outlook refresh token + clientState required explicit per-secret cleanup (LEARNINGS §6 post-rotation debug saga); OUTLOOK_CLIENT_SECRET expires 2028-04-15 (24-month Azure ceiling) logged in .planning/SECURITY-ROTATION-LOG.md

## User Setup Required
See `docs/outlook-integration-setup.md` for full runbook:
- OUTLOOK_TENANT_ID, OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REDIRECT_URI
- OUTLOOK_WEBHOOK_NOTIFICATION_URL (must be publicly reachable HTTPS)
- OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET (openssl rand -hex 32)
- EMAIL_TOKEN_ENCRYPTION_KEY (from Plan 0)
- Entra app registration with Mail.Read + offline_access + User.Read scopes + admin consent
- Sentry Crons monitor for refresh-outlook-subscription (or manual weekly check)
- Inngest env vars with Production scope in Vercel

## Next Phase Readiness
- Outlook email activity pipeline operational for anchor
- EMAIL_TOKEN_ENCRYPTION_KEY rotation deferred to Phase 5; manual procedure in docs/outlook-integration-setup.md
- findCandidateByEmail uses .eq() — Phase 3 LinkedIn capture path benefits from the same fix
- Multi-mailbox-per-user deferred to Phase 5

---
*Phase: 02-search-match-intake*
*Completed: 2026-05-19*
