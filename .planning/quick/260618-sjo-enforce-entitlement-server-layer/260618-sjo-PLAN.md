---
quick_id: 260618-sjo
slug: enforce-entitlement-server-layer
title: Enforce subscription entitlement at the data/action layer (audit blockers 1 & 2 + public-apply AI gate)
status: ready
date: 2026-06-18
must_haves:
  truths:
    - A lapsed/cancelled/past_due/none org can NO LONGER perform CRM mutations by calling server actions or the authed /api/linkedin/ingest route directly — they are blocked server-side, not just hidden in the browser.
    - A non-entitled org can NO LONGER drive Anthropic/Voyage/OpenAI spend — checkCap denies all Claude purposes when status ∉ {trialing, active}, and the public apply form no longer enqueues CV parse/embed for non-entitled orgs.
    - The entitlement policy used everywhere matches the existing layout EXACTLY — entitled ⟺ status ∈ {trialing, active}. Grandfathered comp orgs (status 'active', null stripe ids) stay fully entitled. New orgs still onboard because checkout creates a 'trialing' row before the dashboard loads.
    - checkCap still FAILS OPEN on a transient getEntitlement error (never blocks a paying customer's AI on a DB blip) but now FAILS CLOSED on a definitive non-entitled status. The layout's empty fail-open catch now logs to Sentry (audit rank 22).
    - typecheck, lint, and the full vitest suite pass; new tests cover the deny/allow matrix.
  artifacts:
    - src/lib/stripe/require-entitlement.ts (new gate helper)
    - src/lib/stripe/cap-enforcement.ts (status-aware deny)
    - src/app/(app)/layout.tsx (Sentry on fail-open catch)
    - ~25 mutating server-action files + src/app/api/linkedin/ingest/route.ts (gated)
    - src/app/(public)/apply/[orgSlug]/actions.ts (skip AI enqueue when not entitled)
    - tests under src/lib/stripe/
  key_links:
    - src/lib/stripe/entitlement.ts (getEntitlement — reused for status)
    - src/lib/ai/claude.ts (runWithLogging → checkCap, covers all Claude purposes)
---

# Quick Task 260618-sjo — Enforce entitlement at the data/action layer

Fixes pre-launch audit BLOCKERS 1 & 2 and the completeness-critic public-apply AI-spend gap. Full audit: `.planning/audits/PRE-LAUNCH-AUDIT-2026-06-18.md`.

## Problem
Entitlement is enforced ONLY in `src/app/(app)/layout.tsx` (renders `PaywallScreen` instead of the page). Server actions are independently-callable POST endpoints and the authed `/api/linkedin/ingest` route is reachable directly, so a lapsed/cancelled/past_due/none org keeps full CRM + AI access by bypassing the rendered paywall. Separately, `checkCap` and `getEntitlement` never inspect subscription status, so non-paying orgs burn paid AI keys to the monthly cap; `checkCap` also fails OPEN on error. Voyage embeds bypass `checkCap` entirely, and the public apply form drives parse+embed AI spend with no entitlement check.

## Entitlement policy (AUTHORITATIVE — match the layout exactly)
`entitled ⟺ getEntitlement(orgId).status ∈ {'trialing','active'}`.
- Everything else — `none`, `past_due`, `canceled`/`cancelled`, `incomplete`, `unpaid`, `paused`, etc. — is NOT entitled.
- There is NO special carve-out for status `none`: the layout already gates `none` (card-first), so a legitimately-onboarding org is `trialing` (entitled) by the time it can reach any action. Do not add a `none` exception — it would re-open the leak.
- `getEntitlement` already honours `trial_end_override` (admin trial extensions) — reuse it so the gate inherits that logic identically.

## Tasks

### Task 1 — Gate helper + status-aware checkCap + layout Sentry (+ tests)
**Files:** `src/lib/stripe/require-entitlement.ts` (new), `src/lib/stripe/cap-enforcement.ts`, `src/app/(app)/layout.tsx`, new/extended tests in `src/lib/stripe/`.

1. New `src/lib/stripe/require-entitlement.ts` (`import 'server-only'`):
   - `export const ENTITLED_STATUSES = ['trialing', 'active'] as const` and a helper `isEntitledStatus(status): boolean`.
   - `export async function isOrgEntitled(orgId: string): Promise<boolean>` → `isEntitledStatus((await getEntitlement(orgId)).status)`. (Reuse `getEntitlement` so status semantics incl. `trial_end_override` are identical. Perf is acceptable on mutation paths.)
   - `export type EntitlementGate = { ok: true; userId: string; orgId: string; status: EntitlementStatus['status'] } | { ok: false; reason: 'unauthenticated' | 'not_entitled'; status?: EntitlementStatus['status'] }`
   - `export async function requireEntitledOrg(): Promise<EntitlementGate>` → `createClient()` → `getUser()` (return `{ok:false,reason:'unauthenticated'}` if no user) → `getProfile(supabase, user.id)` for `organization_id` (treat profile miss as `unauthenticated`) → `getEntitlement(orgId)` → return `ok:true` iff status entitled, else `{ok:false, reason:'not_entitled', status}`. On any thrown error during resolution, FAIL CLOSED here (return `not_entitled`) BUT capture to Sentry — a mutation gate erring should not silently grant; this differs from checkCap on purpose (a blocked mutation is recoverable; burning nothing is safe).
   - `export const ENTITLEMENT_BLOCKED_MESSAGE = 'Your subscription is inactive. Please update your billing in Settings → Billing to continue.'`
2. `cap-enforcement.ts` `checkCap`: after the successful `getEntitlement`, BEFORE the cap-ratio math, add: if `!isEntitledStatus(entitlement.status)` → `return { allow: false, mode: 'hard', bucket }`. Keep the existing `catch` → fail-OPEN-on-error behaviour (do NOT change error handling; a transient DB error must not block paying customers' AI). Add a one-line comment explaining the open-on-error / closed-on-definitive-status split. Import the helper from `require-entitlement`.
3. `layout.tsx`: replace the empty `} catch {` body with a `Sentry.captureException(err, { tags: { layer: 'billing', helper: 'AppLayout', step: 'getEntitlement' } })` (import `* as Sentry from '@sentry/nextjs'`). KEEP the fail-open defaults (`entitled = true`) — page access for paying customers must survive a billing blip; we only add observability (audit rank 22).
4. Tests: new `require-entitlement.test.ts` (mock getEntitlement; assert isOrgEntitled true for trialing/active, false for none/past_due/canceled). Extend `cap-enforcement.test.ts`: assert `checkCap` returns `{allow:false,mode:'hard'}` for a capped purpose when status is none/past_due/canceled, and still allows trialing/active under cap. Keep existing tests green.

### Task 2 — Apply the gate to every mutating server action + the authed LinkedIn route
**Files:** the mutating `actions.ts` files under `src/app/(app)/**` + `src/app/api/linkedin/ingest/route.ts`.

For EACH exported async server action that CREATES, UPDATES, DELETES CRM/domain data OR triggers AI: call `requireEntitledOrg()` as the first statement after input validation; on `!ok`, return the action's OWN error shape carrying `ENTITLEMENT_BLOCKED_MESSAGE` (match each file's result union — e.g. `{ ok: false, formError: ENTITLEMENT_BLOCKED_MESSAGE }`, or `{ ok:false, error: ... }`, or for `void`/redirect actions, `redirect('/settings/billing')` or throw a clear Error). Read each file and match its convention exactly — do not crash the caller.

**GATE these** (verify exports per file; gate the mutating/AI ones):
`candidates/new`, `candidates/[id]` (incl. delete), `candidates/[id]/edit`, `candidates/[id]/floats`, `candidates/[id]/shortlist-actions`, `candidates/[id]/voice-notes`, `candidates/import`, `clients/new`, `clients/[id]`, `clients/[id]/jobs/new`, `clients/[id]/outreach-actions`, `jobs/new`, `jobs/[id]`, `jobs/[id]/ad-panel`, `jobs/[id]/matches` (the mutating/score-trigger exports), `jobs/[id]/shortlist`, `spec/new`, `spec/actions`, `spec/[id]/review`, `campaigns/new/actions` (NOT the read-only progress poller), `reports/nl/actions`, `settings/apply-form-actions`, `settings/branding/actions`, `settings/integrations/actions`, `settings/integrations/outlook-actions`, `settings/team/actions`, `_dashboard/sample-data-action`, and the NON-billing mutations in `settings/actions`.
`/api/linkedin/ingest/route.ts`: after it resolves the bearer-token user → org, add `if (!(await isOrgEntitled(orgId))) return 402/403 JSON`. Place it AFTER auth, BEFORE any DB write or Inngest enqueue.

**DO NOT gate** (must stay reachable for non-entitled orgs / are out of scope):
- Anything billing/subscription: `/api/stripe/checkout`, `/api/stripe/portal`, `stripe/return/actions.ts`, and any billing-management action in `settings/actions.ts` (a gated user MUST be able to pay/manage billing).
- `admin/actions.ts` (super-admin tooling — gated by `requireSuperAdmin`; must work regardless of the admin's own org billing).
- `_actions/submit-feedback.ts` (good-will, no AI, no PII risk).
- Auth/sign-out, and read-only actions (e.g. `campaigns/new/progress-actions.ts` if it only polls).
- `src/lib/branding/colours.ts` (utility, not a user action).

If unsure whether an export mutates, read it; when genuinely read-only, leave it. Err toward gating any create/update/delete or AI-spend path.

### Task 3 — Public apply form: gate the AI spend (not the application itself)
**File:** `src/app/(public)/apply/[orgSlug]/actions.ts`.
The public apply form must STILL create the candidate + record consent for any org (applications are not a paid feature for the applicant). But it must NOT spend AI for a non-entitled org. Before enqueuing the CV-parse / embed Inngest event(s), check `isOrgEntitled(orgId)`; if not entitled, SKIP the AI enqueue (leave the candidate + CV stored, no parse/embed) and add a short comment + Sentry breadcrumb. This closes the Voyage path (which bypasses `checkCap`); the Claude path is also covered by Task 1's `checkCap` deny as a backstop.

## Verification
- `pnpm typecheck` clean, `pnpm lint` clean, `pnpm exec vitest run` all green (incl. new tests).
- Reason through: a `trialing`/`active`/comp org is unaffected (all actions, AI, apply work). A `none`/`past_due`/`canceled` org: every gated action returns the blocked message, all Claude/Voyage spend is denied, the public apply still creates the candidate but enqueues no AI. Onboarding (trialing) still seeds sample data + imports CSV.
- Commit atomically per task. Do NOT commit .planning docs (orchestrator handles that). Do NOT touch ROADMAP.md.
