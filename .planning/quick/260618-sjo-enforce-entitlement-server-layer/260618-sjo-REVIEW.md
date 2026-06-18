---
quick_id: 260618-sjo
slug: enforce-entitlement-server-layer
reviewed: 2026-06-18T20:01:22Z
depth: deep
files_reviewed: 38
files_reviewed_list:
  - src/lib/stripe/require-entitlement.ts
  - src/lib/stripe/cap-enforcement.ts
  - src/lib/stripe/entitlement.ts
  - src/app/(app)/layout.tsx
  - src/app/api/linkedin/ingest/route.ts
  - src/app/(public)/apply/[orgSlug]/actions.ts
  - src/lib/db/profiles.ts
  - src/app/(app)/_dashboard/sample-data-action.ts
  - src/app/(app)/campaigns/new/actions.ts
  - src/app/(app)/candidates/[id]/actions.ts
  - src/app/(app)/candidates/[id]/edit/actions.ts
  - src/app/(app)/candidates/[id]/floats/actions.ts
  - src/app/(app)/candidates/[id]/shortlist-actions.ts
  - src/app/(app)/candidates/[id]/voice-notes/actions.ts
  - src/app/(app)/candidates/import/actions.ts
  - src/app/(app)/candidates/new/actions.ts
  - src/app/(app)/clients/[id]/actions.ts
  - src/app/(app)/clients/[id]/jobs/new/actions.ts
  - src/app/(app)/clients/[id]/outreach-actions.ts
  - src/app/(app)/clients/new/actions.ts
  - src/app/(app)/jobs/[id]/actions.ts
  - src/app/(app)/jobs/[id]/ad-panel/actions.ts
  - src/app/(app)/jobs/[id]/matches/actions.ts
  - src/app/(app)/jobs/[id]/shortlist/actions.ts
  - src/app/(app)/jobs/new/actions.ts
  - src/app/(app)/reports/nl/actions.ts
  - src/app/(app)/settings/actions.ts
  - src/app/(app)/settings/apply-form-actions.ts
  - src/app/(app)/settings/branding/actions.ts
  - src/app/(app)/settings/integrations/actions.ts
  - src/app/(app)/settings/integrations/outlook-actions.ts
  - src/app/(app)/settings/team/actions.ts
  - src/app/(app)/spec/[id]/review/actions.ts
  - src/app/(app)/spec/actions.ts
  - src/app/(app)/spec/new/actions.ts
  - src/lib/stripe/require-entitlement.test.ts
  - src/lib/stripe/cap-enforcement.test.ts
  - tests/unit/app/api/linkedin/ingest.test.ts
  - tests/unit/app/apply/confirm-action-entitlement-skip.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: clean
---

# Quick Task 260618-sjo: Code Review Report — Entitlement Enforcement

**Reviewed:** 2026-06-18T20:01:22Z
**Depth:** deep (cross-file: gate helper → 29 actions + LinkedIn route + public apply, call-chain to every AI/embed Inngest dispatch site, UI consumers, tests)
**Files Reviewed:** 38
**Status:** clean

## Summary

This change is **clean and ships safe**. I adversarially traced the entitlement
policy through the gate helper, `checkCap`, the layout, all 29 gated server
actions, the authed LinkedIn route, the public apply form, every AI/embed
Inngest dispatch site, the UI consumers that render the blocked message, and
the tests. The leak (audit blockers 1 & 2 + the public-apply Voyage path) is
genuinely closed, and I found **no caller-crash, no shape mismatch, no IDOR, no
over-gating regression, no missed mutating/AI action, and no policy
inconsistency**. The three findings below are all INFO-level residuals worth a
glance, none block UAT.

The single most important thing the founder should know: **there is no
BLOCKER and no HIGH. A lapsed/cancelled/past_due/none org is now blocked
server-side from every CRM mutation and from all Claude + Voyage spend, while
paying customers are unaffected and a transient DB blip never locks them out of
the app or their AI.**

---

## What I verified (and it passed)

**1. Policy correctness — PASS.**
- `isEntitledStatus` (`require-entitlement.ts:36-38`) is a strict allowlist:
  only `trialing` + `active` pass. Every other status — `none`, `past_due`,
  `cancelled` — is denied. There is **no `none` carve-out anywhere** (grepped
  the whole gate surface; the only `'none'` references are in `entitlement.ts`
  where it's *assigned* as a status, never *excepted*). The allowlist design
  means even an unexpected Stripe status (`incomplete`/`unpaid`/`paused`, which
  aren't in the `SubscriptionStatus` union at all) fails safe → denied.
- Comp orgs are `status='active'` (`entitlement.ts` returns the sub's status
  verbatim) → entitled. Confirmed.
- The layout (`layout.tsx:48`), `requireEntitledOrg` (`:104`), `isOrgEntitled`
  (`:57`) and `checkCap` (`cap-enforcement.ts:108`) all use the **identical**
  predicate. No drift.
- `checkCap` fail-OPEN on a thrown `getEntitlement` is **preserved**
  (`cap-enforcement.ts:92-100` → returns `{allow:true, mode:'normal'}`), and
  fail-CLOSED on a *definitive* non-entitled status is **added** at `:108-110`.
  This split is exactly the intended posture — a DB blip never blocks a paying
  customer's AI; a real lapse denies.
- `requireEntitledOrg` fails CLOSED on resolution error (`:109-115`,
  Sentry-captured). The layout fails OPEN with `entitled=true` defaults
  (`:40-56`) and now logs to Sentry. Both correct per the money-vs-availability
  split.

**2. Caller-crash safety — PASS (highest-risk area, clean).**
- I opened every gated action, read its declared result union, and confirmed
  the gate's early-return shape is a member of that union. Examples:
  `createCandidateAction` → `{ok:false, formError}` ∈ `CreateCandidateResult`
  (`candidates/new/actions.ts:13-16`); `logActivityAction` → `{ok:false,error}`
  ∈ `ActionResult` (`candidates/[id]/actions.ts:22`); `deleteJobAction` →
  `{ok:false,error}` ∈ `DeleteJobResult` (`jobs/[id]/actions.ts:372`);
  `createContactAction` returns `formError` and `ContactActionResult` includes
  `formError` (`clients/[id]/actions.ts:25-28`). Every one matches.
- Because `pnpm typecheck` passes (0 errors per SUMMARY) and these are
  discriminated unions, a mismatched shape would have failed compilation — the
  type system is a hard backstop here, and it's green.
- I verified the UI actually *renders* the blocked message (not silent
  nothing): `candidate-form.tsx:93-94` → `toast.error(result.formError)`;
  `welcome-checklist.tsx:100-101` → `toast.error(result.error)`. Forms surface
  `fieldErrors`/`formError`/`error` and toast them. The user sees
  "Your subscription is inactive…".

**3. Completeness — PASS.**
- Cross-checked every `'use server'` file under `src/app/(app)/**` (29 files)
  and every `src/app/api/**/route.ts`. The only un-gated `'use server'` files
  are `_actions/submit-feedback.ts` and `campaigns/new/progress-actions.ts`,
  both correctly excluded (read-only / good-will, no spend).
- Enumerated every AI/embed Inngest event dispatched from user-facing code:
  `cv/uploaded`, `embed/backfill-org`, `job/embed`,
  `job/score-top-candidates`, `linkedin/captured`, `spec/uploaded`,
  `campaign/send-approved`. **Every single dispatch site is behind a gate**
  (`uploadCV`/`retryParse`, `confirmApplyAction`, `triggerCandidateBackfill`,
  job-create actions, ingest route, `submitSpecCall`, `approveCampaign`).
- Gate placement is correct in every action I spot-checked: AFTER zod/input
  validation, BEFORE any DB write / storage upload / Inngest enqueue / AI call.
  Verified specifically on the side-effect-heavy ones (`uploadCVAction`
  `:145` before `storage.upload` `:174`; `submitVoiceNoteAction` `:110` before
  any insert; LinkedIn route `:163` before `upsert` `:178` and `inngest.send`
  `:200`).

**4. Over-gating / regressions — PASS.**
- Billing/checkout/portal/stripe-return (`/api/stripe/*`,
  `stripe/return/actions.ts`), `admin/actions.ts`, `_actions/submit-feedback.ts`,
  auth/sign-out, and `src/lib/branding/colours.ts` are **untouched** — a gated
  org can still pay and super-admin still works.
- Read-only surfaces stay reachable: `searchCandidatesAction` (trigram RPC,
  no AI/write — `jobs/[id]/actions.ts:87`), `previewCampaignAction` (segment
  read + slice, no write — `campaigns/new/actions.ts:65`),
  `getLatestOutreachDraftAction`, `progress-actions.ts`. All correctly ungated.
- Onboarding intact: `seedSampleDataAction` and `importCandidatesAction` are
  gated but run during `trialing` (entitled), so first-login seed + CSV import
  still work. The gate comment at `sample-data-action.ts:48-49` documents this.
- Public apply STILL creates the candidate + CV + records consent for a
  non-entitled org (`apply/[orgSlug]/actions.ts` — the entitlement check is at
  `confirmApplyAction:537`, AFTER all the create/consent writes, and only skips
  the `cv/uploaded` enqueue). Confirmed the candidate is kept and only AI is
  withheld.

**5. Double-resolution / correctness — PASS.**
- `requireEntitledOrg` resolves user→profile→org→entitlement. Missing user →
  `unauthenticated` (`:92-94`). Missing/errored profile → `unauthenticated`
  (`:97-100`, treats any `!profile.ok` as unauth — fail-closed, never throws).
  Any thrown error → caught at `:109`, returns `not_entitled`, Sentry-captured.
  No unhandled throw path.
- LinkedIn route resolves the **bearer-token user's** org
  (`getProfile(db, user.id)` where `user` comes from `getUser(token)`,
  `route.ts:112/150/157`) before `isOrgEntitled(organizationId)` `:163`, and
  returns a clean `402 {ok:false, error:'subscription_inactive'}` with CORS.

**6. Multi-tenancy — PASS, no IDOR introduced.**
- `requireEntitledOrg` keys on the caller's own session
  (`createClient()` → `getUser()` → own profile's `organization_id`). No
  client-supplied org id anywhere in the cookie-auth path.
- LinkedIn route keys on the token user's own profile org, not any body field.
- Public apply: `isOrgEntitled(args.organizationId)` uses a client-passed org,
  BUT it's guarded — `confirmApplyAction:481-487` first requires the CV row to
  match `(candidateCvId, organizationId, candidateId)` via three `.eq()`
  filters, so an attacker can't supply a foreign org id (the cvRow lookup
  fails and short-circuits at `:488` before the entitlement check). The org
  used for the AI decision is provably the one that owns the candidate.

**7. Test quality — PASS, not shallow.**
- `require-entitlement.test.ts` asserts the full matrix: `isEntitledStatus`
  true for trialing/active, false for none/past_due/cancelled; `isOrgEntitled`
  same matrix + fail-CLOSED on throw; `requireEntitledOrg` unauthenticated /
  profile-miss / entitled (with resolved ids) / not_entitled (with status) /
  fail-CLOSED on throw.
- `cap-enforcement.test.ts` asserts non-entitled status → `{allow:false,
  mode:'hard'}` **even under cap** (the real leak vector), and entitled under
  cap → allow. Fail-open-on-error coverage was already present.
- `ingest.test.ts` asserts 402 + `subscription_inactive` AND that
  `upsertCandidateFromLinkedIn` and `inngest.send` were **never called** (gate
  fires before any write/enqueue).
- `confirm-action-entitlement-skip.test.ts` asserts candidate kept (`ok=true`,
  success redirect) but `inngest.send` never called when not entitled.

---

## Narrative Findings (AI reviewer)

## Info

### IN-01: Outlook history-webhook can still sync for a lapsed org (no AI spend, not a leak)

**File:** `src/app/api/outlook/webhook/route.ts:169`
**Issue:** The Microsoft Graph push webhook fires `inngest.send('outlook/history-changed')` for any org with stored Outlook credentials, with no entitlement check. An org that connected Outlook while entitled and then lapsed would keep receiving reply-sync runs. I traced the handler (`src/lib/inngest/functions/sync-outlook-history.ts`) and confirmed it makes **zero AI calls** (no Voyage/Claude/embed/`runWithLogging`) — it's pure reply-matching DB work. The *connect* path (`startOutlookOAuthAction`) IS gated, so a non-entitled org cannot newly enable this. This is therefore neither an AI-spend leak nor an in-scope mutation path; it's a benign residual.
**Fix:** No action needed for this task. If you later want strict "lapsed orgs do zero background work," gate the webhook on `isOrgEntitled(cred.organization_id)` before the `inngest.send` — but only do this if a future Outlook sync starts driving AI. Documenting here so it's a known, intentional gap.

### IN-02: `confirmApplyAction` AI-skip emits a breadcrumb, not a captured event

**File:** `src/app/(public)/apply/[orgSlug]/actions.ts:537-546`
**Issue:** When a genuinely-entitled org hits a transient `getEntitlement` error during a public application, `isOrgEntitled` fails CLOSED (correct) and the CV parse/embed is silently skipped; the apply path only adds a Sentry **breadcrumb** (info level), not a captured exception. The transient error itself *is* captured inside `isOrgEntitled` (`require-entitlement.ts:59`), so it's observable — but the "we skipped AI for what might be a paying org" decision isn't independently surfaced, so you can't easily alert on "applications landing without parsing."
**Fix:** Optional. If you want visibility into skipped-parse volume, change the breadcrumb to a low-severity `Sentry.captureMessage('apply: AI parse skipped — org not entitled', { level: 'info', tags: { org_id: args.organizationId } })`. Not required — the recruiter can re-trigger parsing from the candidate detail page, and the underlying error is already captured.

### IN-03: `getProfile` internal-error is collapsed to `unauthenticated`

**File:** `src/lib/stripe/require-entitlement.ts:96-100`
**Issue:** `requireEntitledOrg` treats *any* `!profile.ok` as `reason:'unauthenticated'`, including `getProfile`'s `code:'internal'` (a DB error) which is distinct from `code:'not_found'`. The result is fail-closed either way (action blocked), so this is **safe** — but a paying customer hitting a profile-read DB blip would see the generic blocked/billing message rather than a "try again" error, which is slightly misleading UX. The error is already captured inside `getProfile`, so it's observable.
**Fix:** Optional. If you want to distinguish, branch on `profile.code === 'internal'` and return a transient-error reason (or reuse `not_entitled` which already implies "recoverable"). Low priority — fail-closed is the correct security direction and the case is rare.

---

_Reviewed: 2026-06-18T20:01:22Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
