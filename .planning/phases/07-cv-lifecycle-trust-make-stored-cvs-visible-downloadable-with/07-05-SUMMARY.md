---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 05
subsystem: infra
tags: [inngest, sentry, cron, observability, background-jobs]

# Dependency graph
requires: []
provides:
  - "timeouts.start/finish on embed-batch and reconcile-cv-parses (both concurrency:{limit:1})"
  - "Top-of-handler Sentry heartbeat on both crons: embed-batch:cron:heartbeat, reconcile-cv-parses:cron:heartbeat"
  - "Regression test (tests/unit/lib/inngest/cron-hardening.test.ts) pinning both invariants by source inspection"
  - "docs/cron-monitoring.md — founder-facing Sentry Crons monitor setup + Inngest free-tier quota diagnosis"
affects: [inngest-functions, background-job-reliability, sentry-alerting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inngest function-level timeouts ({start, finish} DurationString) on every concurrency-1 cron to bound a wedged run's blast radius"
    - "Top-of-handler Sentry.captureMessage heartbeat (before any step.run) as a liveness signal that fires even on a no-op tick"

key-files:
  created:
    - tests/unit/lib/inngest/cron-hardening.test.ts
    - docs/cron-monitoring.md
  modified:
    - src/lib/inngest/functions/embed-batch.ts
    - src/lib/inngest/functions/reconcile-cv-parses.ts

key-decisions:
  - "timeouts.start='5m' / timeouts.finish='10m' on both crons — ~10x the healthy runtime (seconds), so a legitimately slow run is never falsely cancelled, but a wedge is bounded to 10 minutes max instead of days"
  - "Regression test uses source inspection (node:fs + regex) rather than importing the Inngest function modules, matching the plan's stated reason: importing pulls in @/lib/supabase/service, @/lib/env and the Sentry SDK, which need a populated server environment the unit suite doesn't have"
  - "Runbook recommends a Sentry Metric Alert (Number of Events, 'is below 1') keyed on each heartbeat message string, not Sentry's native Crons/check-in product — the existing heartbeats use plain Sentry.captureMessage, not Sentry.captureCheckIn, so Metric Alerts are the mechanism that actually works with the code as it stands"

requirements-completed: [CLT-07]

# Metrics
duration: ~25min
completed: 2026-08-11
---

# Phase 07 Plan 05: Cron hardening — timeouts, heartbeats, monitoring runbook Summary

**Function-level `timeouts` (start=5m/finish=10m) plus a top-of-handler Sentry heartbeat on both concurrency-1 crons (embed-batch, reconcile-cv-parses), a source-inspection regression test pinning both, and a founder-facing Sentry Metric Alert runbook that names the free-tier Inngest quota as the real root cause of the 6-9 Aug outage.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-11T13:50:00Z (approx.)
- **Completed:** 2026-08-11T14:11:49Z
- **Tasks:** 3/3 completed
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments
- `embed-batch` and `reconcile-cv-parses` — both `concurrency:{limit:1}` with no prior function-level timeout — now carry `timeouts:{start:'5m',finish:'10m'}`, so a wedged run is cancelled automatically instead of blocking the entire background-job queue for days (the exact 4-9 Aug 2026 failure mode).
- Both functions emit a fixed Sentry heartbeat (`embed-batch:cron:heartbeat`, `reconcile-cv-parses:cron:heartbeat`) before any `step.run`, copying the proven `refresh-outlook-subscription.ts:49` shape, so a stall is now provable from Sentry the same day rather than discovered by a customer.
- A regression test (`tests/unit/lib/inngest/cron-hardening.test.ts`) locks in all four invariants by source inspection: `timeouts{start,finish}` present, `concurrency:{limit:1}` still present, and the heartbeat fires strictly before the first `step.run`.
- `docs/cron-monitoring.md` — a founder-facing runbook covering the full 8-function scheduled-job inventory, the four heartbeat strings to alert on, step-by-step Sentry Metric Alert setup, what a missing heartbeat means vs. an `inngest/function.cancelled` event, the first three things to check during a suspected stall, and the free-tier Inngest quota mechanism that actually caused the 6-9 Aug silence.
- Zero changes to either function's sweep behaviour — no selector, row cap, drift counter, or dedup bucket touched. `git diff` on both source files shows only the added `timeouts` block, the heartbeat call, and their explanatory comments.

## Task Commits

Each task was committed atomically:

1. **Task 1: Timeouts and heartbeats on both concurrency-1 crons** - `baf20f7` (feat)
2. **Task 2: Cron-hardening regression test** - `b65cffc` (test)
3. **Task 3: Cron monitoring runbook** - `851c23b` (docs)

_Note: Task 2 is `tdd="true"` but sequenced after Task 1's implementation per the plan's own ordering — see "Deviations from Plan" for how RED/GREEN were still verified rather than skipped._

## Files Created/Modified
- `src/lib/inngest/functions/embed-batch.ts` - Added `timeouts:{start:'5m',finish:'10m'}` beside `concurrency:{limit:1}`, plus a top-of-handler `embed-batch:cron:heartbeat` Sentry message before `eventData` extraction / the candidate+jobs sweeps
- `src/lib/inngest/functions/reconcile-cv-parses.ts` - Same `timeouts` block, plus a top-of-handler `reconcile-cv-parses:cron:heartbeat` before the three sweep steps (stuck-pending, budget-capped resume, heal-unmerged-profiles)
- `tests/unit/lib/inngest/cron-hardening.test.ts` - New source-inspection regression test: timeouts present, concurrency:{limit:1} preserved, heartbeat before first step.run, for both target files
- `docs/cron-monitoring.md` - New founder-facing runbook: function inventory, heartbeat strings, Sentry Metric Alert setup steps, missing-heartbeat vs. cancelled-event semantics, stall-triage checklist, and the Inngest free-tier quota caveat

## Decisions Made
- **Timeout windows (5m start / 10m finish) for both crons** — sized at ~10x the healthy runtime (embed-batch and reconcile-cv-parses both normally finish in seconds; reconcile-cv-parses' three capped steps make a slow-but-legitimate run more plausible than embed-batch's, but 10 minutes still comfortably covers it). Matches the plan's threat-model disposition T-07-23 (accept the small risk of cancelling a legitimately long sweep — every step is idempotent so the next tick resumes cleanly).
- **Metric Alert over native Sentry Crons for the runbook** — the existing heartbeat prior art (`refresh-outlook-subscription.ts`, `stripe-reconcile.ts`) and the two new heartbeats all use `Sentry.captureMessage`, not `Sentry.captureCheckIn`. Sentry's dedicated Crons/Monitors product requires the latter. Recommending it in the runbook without the code to back it would give the founder unfollowable instructions, so the runbook documents the Metric Alert path that works today and notes the check-in-based upgrade as a future, out-of-scope option.
- **Retention/cleanup sweeps left uninstrumented** — `cleanup-stale-summaries`, `spec-draft-cleanup-sweep`, `voice-note-audio-retention-sweep`, and `spec-audio-retention-sweep` are all concurrency-1 with no timeout or heartbeat, but they're outside this plan's `files_modified` scope and weren't implicated in the 4-9 Aug incident. Documented as a known gap in the runbook's inventory table rather than silently fixed (scope-boundary rule) or silently omitted.

## Deviations from Plan

None affecting code or test correctness. One procedural note on Task 2's TDD framing:

**Task 2 TDD sequencing.** The plan places Task 2 (`tdd="true"`, "Cron-hardening regression test") *after* Task 1, which already implements the behavior the test asserts — so writing the test against current source would pass immediately (GREEN) with no natural RED phase. Rather than skip the RED/GREEN verification implied by `tdd="true"`, I verified it out-of-band: extracted the pre-Task-1 versions of both source files via `git show HEAD~1:<path>` into scratch copies, ran the test's exact stripCommentLines + regex assertions against them with a throwaway Node script, and confirmed all four checks failed as expected (no `timeouts` block; the only `Sentry.captureMessage` calls in the old files land after the first `step.run`). Then ran the actual vitest suite against current (Task-1-implemented) source and confirmed 6/6 pass (GREEN). No repo files were touched during the RED check — the pre-Task-1 content only ever existed in throwaway scratch files, never checked out over the working tree. This is documented for traceability, not filed as a Rule 1-4 deviation, since it changed no code or test content, only added a manual verification step.

## Issues Encountered
- **`node_modules` was not installed** in this worktree at session start — ran `corepack pnpm install --frozen-lockfile` before any gate could run. Not a deviation from the plan; a prerequisite for executing it at all.
- **`pnpm build` fails locally on missing env vars** (`SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — this matches the documented project reality ("Vercel build is the real build gate since local `pnpm build` fails on env validation"). To satisfy the plan's specific verification requirement — confirm `GET /api/inngest` still lists both functions and that the unsupported-config-field failure mode doesn't fire — I created a temporary, gitignored `.env.local` with dummy (non-secret, clearly-fake) placeholder values satisfying the Zod schema shape, ran `pnpm build` + `next start` locally, and hit the live introspection endpoint. Response: `{"has_event_key":true,"has_signing_key":true,"function_count":35,"mode":"dev","schema_version":"2024-05-24"}` — a clean 200, no `Invalid function config` warning logged for either target function (Inngest's `configs()` validates every function's config via `functionConfigSchema.safeParse()` and warns per-function on failure; none appeared). `.env.local` and the `.next` build output were deleted afterward and never staged — `git status --short` was empty before the final commits.
- **`next dev` hit the sandbox's OS file-watch (inotify) limit** (Turbopack `FATAL: OS file watch limit reached`) — this is an environment limitation, not a code issue, and unrelated to this plan's changes. Worked around it by using `next build` + `next start` (no file watcher) for the introspection check instead of `next dev`.

## User Setup Required

**External service configuration requires manual action in the Sentry dashboard.** See `docs/cron-monitoring.md` section 3 for the exact steps: create one Metric Alert per heartbeat string (`embed-batch:cron:heartbeat`, `reconcile-cv-parses:cron:heartbeat`, plus the two pre-existing `outlook:cron:heartbeat` and `phase5:stripe-reconcile:heartbeat`), each filtered on `message:"<string>"`, condition "Number of Events is below 1" over a window sized to ~2 missed ticks, with a notification action. No code or env var changes required — this is a one-time Sentry UI setup task for the founder.

Separately (out of scope for this phase, documented in the runbook as the actual root-cause fix): the Inngest account should be upgraded off the free tier — idle crons alone consume roughly half the free tier's monthly step quota, and the account-wide 5-concurrent-step cap plus execution pause on quota exhaustion is the real mechanism behind the 6-9 Aug 2026 silence. This phase's `timeouts` change bounds the blast radius of a single wedged run; it does not remove that ceiling.

## Next Phase Readiness
- Both hardened crons compile, lint clean, and pass the full 786-test suite (68 files, 0 failures) alongside the new 6-test regression file.
- The runbook is ready for the founder to action immediately (Sentry Alert setup, ~10 minutes, no code involved).
- No blockers for the remaining Phase 07 plans — this plan's file scope (embed-batch.ts, reconcile-cv-parses.ts, docs/cron-monitoring.md, the new test file) does not overlap with the CV file-access, confidence-flagging, or field-editing work in the other Phase 07 plans.

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

- FOUND: src/lib/inngest/functions/embed-batch.ts
- FOUND: src/lib/inngest/functions/reconcile-cv-parses.ts
- FOUND: tests/unit/lib/inngest/cron-hardening.test.ts
- FOUND: docs/cron-monitoring.md
- FOUND commit: baf20f7 (feat — timeouts + heartbeats)
- FOUND commit: b65cffc (test — cron-hardening regression test)
- FOUND commit: 851c23b (docs — cron monitoring runbook)
