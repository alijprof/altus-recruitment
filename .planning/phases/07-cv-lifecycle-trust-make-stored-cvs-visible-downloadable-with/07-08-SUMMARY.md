---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 08
subsystem: testing
tags: [playwright, e2e, smoke-test, cv-lifecycle, vitest, next-build, ci-gates]

# Dependency graph
requires:
  - phase: 07-01..07-07
    provides: CV files section + signed URLs, confidence cue, full parsed-field editing, embedding-invalidation contract, match-score backfill, self-refreshing Explain + Score all, cron hardening
provides:
  - Full autonomous gate sequence run and recorded green (lint, typecheck, vitest, next build, integration suite) for the whole Phase-7 branch
  - New authed browser smoke spec (tests/smoke/authed/cv-lifecycle.smoke.ts) authored, gated, and registered — NOT yet executed
affects: [phase-08-and-later smoke suites, post-merge production verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling smoke spec under a distinct scratch prefix so two write-capable specs' cleanup sweeps can never collide"
    - "Local build gate with git-ignored placeholder env vars as a bonus signal ahead of the real Vercel build gate"

key-files:
  created:
    - tests/smoke/authed/cv-lifecycle.smoke.ts
    - .planning/phases/07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with/07-VERIFICATION.md
  modified: []

key-decisions:
  - "This run is intentionally PARTIAL: only Task 1 (gates) and the authoring/gating half of Task 3 (smoke spec) were in scope. Task 2 (code review) and Task 3's actual execution are deferred by explicit instruction."
  - "pnpm build failed locally on missing env vars (documented pre-existing limitation); created a git-ignored .env.local with non-secret placeholder values to get a genuine local next build signal rather than skipping the gate outright."
  - "cv-lifecycle.smoke.ts's Match-freshness scenario asserts Score all is visible whenever match cards are present, per the plan's literal instruction, with an inline code comment flagging the one edge case (all-cards-already-fresh) it cannot distinguish client-side — documented rather than silently weakened."

patterns-established:
  - "Sibling authed smoke specs share ONE session/env-var guard (SMOKE_ALLOWED_USER_ID) but use DISTINCT scratch-name prefixes so their afterAll sweeps are provably non-interfering."

requirements-completed: []  # CLT-08 not marked complete — Task 3 execution, Task 4 founder sign-off, and Task 2 review are all still outstanding.

# Metrics
duration: partial run (gates + spec authoring only)
completed: 2026-08-11
---

# Phase 7 Plan 08: Full Gates + CV-Lifecycle Smoke Spec (Automated Portion) Summary

**Ran the whole Phase-7 branch through every autonomous gate (all green) and authored a hardened, sibling authed-browser smoke spec for the phase's five write/read surfaces — execution against production and the mechanical code review are explicitly deferred to separate passes.**

## Status: PARTIAL

This SUMMARY documents an intentionally partial execution of 07-08-PLAN.md,
scoped by explicit instruction to:

- Task 1 in full (the complete autonomous gate sequence).
- The AUTOMATED half of Task 3 — authoring `tests/smoke/authed/cv-lifecycle.smoke.ts`
  and gating the file itself (typecheck/lint/prettier/`--list`).

Explicitly NOT done in this run:

- **Task 2** (`/gsd-code-review`) — the orchestrator runs this in parallel via
  a dedicated reviewer agent.
- **Task 3's execution** (`pnpm smoke:auth` against a live session) — the
  phase branch has not been deployed. This repo's documented pattern is that
  the authed smoke suite targets PRODUCTION (`https://altusrecruit.com`)
  post-merge, and there is no captured session
  (`tests/smoke/.auth/prod.json`) in this environment regardless.
- **Task 4** (founder UAT checkpoint) — blocking, requires a human, and per
  the plan itself must not even be presented until Task 3's execution has
  actually passed.

Because of this scope, **CLT-08 is not being marked complete** by this run,
and `STATE.md` / `ROADMAP.md` / `REQUIREMENTS.md` are intentionally left
untouched — see "What's still outstanding" below.

## Accomplishments

- Ran and recorded the complete autonomous gate sequence for the whole
  Phase-7 branch (5144ec7..526cb40, all 7 implementation plans + their
  wave-merge commits): `pnpm lint` (0 errors), `pnpm typecheck` (clean),
  the full `vitest` suite (890 passed, 0 failed, 28 todo), `next build`
  (all 64 routes, including every Phase-7-touched route), and
  `pnpm test:integration` against a real local Supabase stack (25/25
  passed, stack started and stopped cleanly). No dependency and no
  migration were added anywhere in the phase.
- Authored `tests/smoke/authed/cv-lifecycle.smoke.ts` (441 lines) — a
  sibling to the frozen `cv-intake.smoke.ts` under its own distinct scratch
  prefix, covering: the CV files section + real signed-URL download
  (07-01), the unsure-fields confidence cue (07-02), the full parsed-field
  editing round-trip (07-03 + 07-04, "the single most valuable assertion in
  the phase"), and match-freshness copy + the `Score all` control (07-07).
  Copied the hardened session guard, pageerror tracker, and prefix-sweep
  cleanup verbatim from `cv-intake.smoke.ts` per the plan's explicit
  instruction not to re-derive them.
- Gated the new spec file: `pnpm exec prettier --write` (then confirmed
  clean), `pnpm exec eslint` (clean), whole-project `pnpm typecheck`
  (clean), and `pnpm exec playwright test --list` confirmed all 7
  scenarios register correctly alongside the existing two specs (24 tests
  total across 3 files) — a static check only, no browser launched, no
  network call made, nothing written anywhere.

## Task Commits

1. **Task 1: Full autonomous gates** — recorded in `348eded` (docs commit,
   bundled with Task 3's authoring evidence in one `07-VERIFICATION.md`;
   see below).
2. **Task 3 (authoring half): author cv-lifecycle.smoke.ts** — `5a05305`
   (test)
3. **Verification recording (Task 1 + Task 3 authoring evidence)** —
   `348eded` (docs)

No plan-metadata commit was made for this run (no `docs({phase}-{plan}):
complete [plan-name] plan` commit) — this run does not close the plan.

## Files Created/Modified

- `tests/smoke/authed/cv-lifecycle.smoke.ts` — new authed, write-capable
  Playwright smoke spec for Phase 7's surfaces (see Accomplishments above
  for full scenario list).
- `.planning/phases/07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with/07-VERIFICATION.md`
  — verbatim gate results, authoring evidence, and an explicit scope note
  recording what this run did and did not cover.

## Decisions Made

- **Local build gate with placeholder env vars.** `pnpm build` fails out of
  the box on missing env vars (`SUPABASE_SERVICE_ROLE_KEY`,
  `INNGEST_EVENT_KEY`/`SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and — surfaced only once those
  five were fixed — `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`VOYAGE_API_KEY`
  for a client eagerly instantiated at module-load in `/api/inngest`).
  Per project MEMORY the real build gate is Vercel, not local — but rather
  than skip the local build gate outright, created a git-ignored
  `.env.local` with non-secret placeholder values purely to get a genuine
  `next build` Turbopack-compile + typecheck + static-generation signal
  locally. Never staged, never committed (`.env*` is in `.gitignore`).
- **`pnpm test --run` doesn't reach vitest as pnpm intercepts the bare
  `--run` flag.** Documented in 07-VERIFICATION.md; used `pnpm exec vitest
  run` instead, confirmed identical pass count.
- **Match-freshness assertion kept literal, with a documented caveat rather
  than silently weakened.** The plan instructs "Assert the Score all
  control exists when cards are present," but `showScoreAll`
  (`jobs/[id]/matches/page.tsx`) is also `false` when every visible card is
  already fresh — a state the smoke can't distinguish from "no cards"
  purely client-side. Implemented the assertion exactly as the plan states
  and left an inline comment flagging the one edge case where a
  post-merge run could trip on this specifically, rather than either
  weakening the check or silently hoping it never happens.

## Deviations from Plan

None that changed behaviour — this run's only deviations are scope
reductions explicitly directed by the invoking instructions (Task 2 and
Task 3's execution excluded), not unplanned auto-fixes. No Rule 1/2/3
auto-fixes were needed: no bug was found, no missing critical
functionality was found, and nothing blocked completion of the in-scope
work.

## Known Stubs

None — this run added test infrastructure only, no product-facing UI or
data paths.

## Threat Flags

None — `tests/smoke/authed/cv-lifecycle.smoke.ts` operates entirely within
the threat model 07-08-PLAN.md already declares (T-07-38 through T-07-43);
it introduces no new network endpoint, auth path, or schema surface.

## What's still outstanding

Before Task 4's founder checkpoint can legitimately be presented (per
07-08-PLAN.md's own ordering — "This checkpoint sits AFTER the gates, the
code review and both authed smokes"), the following must still happen:

1. **Task 2** — mechanical code review across every file the seven
   implementation plans touched (silent-fail mutations, schema-column
   mismatches, idempotency, cache invalidation, server/browser-client
   boundary, PII-to-Sentry, stray `role="alert"` inside `<main>`). Findings
   recorded in `07-VERIFICATION.md`, gates re-run after remediation.
2. **Task 3 execution** — `pnpm smoke:auth` run against the deployed app
   with a real founder session, confirming BOTH `cv-intake.smoke.ts`
   (frozen Phase-6 suite, must still pass unchanged) and the new
   `cv-lifecycle.smoke.ts` pass together. Results recorded in
   `07-VERIFICATION.md`.
3. **Task 4** — the founder UAT checkpoint itself, once 1 and 2 are green.

## Self-Check: PASSED

- FOUND: `tests/smoke/authed/cv-lifecycle.smoke.ts`
- FOUND: `.planning/phases/07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with/07-VERIFICATION.md`
- FOUND: commit `5a05305` (test(07-08): author cv-lifecycle.smoke.ts)
- FOUND: commit `348eded` (docs(07-08): record Task 1 gate results + Task 3 authoring evidence)
