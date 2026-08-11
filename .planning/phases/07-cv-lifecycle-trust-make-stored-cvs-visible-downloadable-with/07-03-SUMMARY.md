---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 03
subsystem: database
tags: [zod, react-hook-form, supabase, postgres, vitest, embeddings, voyage]

# Dependency graph
requires: []
provides:
  - "editCandidateSchema covers every AI-parsed candidate field (seniority_level, years_experience, salary_current_estimate, salary_expectation, headline, about, skills, sector_tags, work_experience, education), not just the original 8 basics"
  - "UpdateCandidateInput + updateCandidate accept and write all ten new fields"
  - "updateCandidateAction sanitises the whole patch (sanitiseForPostgres) before every write — the third write path to adopt this, after updateCandidateCVParse and markCandidateFieldsFromCV"
  - "Permanent contract test proving invalidate_candidate_embedding's SQL trigger column list and CandidateEmbedFields (embed-text.ts) are identical, catching drift at test time in either direction"
  - "WorkExperienceRow / EducationRow types exported for 07-04's repeating-row form components"
affects: ["07-04 (builds the edit form UI against these contracts)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Numeric edit-form fields stay string-typed with a `.refine()` boundary (not z.coerce.number()) to preserve react-hook-form input/output type alignment under @hookform/resolvers 5 — mirrors jobs/new/schema.ts's numericString pattern"
    - "Array-editor fields (tag inputs, repeating rows) use `.transform()` + `.pipe()` at the array level to drop blanks / filter empty rows — safe because these are not native <input> elements bound 1:1 via register(), unlike the scalar text fields where transform pipelines break RHF resolver type inference"
    - "toNullableString/toNullableNumber helpers preserve `undefined` (field omitted from payload) vs `''` (explicit clear) — required because a still-live older/partial form payload must never collapse an omitted key into a destructive null write"
    - "Record<keyof T, true> object-literal exhaustiveness assertion for binding a test to an unexported type's key set without importing the type — TypeScript's excess-property check fails the build in both directions (field added or removed)"

key-files:
  created:
    - tests/unit/app/candidates/edit-schema.test.ts
    - tests/unit/lib/ai/embedding-invalidation-contract.test.ts
  modified:
    - "src/app/(app)/candidates/[id]/edit/schema.ts"
    - "src/app/(app)/candidates/[id]/edit/actions.ts"
    - src/lib/db/candidates.ts

key-decisions:
  - "Deviated from the plan's literal `x || null` instruction for the ten new scalar fields (Rule 1 — data-safety bug fix): used undefined-preserving toNullableString/toNullableNumber instead, because the current unmodified edit form's payload genuinely omits these keys and `x || null` would silently null out real candidate data on every save made through the old form until 07-04 ships"
  - "Array/row entries over their length cap (100 chars for tags, 255 for row title/company/school/degree) REJECT the whole field rather than truncate, matching the existing spec/[id]/review/actions.ts precedent — an edit-form value is deliberate recruiter input, not an AI-parse guess to coerce"
  - "Chose the Record<keyof T, true> exhaustiveness pattern over the plan-suggested `satisfies readonly (keyof T)[]` array for the contract test's field-list binding, because satisfies-on-an-array only rejects removed keys, not added ones — the Record form catches both directions at compile time"

requirements-completed: [CLT-04]

# Metrics
duration: 15min
completed: 2026-08-11
---

# Phase 7 Plan 03: Edit Schema/Action/DB Contracts + Embedding-Invalidation Drift Contract Test Summary

**Widened `/candidates/[id]/edit`'s write path (schema, action, UpdateCandidateInput) to cover all ten previously-uneditable AI-parsed candidate fields, sanitised at the DB boundary, with zero app-side embedding-invalidation code — backed by a permanent test that proves the existing SQL trigger already covers exactly the right columns.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-11T14:53:39+01:00
- **Completed:** 2026-08-11T15:08:37+01:00
- **Tasks:** 3 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `editCandidateSchema` now validates seniority_level, years_experience, both salary fields, headline, about, skills, sector_tags, work_experience and education — 49 vitest cases cover every behavior case in the plan, including full backward compatibility with the original 8-field payload
- `UpdateCandidateInput` + `updateCandidate` + the edit action write all ten fields to the database, with the entire patch passed through `sanitiseForPostgres` before every write
- Proved (via a from-disk, no-DB-needed SQL parse) that `invalidate_candidate_embedding`'s trigger column list and `candidateEmbeddingText`'s field set are byte-for-byte identical — confirming zero app-side invalidation code is the correct implementation, not an oversight

## Task Commits

Each task was committed atomically:

1. **Task 1: Widen the edit schema** - `9522dc1` (feat)
2. **Task 2: Widen updateCandidate and the edit action** - `da9ab55` (feat)
3. **Task 3: Embedding-invalidation contract test** - `8ccfcc0` (test)

_No TDD RED→GREEN split was needed for Tasks 1/3 (`tdd="true"`) beyond a single commit each — the schema/test were written and passed in one pass since this is greenfield contract code with no pre-existing implementation to make fail first._

## Files Created/Modified
- `src/app/(app)/candidates/[id]/edit/schema.ts` - Widened `editCandidateSchema`; exports `SENIORITY_LEVEL_VALUES`/`LABELS`, `WorkExperienceRow`, `EducationRow`
- `src/app/(app)/candidates/[id]/edit/actions.ts` - Maps + sanitises the ten new fields; `toNullableString`/`toNullableNumber` helpers; comments recording D-08 + the no-invalidation rationale
- `src/lib/db/candidates.ts` - `UpdateCandidateInput` widened with the ten new optional keys
- `tests/unit/app/candidates/edit-schema.test.ts` - 49 cases covering every Task 1 behavior
- `tests/unit/lib/ai/embedding-invalidation-contract.test.ts` - 14 cases: SQL-trigger-vs-embed-field set equality (both directions), a regression pin on the exact 8-column list, and per-field absence checks for the 6 non-search fields

## Decisions Made
- **Undefined-preserving null coercion for the 10 new scalars** (deviation, see below) instead of the plan's literal `x || null` — necessary for data safety given the current form is unmodified until 07-04.
- **Reject-over-truncate for length caps** on tag entries and row fields, matching the existing `spec/[id]/review/actions.ts` precedent.
- **`Record<keyof T, true>` exhaustiveness** for the contract test's compile-time binding to the unexported `CandidateEmbedFields` shape, catching both field-added and field-removed drift at typecheck time (stronger than the plan-suggested `satisfies (keyof T)[]` array, which only catches removal).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / data-safety] Used undefined-preserving null coercion instead of literal `x || null` for the ten new scalar fields**
- **Found during:** Task 2 (edit action)
- **Issue:** The plan's action instructions say to coerce the new fields' `''` to `null` "exactly as the existing eight do (`x || null`)". The existing eight fields' current form (`candidate-edit-form.tsx` + its `defaultValues` in `page.tsx`) is NOT modified by this plan — 07-04 wires the new fields into the UI. Until 07-04 ships, that unmodified form's submitted payload genuinely omits all ten new keys (they are never `undefined`-then-registered, they simply don't exist in the submitted object). `x || null` collapses `undefined` into `null` exactly the same as `''`, so reusing it verbatim would silently NULL OUT seniority_level, years_experience, both salaries, headline, about, skills, sector_tags, work_experience and education on every single save made through the currently-live edit form — a live-data-loss bug on a production system with real candidate rows (per the phase's own "no destructive/irreversible op" constraint).
- **Fix:** Added `toNullableString`/`toNullableNumber` helpers that return `undefined` (skip the column) when the input is `undefined`, and `null` (clear the column) only when the input is the explicit sentinel `''`. Documented the exact reasoning in a comment above the helpers and referenced from the patch-construction comment block.
- **Files modified:** `src/app/(app)/candidates/[id]/edit/actions.ts`
- **Verification:** `pnpm typecheck` clean; full `pnpm vitest run` (843 tests) green; manually traced that `parsed.data.patch.<newField>` evaluates to `undefined` when the current 8-field form's payload is parsed against the widened schema (property access on an absent key), and that `undefined` values are dropped by `JSON.stringify` before reaching PostgREST, so the column is genuinely left untouched.
- **Committed in:** `da9ab55` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — data-safety bug)
**Impact on plan:** Necessary correctness fix, not scope creep. The plan's intent (contracts only, no UI in this plan) is unchanged; only the null-vs-omitted handling inside the already-planned action code was corrected to avoid a live-data-loss regression during the gap between this plan landing and 07-04 shipping the UI that actually exercises these fields.

## Issues Encountered
None beyond the deviation above. The worktree had no `node_modules` at session start (this is a git worktree, not the main checkout) — ran `corepack pnpm install --frozen-lockfile` once to install dependencies (zod 4.4.3, vitest 4.1.6) before any verification could run; not a plan deviation, just environment setup.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 07-04 can now build the repeating-row (work_experience/education) and tag-input (skills/sector_tags) UI components directly against `editCandidateSchema`, `WorkExperienceRow`, `EducationRow`, `SENIORITY_LEVEL_VALUES`/`LABELS` — no further schema changes should be needed.
- 07-04 MUST update `candidate-edit-form.tsx` and `page.tsx`'s `defaultValues` to include all ten new fields (not just render inputs for them) — until it does, the `toNullableString`/`toNullableNumber` undefined-vs-empty distinction in this plan's action is the load-bearing safeguard against silent data loss; 07-04 should not remove or "simplify" those helpers back to `x || null` without first confirming the form always sends all ten keys.
- No blockers. `pnpm lint` (0 errors), `pnpm typecheck` (clean), and the full `pnpm vitest run` (843 passed, 0 failed) all pass on top of this plan's changes; no migration was added; `src/lib/ai/profile-completeness.ts` and `src/lib/ai/embed-text.ts` are untouched (`git diff --stat` empty for both).

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 6 files created/modified by this plan verified present on disk:
`src/app/(app)/candidates/[id]/edit/schema.ts`,
`src/app/(app)/candidates/[id]/edit/actions.ts`, `src/lib/db/candidates.ts`,
`tests/unit/app/candidates/edit-schema.test.ts`,
`tests/unit/lib/ai/embedding-invalidation-contract.test.ts`, and this
SUMMARY.md. All 3 task commit hashes (`9522dc1`, `da9ab55`, `8ccfcc0`)
verified present in `git log --all`.
