---
phase: quick-260804-lfz
verified: 2026-08-04T15:49:17Z
status: human_needed
score: 12/12 must-haves verified in code
overrides_applied: 0
human_verification:
  - test: "Set SENTRY_DSN + NEXT_PUBLIC_SENTRY_DSN in Vercel, trigger a client-side error on the deployed app, confirm it appears in the Sentry dashboard tagged org_id/user_id with no PII (cookies/email scrubbed)."
    expected: "Event appears in Sentry within ~1 min, no candidate name/email/CV text in the payload."
    why_human: "External service integration (Sentry ingestion) — cannot be verified from static code; also blocked on the founder setting the DSN env vars (code no-ops silently until then, by design)."
  - test: "Live browser smoke of the four new CV-pipeline UI states on the candidate page: (a) PendingState past 5 min → 'taking longer than expected' + Try again button, (b) FailedState budget-capped → 'View AI budget' + restored 'Try again now' button, (c) FailedState unparseable-source → honest no-retry copy with no Try-again button, (d) dashboard CvParseHealthWidget rendering with real failed/stale-pending counts and candidate links."
    expected: "All four states render the copy and controls described in the plan with no layout regressions; the widget only appears when failed+stalePending > 0."
    why_human: "Visual/UX rendering — HARD RULE #1's browser-automation pre-smoke step, explicitly deferred by this plan's own <verification> section to the orchestrator, not run by this code-only verification pass."
  - test: "After deploy, wait for the reconciler's first 15-min cron run and confirm candidates 62783324-4ec4-4d53-8405-cf913bfe7195 and 3bf8ffe0-d54f-4649-aa1e-0949adb73b2c (Steele Charles org) have their profile fields populated from the previously-unmerged CV data, and that candidate_embedding was subsequently re-populated by the next embed-batch sweep."
    expected: "Both candidates show non-empty current_role_title/skills/etc. within ~15-25 min of deploy; a Sentry breadcrumb 'reconciler healed an unmerged profile' appears for each."
    why_human: "Real-time, production-data-dependent behavior (SF-2 remediation) — the heal-unmerged-profiles logic is verified correct by static code review, but its actual effect on live rows can only be confirmed after the founder deploys and the cron fires against production."
  - test: "Founder runs `pnpm exec supabase db push --linked` for both migration files and confirms both apply cleanly to production with zero errors, then spot-checks that anon PostgREST calls to the 10 revoked functions now 403/permission-deny and that record_audit_anonymous (used by the public apply form) still succeeds."
    expected: "Both migrations apply cleanly; anon RPC calls to the 10 functions return 42501 permission denied; the apply form's audit-log write still works."
    why_human: "Migrations are file-only by hard rule — the executor never pushed them, so their actual effect on the production schema/grants is unverified until the founder runs the push and someone confirms it."
---

# Quick Task: SC Review Batch 1 — CV-Pipeline Silent Failures Verification Report

**Task Goal:** Close the CV-pipeline silent-failure cluster (SF-1, SF-2, SF-4, SF-5) from the
2026-07-31 Steele Charles feature review, resurrect browser-side Sentry under Next 16 Turbopack
(SF-7), and stage the anon-RPC lockdown migration (SEC-ANON-RPC) — without pushing any database
write.

**Verified:** 2026-08-04T15:49:17Z
**Status:** human_needed
**Re-verification:** No — initial verification

**Branch state verified:** `quick/sc-review-fixes-260804` at merge commit `93a7352` (Batch 1
squashed-into-main-history via task commits `1cb386d`, `b8aeff1`, `e97dc2b`, `9bb65c6`). A
concurrent Batch 2 executor's worktree exists at `.claude/worktrees/agent-ae5fbd054e83d5bf9/`
(locked, on branch `worktree-agent-ae5fbd054e83d5bf9`) — per instructions, its files were
excluded from this verification (see Environment Note below).

## Goal Achievement

### Observable Truths (from PLAN frontmatter `must_haves.truths`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Scanned/no-text PDF ends 'failed' with honest message that survives `onFailure`; UI offers re-upload not a doomed retry | ✓ VERIFIED | `parse-cv.ts:261-273` writes `CV_NO_TEXT_MESSAGE`; `markCvFailed`'s `preserveExistingMessage` (parse-cv.ts:89-128) reads the row before `onFailure` overwrites it; `onFailure` passes `preserveExistingMessage: true` (parse-cv.ts:155-163); `cv-review-panel.tsx:244-260` `unparseable` branch renders honest copy with **no** retry button |
| 2 | Failed profile-merge no longer lands 'complete': parse-cv throws on `!result.ok` | ✓ VERIFIED | `parse-cv.ts:309-318` captures `mergeResult`, throws `markCandidateFieldsFromCV: ${code}` inside `step.run('write-extracted', …)` on `!ok` |
| 3 | Two known production casualties self-heal on first reconciler run after deploy | ✓ VERIFIED (code) — see Human Verification #3 | `reconcile-cv-parses.ts:287-362` `heal-unmerged-profiles`: selects `complete` rows with `extracted_data`, skips unless `isProfileEffectivelyEmpty`, calls `markCandidateFieldsFromCV` with `toParsedCVSubset`; SUMMARY's trigger-coverage claim (all D-08-written columns are watched by `invalidate_candidate_embedding`) independently confirmed against `20260519092951_invalidate_embeddings_triggers.sql:43-51` |
| 4 | `candidate_cvs` row stuck 'pending' >15 min is re-enqueued or flipped 'failed' honestly | ✓ VERIFIED | `reconcile-cv-parses.ts:122-209` `sweep-stuck-pending` + `decideStuckPendingAction` (9 unit tests incl. both boundaries, all pass) |
| 5 | Budget-capped parse genuinely resumes automatically once the org's cap allows | ✓ VERIFIED | `reconcile-cv-parses.ts:215-278` `resume-budget-capped`: one `checkCap` per org per sweep, resets `pending` + re-sends `cv/uploaded` when `allow` |
| 6 | `confirmApplyAction` marks the CV row 'failed' when `inngest.send` throws | ✓ VERIFIED | `actions.ts:561-582`; unit test `confirm-action-inngest-fallback.test.ts` asserts `parsing_status === 'failed'` in the recorded update patch — test passes |
| 7 | After the 5-min poll cap the candidate page shows 'taking too long — retry', not permanent 'Parsing…' | ✓ VERIFIED (code) — see Human Verification #2 | `cv-review-panel.tsx:116-175` `PendingState` sets `timedOut` and renders the amber panel + `Try again` button wired to `onRetry` |
| 8 | Browser-side errors reach Sentry under Next 16 Turbopack via `instrumentation-client.ts` | ✓ VERIFIED (code) — see Human Verification #1 | `instrumentation-client.ts` exists at repo root, `Sentry.init` with PII-safe `beforeSend`; `sentry.client.config.ts` deleted, zero dangling references (grep confirmed) |
| 9 | Failed Claude attempts recorded in `ai_usage` at 0 tokens/0 cost | ✓ VERIFIED | `claude.ts:212-224` outer try/catch around the retry loop logs exactly one `${purpose}_failed` row at 0/0/0; `CapExceededError` explicitly excluded (claude.ts:134-140, thrown before `started`/outer try); voyage.ts and whisper.ts carry the identical pattern (confirmed by grep) |
| 10 | Dashboard surfaces org-level count of failed + stale-pending CV parses (only when >0), linking to affected candidates | ✓ VERIFIED | `dashboard.ts:552-`, `getCvParseHealth` two-query pattern, degrades to zeros on error; `cv-parse-health-widget.tsx` returns `null` when `total === 0`; wired into `page.tsx`'s `Promise.all` and rendered above `StaleApplicationsWidget`, outside the `isEmpty` early return |
| 11 | Candidates with effectively-empty profiles are not embedded/match-scored; pre-existing scores badged 'Profile incomplete' | ✓ VERIFIED | `isProfileEffectivelyEmpty` applied at all 4 sites: `parse-cv.ts:348` (reactive embed), `embed-batch.ts:142` (sweep filter), `precompute-matches-for-job.ts:233` (scoring skip, before cache/ai_usage), `match-card.tsx:65` (badge) — `CandidateByIdRow` (candidates.ts:574-586) confirmed to include all 6 predicate fields |
| 12 | `anon` can no longer EXECUTE the audited SECURITY DEFINER functions (staged migration file); `record_audit_anonymous` keeps working | ✓ VERIFIED | `20260804120100_revoke_anon_execute_security_definer.sql` — idempotent `pg_proc`-driven loop over 11 names; `rls_auto_enable` confirmed absent from the repo (0 grep hits), 10 others confirmed present; `record_audit_anonymous` confirmed already anon-revoked (`20260519092947`) and correctly excluded; no non-comment line touches `authenticated`; both safety analyses (trigger functions, `current_organization_id` blast radius on `plan_overrides`/`voice_notes`/`email_campaigns`/`email_campaign_recipients`) independently spot-checked against the cited migrations and confirmed accurate |

**Score:** 12/12 truths verified by code inspection. 4 of the 12 have a residual live/production
confirmation step that only becomes possible after deploy (see Human Verification section) —
this is expected: migrations are file-only by hard rule, and the plan's own `<verification>`
section explicitly defers browser pre-smoke + founder migration push to the orchestrator.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `instrumentation-client.ts` | Turbopack-compatible browser Sentry init | ✓ VERIFIED | Exists, `Sentry.init` present, `sendDefaultPii: false`, PII-safe `beforeSend`, `onRouterTransitionStart` export confirmed present in installed SDK (`node_modules/@sentry/nextjs/build/types/client/index.d.ts`) |
| `sentry.client.config.ts` | Deleted | ✓ VERIFIED | File absent; zero references anywhere in the tree (grep, excluding `node_modules`) |
| `src/lib/cv/parse-messages.ts` | Shared copy + predicates | ✓ VERIFIED | All 5 message constants + `isBudgetCapped`/`isUnparseableSource` present, no `server-only` import, consumed by both `parse-cv.ts` (server) and `cv-review-panel.tsx` (client) |
| `src/lib/cv/reconcile-decisions.ts` | Pure stuck-pending decision function | ✓ VERIFIED | `decideStuckPendingAction` matches spec exactly incl. boundary rules; 9/9 unit tests pass |
| `src/lib/ai/profile-completeness.ts` | Contamination guard | ✓ VERIFIED | `isProfileEffectivelyEmpty` matches spec exactly (full_name excluded, years_experience=0 counts as present); 6/6 unit tests pass |
| `src/lib/inngest/functions/reconcile-cv-parses.ts` | 15-min cron sweep | ✓ VERIFIED | `reconcileCvParses` exports, 3 steps (sweep-stuck-pending, resume-budget-capped, heal-unmerged-profiles), cron `TZ=Europe/London */15 * * * *`, concurrency 1, per-row/per-org try/catch |
| `src/app/(app)/_dashboard/cv-parse-health-widget.tsx` | Org-level CV parse visibility | ✓ VERIFIED | Renders `null` when `total === 0`; badges + candidate links present |
| `supabase/migrations/20260804120000_candidate_cvs_parse_error_detail.sql` | FILE ONLY, new column | ✓ VERIFIED | Exists, `add column if not exists`, comment present, no push executed |
| `supabase/migrations/20260804120100_revoke_anon_execute_security_definer.sql` | FILE ONLY, anon REVOKE | ✓ VERIFIED | Exists, idempotent loop, `record_audit_anonymous` excluded with rationale, no push executed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `parse-cv.ts` | `markCandidateFieldsFromCV` result | checked `.ok` + throw inside `step.run('write-extracted')` | ✓ WIRED | `parse-cv.ts:309-318` |
| `parse-cv.ts` (`onFailure`) | existing honest `parse_error` | `preserveExistingMessage` read-before-write in `markCvFailed` | ✓ WIRED | `parse-cv.ts:89-128`, `:155-163` |
| `reconcile-cv-parses.ts` | `cv/uploaded` event | `inngest.send` re-enqueue for stuck-pending rows w/ Storage object | ✓ WIRED | `reconcile-cv-parses.ts:167-178`, payload shape matches `<interfaces>` byte-for-byte |
| `reconcile-cv-parses.ts` | `markCandidateFieldsFromCV` | `heal-unmerged-profiles` step | ✓ WIRED | `reconcile-cv-parses.ts:323-341` |
| `src/app/api/inngest/route.ts` | `reconcileCvParses` | `serve({ functions: [...] })` registration | ✓ WIRED | `route.ts:15,61` |
| `cv-review-panel.tsx` | `parse-messages.ts` | `isBudgetCapped`/`isUnparseableSource` predicates | ✓ WIRED | `cv-review-panel.tsx:23,206-207` |
| `candidate-cvs.ts` | `candidate_cvs.parse_error_detail` | defensive write w/ PGRST204 fallback | ✓ WIRED | `candidate-cvs.ts:151-221`, `isMissingColumnError` handles both `PGRST204` code and message-substring match |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `cv-parse-health-widget.tsx` | `health: CvParseHealth` | `getCvParseHealth(supabase)` → two live `candidate_cvs` queries (`count: 'exact'`) + a `candidates` name lookup | Yes — real DB queries, RLS-scoped, degrades to zeros only on query error | ✓ FLOWING |
| `match-card.tsx` badge | `candidate: CandidateByIdRow` | `listCandidatesByIds` (extended select incl. all 6 predicate fields) | Yes — real DB columns, not hardcoded | ✓ FLOWING |
| `cv-review-panel.tsx` | `candidateCv.parse_error` | passed as a prop from the parent RSC reading the real `candidate_cvs` row | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck clean on the batch's diff | `pnpm typecheck` (via `corepack pnpm`) | `tsc --noEmit` exits 0, no output | ✓ PASS |
| Lint clean on the batch's diff (excluding concurrent worktree noise) | `pnpm exec eslint . --ignore-pattern '.claude/**'` | 0 errors, 22 pre-existing `_`-prefixed unused-var warnings (unrelated to this batch, confirmed pre-existing via `git show f7f7b50`) | ✓ PASS |
| Full unit suite green (excluding concurrent worktree noise) | `pnpm exec vitest run --exclude '**/.claude/**'` | 435 passed, 28 todo, 0 failed | ✓ PASS |
| New pure-logic + updated fallback suites | `pnpm exec vitest run tests/unit/lib/cv/reconcile-decisions.test.ts tests/unit/lib/ai/profile-completeness.test.ts tests/unit/app/apply/confirm-action-inngest-fallback.test.ts` | 16/16 passed | ✓ PASS |
| No dangling reference to deleted `sentry.client.config.ts` | `grep -rn "sentry.client.config" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.json" . \| grep -v node_modules` | 0 matches | ✓ PASS |
| No `supabase db push`/`apply_migration` actually invoked in the diff's code paths | grep across diff + git history | 0 executable invocations (only instructional comments in migration headers and one pre-existing unrelated comment in `candidates.ts:20`) | ✓ PASS |
| `git status` shows only expected files touched, no `src/types/database.ts` churn | `git status --short` on a clean checkout at `93a7352` | Clean (only unrelated untracked files) | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` probes declared or referenced by this plan/summary.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| SF-1 | 01 | Message-clobber + contamination guard | ✓ SATISFIED | Truths #1, #11 |
| SF-2 | 01 | Discarded merge-result now throws + self-heal | ✓ SATISFIED | Truths #2, #3 |
| SF-4 | 01 | Apply-form unswallow + reconciler + dashboard visibility | ✓ SATISFIED | Truths #4, #6, #10 |
| SF-5 | 01 | Budget-cap resume + UI timeout state | ✓ SATISFIED | Truths #5, #7 |
| SF-7 | 01 | Browser Sentry resurrection | ✓ SATISFIED (code) | Truth #8 |
| SEC-ANON-RPC | 01 | Anon-RPC lockdown migration | ✓ SATISFIED | Truth #12 |

No orphaned requirements — all 6 declared IDs are addressed by the single plan in this quick task.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any file touched by this batch (28-file diff scanned) | — | None |
| Environment (not a code file) | — | `pnpm lint` / `pnpm test` run from repo root pick up the concurrent Batch 2 worktree at `.claude/worktrees/agent-ae5fbd054e83d5bf9/` (a nested git worktree physically inside this checkout), producing 1 unrelated `@ts-nocheck` lint error and 3 Playwright/Vitest collisions that do **not** belong to this batch | ℹ️ Info | Not a defect in this diff — confirmed by re-running both gates with `.claude/**` excluded, which is clean. Worth adding `'.claude/worktrees/**'` to `eslint.config.mjs`'s `globalIgnores` and Vitest's exclude list so future `pnpm lint`/`pnpm test` runs aren't polluted by sibling worktrees — flagging as a process note, not a Batch 1 gap. |

### Deviation Verification (explicitly requested)

**`src/app/(app)/settings/usage/page.tsx` — `formatPurposeLabel()`:** Confirmed this is a
**label-only** transformation, not a row filter. `rows`, `purposeBreakdown`, `totalPence`, and
`topExpensive` all still include `_failed` rows unchanged — they just render as
`"<purpose> — failed attempt (no cost)"` instead of the raw `<purpose>_failed` string
(`page.tsx:58-63,203,243`). Verified this does **not** break the usage meter's totals:
- `totalPence` (headline £ figure) is unaffected because every `_failed` row carries
  `cost_pence: 0` (enforced at the source in `claude.ts:213-222`, `voyage.ts`, `whisper.ts`).
- `_failed` rows get their **own** `purposeBreakdown` line (distinct map key from the
  success-path purpose), so a customer sees `cv_parse` and `cv_parse — failed attempt (no cost)`
  as two separate rows rather than the failure silently inflating the real purpose's spend.
- `matchSpendPence` (feeds the match-scoring ceiling bar) looks up the map by the literal key
  `'match_score'`, which a `match_score_failed` row does not match — the ceiling calculation is
  unaffected by failed-attempt telemetry, as intended.
- The only place `_failed` rows are counted is the "{rows.length} calls" line in the headline
  card — this is arguably correct (a call *was* attempted), not a defect.

No regression found in this deviation.

## Human Verification Required

### 1. Browser Sentry live capture

**Test:** Set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` in Vercel, trigger a client-side error on
the deployed app, confirm it appears in the Sentry dashboard.
**Expected:** Event appears in Sentry within ~1 min, no candidate name/email/CV text in the
payload (cookies + `user.email` deleted by `beforeSend`).
**Why human:** External service integration — cannot be verified from static code, and the code
deliberately no-ops until the founder sets the DSN.

### 2. CV-pipeline UI states — visual smoke

**Test:** Live browser walkthrough of the four new/changed states: (a) `PendingState` past 5 min
→ timeout panel + retry, (b) `FailedState` budget-capped → restored "Try again now" button,
(c) `FailedState` unparseable-source → honest no-retry copy, (d) `CvParseHealthWidget` on the
dashboard with real counts + candidate links.
**Expected:** All render the copy/controls described in the plan with no layout regressions;
widget hidden when there's nothing to show.
**Why human:** Visual/UX rendering — this is exactly HARD RULE #1's browser-automation
pre-smoke step, which the plan's own `<verification>` section explicitly defers to the
orchestrator rather than this code-review pass.

### 3. Production self-heal confirmation

**Test:** After deploy, wait for the reconciler's first 15-min cron run and confirm candidates
`62783324-4ec4-4d53-8405-cf913bfe7195` and `3bf8ffe0-d54f-4649-aa1e-0949adb73b2c` (Steele Charles
org) have their profile fields populated, and that `candidate_embedding` is subsequently
re-populated by the next `embed-batch` sweep.
**Expected:** Both candidates show non-empty structured fields within ~15-25 min of deploy; a
Sentry breadcrumb `"reconciler healed an unmerged profile"` appears for each.
**Why human:** Real production-data-dependent behavior — the heal logic is verified correct by
static code review, but its actual effect on the live rows can only be confirmed after deploy.

### 4. Founder migration push confirmation

**Test:** Run `pnpm exec supabase db push --linked` for both migration files; confirm anon
PostgREST calls to the 10 revoked functions now fail with `42501 permission denied`, and that
`record_audit_anonymous` (used by the public apply form) still succeeds.
**Expected:** Clean apply; anon RPC denied; apply-form audit write unaffected.
**Why human:** Migrations are file-only by hard rule — never pushed by the executor or this
verification pass.

## Gaps Summary

No code-level gaps found. Every `must_haves.truth`, artifact, and key link in the plan's
frontmatter is backed by real, wired, non-stub code — confirmed by direct file inspection (not
SUMMARY.md claims), `pnpm typecheck`/`pnpm lint`/`pnpm test` all green on the batch's actual
diff, and cross-checks of the SUMMARY's three plan-required findings (trigger-coverage,
voyage/whisper telemetry, `captureRouterTransitionStart` SDK presence) against the real
migration files and `node_modules` — all confirmed accurate, not just asserted.

The `human_needed` status is driven entirely by items that are inherently unverifiable from
static code: live Sentry ingestion, visual UI rendering, production-data self-heal, and the
founder's manual migration push. None of these represent a defect found in the diff — they are
the expected residual verification surface for a plan whose own `<verification>` section
explicitly scopes autonomous gates to typecheck/lint/test/greps and defers browser pre-smoke +
migration application to the orchestrator and founder.

One process note (not a Batch 1 defect): running `pnpm lint`/`pnpm test` from the repo root
currently picks up files from the concurrent Batch 2 worktree at
`.claude/worktrees/agent-ae5fbd054e83d5bf9/` (a nested git worktree), producing false-positive
failures unrelated to this batch. Recommend adding `.claude/worktrees/**` to
`eslint.config.mjs`'s `globalIgnores` and to the Vitest exclude list.

---

*Verified: 2026-08-04T15:49:17Z*
*Verifier: Claude (gsd-verifier)*
