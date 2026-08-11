---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 06
subsystem: ai
tags: [inngest, match-scoring, admin, backfill, sonnet, ai-usage]

# Dependency graph
requires:
  - phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
    provides: score-application-match (SF-3 scorer, Batch 2) and enqueueApplicationMatchScore (the single fire-point helper)
provides:
  - "backfillApplicationMatchScores — event-triggered (no cron) Inngest sweep that fans out to the existing scorer for applications that predate auto-scoring"
  - "backfillMatchScoresAction + BackfillMatchScoresForm — super-admin trigger on /admin"
affects: [admin, ai-usage, match-scoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coarse pair-existence pre-filter (any ai_summaries row for the pair, not version-exact) as a spend-avoidance optimisation that fails OPEN — the authoritative idempotency guard stays inside the scorer's own cache lookup"
    - "Backfill sweeps reuse the single application-create fire-point (enqueueApplicationMatchScore) instead of duplicating any scoring/cap/tenancy logic"

key-files:
  created:
    - src/lib/inngest/functions/backfill-application-match-scores.ts
    - src/app/admin/BackfillMatchScoresForm.tsx
    - tests/unit/lib/inngest/backfill-application-match-scores.test.ts
  modified:
    - src/app/api/inngest/route.ts
    - src/app/admin/actions.ts
    - src/app/admin/page.tsx

key-decisions:
  - "Event-triggered only, no cron trigger — a backfill is a deliberate one-off the founder starts from /admin, so spend never happens on a schedule nobody asked for (matches D-04 + the plan's Claude's Discretion note)."
  - "Wrote the file-header comments to describe the guards without naming score-application-match's internal function identifiers verbatim, so the plan's `grep -n \"scoreCandidateForJob\\|checkCap\\|getMatchSummary\"` verification returns clean while still documenting which decisions live where."
  - "Button accessible name uses aria-label (not the changing visible text) so it stays stable for role+name targeting through the pending state, per the plan's explicit ask."

requirements-completed: [CLT-05]

# Metrics
duration: ~30min
completed: 2026-08-11
---

# Phase 7 Plan 06: Match-score backfill sweep Summary

**Event-triggered Inngest sweep (`backfill-application-match-scores`) that fans out to the existing `score-application-match` scorer via `enqueueApplicationMatchScore` for applications predating auto-scoring, plus a super-admin trigger on /admin — zero new scoring, capping, or tenancy logic.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `backfillApplicationMatchScores` selects unscored, job-bearing applications (oldest-first, 500-row cap, optional org scope) and calls `enqueueApplicationMatchScore` once per row — the same single fire-point add-to-job and promote-shortlist-to-application already use. It never calls the Sonnet scoring function, the AI cap check, the version-exact cache lookup, or the empty-profile predicate; every one of those decisions stays inside `score-application-match`.
- A coarse "any `ai_summaries` row exists for this pair" pre-filter skips already-scored applications without touching the scorer's authoritative version-exact cache guard — D-04's "no auto-rescore loops beyond what exists."
- Row-cap truncation is reported (`truncated: true` + a Sentry warning), mirroring `stripe-reconcile.ts`'s `STUCK_EVENT_SWEEP_CAP` treatment — a truncation can never lie by omission.
- `timeouts: { start: '5m', finish: '10m' }` on the concurrency-1 function so this sweep can never join `embed-batch`/`reconcile-cv-parses` as a thing that wedges the Inngest queue for days.
- Registered in `serve()`'s functions array (the single wiring step the whole plan depends on — an unregistered function silently never runs).
- `backfillMatchScoresAction` gates with `requireSuperAdmin()` first, sends `application/backfill-scores` (scoped to `organization_id` only when supplied — default is unscoped/all-orgs per D-04), and reports an honest "queued" message since the work is asynchronous.
- `BackfillMatchScoresForm` renders on `/admin` beside `ProvisionExternalOrgForm`, with a stable `aria-label="Backfill match scores"` so the button stays targetable by role+name through the "Queuing…" pending state.

## Task Commits

Each task was committed atomically:

1. **Task 1: Backfill sweep function** - `4b63ed6` (feat, tdd)
2. **Task 2: Register the function and add the super-admin trigger** - `ce34d25` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

## Files Created/Modified
- `src/lib/inngest/functions/backfill-application-match-scores.ts` - The sweep: DB selection, ai_summaries pair pre-filter, per-row enqueue with try/catch, row-cap truncation reporting
- `tests/unit/lib/inngest/backfill-application-match-scores.test.ts` - 7 vitest cases covering every `<behavior>` bullet in the plan (float exclusion, already-scored skip, oldest-first ordering, row-cap truncation, org scoping both ways, per-row error isolation)
- `src/app/api/inngest/route.ts` - Registers `backfillApplicationMatchScores` in the `serve()` functions array
- `src/app/admin/actions.ts` - `backfillMatchScoresAction(orgId?)` — `requireSuperAdmin()` gate, `inngest.send`, honest async-queued messaging
- `src/app/admin/BackfillMatchScoresForm.tsx` - Super-admin trigger UI (useTransition, sonner toast, stable aria-label)
- `src/app/admin/page.tsx` - Renders `BackfillMatchScoresForm` beside `ProvisionExternalOrgForm`

## Decisions Made
- Coarse (not version-exact) pair pre-filter, matching the plan's explicit instruction — the version-exact decision stays solely inside the scorer's cache lookup so there is exactly one place that guard can drift.
- File-header/doc comments describe the guarded functions by role ("the Sonnet match-scoring call", "the AI budget-cap check", "the version-exact cache lookup") rather than by literal identifier, so the plan's mechanical grep verification (`scoreCandidateForJob|checkCap|getMatchSummary` must return nothing) holds while the documentation intent is preserved.
- No `revalidatePath` call in `backfillMatchScoresAction` — unlike the other admin actions in this file, this one has no synchronous DB write of its own to reflect; scores land asynchronously via the sweep and the downstream scorer, and the UI copy says so.

## Deviations from Plan

None — plan executed exactly as written. The only interpretive choice was how to phrase code comments to satisfy the plan's own verification grep (see Decisions above), which is a documentation-wording detail, not a functional deviation.

## Issues Encountered
- The worktree had no `node_modules` (fresh worktree checkout) — ran `pnpm install` first. No lockfile changes resulted.
- Local `pnpm build` fails on env validation without real secrets (a known pre-existing condition per project memory — Vercel is the real build gate). Verified the build compiles and collects page data cleanly (including `/admin` and `/api/inngest`) using a temporary, gitignored `.env.local` with dummy values, then deleted it and the `.next` output before committing — no env or build artifacts were committed.
- The initial `<worktree_branch_check>` merge-base didn't match the expected commit (`e5b6b68b`, a sibling docs-only planning-precision commit touching 07-03/07-07 PLAN.md that landed after this worktree forked) — caught after Task 1+2 were already committed. Fixed by stashing the in-progress SUMMARY/STATE changes, rebasing both task commits cleanly onto `e5b6b68b` (verified linear/no-conflict since that commit touches neither of this plan's files), then popping the stash. Task commit hashes changed as a result (`6d9d663`→`4b63ed6`, `2f480bb`→`ce34d25`); typecheck + the full test suite were re-verified green post-rebase.

## User Setup Required
None - no external service configuration required. The backfill is triggered manually from `/admin` by a super-admin whenever the founder decides to run it (deliberately no cron, per D-04 and this plan's Claude's Discretion note).

## Next Phase Readiness
- Ready: the sweep and its /admin trigger are code-complete, typechecked, linted, unit-tested, and build-verified. Per this plan's hard rules, it is **not** triggered against production here — execution happens post-deploy under the founder-approved flow (this is a live-prod repo; no migrations or prod access occurred in this plan, and none were needed — no schema changes).
- Before founder UAT of this feature specifically, the standard pre-UAT pipeline (`/gsd-code-review` + browser-automation pre-smoke) should still run per the global CLAUDE.md HARD RULE #1, most usefully once this lands on a preview/prod deploy where the button can actually be clicked end-to-end against real applications.
- No blockers for the remaining Phase 7 plans (07-07, 07-08).

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

- FOUND: src/lib/inngest/functions/backfill-application-match-scores.ts
- FOUND: tests/unit/lib/inngest/backfill-application-match-scores.test.ts
- FOUND: src/app/admin/BackfillMatchScoresForm.tsx
- FOUND: commit 4b63ed6 (Task 1)
- FOUND: commit ce34d25 (Task 2)
