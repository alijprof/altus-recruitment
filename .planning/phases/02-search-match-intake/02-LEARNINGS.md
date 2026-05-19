---
phase: 2
phase_name: "search-match-intake"
project: "Altus — AI-First Recruitment CRM"
generated: "2026-05-19"
status: "Functionally complete; user smoke-test backlog closed"
---

# Phase 2 — Learnings

**Captured:** 2026-05-19
**Phase status:** Functionally complete; user smoke-test backlog closed
**Related:** `01-LEARNINGS.md` (do not duplicate — referenced where applicable)

## TL;DR

1. **Service-role inserts do NOT inherit `organization_id` from the session.** The `*_set_org` BEFORE INSERT triggers call `current_organization_id()`, which returns NULL when `auth.uid()` is NULL (Inngest + apply-form path). Every service-role insert into a tenant-scoped table MUST pass `organization_id` explicitly. Cost us the apply-form P0 (commit `a12883b`).
2. **Phase 1's C1 class (cross-tenant FK guard) returned in a new shape.** This time it was a `security invoker` RPC called from service-role: RPC body had no `where organization_id = ?` filter, RLS was bypassed, top-N candidate matches leaked across orgs to Anthropic (CRITICAL C1 in REVIEW). Same lesson, second occurrence: never trust RLS as the boundary when service-role is in the call chain.
3. **The mid-phase Outlook pivot cost ~1 day of planner+research rework.** D2-15..D2-19 were locked against Gmail; the anchor uses Microsoft 365. We caught it before code shipped (Plan 4 was the only affected plan), but it invalidated the entire EMAIL-01 research section, the env var names, the OAuth library choice, the webhook auth model, and the renewal cadence. Lesson: confirm provider before discuss-phase, not during plan-phase.
4. **Next.js 16 enforces a Suspense boundary around `useSearchParams()`.** Local `pnpm build` passed; production runtime crashed `/candidates` and `/clients` after the ViewToggle landed. Fix was to make ViewToggle a Server Component receiving search params as props (commit `0df09c5`).
5. **Cost-bomb defences must guard the on-demand path too, not just the batch path.** `precomputeMatchesForJob` had a £100/month spend ceiling; `explainCandidateMatchAction` (same Sonnet model, same cost, synchronous from any recruiter click) did not (HIGH H2 in REVIEW).

## Decisions that aged well

### D2-04: Hybrid search via single RPC + RRF k=60
Encapsulating semantic + trigram fusion behind one Postgres function (`match_candidates`) meant the call sites stayed dumb and the cosine-vs-trigram ranking logic lived in one place. The empty-string degenerate path (`getTopCandidatesByVector` passes `''` so trigram CTE returns 0 rows) works exactly as predicted in VERIFICATION §6 — pure vector ranking, no surprise. Keep this pattern for Phase 3's shortlist search.

### D2-05: HNSW deferred to manual operator gesture
`bootstrap-vector-index` ships as a state-writer + Sentry signal, NOT a DDL executor. VERIFICATION M-1 flagged the `CREATE INDEX CONCURRENTLY`-in-transaction problem early and we picked Option (b) before any code ran. Sequential scan at <100 candidates is fine; the deferred path saved an entire dependency (`pg` direct connection) we didn't need.

### D2-11: Two-stage signed-upload-URL flow
Apply-form CV upload via signed-URL PUT → confirm action worked exactly as planned. Bypasses the Next.js 4.5 MiB body limit, supports the 10 MiB cap, never gives the browser service-role privileges. The M-2 explicit `storagePath.startsWith()` tenant assertion (added by VERIFICATION patch 2) was load-bearing.

### D2-16: aes-256-gcm encryption + generalised env-var name
`EMAIL_TOKEN_ENCRYPTION_KEY` (not `OUTLOOK_TOKEN_ENCRYPTION_KEY`) — the foresight to name the env var generically meant the Outlook pivot did not require an env rename. Future Gmail adapter (Phase 5) can share the same key. REVIEW called `src/lib/encryption.ts` "exemplary" — single point of crypto, validated key length, random IV per encryption, 5 unit tests for 80 lines of code.

### D2-20: `_verify_same_org_check` suffix on FK guards
Phase 1's trigger-ordering bug (`01-LEARNINGS.md` — alphabetical sort is load-bearing) was respected. `ai_summaries_verify_same_org_check` sorts after `ai_summaries_set_org`. No trigger-order regression in Phase 2. Keep the naming convention in Phase 3.

### Plan 0 hardening before feature work (carried from Phase 1)
Same pattern as Phase 1: Plan 0 lands env validation, types, migrations, db helpers, Voyage wrapper, match wrapper, public layout, middleware, encryption helper. Plans 1–4 had a complete foundation to build on. Wave layout `0 → 1 → 2 || 3 || 4` cut wall-clock substantially.

## Decisions that needed revision

### D2-15..D2-19: Gmail → Outlook (mid-phase pivot)
**Trigger:** Anchor agency runs Microsoft 365, not Google Workspace. Realised during planning of Plan 4, before any Gmail code shipped.
**Fix:** `02-RESEARCH-OUTLOOK.md` written from scratch; D2-15..D2-19 re-locked under the same numbers but with Outlook semantics; `02-04-outlook-integration-PLAN.md` fully rewritten. VERIFICATION ran against Gmail-named findings (M-3 Pub/Sub, M-6 GMAIL_TOKEN_ENCRYPTION_KEY, M-7 daily renewal, W-4 callback middleware) — each was translated 1:1 to its Outlook equivalent in the rewritten plan.
**Key divergences that bit:** subscription cap is 4230 min (~3 days) not 7 days; webhook auth is `clientState` not signed JWT; refresh tokens rotate sliding-90-days; synchronous `validationToken` handshake on every subscription create AND renewal; admin consent + Conditional Access are real failure modes (see `02-RESEARCH-OUTLOOK.md` §summary).
**Lesson for Phase 3:** Lock provider-specific assumptions in discuss-phase, not after plan-phase. The anchor's tooling answer is a discuss-phase question even when it sounds like an implementation detail.

### D2-11 storage path layout: `<org>/applicants/<candidate>-<uuid>` vs `<org>/<candidate>/`
**Trigger:** `parse-cv` Inngest function (Phase 1) enforced `storage_path` starting with `<org>/<candidate>/` as the cross-tenant guard. Apply-form deliberately wrote `<org>/applicants/<candidate>-<uuid>.ext` so retention policies could be separated later. Every apply-form CV failed the tenant check, was marked `failed`, and the retry button just re-failed (commit `04fc69b`).
**Fix:** `parse-cv` now accepts both layouts. Both still bind `org_id` AND `candidate_id` into the path, so the guard remains effective.
**Lesson:** When a Phase 1 path-layout invariant is reused by a Phase 2 callsite with different conventions, audit the invariant guard at both call sites in the same commit. The guard was correct; the second callsite was unaware of it.

### D2-08: "structured-summary-only" → 2k chars CV + 4k chars JD added
**Trigger:** CONTEXT wording said "no raw CV / JD body". Plan 2 T2.1 step 3 added small CV + JD snippets back in for match quality.
**Fix:** Documented in VERIFICATION §B as W-3 "addition, not reduction". Cost stayed bounded.
**Lesson:** If the matched output quality is "the primary differentiator in the demo" (per CONTEXT specifics), context tradeoffs against cost may need to land on the input-quality side. Document the deviation rather than silently letting it drift.

### D2-21: Type regen ("early in Phase 2")
**Trigger:** Phase 1 ended with `as unknown as ...` defensive casts and `// reason: pending regen`. Plan 0 of Phase 2 attempted `--linked`; the Supabase CLI version mismatch from Phase 1 (`01-LEARNINGS.md`) was not resolved. Multiple rounds of regen across the phase as new migrations landed.
**Fix:** Lived with intermittent regen failures; some Phase 2 helpers still have casts.
**Lesson:** Type regen path needs CI or a make-target run *before* any plan touches new tables, not "in Plan 0". Phase 3 should add a `pnpm db:types:verify` smoke test that fails fast if the generated file is out of sync.

## Recurring bug classes (avoid in Phase 3)

### 1. Service-role inserts + organization_id trigger (apply-form P0)
**Root cause:** `candidates_set_org`, `candidate_cvs_set_org`, `activities_set_org` BEFORE INSERT triggers call `current_organization_id()` which selects from `public.users where id = auth.uid()`. Under service-role there is no `auth.uid()` → trigger raises `"organization_id is required and could not be resolved from auth context"`.
**Where it landed:** `submitApplyAction` created the `candidates` row (because `createCandidate` already accepted an explicit `organization_id`), but `createCandidateCV` and `createActivity` did NOT — they relied on the trigger. Insert failed silently, user saw "Something went wrong."
**Fix shape:** `createCandidateCV` and `createActivity` extended to accept optional `organizationId`; apply-form passes `org.id` explicitly. Commit `a12883b`.
**Prevent in future:** Grep test — every Inngest function and every unauthenticated server action that does service-role inserts must pass `organization_id` to the helper. Helpers should accept the param but make it OPTIONAL so authenticated callers (where `auth.uid()` is set) stay unchanged.
**Also added:** Sentry breadcrumbs at every silent failure point — `createCandidate`, `nextCVVersion`, `createCandidateCV`. Opaque "Something went wrong" is unacceptable in production.

### 2. Service-role + `security invoker` RPC = silent cross-tenant RLS bypass (REVIEW C1)
**Root cause:** Service-role bypasses RLS. `security invoker` RPCs that read `from public.candidates` with no explicit `where organization_id = ?` filter return rows across ALL orgs when called under service-role. This is **the same class of bug as Phase 1's C1** (cross-tenant FK guard missing on `candidate_cvs`) — executors validated the calling JOB's org but trusted the candidate-side RPC to RLS-filter.
**Where it landed:** `match_candidates_for_job` → `match_candidates`. Top-10 vector matches returned from across the whole database; Sonnet was called with foreign-org candidate CV summaries; the requesting org's `ai_usage` ledger absorbed the cost; only the upsert silently failed (caught by `ai_summaries_set_org` trigger raising NULL org).
**Fix shape:** Migration `20260519130000_match_candidates_for_job_org_filter.sql` added `p_organization_id` arg + injected `where c.organization_id = p_organization_id` in both CTEs. Caller-side fence in `precompute-matches-for-job.ts` for defence-in-depth.
**Prevent in future:** Every `security invoker` RPC called from any code path that may run under service-role MUST take an `organization_id` arg and filter by it explicitly. Add to plan-checker: "for every new RPC, does it have a `p_organization_id uuid` argument? If not, who calls it under service-role?"

### 3. Next.js 16 `useSearchParams()` without Suspense boundary
**Root cause:** Next.js 16 hard-enforces a Suspense boundary around `useSearchParams()` (Phase 1's Next.js 15 was looser). Local `pnpm build` passed because the route's static prerender hit a different code path; production runtime crashed.
**Where it landed:** `<ViewToggle>` Client Component on `/candidates` and `/clients`. Crash blanked the entire page.
**Fix shape:** Make `ViewToggle` a Server Component that receives `basePath + current view + other URL params` as props. The pages already parse the search params anyway — passing them down is cheaper than re-reading from the client. Commit `0df09c5`.
**Prevent in future:** Default to Server Components for any URL-param-reading component. `'use client' + useSearchParams()` should require an explicit reason. Grep test in code-reviewer prompt: any `useSearchParams()` must be inside a `<Suspense>` boundary OR the component must be in the `(app)` route group with a parent Suspense.

### 4. Voyage SDK ESM build break (require workaround)
**Root cause:** `voyageai` npm package ships ESM-only; Next.js 16's bundler trips on it during the server build.
**Where it landed:** Plan 0 type-check / build verification.
**Fix shape:** `next.config.ts` `serverExternalPackages: ['voyageai']` to mark it as external (not bundled).
**Prevent in future:** When adding a new AI/integration SDK, do a quick `pnpm build` against a smoke import before plan-phase locks in the dependency. ESM-only packages need `serverExternalPackages` more often than not.

### 5. Inngest env vars defaulted to Preview-only scope in Vercel
**Root cause:** Vercel env vars default to "Preview + Development". `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` were added without selecting "Production". Production Inngest received no events.
**Where it landed:** Apply-form CV uploads created candidate rows but never fired `cv/uploaded` → no parse, no embed, no match scoring. Looked like a silent CV-parser bug; was a missing env var scope.
**Fix shape:** Re-add envs with Production scope ticked.
**Prevent in future:** Vercel env var checklist in `docs/outlook-integration-setup.md`-style runbook for every Phase: "all envs in this list must have Production scope". Vercel CLI `vercel env ls production` is the verification step.

### 6. Outlook subscription `clientState` defence holes
**Root cause:** `subscription_client_state` column is NULLABLE in the migration. Renewal path uses `cred.subscription_client_state ?? ''` and writes `''` back if the original was null. Webhook validator compares `n.clientState === cred.subscription_client_state` — a forged notification with `clientState: ''` matches.
**Where it landed:** Detected by REVIEW H1, not by smoke test (this requires a corrupted-row precondition).
**Fix shape:** (a) Refuse to renew when `subscription_client_state IS NULL` — schedule a recreate instead. (b) In the webhook, reject empty clientState explicitly: `n.clientState.length > 0 && cred.subscription_client_state && ...`.
**Prevent in future:** When a column is the SOLE auth signal for a webhook, it must be `NOT NULL` at the schema level OR fail-closed at every consumer. Defence-in-depth, both layers.

### 7. HNSW build privilege escalation (any auth'd user → global DDL trigger)
**Root cause:** `triggerHnswBuildAction` checked `user` but not `me.role === 'owner'`. HNSW build is a one-shot global gesture (per D2-05); any recruiter in any tenant could fire it.
**Where it landed:** REVIEW H3.
**Fix shape:** Mirror `toggleApplyFormEnabledAction`'s role check. Gate the UI in `IntegrationsPage` so non-owners don't see the button.
**Prevent in future:** Convention drift — the role-check pattern existed in one server action but not the new ones. Code-reviewer prompt: "for every new server action that triggers an Inngest event with global side effects, does it check `me.role === 'owner'`?"

### 8. `.ilike(email, ...)` wildcard injection on Outlook sync
**Root cause:** `findCandidateByEmail` used `.ilike('email', normalised)`. Email local-parts can legally contain `_` (e.g. `john_doe@x.com`) — interpreted as a single-char wildcard. False-positive attribution risk inside the org.
**Where it landed:** REVIEW M1, not surfaced by smoke test.
**Fix shape:** Escape wildcards OR lowercase emails at write-time and use `.eq()` with `lower()` (preferable). Pair with a future `unique (organization_id, lower(email))` index.
**Prevent in future:** Default to `.eq()` for exact-match lookups. `.ilike()` only with explicit escaping. Phase 3's LinkedIn capture path will hit this same surface.

## Tooling + workflow notes

### What worked
- **`gsd-code-reviewer` is now a non-negotiable gate, again.** Just like Phase 1 (which surfaced C1), Phase 2 review surfaced another CRITICAL — different mechanism, same class. Without the review pass the cross-tenant Sonnet leak would have shipped. Budget review time into every phase.
- **Pattern-mapper agent saved propagation cost.** `02-PATTERNS.md` (55 KB) captured the file-by-file conventions Phase 1 settled on. Plan 0 reused them mechanically.
- **Plan-checker caught BLOCKERs again.** VERIFICATION found 3 BLOCKER + 4 WARNING; all applied inline before execution. Same value as Phase 1.
- **Wave-based parallel execution.** Plans 3 + 4 ran in parallel after Plan 0, no conflicts. The "files-you-own" briefing prevented the Phase 1 near-collision.
- **Per-tenant cost dashboard at `/settings/usage`.** User feedback called this out specifically as a strength. The non-negotiable `record_ai_usage` write paid off — recruiter can see live spend.

### What hurt
- **The Outlook pivot at planning time.** Cost roughly a day of research + re-planning. Compounded by the fact that VERIFICATION ran against the Gmail plan, and we had to mentally translate each finding to its Outlook equivalent.
- **Multiple rounds of type regen.** Phase 1 lesson said "test the regen path early"; Phase 2 didn't. By end-of-phase the generated `src/types/database.ts` was several migrations stale.
- **Smoke-test feedback lag.** REVIEW caught H1/H2/H3 the same day Phase 2 finished, but the apply-form P0 was only caught when the user actually filled out the form on production. Production smoke-test must include the apply-form happy path before declaring functional completion.
- **Migration ordering implied but not enforced.** VERIFICATION W-2 flagged that Plan 0 created six migrations in implied creation-order, with no documented ordering dependency. None of the migrations had inter-dependencies, but the pattern is fragile.

## Cost + observability

### Costs
- Voyage embedding: ~£0.005 per CV embed, ~£0.001 per JD embed. Cheap.
- Sonnet match scoring: ~0.7p per match (per D2-08 input cap). Top-10 precompute on job-create = ~7p per job.
- Synchronous `explainCandidateMatchAction` (H2): same Sonnet cost, no rate limit, no spend ceiling. The £100/month ceiling is a precompute-side defence only — a single recruiter can blow it from the UI.

### Observability surprises
- **`ai_usage` ledger poisoned by cross-tenant matches (C1).** Org A's `cost_pence` accumulated for Sonnet calls over org B's candidates. The cost ledger is now untrustworthy for any history before the C1 fix migration. Phase 3 should consider a one-off rebuild script if pricing decisions depend on Phase 2 data.
- **Cron functions lacked `TZ=Europe/London` consistently.** `refresh-outlook-subscription` defaulted to UTC (REVIEW M7). Phase 1 was always TZ-explicit. Add to plan-checker.
- **Sentry PII discipline drift in db helpers.** REVIEW M6: db helpers in `src/lib/db/*` passed raw Supabase errors to `Sentry.captureException` without `formatErrorForSentry` wrapping. Phase 1 R4 said "lift name + status only". Pattern drift between Inngest functions (which DID use the wrapper) and db helpers (which didn't). Fix is to extend `beforeSend` to scrub `event.exception.values[*].value` globally — covers everything in one pass.

## Open items deferred from Phase 2

Tracked here so Phase 3 / Phase 5 don't lose them:

- **REVIEW M1 + M2 + L5: lowercase email storage + `unique (organization_id, lower(email))` index.** Phase 3 migration. Closes wildcard injection + duplicate-candidate from the apply form.
- **REVIEW M5: `cleanup-stale-summaries` needs pagination + per-org cap.** Works at anchor scale (<1k); breaks at SaaS scale. Phase 5 SaaS shell.
- **REVIEW M6: extend Sentry `beforeSend` to scrub `event.exception.values[*].value`.** One-pass fix for all db-helper PII drift.
- **REVIEW L2: orphan storage object cleanup.** Apply-form PUT succeeds → confirm fails → storage file is orphaned. No retention policy yet.
- **REVIEW L6: dev-bypass Turnstile button in production.** Server-side env validation should require `NEXT_PUBLIC_TURNSTILE_SITE_KEY` when `NODE_ENV === 'production'`.
- **REVIEW H2 follow-up: per-user rate limit on `explainCandidateMatchAction`.** Spend ceiling guard is the minimum; per-user idempotency window would also remove the W-1 synchronous-Sonnet exception.
- **Type regen pipeline.** Add CI step or `pnpm db:types:verify` that fails when generated types are stale.
- **HNSW first build.** Manual operator gesture once anchor accumulates ≥100 candidates per org. Bootstrap function ready; DDL not yet executed.
- **Outlook OAuth callback L8: `Location` header on 400 response.** Cosmetic but inherits a redirect that the browser ignores. Strip or redirect to a dedicated CSRF error page.
- **EMAIL_TOKEN_ENCRYPTION_KEY rotation procedure.** Documented as deferred to Phase 5 SaaS shell; manual procedure should land in `docs/outlook-integration-setup.md` before that.
- **Gmail provider adapter.** Phase 5 SaaS shell. `outlook_credentials` table + `src/lib/integrations/outlook.ts` may be generalised at that point.
- **From `.planning/phases/02-search-match-intake/deferred-items.md`:** sync-outlook-history lint warnings (3 unused eslint-disable directives), out-of-scope apply-form typecheck errors from Plan 2 (now resolved in Plan 3), out-of-scope rate-limit test failures (now resolved).
- **Security rotation calendar reminder:** Outlook client secret expires 2028-04-15 (24-month Azure ceiling). Logged in `.planning/SECURITY-ROTATION-LOG.md` (commit `062d09d`).

## Cross-references

### Commits
- `a12883b` — fix(apply): pass org_id explicitly to service-role inserts
- `04fc69b` — fix(parse-cv): accept apply-form storage path layout
- `0df09c5` — fix(ui): make ViewToggle a Server Component
- `8c7a5ab` — feat(ui): list/cards toggle + full-bleed pipeline (P2 backlog)
- `215d3a7` — feat(candidates): inline applications + stage change (P1 backlog)
- `cfdd175` — feat(branding): Altus Recruit lockup
- `062d09d` — docs(security): mass secret rotation log

### Key files for Phase 3 reference
- `src/lib/db/candidates.ts` — service-role-aware inserts; case-sensitivity TBD
- `src/lib/db/candidate-cvs.ts` — explicit organizationId pattern (apply-form fix)
- `src/lib/db/activities.ts` — explicit organizationId pattern (apply-form fix)
- `src/lib/inngest/functions/parse-cv.ts` — dual storage path layout acceptance
- `src/lib/inngest/functions/precompute-matches-for-job.ts` — REVIEW C1 fixed; caller-side fence pattern
- `supabase/migrations/20260519130000_match_candidates_for_job_org_filter.sql` — RPC org-filter retrofit
- `supabase/migrations/20260519092945_outlook_credentials.sql` — `subscription_client_state` is nullable; defence-in-depth in webhook + renewal paths
- `src/components/app/view-toggle.tsx` — Server Component pattern for URL-param-reading UI
- `next.config.ts` — `serverExternalPackages: ['voyageai']`

### Planning artifacts
- `02-CONTEXT.md` — D2-01..D2-22 (D2-15..D2-19 superseded by Outlook variants)
- `02-RESEARCH.md` — original (Gmail-flavoured); D.15–D.24 superseded
- `02-RESEARCH-OUTLOOK.md` — Outlook supplement, REPLACES D.15–D.24
- `02-REVIEW.md` — 1 CRITICAL + 3 HIGH + 7 MEDIUM + 8 LOW findings
- `02-USER-FEEDBACK.md` — smoke-test backlog (P0 apply-form + P1/P2/P3 polish)
- `02-VERIFICATION.md` — 3 BLOCKER + 5 WARNING patches applied inline pre-execution
- `02-PATTERNS.md` — file-by-file conventions propagated from Phase 1
- `.planning/SECURITY-ROTATION-LOG.md` — 2026-05-19 mass secret rotation

### Phase 1 lessons re-validated this phase (do not re-document)
- Cross-tenant FK guard pattern (`01-LEARNINGS.md` Lesson: "Cross-tenant FK guards must extend to ALL tenant-scoped tables") — repeated in REVIEW C1 via a different mechanism (RPC vs FK).
- Plan-checker as load-bearing gate — same value, same week.
- Service-role usage only in Inngest + invite paths — Phase 2 added `submitApplyAction` as a third legitimate caller; the pattern's intent (explicit tenant boundary check) still holds.
- Sentry wizard's Next.js 16 quirks — no new findings.
- `pnpm db:types` regen path fragility — same problem, not resolved.
