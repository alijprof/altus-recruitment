---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 09
subsystem: testing
tags: [playwright, e2e, smoke-test, branded-cv, vitest, next-build, ci-gates]

# Dependency graph
requires:
  - phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv- (08-01..08-08)
    provides: candidate_branded_cvs table + org-logos bucket, branding colours + logo upload flow (BCV-04), branded PDF template + zero-AI generation (BCV-01/02/03), single-row regenerate invariant (BCV-06), delivery route + GDPR sweeps (BCV-05/06)
provides:
  - Full autonomous gate sequence run and recorded green for the whole Phase-8 branch (lint, typecheck, full vitest suite, next build local reproduction, prettier)
  - New authed browser smoke spec (tests/smoke/authed/branded-cv.smoke.ts) authored, gated, and registered — NOT yet executed
  - workers: 1 pinned in playwright.smoke-auth.config.ts (closes the Phase-7 STATE.md follow-up on parallel write-capable spec interference)
affects: [any future phase's smoke suite; post-deploy production verification of Phase 8]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling smoke spec under a distinct scratch prefix so three write-capable specs' cleanup sweeps can never collide, with workers: 1 as the actual cross-file interference guard (prefix distinctness alone is insufficient — trigram-fuzzy search matches across prefixes)"
    - "Migration-tolerant smoke: a spec detects a not-yet-migrated feature at its own Generate/first-interaction step and skips every dependent test with an explicit reason, rather than failing against infrastructure that legitimately hasn't shipped to the target database yet"
    - "In-memory-constructed, spec-valid minimal PNG fixture (Buffer + setInputFiles({name, mimeType, buffer})) for an image-upload smoke path, avoiding a new binary fixture file on disk"

key-files:
  created:
    - tests/smoke/authed/branded-cv.smoke.ts
    - .planning/phases/08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-/08-VERIFICATION.md
  modified:
    - playwright.smoke-auth.config.ts

key-decisions:
  - "This run is intentionally PARTIAL: only the authoring/gating half of Task 1 and the autonomous-gates half of Task 2 were in scope. The mechanical code-review half of Task 2, Task 3's actual execution, and Task 4 are deferred by explicit instruction, mirroring 07-08's precedent exactly."
  - "pnpm build failed locally on missing env vars (pre-existing, documented limitation — src/lib/env.ts's zod schema); created a git-ignored .env.local with non-secret placeholder values to get a genuine local next build signal rather than skipping the gate outright, same technique 07-08 used."
  - "The branded-cv.smoke.ts Regenerate assertion checks 'exactly ONE branded-copy line survives a second Generate click' rather than a changed date string — formatDateLong is date-only (day granularity), so two same-day generations render an identical date; the single-row-count check is the honest UI-observable half of the single-row invariant, matching the plan's own framing."
  - "The tiny PNG used for the logo-upload round-trip is a hand-constructed, spec-valid 69-byte 1x1 RGB PNG (correct signature + IHDR + zlib-deflated IDAT + CRC32 per chunk), verified against Pillow at authoring time — not a bare magic-byte stub — because assertUploadableLogo re-sniffs the bytes server-side and the browser's own <Image> preview must actually decode it."

patterns-established:
  - "Sibling authed smoke specs share ONE session/env-var guard (SMOKE_ALLOWED_USER_ID) but use DISTINCT scratch-name prefixes AND rely on workers: 1 (not prefix distinctness alone) for cross-file non-interference."

requirements-completed: []  # BCV-01 through BCV-07 not marked complete — Task 2's code review, Task 3's execution, and Task 4's founder sign-off are all still outstanding.

# Metrics
duration: partial run (authoring + gates only)
completed: 2026-08-12
---

# Phase 8 Plan 09: Full Gates + Branded-CV Smoke Spec (Automated Portion) Summary

**Ran the whole Phase-8 branch through every autonomous gate (all green: 0 lint errors, clean typecheck, 1149/1149 vitest passing, clean local build) and authored a hardened, sibling authed-browser smoke spec covering Generate/Regenerate/View/branding-upload for the phase's Branded CV feature — execution against production and the mechanical code review are explicitly deferred to separate passes.**

## Status: PARTIAL

This SUMMARY documents an intentionally partial execution of 08-09-PLAN.md,
scoped by explicit instruction to:

- Authoring `tests/smoke/authed/branded-cv.smoke.ts` (Task 1's spec-writing
  half) and pinning `workers: 1` in `playwright.smoke-auth.config.ts`.
- The autonomous-gates half of Task 2: `pnpm typecheck`, `pnpm lint`,
  `pnpm exec vitest run` (full suite), `pnpm exec prettier --check` on
  touched files, and a local `pnpm build` reproduction using the documented
  dummy-env technique.

Explicitly NOT done in this run:

- **Task 2's mechanical code review** (`/gsd-code-review`) — the orchestrator
  runs this in parallel via a dedicated reviewer agent.
- **Task 3's execution** (`pnpm smoke:auth --workers=1` against a live
  session) — the phase branch has not been deployed, and the founder's manual
  `db push` for the two Phase-8 migrations (`candidate_branded_cvs`,
  `org-logos` bucket) has not landed on production. Running the smoke before
  that push would only exercise the spec's own migration-tolerant skip path,
  not the real feature.
- **Task 4** (founder UAT checkpoint) — blocking, requires a human, and per
  the plan itself must not even be presented until Tasks 2 and 3 are both
  green.

Because of this scope, **BCV-01 through BCV-07 are not being marked
complete** by this run, and `STATE.md` / `ROADMAP.md` / `REQUIREMENTS.md` are
intentionally left untouched — see "What's still outstanding" below.

## Accomplishments

- Ran and recorded the complete autonomous gate sequence for the current
  Phase-8 worktree: `pnpm lint` (0 errors, 38 pre-existing warnings, none in
  touched files), `pnpm typecheck` (clean), the full `vitest` suite (1149
  passed, 0 failed, 1 skipped, 28 todo), `pnpm build` (Turbopack compile +
  in-build `tsc` + static generation, all routes including
  `/candidates/[id]/branded-cv` and `/settings/branding`), and
  `pnpm exec prettier --check` on both touched files (clean). No dependency
  and no migration were added by this plan.
- Authored `tests/smoke/authed/branded-cv.smoke.ts` (8 scenarios) — a sibling
  to the frozen `cv-intake.smoke.ts` and `cv-lifecycle.smoke.ts`, under its
  own `'GSD Phase08 Smoke'` scratch prefix, covering: scratch candidate
  creation, Tier-1 CV upload + completed parse, Generate (BCV-01) with a
  generated-date assertion, Regenerate (BCV-06) asserting exactly one
  branded-copy line survives a second click, View delivery (BCV-05) via the
  real Playwright download event on the Supabase storage origin (never the
  popup URL, per the Phase-7 addendum lesson), a structural pin that View is
  always a link never a button, Branding settings surfaces (BCV-04) including
  a state-preserving logo upload/remove round-trip that only runs when the
  org currently has no logo configured, the fail-closed prefix-guarded
  `afterAll` sweep, and a final no-uncaught-client-errors check.
  Migration-tolerant by design: detects an absent "Branded CV" section at the
  Generate step and skips every dependent test with an explicit reason,
  matching `branded-cv-panel.tsx`'s own migration-tolerant render contract.
- Pinned `workers: 1` in `playwright.smoke-auth.config.ts` with a rationale
  comment, closing the Phase-7 STATE.md open item: parallel write-capable
  spec runs trip each other's fail-closed sweep guards because trigram-fuzzy
  candidate search matches scratch prefixes across specs regardless of how
  distinct the literal prefix text is.
- Gated the new spec file: `pnpm exec tsc --noEmit`, `pnpm exec eslint`
  (clean on both touched files), `pnpm exec prettier --check` (clean after
  one `--write` pass collapsing a single over-width line), and
  `pnpm exec playwright test --list` confirmed all 8 scenarios register
  correctly alongside the three existing spec files (32 tests total across 4
  files) — a static check only, no browser launched, no network call made,
  nothing written anywhere.
- Confirmed both frozen specs (`cv-intake.smoke.ts`, `cv-lifecycle.smoke.ts`)
  remain byte-identical (`git diff --stat` empty against both).

## Task Commits

1. **Task 1 (authoring): branded-CV smoke spec + serial worker pin** -
   `12dc6b4` (feat)
2. **Style fix: prettier --write on branded-cv.smoke.ts** - `e66de2a` (style)
3. **Task 2 (gates portion): record autonomous gate results** - `45b458e`
   (docs)

No plan-metadata commit was made for this run (no `docs(08-09): complete
[plan-name] plan` commit) — this run does not close the plan.

## Files Created/Modified

- `tests/smoke/authed/branded-cv.smoke.ts` — new authed, write-capable
  Playwright smoke spec for Phase 8's Branded CV surfaces (see
  Accomplishments above for the full 8-scenario list).
- `playwright.smoke-auth.config.ts` — `workers: 1` pinned with a rationale
  comment explaining the cross-file sweep-interference guard.
- `.planning/phases/08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-/08-VERIFICATION.md`
  — verbatim gate results, authoring evidence, and an explicit scope note
  recording what this run did and did not cover.

## Decisions Made

- **Local build gate with placeholder env vars.** `pnpm build` fails out of
  the box on missing env vars (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
  `INNGEST_EVENT_KEY`/`SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, plus `OPENAI_API_KEY`/`VOYAGE_API_KEY`
  for clients instantiated eagerly at module-load). Per project MEMORY the
  real build gate is Vercel, not local — but rather than skip the local build
  gate outright, created a git-ignored `.env.local` with non-secret
  placeholder values purely to get a genuine `next build` Turbopack-compile +
  typecheck + static-generation signal locally. Never staged, never
  committed (`.env*` is in `.gitignore`, confirmed via `git check-ignore`).
- **Regenerate assertion targets row-count, not a changed date string.**
  `formatDateLong` renders day-granularity dates, so two same-day Generate
  clicks produce an identical visible date — asserting "exactly one
  `Branded copy · generated …` line" is the honest UI-observable proof of the
  single-row invariant (BCV-06) available to a browser-only test; a changed
  `generated_at` timestamp is verified at the DB layer by the unit suite, not
  re-derived here.
- **Migration-tolerant skip implemented as a runtime section-presence check,
  not an env-var flag.** The spec navigates to the candidate page and checks
  whether the "Branded CV" `<section>` renders at all before attempting
  Generate — mirroring `branded-cv-panel.tsx`'s own `state.kind ===
  'unavailable'` degrade contract exactly, so the smoke's skip condition can
  never drift out of sync with the app's actual behaviour.
- **Hand-constructed PNG fixture instead of a checked-in binary file.** A
  69-byte, spec-valid 1x1 RGB PNG (correct signature, IHDR, zlib-deflated
  IDAT with correct CRC32, IEND) is embedded as a base64 constant and decoded
  via `Buffer.from(...)` at runtime, passed to `setInputFiles({ name,
  mimeType, buffer })` — avoids adding a new binary fixture to
  `tests/fixtures/`, and is genuinely valid (verified against Pillow at
  authoring time) so both the server-side magic-byte re-sniff
  (`assertUploadableLogo`) and the browser's own `<Image>` preview succeed.

## Deviations from Plan

None that changed behaviour — this run's only deviations are scope
reductions explicitly directed by the invoking instructions (Task 2's code
review and Task 3's execution excluded), not unplanned auto-fixes. One
trivial Rule 1-adjacent formatting fix: `pnpm exec prettier --write` on the
new spec file to collapse a single over-100-char `expect(...).toMatch(...)`
call, caught by the `prettier --check` gate itself — no logic change,
committed separately (`e66de2a`) for a clean diff.

## Known Stubs

None — this run added test infrastructure and a config change only, no
product-facing UI or data paths.

## Threat Flags

None — `tests/smoke/authed/branded-cv.smoke.ts` operates entirely within the
threat model `08-09-PLAN.md` already declares (T-08-56 through T-08-61,
T-08-SC); it introduces no new network endpoint, auth path, or schema
surface. The `workers: 1` pin directly closes T-08-59 (parallel-run
sweep-guard interference).

## Issues Encountered

- `node_modules` was absent in this worktree; ran `pnpm install
  --frozen-lockfile` first (installed exactly what `pnpm-lock.yaml`
  specifies, lockfile itself untouched — confirmed via `git diff --stat
  package.json pnpm-lock.yaml`).
- `pnpm build` needed the placeholder-env-var workaround described above
  (pre-existing, documented limitation, not introduced by this plan).

## User Setup Required

None - no external service configuration required by this run. The two
Phase-8 migrations (`candidate_branded_cvs`, `org-logos` bucket) remain
founder-`db push`-pending per this project's manual-migration workflow —
unrelated to this run's own scope, but a hard prerequisite for Task 3's
eventual execution.

## Next Phase Readiness

- The autonomous half of the phase's acceptance gate is fully green. The
  branded-CV smoke spec is authored, statically verified, and registered.
- Ready for the orchestrator's parallel mechanical code-review pass (Task 2's
  remaining half) and, once that closes and the founder has pushed the two
  pending migrations plus deployed the branch, Task 3's real execution
  against production.
- No blockers for those next steps. This run makes no claim about the
  feature's real-browser behaviour beyond what `--list` (static enumeration)
  can prove — that remains Task 3's job.

## What's still outstanding

Before Task 4's founder checkpoint can legitimately be presented (per
08-09-PLAN.md's own ordering), the following must still happen:

1. **Task 2 (code review)** — mechanical review across every file the eight
   implementation plans (08-01 through 08-08) touched (silent-fail
   mutations, schema-column mismatches, idempotency, cache invalidation,
   server/browser-client boundary, PII-to-Sentry, the fire-and-forget
   promise class). Findings recorded in `08-VERIFICATION.md`, gates re-run
   after remediation.
2. **Founder's manual migration push** — `candidate_branded_cvs` and
   `org-logos` bucket migrations must land on production
   (`pnpm exec supabase db push --linked`) before Task 3 can exercise the
   real feature rather than its migration-tolerant skip path.
3. **Deploy** — the Phase-8 branch must reach production so `pnpm smoke:auth`
   has something real to test against.
4. **Task 3 execution** — `pnpm smoke:auth --workers=1` run against the
   deployed app with a real founder session, confirming all four specs
   (`cv-intake`, `cv-lifecycle`, `read-only`, and the new `branded-cv`) pass
   together. Results recorded in `08-VERIFICATION.md`.
5. **Task 4** — the founder UAT checkpoint itself, once 1-4 are green.

## Self-Check: PASSED

- FOUND: `tests/smoke/authed/branded-cv.smoke.ts`
- FOUND: `.planning/phases/08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-/08-VERIFICATION.md`
- FOUND: commit `12dc6b4` (feat(08-09): branded-CV authed smoke spec + serial worker pin)
- FOUND: commit `e66de2a` (style(08-09): prettier --write on branded-cv.smoke.ts)
- FOUND: commit `45b458e` (docs(08-09): record Task 1 authoring evidence + Task 2 autonomous gate results)

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12 (partial run)*
