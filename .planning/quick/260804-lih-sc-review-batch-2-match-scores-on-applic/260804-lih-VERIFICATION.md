---
phase: quick/260804-lih
verified: 2026-08-04T16:24:07Z
status: human_needed
score: 9/9 must-have truths verified (code-level); 5/5 artifacts; 5/5 key links
overrides_applied: 0
human_verification:
  - test: "Add a candidate to a job in the live app (any of the four create-application paths), wait for the Inngest job to complete, then reload the job's applications page, the desktop pipeline kanban, and the mobile pipeline view."
    expected: "A match-score badge (0-100, coloured by tone) appears in the Match column on the applications table, on the pipeline card's bottom row, and on the mobile accordion row — all three surfaces show the same score and the same one-line note on hover/title."
    why_human: "The scoring path runs asynchronously through Inngest and calls the real Anthropic Sonnet API; only a live run against a real candidate/job pair with real embeddings proves the end-to-end chain (event fired -> tenant verified -> profile non-empty -> Sonnet scored -> ai_summaries written -> enrichment read -> badge rendered) actually completes, not just that each link is individually wired in source."
  - test: "Re-fire the same add-to-job action a second time (or trigger a rapid double-click) for the identical candidate x job pair."
    expected: "No second Sonnet call is billed (ai_usage shows one match_score row for the pair), no second ai_summaries row is written, and no Sentry exception fires."
    why_human: "This is the idempotency/concurrency contract (T-lih-02, audit SF-3's '07-07 double-fire') and can only be confirmed by observing real ai_usage/ai_summaries rows and a live Sentry project, not by reading the code."
  - test: "Add a candidate with an effectively-empty profile (no skills, no role, no summary) to a job."
    expected: "No match-score badge ever appears for that pair, no Sonnet spend is logged, and a Sentry breadcrumb (not an exception) is recorded."
    why_human: "Requires a real candidate row and a live Inngest execution to confirm the empty-profile skip fires end-to-end rather than just existing as a code branch."
  - test: "Run a `/search` query in semantic mode and in trigram mode (`?mode=trigram`) as a real signed-in user, then a `/candidates?q=...` search."
    expected: "Each render writes exactly one `audit_log` row with the correct `mode`/`semantic_ok`/`result_count`/`surface`, and the raw query text is never present in the row anywhere (including nested inside `metadata`)."
    why_human: "`record_audit` is a live RPC against the database and depends on `current_organization_id()` resolving from a real authenticated session — this cannot be exercised without a running app + real session."
  - test: "Open a job detail page and a client detail page as a signed-in recruiter, then have a super-admin hit `/admin/[orgId]/export`."
    expected: "A `view` audit row appears for the job and for the company (client), and an `export` audit row appears attributed to the EXPORTED org's id (not the super-admin's own org)."
    why_human: "Confirms the cross-org attribution behaviour (the one deliberately-different audit path) against a real multi-org fixture, which is not observable from source alone."
  - test: "Trigger a real Stripe webhook event via the Stripe CLI (`stripe trigger customer.subscription.updated`) against the deployed route, then simulate a handler failure (e.g. temporarily point at an org id that will 500) and confirm Stripe's retry re-processes it."
    expected: "First delivery: ledger row goes received -> processed with a `processed_at`. Failure case: ledger row goes received -> error with a name+event-type-only `error_detail`, HTTP 500 returned, and Stripe's automatic retry re-drives the SAME event to completion (not silently dropped)."
    why_human: "SECURITY INVARIANT 4 (T-lih-06) is the highest-consequence contract in this batch — a regression here silently loses a paid customer's subscription. Unit tests mock the ledger client; only a real Stripe CLI round-trip against the deployed route proves Stripe's retry semantics interact correctly with the new short-circuit condition."
  - test: "Load any page after deploy and check the Vercel Analytics dashboard for incoming pageview events."
    expected: "Pageviews appear in the Vercel project's Analytics tab within a few minutes."
    why_human: "`<Analytics />` rendering in the tree is confirmed by source, but whether it actually reports to Vercel's collector requires a live deployed instance."
---

# Phase quick/260804-lih Verification Report

**Phase Goal:** SC review batch 2 — match scores generated on every application-create path with
idempotency + empty-profile skip + display on applications table and BOTH pipeline surfaces
(desktop card + mobile list); search telemetry (`record_audit` in all 3 `/search` branches +
`/candidates?q`, metadata mode/semantic_ok/result_count, never the raw query); `set_created_by`
trigger migration + `owner_user_id` stamping; job/client detail-view audits + service-audit on
admin export; Stripe webhook status ledger (received/processed/error) that degrades
pre-migration and NEVER dedupes a failed event away; `@vercel/analytics` in root layout.

**Verified:** 2026-08-04T16:24:07Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All 9 must-have truths, all 5 declared artifacts, and all 5 declared key links pass full
static/mechanical verification (source-read, automated grep re-run, typecheck, lint, targeted
+ full test suite, dummy-env build). Nothing that touches an external service (Anthropic
Sonnet, Voyage, Stripe, Vercel Analytics collector) or depends on a live authenticated session
can be proven end-to-end from source alone — those items are listed under Human Verification
below and match the plan's own `<verification>` block, which explicitly states this browser
pre-smoke had not yet been run at SUMMARY time. Per HARD RULE #1 (global CLAUDE.md), that
pre-smoke must be run before any human UAT.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Adding a candidate to a job produces a cached `match_score` row in `ai_summaries` for that exact candidate x job pair | VERIFIED (code-complete) | `addCandidateToJobAction` (`src/app/(app)/jobs/[id]/actions.ts:82-88`) fires `enqueueApplicationMatchScore` after a successful `createApplication`, sending `application/score-match`; `score-application-match.ts` step 4 calls `upsertMatchSummary` with `kind: 'match_score'`. Unique constraint on `ai_summaries` confirmed pre-existing in `20260519092944_ai_summaries.sql:56`. Runtime completion (real Sonnet call succeeding) needs a live run — see Human Verification #1. |
| 2 | Re-firing the same application-create path does not produce a second Sonnet call or a second summary row | VERIFIED | Idempotency guard: `getMatchSummary` cache-lookup before spend (`score-application-match.ts:171-182`); DB-level backstop: pre-existing unique constraint + `upsertMatchSummary`'s `23505` -> `{ok:false, code:'duplicate'}` with NO `Sentry.captureException` (`src/lib/db/ai-summaries.ts:162-174`), covered by `match-score-enrichment.test.ts` (2 passing cases). |
| 3 | A candidate whose profile is effectively empty is never match-scored | VERIFIED | `score-application-match.ts:159-167` calls `isProfileEffectivelyEmpty(verified.candidate)` (imported unmodified from Batch 1's `src/lib/ai/profile-completeness.ts`) BEFORE the cache-lookup or any spend, returns `{skipped:'empty-profile'}` with a Sentry breadcrumb (not exception). |
| 4 | The recruiter sees the match score on the job's applications table and on BOTH pipeline surfaces (desktop card and mobile list) | VERIFIED | `applications-list.tsx:119-124` (Match column + `<MatchScoreBadge>`), `pipeline-card.tsx:165-168`, `pipeline-mobile-list.tsx:251-255` — all three render `<MatchScoreBadge score={...}>` with a null-guard and `title=match_note`. Confirmed `PipelineMobileList` is a genuinely separate render tree (`pipeline-shell.tsx:53`), not CSS-hidden — badge addition there is not redundant with the desktop card. |
| 5 | A concurrent double-fire resolves as a benign duplicate — no second Sonnet call, no Sentry exception | VERIFIED | Same evidence as #2, plus Inngest `concurrency: { limit: 2, key: 'event.data.organization_id' }` (`score-application-match.ts:81`) documented as generous-not-exclusive, with the DB unique constraint as the true backstop. |
| 6 | Every `/search` render writes an audit_log row carrying mode, semantic_ok and result_count — in all three branches | VERIFIED | Re-ran the plan's own grep: `grep -c 'await recordSearchAudit(' src/app/(app)/search/page.tsx` = 3. Read all three call sites (trigram: line 123, semantic success: line 215, semantic fallback: line 222) — each carries `{mode, semantic_ok, result_count, surface}` and never `q`. `/candidates?q=` also instrumented (`candidates/page.tsx:86-91`, gated on `if (q)`). |
| 7 | Newly created candidates, companies, contacts, jobs and applications carry created_by without app-code changes | VERIFIED (artifact complete; DB apply pending, by design) | Migration file `20260804130000_set_created_by_trigger.sql` contains exactly 5 `create trigger ... execute function public.set_created_by()` statements (re-ran plan's grep, count=5), `SECURITY INVOKER` (no `security definer` string present, case-sensitive check passed), `set search_path = public` present. Per hard_rules #2 and the plan's own success_criteria ("migration files exist... and are unapplied"), this migration is intentionally NOT pushed to the live DB by this quick task — the founder applies it manually. The truth becomes live-true only after that manual push, which is outside this plan's scope by design, not a gap. |
| 8 | A Stripe webhook whose handler throws leaves a ledger row that is NOT 'processed', and Stripe still re-delivers and re-drives it | VERIFIED | Traced the full code path in `src/app/api/stripe/webhook/route.ts`: seen-check (`readLedgerSeenStatus`) short-circuits ONLY when `seen.found && (seen.status === null \|\| seen.status === 'processed')` (line 194) — a `'received'` or `'error'` row falls through and re-runs `handleStripeEvent`. On throw: 500 returned, ledger stamped `status:'error'` with `error_detail` = `` `${err.name}: ${event.type}` `` (never `err.message`), and `'processed'` is never stamped on that path. Confirmed by test `'handler throw → 500, ledger stamped received then error, NEVER processed'` (asserts `statuses).not.toContain('processed')`) and the new `it.each(['received','error'])('a prior "%s" row does NOT short-circuit...')` parametrized test — both pass. |
| 9 | The Stripe webhook returns its normal response even when the new status columns are absent from the database | VERIFIED | `isMissingColumnError` (PGRST204/42703) guards every ledger write; seen-check falls back to a legacy `stripe_event_id`-only select treating any existing row as `'processed'`; the up-front 'received' stamp and the success 'processed' stamp both skip/retry-legacy silently on a missing-column error and never change the HTTP response. Test `'a PGRST204 (missing status column) degrades to the legacy shape and still returns 200'` passes and asserts `Sentry.captureException` was NOT called for this expected degradation. |

**Score:** 9/9 truths verified at the code level.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/inngest/functions/score-application-match.ts` | Inngest fn, tenant-verified, contains `application/score-match` | VERIFIED | Exists, exports `scoreApplicationMatch`, tenant guard at lines 135-140 (`candidateResult.data.organization_id !== organization_id \|\| jobResult.data.organization_id !== organization_id` → `NonRetriableError`), registered in `src/app/api/inngest/route.ts:67`. |
| `src/lib/inngest/enqueue-match-score.ts` | Single fire-point, no-ops on null jobId | VERIFIED | Exports `enqueueApplicationMatchScore`; returns early when `!args.jobId \|\| !args.organizationId \|\| !args.candidateId`; try/catch around `inngest.send` never rethrows. |
| `src/lib/db/audit.ts` | `recordViewAudit`/`recordSearchAudit`/`recordServiceAudit`/`NIL_UUID` | VERIFIED | All four exported; each never-throw (try/catch, Sentry-capture, no rethrow). |
| `supabase/migrations/20260804130000_set_created_by_trigger.sql` | `set_created_by()` trigger, contains `set_created_by` | VERIFIED | Present, additive-only (5 `create trigger`), append-only per `git diff --name-status` (status `A`, not `M`). |
| `supabase/migrations/20260804130100_stripe_webhook_event_status.sql` | status/error_detail/processed_at columns, contains `processed_at` | VERIFIED | Present, additive-only (`add column if not exists`), check constraint, partial index; append-only per `git diff --name-status` (status `A`). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `jobs/[id]/actions.ts` | `enqueue-match-score.ts` | `enqueueApplicationMatchScore` after successful `createApplication` | WIRED | Called at line 82, after `revalidatePath`, using `result.data.*` from the create call. Also verified the other 3 call sites (shortlist add, promote-to-application, add-float) all wire the same helper after their writes. |
| `enqueue-match-score.ts` | `score-application-match.ts` | `inngest.send({ name: 'application/score-match' })` | WIRED | Exact event name match confirmed on both ends. |
| `applications.ts` | `ai-summaries.ts` | `listLatestMatchScoresForPairs` enrichment | WIRED | `enrichWithMatchScores` helper (line 93) called from both `listApplicationsForJob` (line 179) and `listAllApplicationsByStage` (line 278); degrades to unenriched cards on error (never fails the list). |
| `search/page.tsx` | `public.record_audit` | `recordSearchAudit` in all 3 branches | WIRED | 3 call sites confirmed by count and by reading each; `record_audit` RPC contract (org resolved server-side, `p_action` enum includes `'view'`) confirmed in `20260513152244_phase1_domain_schema.sql:104-124`. |
| `stripe/webhook/route.ts` | `stripe_webhook_events.status` | received -> processed/error with PGRST204/42703 fallback | WIRED | Full lifecycle traced in-source; both error codes referenced; degradation tested. |

### Behavioral / Test Verification

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Typecheck | `corepack pnpm typecheck` | clean, 0 errors | PASS |
| Lint | `corepack pnpm lint` | 0 errors, 24 pre-existing warnings (none in this batch's files) | PASS |
| Targeted unit tests | `corepack pnpm exec vitest run src/lib/inngest/enqueue-match-score.test.ts src/lib/db/match-score-enrichment.test.ts src/lib/db/create-application.test.ts src/app/api/stripe/webhook/route.test.ts` | 4 files, 30 tests, all pass | PASS |
| Full test suite (regression check) | `corepack pnpm exec vitest run` | 51 passed \| 4 skipped, 448 tests passed, 0 failed | PASS |
| Dummy-env build | `pnpm build` with the 7 dummy env vars from the plan | exit 0, all routes compiled including `/api/stripe/webhook`, `/search`, `/jobs/[id]`, `/clients/[id]`, `/admin/[orgId]/export` | PASS |
| Plan's Task 1 automated verify grep (10 assertions) | re-ran verbatim | all 10 passed | PASS |
| Plan's Task 2 automated verify grep (13 assertions incl. `-eq 3` search-audit count, `-eq 5` trigger count, negative greps for `security definer` / raw query) | re-ran verbatim | all 13 passed | PASS |
| Plan's Task 3 automated verify grep (7 assertions incl. `PGRST204`, `42703`, negative `err.message` grep) | re-ran verbatim | all 7 passed | PASS |
| Migration append-only check | `git diff --stat main...HEAD -- supabase/migrations/` + `--name-status` | 4 files total (2 from Batch 1, 2 from Batch 2), all status `A` (Added), zero `M` (Modified) | PASS |
| Commit count | `git log --oneline` | exactly 3 atomic commits (`a55fb45`, `a5a07ac`, `8b313c0`), one per task | PASS |

### Special-Attention Items (per orchestrator instruction)

1. **Webhook seen-check short-circuit condition** — traced end to end in `src/app/api/stripe/webhook/route.ts:194`: `if (seen.found && (seen.status === null || seen.status === 'processed'))`. This is a boolean AND over an OR — it short-circuits ONLY when a row exists AND its status is either legacy-NULL or `'processed'`. A `'received'` or `'error'` row evaluates false and falls through to re-run `handleStripeEvent`. Confirmed correct and matches SECURITY INVARIANT 4's stated contract. Directly tested by the new `it.each(['received', 'error'])` parametrized case.
2. **Cross-tenant guard in `score-application-match.ts`** — `verify-and-load` step (lines 120-150) loads both `candidate` and `job` via service-role (RLS-bypassing) reads, then compares BOTH rows' `organization_id` against the event's claimed `organization_id` before any further processing; mismatch throws `NonRetriableError`. Confirmed `getCandidateForEmbedding`/`getJobForEmbedding` select `organization_id` (not omitted), so the comparison is against real data, not a type-only field.
3. **Enqueue failures never fail the user action** — `enqueueApplicationMatchScore` wraps `inngest.send` in try/catch, captures to Sentry on rejection, and always resolves (never rejects/throws). All 4 call sites `await` it but do not check its return value or wrap it in their own try/catch, so even a synchronous throw inside the helper (none exists) could not propagate past the helper's own catch. Confirmed by the unit test `'never throws when inngest.send rejects — captures to Sentry and resolves'`.
4. **Audit helper never logs raw query** — `recordSearchAudit`/`recordViewAudit` accept only a caller-supplied `metadata` object; the helper itself never touches a query string. All 4 call sites (`/search` x3, `/candidates` x1) pass a metadata object containing only `mode`/`semantic_ok`/`result_count`/`surface` — confirmed by direct read of each call site, plus the plan's negative grep `! grep -q "query: q\|p_query"` re-run and passing.

### Anti-Patterns Found

None. Scanned all 21 files touched by this plan for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`, "coming soon"/"not yet implemented" phrasing, and `any` usage without a `// reason:` comment — zero matches. Confirmed `match-score-badge.tsx` (imported into two Client Components) has no `server-only` import in itself or its two dependencies (`Badge`, `cn`).

### Requirements Coverage

No `.planning/REQUIREMENTS.md` exists in this repository (quick tasks self-declare requirement IDs in plan frontmatter rather than drawing from a central requirements ledger). All 6 self-declared requirement IDs (`SF-3`, `TEL-SEARCH`, `TEL-ATTRIB`, `TEL-VIEW`, `TEL-ANALYTICS`, `STRIPE-SAFETY`) map 1:1 onto the artifacts and truths verified above.

## Human Verification Required

The code-level implementation is complete and correct by every mechanical and static check
available. What remains unverifiable from source is real-world execution against live external
services (Anthropic Sonnet, Voyage, Stripe, Vercel's Analytics collector) and real authenticated
sessions — this matches exactly what the plan's own `<verification>` section calls "MANDATORY
before any human UAT" and what the SUMMARY explicitly says has not yet been run. See the
`human_verification` list in the frontmatter for the 7 specific checks (add-candidate-to-job
score-badge appearance on all 3 surfaces, idempotency-under-real-double-fire, empty-profile skip
against a real record, search telemetry against a real session, view/export audit attribution,
a real Stripe CLI round-trip through both the success and failure paths, and Vercel Analytics
collector receipt).

## Gaps Summary

No code-level gaps found. Every declared truth, artifact, and key link is present, substantive,
and correctly wired; the full test suite (448 tests) and a dummy-env production build both pass
clean; all 30 of the plan's own automated verify-gate assertions across the three tasks re-ran
successfully; migrations are additive-only and correctly left unapplied per the project's
migration hard rule. The only reason this is not `passed` is that HARD RULE #1's mandatory
browser-automation pre-smoke has not yet been executed against a live/preview deployment — that
step is what turns "every wire is connected in source" into "the customer-visible feature
actually works," and it cannot be substituted with static analysis for AI-call and webhook-retry
behavior specifically.

---

*Verified: 2026-08-04T16:24:07Z*
*Verifier: Claude (gsd-verifier)*
