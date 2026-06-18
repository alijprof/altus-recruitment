---
quick_id: 260618-sjo
slug: enforce-entitlement-server-layer
title: Enforce subscription entitlement at the data/action layer (audit blockers 1 & 2 + public-apply AI gate)
status: complete
date: 2026-06-18
---

# Quick Task 260618-sjo — Enforce entitlement at the data/action layer — SUMMARY

**One-liner:** Lapsed/cancelled/past_due/none orgs can no longer mutate CRM data or burn paid AI keys by calling server actions, the authed LinkedIn route, or the public apply form directly — a new `require-entitlement.ts` gate + status-aware `checkCap` deny now enforce `entitled ⟺ status ∈ {trialing, active}` server-side, matching the layout exactly, while still failing OPEN for AI on a transient DB blip and KEEPING the public application itself for any org.

## Policy enforced (authoritative)
`entitled ⟺ getEntitlement(orgId).status ∈ {'trialing','active'}`. No carve-out for `none` (the layout already gates `none` card-first; onboarding orgs are `trialing` by the time they reach an action). Grandfathered comp orgs are `status='active'` → entitled. `getEntitlement` is reused everywhere so `trial_end_override` (admin extensions) is inherited identically.

## Gates (all PASS)
- `pnpm typecheck` → **0 errors** (`tsc --noEmit` clean).
- `pnpm lint` → **0 errors, 20 warnings** (all warnings pre-existing `_`-prefixed unused-mock-param in test files; convention matches sibling tests).
- `pnpm exec vitest run` → **37 test files passed | 4 skipped; 286 tests passed | 28 todo; 0 failed** (incl. all new tests).

## Commits
| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | `58f07b5` | Gate helper (`require-entitlement.ts`) + status-aware `checkCap` deny + layout Sentry on fail-open catch + tests |
| 2 | `b178f2a` | `requireEntitledOrg()` on every mutating server action + `isOrgEntitled()` on `/api/linkedin/ingest` + ingest test update |
| 3 | `0a4e62e` | Public apply: skip CV parse/embed enqueue for non-entitled orgs (candidate still created) + tests |

## Task 1 — gate helper, checkCap, layout
- **New** `src/lib/stripe/require-entitlement.ts` (`import 'server-only'`): `ENTITLED_STATUSES`, `isEntitledStatus()`, `isOrgEntitled(orgId)` (fails CLOSED on error), `requireEntitledOrg()` (resolves user→profile→org→entitlement; fails CLOSED on error, Sentry-captured), `ENTITLEMENT_BLOCKED_MESSAGE`, `EntitlementGate` type.
- `src/lib/stripe/cap-enforcement.ts`: after the successful `getEntitlement`, before the cap-ratio math, `if (!isEntitledStatus(entitlement.status)) return { allow:false, mode:'hard', bucket }`. The existing `catch` → fail-OPEN-on-error is **unchanged** (transient DB error must not block paying customers' AI). Comment documents the open-on-error / closed-on-definitive-status split.
- `src/app/(app)/layout.tsx`: empty fail-open `catch {}` now `Sentry.captureException(err, { tags: { layer:'billing', helper:'AppLayout', step:'getEntitlement' } })`; `entitled=true` defaults preserved (audit rank 22).
- **Tests:** new `require-entitlement.test.ts` (isEntitledStatus matrix; isOrgEntitled true for trialing/active, false for none/past_due/cancelled + fail-closed; requireEntitledOrg unauthenticated/profile-miss/entitled/not_entitled/fail-closed). Extended `cap-enforcement.test.ts` (hard deny under cap for none/past_due/cancelled; allow for trialing/active under cap).

## Task 2 — files GATED (29 mutating exports across these files)
`requireEntitledOrg()` added as the first statement after each action's input validation, returning the file's own error shape with `ENTITLEMENT_BLOCKED_MESSAGE`:

- `candidates/new` (createCandidate), `candidates/[id]` (logActivity, uploadCV, retryParse, acceptCVFields, deleteCandidate), `candidates/[id]/edit` (updateCandidate), `candidates/[id]/floats` (addFloat, updateFloatNote), `candidates/[id]/shortlist-actions` (convertShortlistToApplication), `candidates/[id]/voice-notes` (submitVoiceNote, applyVoiceNote, rejectVoiceNote), `candidates/import` (importCandidates)
- `clients/new` (createClient), `clients/[id]` (createContact, updateContact, deleteContact, logNote, updateClient, deleteCompany), `clients/[id]/jobs/new` (createJob), `clients/[id]/outreach-actions` (requestOutreachDraft, sendOutreach)
- `jobs/new` (createJobStandalone), `jobs/[id]` (addCandidateToJob, moveApplication, removeApplication, deleteJob), `jobs/[id]/ad-panel` (generateAd, scoreInclusivity, saveJobAd, deleteJobAd), `jobs/[id]/matches` (explainCandidateMatch), `jobs/[id]/shortlist` (addToShortlist, removeFromShortlist)
- `spec/new` (submitSpecCall), `spec/actions` (deleteSpecDraft), `spec/[id]/review` (approveSpecDraft, rejectSpecDraft)
- `campaigns/new/actions` (approveCampaign — the send gate)
- `reports/nl/actions` (nlQuery — Sonnet)
- `settings/actions` (updateProfile, updateOrganization — non-billing), `settings/apply-form-actions` (toggleApplyFormEnabled), `settings/branding/actions` (updateBranding), `settings/integrations/actions` (triggerCandidateBackfill, triggerHnswBuild), `settings/integrations/outlook-actions` (startOutlookOAuth — see decision), `settings/team/actions` (inviteMember, resendInvite — see decision)
- `_dashboard/sample-data-action` (seedSampleData)
- `src/app/api/linkedin/ingest/route.ts`: `isOrgEntitled(orgId)` AFTER bearer-auth + org resolution, BEFORE any write/enqueue → 402 `{ ok:false, error:'subscription_inactive' }`.

### Files deliberately NOT gated (and why)
- **Read-only pollers / search:** `campaigns/new/progress-actions.ts` (getCampaignProgress, getRecipientStatuses), `clients/[id]/outreach-actions::getLatestOutreachDraftAction`, `jobs/[id]/actions::searchCandidatesAction`, `campaigns/new/actions::previewCampaignAction` — no writes, no AI spend; gating them would needlessly break read surfaces.
- **Billing/auth/admin/feedback/util (DO-NOT-GATE list):** `/api/stripe/*`, `stripe/return/actions.ts`, `admin/actions.ts`, `_actions/submit-feedback.ts`, auth/sign-out, `src/lib/branding/colours.ts` — untouched. A gated org MUST be able to pay/manage billing.
- **`settings/integrations/outlook-actions::disconnectOutlookAction`** — NOT gated (DECISION below): teardown/cleanup, no spend. Only the *connect* action (`startOutlookOAuth`, which enables paid outreach) is gated.
- **`settings/team/actions::revokeInviteAction`** — NOT gated (DECISION below): pure cleanup delete, no seat consumption, no email. `inviteMember` (seats + email) and `resendInvite` (email) ARE gated.

## Task 3 — public apply AI gate
`src/app/(public)/apply/[orgSlug]/actions.ts::confirmApplyAction`: candidate + CV + consent are still created/stored for ANY org. Before firing the `cv/uploaded` Inngest event (which drives Haiku parse + the Voyage embed chain that bypasses `checkCap`), it now checks `isOrgEntitled(args.organizationId)`; if not entitled it adds a Sentry breadcrumb and returns `ok:true` (success page) WITHOUT enqueuing — closing the Voyage path. The Claude path is also backstopped by Task 1's `checkCap` deny. **Tests:** updated the M-8 inngest-fallback test to mock `isOrgEntitled=true` (so it still exercises the enqueue/failure path); new `confirm-action-entitlement-skip.test.ts` asserts candidate kept + `inngest.send` never called when not entitled.

## Deny/allow test matrix (results — all asserted GREEN)
| Surface | trialing | active | none | past_due | cancelled |
| ------- | -------- | ------ | ---- | -------- | --------- |
| `isEntitledStatus` | ✅ true | ✅ true | ❌ false | ❌ false | ❌ false |
| `isOrgEntitled` | ✅ true | ✅ true | ❌ false | ❌ false | ❌ false |
| `requireEntitledOrg` | ✅ ok:true | ✅ ok:true | ⛔ not_entitled | ⛔ not_entitled | ⛔ not_entitled |
| `checkCap` (under cap) | ✅ allow/normal | ✅ allow/normal | ⛔ deny/hard | ⛔ deny/hard | ⛔ deny/hard |
| `/api/linkedin/ingest` | 200 | 200 | — | — | 402 (entitled=false → no write/enqueue) |
| public apply enqueue | enqueues | enqueues | — | — | skipped, candidate kept |

Fail-CLOSED-on-error verified: `isOrgEntitled` and `requireEntitledOrg` return not-entitled when `getEntitlement` throws. Fail-OPEN-on-error preserved: `checkCap` still returns allow/normal on a thrown `getEntitlement` (transient DB blip never blocks a paying customer's AI), and the layout keeps `entitled=true` on its catch.

## Deviations / decisions
- **[Decision — fail-closed-for-money]** `disconnectOutlookAction` and `revokeInviteAction` left UNGATED: both are teardown/cleanup with no money or seat impact; gating them would trap a lapsed org from cleaning up (worse UX, no upside). Only the spend/seat-enabling siblings (`startOutlookOAuth`, `inviteMember`, `resendInvite`) are gated. Safest fail-closed-for-money / fail-open-for-availability choice, implemented as such.
- **[Decision]** `settings/actions::updateProfileAction` (own display name/email) IS gated alongside `updateOrganizationAction`. The plan said gate "the non-billing mutations in `settings/actions`"; neither is a billing-management action (those live in checkout/portal/stripe-return), so both are gated. A non-entitled org is fully blocked from CRM mutations including profile edits; billing is reachable via the ungated `/api/stripe/*` + portal paths and the paywall screen.
- **[Decision]** `triggerHnswBuildAction` (owner-only ops gesture) gated for consistency with the "err toward gating any mutation" rule, even though it triggers index DDL rather than direct AI spend.
- **[Note — `none` route status]** `/api/linkedin/ingest` for a `none`-status org also returns 402 (isOrgEntitled=false). This is intentional and consistent with the policy — there is no `none` carve-out anywhere.
- No architectural changes; no new dependencies; no schema/migrations. All edits are additive gates that match each file's existing result-union and never crash the caller.

## Self-Check: PASSED
- `src/lib/stripe/require-entitlement.ts` — FOUND
- `src/lib/stripe/require-entitlement.test.ts` — FOUND
- `tests/unit/app/apply/confirm-action-entitlement-skip.test.ts` — FOUND
- Commits `58f07b5`, `b178f2a`, `0a4e62e` — FOUND on `main`
- typecheck 0 errors / lint 0 errors / vitest 286 passed, 0 failed — verified above
