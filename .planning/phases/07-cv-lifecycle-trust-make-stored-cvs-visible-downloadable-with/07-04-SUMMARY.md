---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 04
subsystem: ui
tags: [react-hook-form, zod, radix, shadcn, accordion, vitest, testing-library]

# Dependency graph
requires:
  - phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
    provides: "07-03's widened editCandidateSchema, updateCandidateAction, UpdateCandidateInput, and the undefined-vs-cleared toNullableString/toNullableNumber write-path guard"
provides:
  - "TagInput — dependency-free controlled chip input (Input + Badge) for text[] fields; Enter/comma commit, case-insensitive dedupe, Backspace-pop, per-tag named remove controls"
  - "RepeatingRows — generic controlled add/remove row editor driven by a field spec, shared by work_experience and education"
  - "/candidates/[id]/edit now edits all 10 previously-uneditable AI-parsed fields (seniority_level, years_experience, salary_current_estimate, salary_expectation, headline, about, skills, sector_tags, work_experience, education) alongside the original 8, in a collapsible Accordion (Basics open by default)"
affects: ["07-08 (smoke spec drives this expanded form)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite form controls (TagInput) declare id/aria-describedby/aria-invalid props explicitly and forward them to their inner native <Input>, so the existing FormControl-Slot pattern (used already for Select) keeps working for non-native controls without any change to form.tsx"
    - "Radix Select forbids an empty-string item value; a local sentinel constant (translated back to '' in onValueChange, and only used to derive the Select's displayed `value`) is the pattern for schema fields whose legitimate 'cleared' value is ''"
    - "Row-array editors (RepeatingRows) are NOT wrapped with id/aria-describedby forwarding — FormLabel above them is a section heading, not a single-control label; each row's own per-field <Label htmlFor> is the real accessible-name source, scoped per row via role=\"group\" aria-label"

key-files:
  created:
    - src/components/app/tag-input.tsx
    - src/components/app/repeating-rows.tsx
    - tests/unit/components/tag-input.test.tsx
  modified:
    - "src/app/(app)/candidates/[id]/edit/page.tsx"
    - "src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx"

key-decisions:
  - "Defensive jsonb-row parsers for work_experience/education were duplicated locally in edit/page.tsx (not lifted to a shared module) — only two consumers exist (this page and the candidate detail page), so a shared module would trade one duplicate parser for a new file plus an import-path change to the untouched detail page, neither of which was in this plan's files_modified list. Lift becomes worthwhile only if/when a third consumer appears."
  - "seniority_level's stored value is defensively re-validated against SENIORITY_LEVEL_VALUES in edit/page.tsx (falls back to '' / \"Not set\") even though the column is untyped `text` — an off-vocabulary historical value must not be handed to the closed-enum Select, matching the jsonb-row defensive-parse spirit T-07-16 asks for"

requirements-completed: [CLT-04]

# Metrics
duration: 20min
completed: 2026-08-11
---

# Phase 7 Plan 04: TagInput, RepeatingRows, Expanded Collapsible Candidate Edit Form Summary

**Built the full parsed-field editing UI on `/candidates/[id]/edit` — a dependency-free TagInput and a generic RepeatingRows editor, wired into a 7-section collapsible Accordion form that now writes all 10 previously-uneditable AI-parsed candidate fields through 07-03's contracts.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-11T15:57Z (worktree reset to 07-03's landed base)
- **Completed:** 2026-08-11T16:09Z
- **Tasks:** 2 completed
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- `TagInput` composes the existing `Input` + `Badge` primitives into a controlled chip input — no hand-rolled input styling, no new dependency; 8 vitest + testing-library cases cover every behavior case from the plan (Enter, comma-split, case-insensitive dedupe, whitespace rejection, per-tag remove, Backspace-pop, onChange contract, controlled render)
- `RepeatingRows` is one generic component (not two near-identical editors) driving both work_experience `{title, company, dates}` and education `{school, degree, dates}` off a field spec
- `/candidates/[id]/edit` now has 7 collapsible sections (Basics / Profile / Experience & seniority / Compensation / Skills & sectors / Work history / Education); Basics — the original 8 fields — is unchanged pixel-for-pixel and open by default
- `page.tsx`'s `defaultValues` now covers every schema field, with defensive parsing for the two jsonb array columns (empty-string defaults, not null, since RepeatingRows binds to controlled `<Input value=...>`) and a defensive re-validation of the stored `seniority_level` string against the closed enum before handing it to the Select

## Task Commits

Each task was committed atomically:

1. **Task 1: TagInput and RepeatingRows components** - `f374087` (feat)
2. **Task 2: Expand the edit page and form** - `c67b4bf` (feat)

## Files Created/Modified
- `src/components/app/tag-input.tsx` - Controlled chip input over `Input`/`Badge`
- `src/components/app/repeating-rows.tsx` - Controlled generic add/remove row editor
- `tests/unit/components/tag-input.test.tsx` - 8 behavior cases for TagInput
- `src/app/(app)/candidates/[id]/edit/page.tsx` - `defaultValues` widened to all 10 new fields; local defensive jsonb-row parsers; `toSeniorityLevelValue` enum guard
- `src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx` - Accordion-wrapped 7-section form; `SENIORITY_NOT_SET` sentinel for the Select; `toRepeatingRowValues` adapter for the two array editors

## Decisions Made
- Kept the jsonb-row parsers as a second, edit-page-local copy rather than extracting a shared module (see frontmatter `key-decisions` — only two consumers exist today, and a shared module wasn't in this plan's `files_modified`).
- Comma-splitting in `TagInput` happens in `onChange` (post-DOM-commit), not `onKeyDown` — the comma character isn't in a controlled input's committed value yet at keydown time, so splitting there would miss the just-typed comma.
- `seniority_level`'s Radix `Select` uses a local `__not_set__` sentinel translated to `''` on change and back on render, since Radix forbids an empty-string `SelectItem` value but `''` is the schema's real "cleared" sentinel.

## Deviations from Plan

None — plan executed as written. The worktree required a `git reset --hard` to the phase's wave-1 merge commit (`2582fd8`) before starting, per the plan's own `<worktree_branch_check>` instruction — the worktree's branch tip predated 07-03 landing, so `schema.ts`/`actions.ts` were still the pre-07-03 8-field versions until the reset. This is the mandated setup step, not a plan deviation.

## Issues Encountered
- `pnpm build` fails locally on Zod env-var validation (`SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` all "undefined") — this worktree has no `.env.local` (secrets live only in Vercel, per project MEMORY `smoke-auth-deterministic-mint` / `vercel-project-ids`). The build's own TypeScript pass ("Finished TypeScript in 14.0s") completed with zero errors before the env-var check aborted the run, and a separate standalone `pnpm exec tsc --noEmit -p .` (the actual type-correctness gate) passed clean with no output. Treating this as the documented pre-existing local-build limitation, not a regression introduced by this plan — Vercel's build (with real secrets) is the real gate per the same MEMORY entry.
- `node_modules` was absent at session start (worktree, not the primary checkout) — ran `corepack pnpm install --frozen-lockfile` once before any verification could run; not a plan deviation, just environment setup (same as 07-03 noted).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `pnpm exec tsc --noEmit -p .` — clean, zero errors.
- `pnpm exec eslint` on all 5 changed/created files — clean, zero errors/warnings.
- `pnpm exec prettier --check` — clean after one `--write` pass (line-wrap only, no logic changes).
- `pnpm vitest run` — 877 passed, 28 todo, 0 failed (up from 07-03's 843; the 8 new TagInput tests plus any other suite growth since — no regressions).
- `git diff --stat -- package.json pnpm-lock.yaml` — empty; no dependency was added (threat T-07-19 held).
- The eight original Basics fields render and submit exactly as before — same field names, same `FormField`/`FormControl` wiring, same submit-handler branches (`fieldErrors` → `setError`, `formError` → toast, no success branch since the action redirects); only the surrounding markup changed (now inside an `AccordionItem`).
- 07-08's smoke spec can target: TagInput's per-tag remove buttons by `role=button, name="Remove {tag}"`; each RepeatingRows row by `role=group, name="{rowLabel} {n}"` with per-field `getByLabelText` scoped inside it; every new scalar field by its visible `FormLabel` text (`Headline`, `About`, `Seniority`, `Years experience`, `Current salary (est.)`, `Expected salary`).
- No blockers for 07-05 through 07-08. Per CLAUDE.md's mandatory pre-UAT pipeline, this plan's automated gates (typecheck/lint/tests) are complete, but the full `/gsd-code-review` + authenticated browser pre-smoke walkthrough of this specific form (save/reload round-trip, accordion expand/collapse, tag add/remove, row add/remove) has not been run as part of this execute-plan pass — that belongs to the phase's dedicated review/smoke step (07-08 per the plan's own cross-reference), not this UI-build plan.

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 6 files created/modified by this plan verified present on disk:
`src/components/app/tag-input.tsx`, `src/components/app/repeating-rows.tsx`,
`tests/unit/components/tag-input.test.tsx`,
`src/app/(app)/candidates/[id]/edit/page.tsx`,
`src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx`, and this
SUMMARY.md. Both task commit hashes (`f374087`, `c67b4bf`) verified present
in `git log --all`.
