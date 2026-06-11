---
phase: quick-260612-0f4
verified: 2026-06-12T00:49:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Send a test campaign email and inspect the delivered email headers"
    expected: "Email arrives with List-Unsubscribe: <https://altusrecruit.com/unsubscribe/{token}>, List-Unsubscribe-Post: List-Unsubscribe=One-Click, and a footer link pointing to the same https URL. No mailto: appears."
    why_human: "Cannot verify actual email delivery or header presence without sending through Resend in a live environment."
  - test: "Click the unsubscribe link in the delivered email and submit the confirm form"
    expected: "GET /unsubscribe/{token} shows an inline HTML confirm page with masked email (e.g. a*****j@...). Submitting the form (POST to same URL) shows the 'You have been unsubscribed' page. Candidate row in Supabase has email_marketing_unsubscribed_at set to a non-null timestamp."
    why_human: "End-to-end flow requires a live email delivery plus DB state inspection."
  - test: "Attempt to send another campaign to the now-suppressed candidate"
    expected: "The candidate does not appear in the campaign's recipient list (getCampaignSegment excludes them). If a legacy recipient row exists, the send loop marks the recipient 'failed' with error_message 'suppressed_unsubscribed' and skips the send."
    why_human: "Requires a live campaign send through Inngest against a seeded DB with a suppressed candidate."
  - test: "Click the unsubscribe link a second time and submit the form again"
    expected: "POST returns the same 'You have been unsubscribed' page (idempotent). The email_marketing_unsubscribed_at timestamp in the DB is unchanged (not overwritten by the second click)."
    why_human: "Requires live DB inspection to confirm the original timestamp is preserved."
  - test: "Navigate to /unsubscribe/ (no token segment) and POST to /unsubscribe/ directly"
    expected: "GET shows 'This link is no longer valid' (constant generic copy, no PII). POST also shows 'This link is no longer valid' — not the success copy."
    why_human: "Route behaviour for missing token segment requires a live HTTP call to the deployed app."
  - test: "Confirm personalised_intro and personalised_outro are written to email_campaign_recipients after a send"
    expected: "After a successful campaign send, the recipient rows in email_campaign_recipients have non-null personalised_intro and personalised_outro."
    why_human: "Requires a live Inngest campaign run and DB inspection."
---

# Phase quick-260612-0f4: PECR One-Click Unsubscribe + Personalisation Persistence — Verification Report

**Phase Goal:** PECR-compliant one-click unsubscribe for email campaigns (tokenised public URL, suppression in segments + send loop, RFC 8058 headers, footer link replaces mailto) + persist per-recipient personalised_intro/outro (IN-02).
**Verified:** 2026-06-12T00:49:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A campaign email carries a real per-recipient https unsubscribe URL plus a List-Unsubscribe-Post one-click header — never the mailto placeholder | ✓ VERIFIED | `send-email-campaign.ts:358-361` sets `'List-Unsubscribe': '<${unsubscribeUrl}>'` and `'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'`. `grep mailto` returns no hit. `unsubscribeUrl` is `buildUnsubscribeUrl(token, env.NEXT_PUBLIC_SITE_URL)`. |
| 2 | GET /unsubscribe/{token} for a valid token returns an inline HTML confirm page with masked email and a form POSTing to the same URL | ✓ VERIFIED | `route.ts:147-175` exports `GET`, looks up recipient by token via service-role, returns `confirmPage(masked, token)`. `confirmPage` builds `<form method="POST" action="/unsubscribe/${safeToken}">`. `invalidTokenPage()` returned for unknown/missing token with status 200. No `page.tsx` present (ls confirms `route.ts` only). |
| 3 | Submitting the confirm form (or RFC 8058 one-click POST) durably suppresses the candidate so they never receive another campaign email | ✓ VERIFIED | `route.ts:182-203` exports `POST`, calls `await suppressByToken(supabase, token)` to completion before returning 2xx. `suppressByToken` in `unsubscribe.ts:157-263` sets `email_marketing_unsubscribed_at = now()` org-scoped, idempotent, never throws. |
| 4 | getCampaignSegment excludes suppressed candidates AND the send loop re-checks suppression per recipient at send time | ✓ VERIFIED | `campaigns.ts:70` has `.is('email_marketing_unsubscribed_at' as unknown as ..., null)` with PECR belt comment. `send-email-campaign.ts:256-261` checks `candidate.email_marketing_unsubscribed_at != null`, marks `'suppressed_unsubscribed'` and skips. Both gates present. |
| 5 | personalised_intro and personalised_outro are written to email_campaign_recipients in the send loop | ✓ VERIFIED | `campaigns.ts:179-227` `updateRecipientStatus` extended with `personalisedIntro`/`personalisedOutro` options; uses `as unknown as` escape hatch on the patch object. `send-email-campaign.ts:370-374` calls `updateRecipientStatus(..., 'sent', { resendEmailId, personalisedIntro: introParagraph, personalisedOutro: outroParagraph })`. |
| 6 | An invalid/unknown token shows constant generic copy and leaks no tenant or candidate data | ✓ VERIFIED | `route.ts:85-92` `invalidTokenPage()` returns `'This link is no longer valid'` copy. `POST` returns `invalidTokenPage()` for missing token (CR-01 fix confirmed at line 188-191). `suppressByToken` maps both "not found" and DB error to `ok:false`; POST renders `confirmedPage()` either way (T-0f4-ENUM). No PII interpolated in either page. |
| 7 | The List-Unsubscribe header URL is byte-for-byte identical to the POST endpoint URL (RFC 8058 one-click) — both are /unsubscribe/{token} served by a single route.ts | ✓ VERIFIED | `buildUnsubscribeUrl` is the single source of truth. `send-email-campaign.ts:301` builds `const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken, env.NEXT_PUBLIC_SITE_URL)` and uses it for both the `List-Unsubscribe` header (line 359) and `assembleCampaignHtml` footer (line 344). Single `route.ts` handles both GET and POST at the same path. |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260612000000_unsubscribe_tokens_and_suppression.sql` | unsubscribe_token column + email_marketing_unsubscribed_at column | ✓ VERIFIED | Both columns present with `add column if not exists`. Partial unique index `email_campaign_recipients_unsub_token_idx` present. Column comments document belt/braces gates. |
| `src/lib/email/unsubscribe.ts` | generateUnsubscribeToken + buildUnsubscribeUrl + maskEmail + suppressByToken | ✓ VERIFIED | All four exports present. `import 'server-only'` at top. `randomBytes(32).toString('base64url')` for token generation. `encodeURIComponent` on token path segment. `suppressByToken` idempotent (re-reads before write), org-scoped, never throws, Sentry tags are fixed strings only. |
| `src/app/(public)/unsubscribe/[token]/route.ts` | Single route.ts: GET inline-HTML confirm + POST one-click suppression | ✓ VERIFIED | File exists. `export const dynamic = 'force-dynamic'`. GET and POST exported. No `page.tsx` in directory. Inline HTML via `new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })`. |
| `src/lib/email/unsubscribe.test.ts` | 19 unit tests covering token/URL/maskEmail/suppressByToken branches | ✓ VERIFIED | 19/19 tests pass (`pnpm exec vitest run src/lib/email/unsubscribe.test.ts` — confirmed live). |
| `src/types/database.ts` | Contains unsubscribe_token + email_marketing_unsubscribed_at (Task 4 evidence) | ✓ VERIFIED | grep confirms all four columns present: `email_marketing_unsubscribed_at` (lines 510, 547, 584), `unsubscribe_token` (line 774, 789, 804), `personalised_intro` (769, 784, 799), `personalised_outro` (770, 785, 800). Task 4 blocking checkpoint has been completed. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `send-email-campaign.ts` | `List-Unsubscribe` + `List-Unsubscribe-Post` headers | `sendResendEmail headers` param | ✓ WIRED | Lines 358-361 pass both headers. `List-Unsubscribe-Post: List-Unsubscribe=One-Click` present. No mailto. |
| `campaigns.ts getCampaignSegment` | `candidates.email_marketing_unsubscribed_at` | `.is()` null filter | ✓ WIRED | Line 70: `.is('email_marketing_unsubscribed_at' as unknown as ..., null)` with comment. |
| `route.ts POST` | `candidates.email_marketing_unsubscribed_at` | `suppressByToken` service-role write | ✓ WIRED | `suppressByToken` reads recipient by token, writes candidate by `candidate_id` + `organization_id`. |
| `List-Unsubscribe header URL` | `POST endpoint URL` | both use `buildUnsubscribeUrl(token, ...)` | ✓ WIRED | Single `unsubscribeUrl` variable used for both header and footer. Single `route.ts` handles GET+POST. RFC 8058 one-click satisfied. |

---

### Code Review Findings — Post-Fix Verification

All four actionable findings from the code review were fixed:

| Finding | Description | Fix Status | Evidence |
|---------|-------------|------------|---------|
| CR-01 | POST with empty token returned success copy (no suppression) | ✓ FIXED | `route.ts:188-191`: `if (!token) { return invalidTokenPage() }` with comment referencing CR-01 fix. |
| WR-01 | Token persist update type-narrowing prevented org-scope `.eq()` guard | ✓ FIXED | `send-email-campaign.ts:276-282`: escape hatch removed; standard `supabase.from('email_campaign_recipients').update({...}).eq('id', recipient.id).eq('organization_id', organization_id)` with both guards. Comment at line 276: "Types now include unsubscribe_token (regenerated post-push), so the escape hatch is gone and the standard two-eq tenant guard applies." |
| WR-02 | `getCampaignWithRecipients` selected `*` including unsubscribe_token | ✓ FIXED | `campaigns.ts:259-263`: explicit column list excluding `unsubscribe_token` with comment "Exclude unsubscribe_token — it is only needed by the service-role send loop (WR-02)". |
| WR-03 | `assembleCampaignHtml` used `encodeURI` without `escapeHtml` wrap for href | ✓ FIXED | `resend.ts:172`: `const safeUnsubUrl = escapeHtml(encodeURI(unsubscribeUrl))` with comment referencing WR-03. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `route.ts` GET | `recipient.email` | service-role `supabase.from('email_campaign_recipients').select('email').eq('unsubscribe_token', token)` | Yes — indexed DB lookup by token | ✓ FLOWING |
| `send-email-campaign.ts` | `unsubscribeUrl` | `buildUnsubscribeUrl(freshRecipient.unsubscribe_token, env.NEXT_PUBLIC_SITE_URL)` | Yes — token from DB row or generated+persisted | ✓ FLOWING |
| `send-email-campaign.ts` | `personalisedIntro`/`personalisedOutro` | `draftCampaignIntroOutro(...)` (Sonnet) then `updateRecipientStatus(..., 'sent', { personalisedIntro, personalisedOutro })` | Yes — Sonnet output written to DB on sent path | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Vitest unit tests (19 tests) | `pnpm exec vitest run src/lib/email/unsubscribe.test.ts` | 19/19 PASS | ✓ PASS |
| No page.tsx collision in route dir | `ls src/app/(public)/unsubscribe/[token]/` | `route.ts` only | ✓ PASS |
| Task 4 types regenerated — unsubscribe_token in database.ts | `grep unsubscribe_token src/types/database.ts` | 6 lines match | ✓ PASS |
| Task 4 types regenerated — email_marketing_unsubscribed_at in database.ts | `grep email_marketing_unsubscribed_at src/types/database.ts` | 3 lines match | ✓ PASS |
| mailto: removed from send loop | `grep -n mailto src/lib/inngest/functions/send-email-campaign.ts` | no match | ✓ PASS |
| List-Unsubscribe-Post present in send loop | `grep List-Unsubscribe-Post src/lib/inngest/functions/send-email-campaign.ts` | line 360 match | ✓ PASS |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No TBD/FIXME/XXX/placeholder patterns detected in modified files. The PRE-LAUNCH BLOCKER comment in send-email-campaign.ts has been updated to "RESOLVED". | — | — |

---

### Human Verification Required

All 7 automated must-haves are VERIFIED. The following items require live environment testing to confirm end-to-end behaviour:

#### 1. Email delivery with real headers

**Test:** Send a test campaign email via the Inngest function to a seed candidate and inspect the raw email headers in the mail client.
**Expected:** `List-Unsubscribe: <https://altusrecruit.com/unsubscribe/{token}>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, footer anchor `href="https://altusrecruit.com/unsubscribe/{token}"`. No `mailto:` present.
**Why human:** Cannot verify actual Resend delivery or email client header rendering programmatically without a live send.

#### 2. End-to-end unsubscribe flow

**Test:** Click the unsubscribe link in the delivered email. Verify the confirm page shows a masked email. Click "Unsubscribe". Verify the confirmation page. Query Supabase: `SELECT email_marketing_unsubscribed_at FROM candidates WHERE id = '{candidate_id}'`.
**Expected:** Confirm page shows `a*****j@domain.com` style masking. Confirmation page shows "You have been unsubscribed." DB row has `email_marketing_unsubscribed_at` set to a non-null ISO timestamp.
**Why human:** Requires live email delivery, browser interaction, and DB inspection.

#### 3. Suppression exclusion in subsequent campaigns

**Test:** After Step 2, create and approve a new campaign with the same market_status filter. Inspect the recipients list.
**Expected:** The suppressed candidate does not appear in the new campaign's recipient rows (`getCampaignSegment` excluded them at the belt gate).
**Why human:** Requires a live Inngest campaign run and DB inspection of recipient inserts.

#### 4. Idempotency of repeat unsubscribe clicks

**Test:** Click the unsubscribe link a second time and submit the form again (or POST directly to the same URL).
**Expected:** "You have been unsubscribed" page shown. `email_marketing_unsubscribed_at` timestamp in DB is unchanged (original value preserved, not overwritten).
**Why human:** Requires live DB inspection to confirm timestamp preservation.

#### 5. Invalid/missing token behaviour at the deployed URL

**Test:** Navigate to `https://altusrecruit.com/unsubscribe/` (no token) and `https://altusrecruit.com/unsubscribe/nonexistenttoken123`. Also POST to both URLs.
**Expected:** All four requests return "This link is no longer valid" constant copy. No PII, no org name, no "You have been unsubscribed" false positive.
**Why human:** Route behaviour for edge cases requires a live HTTP call to the deployed app; Next.js params resolution for empty path segments is runtime-dependent.

#### 6. personalised_intro/outro persistence in DB

**Test:** After a successful campaign send, query: `SELECT personalised_intro, personalised_outro FROM email_campaign_recipients WHERE campaign_id = '{id}'`.
**Expected:** Both columns are non-null for recipients with `status = 'sent'`.
**Why human:** Requires a live Inngest run and DB inspection.

---

### Gaps Summary

No gaps. All 7 must-have truths are VERIFIED by codebase evidence. All 4 post-review fixes (CR-01, WR-01, WR-02, WR-03) are confirmed in the code. Task 4 (migration push + type regen) is confirmed complete via `src/types/database.ts` containing all new columns. The 6 human verification items are behavioural/integration checks that cannot be verified by code inspection alone.

---

_Verified: 2026-06-12T00:49:00Z_
_Verifier: Claude (gsd-verifier)_
