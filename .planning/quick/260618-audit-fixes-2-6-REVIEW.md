---
phase: 260618-audit-fixes-2-6
reviewed: 2026-06-18
depth: deep
files_reviewed: 12
files_reviewed_list:
  - src/app/(app)/campaigns/new/actions.ts
  - src/app/(app)/candidates/[id]/actions.ts
  - src/app/(marketing)/features/page.tsx
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/pricing/page.tsx
  - src/app/(marketing)/privacy/page.tsx
  - src/app/(marketing)/terms/page.tsx
  - src/app/(marketing)/welcome/page.tsx
  - src/app/(public)/apply/[orgSlug]/apply-form.tsx
  - src/app/(public)/apply/[orgSlug]/page.tsx
  - src/lib/db/campaigns.ts
  - src/lib/supabase/middleware.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Pre-Launch Audit Fixes (blockers 2-6) — Adversarial Code Review

**Reviewed:** 2026-06-18
**Depth:** deep (cross-file: schema, RLS, callers, gates)
**Files Reviewed:** 12
**Status:** issues_found (no blockers — 3 warnings, 2 info)

## Summary

All five fixes are fundamentally sound, multi-tenant-safe, and both gates pass
clean (`pnpm typecheck` = 0 errors; `pnpm lint` = 0 errors in the 12 changed
files). Storage paths are bucket-relative (verified against every upload site),
so the GDPR-erasure removal targets the right objects in both CV layouts and the
voice-audio bucket. The dead `careers@altus.co.uk` is gone from all rendered
copy. All forbidden marketing phrases are gone repo-wide. `/privacy` + `/terms`
are correctly in `PUBLIC_PATHS` with no over-exposure, and the draft banners are
present. The per-tenant consent email resolves the org owner via the service
client, correctly scoped to the resolved org.

**No CRITICAL findings.** Nothing here will crash the app or leak across tenants.
The three WARNINGs are robustness gaps where a fix is weaker than its own comment
claims — most importantly the campaign double-send guard does NOT fully close the
concurrent-double-submit race it was written to close (WR-01). For a non-coding
founder about to send real PECR-regulated campaigns, that residual gap should be
understood before go-live.

---

## Warnings

### WR-01: Campaign double-send guard has a TOCTOU race — concurrent double-submits still double-send

**File:** `src/lib/db/campaigns.ts:146-182`, `src/app/(app)/campaigns/new/actions.ts:172-184`
**Issue:** `findRecentDuplicateCampaign` is a check-then-act read with NO
backing DB constraint. There is no unique index on `email_campaigns` involving
`name` (verified in `20260610000000_phase4_hardening.sql:71-101`). Two genuinely
concurrent approvals (the exact "double-submit / second tab / Server-Action
retry" scenario the guard targets) can BOTH execute the dedupe SELECT before
either has INSERTed its campaign row — both see "no duplicate", both create, both
emit `campaign/send-approved`, and the whole consented UK segment is emailed
twice. The guard reliably catches *sequential* resubmits (e.g. a retry a few
seconds later, after the first row exists), but not the simultaneous case, which
is precisely the highest-risk path for a PECR breach. The function comment and
the action comment both assert this prevents the "second tab emails the segment
twice" case; for truly concurrent requests, it does not.
**Fix:** Back the guard with a DB-level guarantee so concurrency can't slip
through. Add a partial unique index in a new migration:
```sql
-- new migration, e.g. 20260618_campaign_dedupe_guard.sql
create unique index email_campaigns_recent_dupe_guard
  on public.email_campaigns (organization_id, name)
  where status in ('approved','sending','sent');
```
Then in `createCampaign`, treat the unique-violation error code (`23505`) as
"duplicate already exists" and have `approveCampaignAction` return the existing
campaign instead of erroring. The JS-side `findRecentDuplicateCampaign` can stay
as the fast-path/UX layer, but the index is what actually makes it safe. (Note:
a full unique index on `(organization_id, name)` would permanently ban re-using a
campaign name; the partial-on-status index above only blocks while a same-named
campaign is in-flight/sent, which still allows a deliberate later re-send once the
window passes — but reconsider the deliberate-resend product requirement before
shipping the index, since it changes that behaviour.)

### WR-02: GDPR storage-erasure cleanup is silent on read failure — orphaned files with zero Sentry signal

**File:** `src/app/(app)/candidates/[id]/actions.ts:484-499`
**Issue:** The two path-capture SELECTs (`candidate_cvs.storage_path`,
`voice_notes.audio_storage_path`) never inspect `.error`. On a transient or
systematic read failure (e.g. a future RLS regression on either table), `.data`
is `null`, `cvPaths`/`voiceAudioPaths` collapse to `[]`, and `removeFromBucket`
no-ops. The candidate is hard-deleted but the CV PDF and voice audio remain in
storage forever — the exact GDPR right-to-erasure gap this fix exists to close —
and because only the *remove* step is wrapped in a Sentry try/catch (not the
read), a systematic failure produces NO telemetry. You'd never know erasure was
silently failing. The `removeFromBucket` early-returns on `paths.length === 0`,
so an empty-due-to-error read is indistinguishable from a legitimately
file-less candidate.
**Fix:** Log when a path-capture read errors so a systematic erasure failure is
visible, while staying best-effort (still proceed with the delete):
```ts
if (cvPathRows.error) {
  Sentry.captureException(
    new Error(`cv path-capture read failed before delete: ${cvPathRows.error.code ?? 'unknown'}`),
    { tags: { layer: 'server-action', action: 'deleteCandidateAction', subop: 'capture-cv-paths', candidate_id: candidateId } },
  )
}
if (voiceAudioRows.error) {
  Sentry.captureException(
    new Error(`voice path-capture read failed before delete: ${voiceAudioRows.error.code ?? 'unknown'}`),
    { tags: { layer: 'server-action', action: 'deleteCandidateAction', subop: 'capture-voice-paths', candidate_id: candidateId } },
  )
}
```
(No PII — only error codes + candidate_id, consistent with the existing tags.)

### WR-03: Per-tenant contact email falls back to the org NAME (a non-email string) injected into "email us at {x}" copy

**File:** `src/app/(public)/apply/[orgSlug]/page.tsx:85`
**Issue:** `const contactEmail = (await resolveOrgContactEmail(org.id)) ?? org.name`.
When `resolveOrgContactEmail` returns `null`, `contactEmail` is set to the
organisation NAME, not an email address. That value is then threaded into
`renderConsentTextV2` ("request... by emailing {contact_email}") and into the
two apply-form upload-error toasts ("email {contactEmail}"). The rendered result
is a GDPR consent statement and error message telling an applicant to "email
Acme Recruitment" — instructing them to email a company name, with no actual
address. The comment defends this as the "impossible no-users case," and it is
in fact very unlikely (the auth trigger always inserts an owner row on org
creation, so every org has ≥1 user). But "impossible" GDPR-consent copy that
ships a meaningless data-subject-rights contact is a poor failure mode for a
compliance-critical surface, and the type system happily allows it because
`contactEmail` is typed `string`, not a validated email.
**Fix:** Fall back to a real, monitored platform address (or hard-fail the
render) rather than a name. The platform DP contact is a safer last resort than
a non-address:
```ts
const PLATFORM_DP_FALLBACK = 'privacy@altusrecruit.com' // monitored mailbox
const contactEmail = (await resolveOrgContactEmail(org.id)) ?? PLATFORM_DP_FALLBACK
```
If routing data-subject requests to the platform contradicts blocker 6's intent
(never a vendor address), prefer to `notFound()` / render an "applications
temporarily unavailable" state when no org user resolves, rather than emit
consent copy that points at a company name. Either way, don't put a non-email
into a "{contact_email}" slot.

---

## Info

### IN-01: No automated test covers the PECR-critical double-send guard or the GDPR erasure path

**File:** `src/lib/db/campaigns.ts:146` (guard), `src/app/(app)/candidates/[id]/actions.ts:484` (erasure)
**Issue:** Both fixes guard legally-significant behaviour (a PECR double-send;
GDPR right-to-erasure) yet have no unit test. `findRecentDuplicateCampaign`'s
set-equality (subset must NOT match), the 5-minute window, and the
status filter are all easy-to-regress logic with no coverage. The
storage-path capture-before-cascade ordering is the kind of thing a future
refactor silently breaks. CLAUDE.md explicitly calls for unit tests on "RLS
policy logic" and "logic that's easy to get wrong."
**Fix:** Add Vitest coverage: (1) `findRecentDuplicateCampaign` returns `null`
for a strict-subset segment, returns the row for an order-swapped equal segment,
and respects the status filter; (2) `deleteCandidateAction` calls
`storage.remove` with the exact captured paths for both bucket layouts. Not a
launch blocker, but cheap insurance on two compliance surfaces.

### IN-02: Privacy/terms scaffolds are unmistakably drafts — confirm the bracketed placeholders block real collection

**File:** `src/app/(marketing)/privacy/page.tsx:48-63,139`, `terms/page.tsx:23-29`
**Issue:** (Confirmation, not a defect.) Verified the "Draft — pending legal
review" amber banner is present on BOTH pages, the `[AGENCY LEGAL NAME]`,
`[AGENCY DP CONTACT EMAIL]`, and `[ICO REGISTRATION NUMBER]` placeholders are
clearly bracketed, the pages are valid server components (no client hooks; uses a
static `LAST_UPDATED` constant, not `new Date()`, so no build/hydration concern),
and the apply-form privacy link uses `rel="noopener noreferrer" target="_blank"`.
The only residual is procedural: the privacy notice still shows literal
`[BRACKETED]` placeholders to real applicants until a solicitor fills them in.
**Fix:** No code change. Process reminder to the founder: a UK DP adviser must
fill the bracketed fields before the first real applicant submits, since the
displayed notice is the basis for the consent the applicant gives.

---

## What I verified clean (no findings)

- **Fix 1 (GDPR erasure):** paths captured BEFORE the `delete_candidate` RPC
  cascade (actions.ts:484-499 precede the rpc at :510); storage paths are
  bucket-relative at every upload site (recruiter `<org>/<cand>/...` at :172,
  apply-form `<org>/applicants/<cand>-<uuid>` at apply/actions.ts:322,
  voice `<org>/<user>/<id>` at voice-notes/actions.ts:164) so `.remove(paths)`
  hits the correct objects in BOTH CV layouts + the voice bucket; selects run on
  the RLS-scoped SSR client (`createClient()` at :469), so cross-tenant rows are
  invisible; cleanup is per-bucket, wrapped, never throws; the removed
  `organizationId`/`getProfile` local is not referenced elsewhere in the function
  AND `getProfile` is still used by another action at :157 (import not orphaned);
  entitlement gate at :463-467 untouched and still first.
- **Fix 2 (marketing copy):** repo-wide grep confirms ZERO remaining "Get
  started free" / "No credit card" / "without a payment method"; only surviving
  `careers@altus` reference is a code comment (allowed); new copy is truthful and
  card-honest; all CTAs still `href="/sign-up"`; no unescaped-entity lint errors.
- **Fix 3 (per-tenant consent email):** owner resolved via `role='owner'` then
  any-user fallback, ordered by `created_at` ascending, `.maybeSingle()`;
  service client is justified (no session on public apply route) and scoped by
  `.eq('organization_id', orgId)`; `users.email` is `not null`, `role` + `created_at`
  columns exist (init migration :23-31); `contactEmail` prop typed `string` and
  threaded into `renderConsentTextV2` + both error toasts; never an Altus address
  (see WR-03 for the org-name fallback caveat).
- **Fix 4 (campaign guard):** runs BEFORE segment re-query/create/send
  (actions.ts:172 precedes :188); set-equality is true equality not subset
  (length check + every-in-target); 5-min window + status filter
  (`approved/sending/sent`) sound; returns existing campaign so caller short-
  circuits with `{ ok: true, campaignId, recipientCount }` matching
  `ApproveCampaignResult`; fails toward sending (returns `null`) on read error
  and logs to Sentry; org-scoped via `.eq('organization_id', orgId)`;
  `recipient_count` nullable handled by `?? 0` at the caller. (Residual
  concurrency race = WR-01.)
- **Fix 5 (privacy scaffold):** `/privacy` + `/terms` both in `PUBLIC_PATHS`
  (middleware:67-68); match is exact-or-`${p}/`-prefix so no over-exposure;
  `/admin` correctly still excluded; draft banners present; valid server
  components; apply-form privacy link has `noopener noreferrer`; footer links
  added; no dead links (terms links to /privacy which exists).
- **Cross-cutting:** `pnpm typecheck` = 0 errors; `pnpm lint` = 0 errors in
  changed files; no new `any` without reason (the one `as string[]` cast at
  campaigns.ts:177 narrows a DB `text[]` and is benign); no PII logged to Sentry
  (only error codes, candidate_id, org-scoped tags); no multi-tenancy hole.

---

_Reviewed: 2026-06-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
