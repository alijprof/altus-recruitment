---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 02
subsystem: candidates-cv
tags: [nextjs, react-server-components, confidence-scoring, shadcn-ui]

# Dependency graph
requires:
  - phase: 06-cv-parse-hardening
    provides: "parse-messages.ts shared predicate module, cv-review-panel.tsx CvReviewPanel, confidence-badge.tsx ConfidenceBadge component"
  - phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
    provides: "07-01: cv-file-display.ts (cvDisplayFilename, isCvFileDownloadable), CvFileLink client control"
provides:
  - "summariseConfidence / CV_FIELD_LABELS pure module (src/lib/cv/confidence-summary.ts)"
  - "Amber 'N fields unsure' badge + named-field summary line on the Latest CV panel (D-02)"
  - "CvFileLink inline on the Latest CV panel header row (D-01 sibling surface)"
affects: [07-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure aggregation modules under src/lib/cv/ with no 'import server-only', so a server component (page.tsx), a client component (cv-review-panel.tsx), and a future Playwright spec (07-08) can all import the same source of truth — mirrors parse-messages.ts and cv-file-display.ts"
    - "Badge rendered as a flex-row SIBLING of a Sheet's trigger button (not nested inside it) to keep the trigger's accessible name stable for role/name-based test locators — Radix Dialog.Root renders no DOM node of its own, so this is a real DOM sibling, not just visual"

key-files:
  created:
    - src/lib/cv/confidence-summary.ts
    - tests/unit/lib/cv/confidence-summary.test.ts
  modified:
    - src/app/(app)/candidates/[id]/cv-review-panel.tsx
    - src/app/(app)/candidates/[id]/page.tsx

key-decisions:
  - "summariseConfidence is a total function: any non-plain-object extracted_data (null, string, number, array, undefined) or non-plain-object confidence_per_field returns the zero result rather than throwing — stored rows predate the Phase 6 coercion boundary and the reconciler still re-processes them (T-07-07)"
  - "CV_FIELD_LABELS became the single source of truth for both the review sheet's row order and the unsure-summary's field order, replacing cv-review-panel.tsx's local FIELD_LABELS array verbatim — the badge/summary line can now never name a field the sheet doesn't also show"
  - "Badge + summary line render only in CompleteState and only when unsureCount > 0 — no confidence data (or all-high) renders neither element, per D-02"
  - "confidence prop is computed once, server-side, in page.tsx only when latestCv.parsing_status === 'complete' — PendingState/FailedState never receive or evaluate it"

patterns-established:
  - "CV_FIELD_LABELS / summariseConfidence sit alongside cv-file-display.ts as the second pure, dependency-free src/lib/cv/ module shared across RSC + client + future Playwright layers"

requirements-completed: [CLT-03]

# Metrics
duration: 15min
completed: 2026-08-11
---

# Phase 7 Plan 02: "N fields unsure" Badge + Named-Field Summary Summary

**An amber "N fields unsure" badge now sits beside the Review button on every candidate's Latest CV panel, with a one-line summary naming exactly those fields underneath — surfacing the low/medium-confidence data that was previously locked inside a sheet nobody opened.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-11T15:57:00+01:00
- **Completed:** 2026-08-11T16:08:00+01:00
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `summariseConfidence` (pure, total, dependency-free) aggregates a candidate_cvs row's `confidence_per_field` into `{ unsureCount, unsureFields }`, walking the shared `CV_FIELD_LABELS` declaration order so the summary line always reads in the same order the review sheet renders its rows.
- `CV_FIELD_LABELS` replaces cv-review-panel.tsx's local `FIELD_LABELS` array — one source of truth for both surfaces, so the badge/summary can never name a field the sheet itself doesn't show.
- The candidate detail page's Latest CV panel now shows, for any completed parse with 1+ low/medium fields: an amber `{n} field(s) unsure` badge as a DOM sibling of the "Review extracted data" button, and a muted `Unsure: Current role, Skills, Seniority.` line beneath it. A parse with no confidence data or all-high fields shows neither element.
- The same panel's header row also now surfaces the filename, upload date, and the existing `CvFileLink` "View" control from Plan 07-01 — closing that plan's remaining "Latest CV panel" sibling-surface clause (D-01) inline, using `cvDisplayFilename` / `isCvFileDownloadable` as-is (no re-derivation).

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure confidence-summary module** - `9110e86` (feat) — includes its unit test in the same commit (see TDD Gate Compliance below)
2. **Task 2: Render the unsure cue + file link on the Latest CV panel** - `1de358c` (feat)

_No plan-metadata commit was made — per this run's executor instructions, SUMMARY.md/STATE.md/ROADMAP.md are left for the orchestrator to commit (wave-1 agents committing them caused merge conflicts)._

## Files Created/Modified

- `src/lib/cv/confidence-summary.ts` — `summariseConfidence`, `CV_FIELD_LABELS`, `ConfidenceSummary` type. No `import 'server-only'`; only dependency is the `ConfidenceLevel` type from `confidence-badge.tsx`.
- `tests/unit/lib/cv/confidence-summary.test.ts` — 13 cases covering every behaviour bullet in the plan (counting, human-label mapping, declaration-order preservation, high-confidence exclusion, missing/malformed `confidence_per_field`, every non-object `extracted` shape never throwing, unknown confidence values ignored, unknown keys ignored) plus a `CV_FIELD_LABELS` order/key assertion.
- `src/app/(app)/candidates/[id]/cv-review-panel.tsx` — deleted the local `FIELD_LABELS` array (now imports `CV_FIELD_LABELS`); threaded a new optional `confidence` prop through `CvReviewPanelProps` into `CompleteState`; `CompleteState` header row now renders filename + upload date + `CvFileLink`; the Review-button row wraps the `Sheet` and a conditional amber `Badge` (with an `aria-label` naming the fields) in a flex row so the badge is a true DOM sibling, never a child, of the trigger button; a conditional muted summary line sits beneath. No `role="alert"` introduced anywhere in `CompleteState`.
- `src/app/(app)/candidates/[id]/page.tsx` — imports `summariseConfidence`; computes `confidenceSummary` server-side (only when `latestCv?.parsing_status === 'complete'`) and passes it to `<CvReviewPanel confidence={confidenceSummary} />`.

## Decisions Made

- Kept the badge/summary derivation as two locally-computed variables (`unsureCount`, `unsureFields`) in `CompleteState` rather than repeated optional-chaining/non-null-assertion on the `confidence` prop — cleaner under `noUncheckedIndexedAccess` strict mode and avoids `!` assertions.
- `CvFileLink` is now rendered in two places for a candidate's latest CV (the Latest CV panel header row, and again in the always-present CV files panel from Plan 07-01) — both are legitimate independent "View" controls for the same row; neither the plan nor any smoke assertion queries "View" by unique role+name globally, so this is not a conflict.
- Used a throwaway, gitignored `.env.local` (same pattern as 07-01) to push `pnpm build` past `src/lib/env.ts` zod validation locally, plus `OPENAI_API_KEY`/`VOYAGE_API_KEY` dummy values needed for `/api/inngest` page-data collection to succeed on this Next.js version. Confirmed full Turbopack build (including `/candidates/[id]`) succeeds, then deleted the file — nothing env-related was committed.

## Deviations from Plan

None — plan executed exactly as written. The only notable observation is a pre-existing, out-of-scope condition (see below), not a deviation caused by this plan's own tasks.

### Out-of-scope discovery (NOT fixed — logged, not touched)

- **`src/app/(app)/candidates/[id]/page.tsx` still fails `prettier --check` on regions this plan never touched** — the same pre-existing drift documented in `07-01-SUMMARY.md` (installed `prettier` 3.8.3 vs. the `^3.3.3` pin reformats `FieldGroup`'s destructure, `formatSalary`'s param wrapping, the `CandidateDetailPage` signature, a ternary/ Tailwind class-order swap, etc.). Diffed the full-file `prettier --write` output against the committed file to confirm every hunk sits in lines this plan's own two tasks never touched — the `summariseConfidence` import, the `confidenceSummary` computation, and the `confidence={confidenceSummary}` prop line are all already prettier-clean. `pnpm lint` (the actual verify gate) passes; ESLint's `eslint-config-prettier` disables conflicting rules rather than enforcing formatting. Left untouched per the scope-boundary rule, same as 07-01.

---

**Total deviations:** 0 auto-fixed, 1 out-of-scope discovery logged (not fixed, pre-existing, confirmed unrelated to this plan's diff)
**Impact on plan:** No functional or security impact. No scope creep.

## TDD Gate Compliance

Task 1 carried `tdd="true"`. As in 07-01, this plan's frontmatter is `type: execute` (not `type: tdd`), so the plan-level RED→GREEN gate-sequence enforcement doesn't formally apply — but the general per-task TDD flow calls for a RED (failing test) commit before a GREEN (passing implementation) commit.

**Deviation:** the test file and the implementation module were authored together and committed as a single `feat(07-02): Task 1: pure confidence-summary module` commit (`9110e86`), not as separate `test(...)` → `feat(...)` commits — matching the same pattern 07-01 used. All 13 test cases were written directly from the plan's `<behavior>` bullets, and `pnpm vitest run tests/unit/lib/cv/confidence-summary.test.ts` was green (13/13) before moving to Task 2. No functional risk: the module is pure, has full behaviour-bullet coverage, and the full `pnpm vitest run` (882 passed, 0 failed, no new failures vs. the 07-01 baseline of 793) confirms no regression.

## Issues Encountered

- Local `pnpm build` fails on `src/lib/env.ts` zod validation with no `.env.local` present (documented, pre-existing project reality — Vercel is the real build gate) and, this run, also on `/api/inngest` page-data collection without dummy `OPENAI_API_KEY` — worked around with a throwaway, gitignored, dummy-valued `.env.local` (deleted before finishing). No real credentials used or exposed.
- No `pnpm`/`corepack enable` binary was pre-provisioned in this worktree's shell; used `corepack pnpm <cmd>` (corepack's direct package-manager invocation, no shim install) throughout instead of a bare `pnpm` command.

## User Setup Required

None — no external service configuration required. No migration was added or needed.

## Next Phase Readiness

- `CV_FIELD_LABELS` / `summariseConfidence` / `ConfidenceSummary` are stable, importable contracts ready for Plan 07-08's Playwright smoke coverage (the same "import, don't duplicate" pattern `parse-messages.ts` and `cv-file-display.ts` already established for that spec).
- The Latest CV panel's badge/summary/file-link surface is complete for D-02 and closes the remaining D-01 "Latest CV panel" clause from Plan 07-01.
- No blockers. All plan verification gates green: `pnpm typecheck`, `pnpm lint` (0 errors — 32 pre-existing warnings unrelated to this plan's files), `pnpm build` (with local dummy env), `pnpm vitest run tests/unit/lib/cv/confidence-summary.test.ts` (13/13), and the full `pnpm vitest run` (882 passed, 28 todo, no new failures).

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 4 created/modified files confirmed present on disk; both commits
(`9110e86`, `1de358c`) confirmed present in `git log`.
