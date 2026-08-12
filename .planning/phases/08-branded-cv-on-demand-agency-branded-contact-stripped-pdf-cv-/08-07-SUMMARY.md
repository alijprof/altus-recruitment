---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 07
subsystem: candidates
tags: [server-actions, supabase-storage, migration-tolerance, pdf, react-pdf, entitlement]

# Dependency graph
requires:
  - phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
    provides: "08-01 candidate_branded_cvs migration (unapplied), 08-04 renderBrandedCv/BrandedCvDocument, 08-05 downloadOrgLogo/getOrganization.logo_storage_path"
provides:
  - "candidate_branded_cvs db helper (getBrandedCvForCandidate, getBrandedCvState tri-state, upsertBrandedCv) — migration-tolerant via isMissingTableError"
  - "generateBrandedCvAction — synchronous, zero-AI, UNGATED-by-billing Server Action that renders + stores an agency-branded, contact-stripped PDF from a candidate's current data"
  - "Branded CV section (BrandedCvPanel + BrandedCvGenerateButton) on the candidate detail page — self-hides pre-migration"
affects: [08-08-branded-cv-delivery-and-export-audit, 08-09-acceptance-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tri-state DB read (ready/none/unavailable) instead of widening the shared DbResult union — lets a UI hide a feature deployed ahead of its migration without a code-level error state"
    - "Write-new-then-delete-old regeneration: upload to a fresh Storage path, upsert the row, THEN best-effort remove the prior object — a mid-regeneration crash leaves the OLD copy servable"
    - "Explicit read-then-update-or-insert (not a PostgREST upsert) so the caller can report the previous storage_path for cleanup, with 23505-recovery on a concurrent-insert race"
    - "Deliberately ungated Server Action (no requireEntitledOrg) documented with an explicit founder-decision rationale comment, mirroring cv-file/[cvId]/route.ts's precedent"

key-files:
  created:
    - src/lib/db/candidate-branded-cvs.ts
    - src/app/(app)/candidates/[id]/branded-cv-panel.tsx
    - src/app/(app)/candidates/[id]/branded-cv-generate-button.tsx
    - tests/unit/lib/db/candidate-branded-cvs.test.ts
    - tests/unit/app/candidates/generate-branded-cv-action.test.ts
  modified:
    - src/lib/db/postgrest-errors.ts
    - src/app/(app)/candidates/[id]/actions.ts
    - src/app/(app)/candidates/[id]/page.tsx

key-decisions:
  - "generateBrandedCvAction is deliberately UNGATED by requireEntitledOrg() — founder decision 2026-08-12 (T-08-39); auth + the RLS-scoped candidate read are the only gates, matching the cv-file/[cvId]/route.ts no-data-hostage precedent."
  - "Missing-table detection crosses the db-helper/action boundary via DbResult.detail's leading SQLSTATE/PostgREST code (failureDetail's 'CODE (subop)' format), not a widened DbResult union — keeps every existing DbResult consumer's exhaustiveness unchanged."
  - "downloadOrgLogo's SniffedImageType ('png'|'jpeg'|'unknown') is narrowed to BrandedCvBranding's 'png'|'jpeg' at the generateBrandedCvAction call site (the helper's own contract already guarantees a non-null return is never 'unknown') rather than widening the PDF template's prop type."

patterns-established:
  - "Migration-tolerant db helper pattern: isMissingTableError (postgrest-errors.ts) + a tri-state resolver type, for any future table that can reach production ahead of its hand-pushed migration."

requirements-completed: [BCV-01, BCV-06, BCV-07]

# Metrics
duration: 30min
completed: 2026-08-12
---

# Phase 8 Plan 07: On-demand Branded CV generation Summary

**Zero-AI, ungated-by-billing Server Action that renders and stores an agency-branded, contact-stripped PDF from a candidate's current data, plus a self-hiding candidate-page control that triggers it.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments
- `candidate_branded_cvs` db helper (`src/lib/db/candidate-branded-cvs.ts`) that degrades to `{ kind: 'unavailable' }` — never throws, never widens the shared `DbResult` union — when the table isn't migrated yet, via a new `isMissingTableError` predicate (42P01/PGRST205) added to `postgrest-errors.ts` next to the existing `isMissingColumnError`.
- `generateBrandedCvAction`: candidate read → org read → optional logo download → in-process `renderBrandedCv` → Storage upload of a fresh path → row upsert → best-effort removal of the previous object. Deliberately carries NO `requireEntitledOrg()` gate, with the founder's rationale documented inline. Pinned by test: `inngest.send` never fires, `fetch` never fires, no `@/lib/ai` import anywhere in the file, `requireEntitledOrg` never called on any path.
- `BrandedCvPanel` (server) + `BrandedCvGenerateButton` (client) wired into the candidate detail page immediately after `CvFilesPanel`, reading `getBrandedCvState` alongside the existing `listCandidateCVs` call. Renders nothing when the table is unavailable; no `role="alert"`, no relative timestamps — the frozen Phase-6 CV-intake smoke spec is untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: candidate_branded_cvs db helper (migration-tolerant)** - `f8db4be` (test — see TDD Gate Compliance note below)
2. **Task 2: generateBrandedCvAction** - `0909e06` (test, RED) then `6602d80` (feat, GREEN)
3. **Task 3: Branded CV section on the candidate page** - `4bbbc04` (feat)

## Files Created/Modified
- `src/lib/db/postgrest-errors.ts` - added `isMissingTableError` (42P01/PGRST205), documented next to `isMissingColumnError`
- `src/lib/db/candidate-branded-cvs.ts` - `BrandedCvRow`, `BrandedCvState` tri-state, `getBrandedCvForCandidate`, `getBrandedCvState`, `upsertBrandedCv` (explicit read-then-update-or-insert with 23505 race recovery)
- `src/app/(app)/candidates/[id]/actions.ts` - `generateBrandedCvAction` added alongside the existing mutations; imports `downloadOrgLogo`, `upsertBrandedCv`, `getOrganization`, `toBrandedCvData`, `renderBrandedCv`
- `src/app/(app)/candidates/[id]/branded-cv-panel.tsx` - server component: tri-state render, Generate/Regenerate control, `BRANDED_CV_FREE_TEXT_WARNING` helper text
- `src/app/(app)/candidates/[id]/branded-cv-generate-button.tsx` - client component: `useTransition` + `generateBrandedCvAction` + toast + `router.refresh()`, no polling/popup
- `src/app/(app)/candidates/[id]/page.tsx` - calls `getBrandedCvState`, renders `<BrandedCvPanel>` after `CvFilesPanel`
- `tests/unit/lib/db/candidate-branded-cvs.test.ts` - 24 tests: `isMissingTableError` code matrix, tri-state resolver (ready/none/unavailable, including the "any other error also degrades, never throws" case and the "missing-table degrades via breadcrumb not captureException" case), insert-vs-update branching, 23505 race recovery, organization_id-never-set-from-argument pin
- `tests/unit/app/candidates/generate-branded-cv-action.test.ts` - 13 tests: non-uuid rejection, no-entitlement-gate pin (afterEach-enforced across every test), unauth/tenancy-not-found paths, exact happy-path call order, logo-download skip when unset, regeneration remove-after-upsert ordering, failed-upload/failed-upsert/failed-logo-download degrade paths, missing-table friendly message, PII-free Sentry capture, static "no `@/lib/ai` import" pin

## Decisions Made
- **No entitlement gate on `generateBrandedCvAction`** (founder decision 2026-08-12, T-08-39 in the plan's threat register): implemented exactly as specified — no `requireEntitledOrg()` call, no `ENTITLEMENT_BLOCKED_MESSAGE` import for this action, with an inline rationale comment mirroring `cv-file/[cvId]/route.ts`'s precedent. Auth (`getUser()`) and the RLS-scoped candidate read are the only gates.
- **Missing-table signal crosses the db-helper → action boundary via `DbResult.detail`'s leading SQLSTATE/PostgREST code** rather than a widened `DbResult` union member, per the plan's explicit "do NOT widen the shared DbResult union" instruction. `upsertBrandedCv` produces `detail: '42P01 (candidate_branded_cvs.select)'` (via the existing `failureDetail` helper's `"CODE (subop)"` format); the action's `isMissingTableDetail()` checks the leading token. This keeps `BrandedCvState`'s `unavailable` member the ONLY place that concept exists as a first-class type.
- **`downloadOrgLogo`'s return type narrowing**: `SniffedImageType` includes `'unknown'`, but `downloadOrgLogo` never actually returns `'unknown'` on a non-null result (it returns `null` itself in that case) — TypeScript can't see that invariant, so the call site narrows explicitly (`format !== 'unknown'`) rather than widening `BrandedCvBranding['logo']`'s type, which would weaken the PDF template's own compile-time guarantee.

## Deviations from Plan

None functionally — all three tasks implement exactly what BCV-01/06/07 and the plan's interfaces specify: same happy-path call order, same write-new-then-delete-old ordering, same no-entitlement rationale, same tri-state migration tolerance, same "no View/Download control yet" scope boundary.

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type-narrowed `downloadOrgLogo`'s `SniffedImageType` at the `generateBrandedCvAction` call site**
- **Found during:** Task 2, `pnpm typecheck`
- **Issue:** `downloadOrgLogo` returns `{ data; format: 'png' | 'jpeg' | 'unknown' } | null`; `BrandedCvBranding['logo']` (08-04) only accepts `'png' | 'jpeg'`. A direct assignment failed `tsc --noEmit`.
- **Fix:** Narrowed with an explicit `format !== 'unknown'` check at the call site (the helper's own contract already guarantees a non-null return is never `'unknown'`), rather than widening the PDF template's prop type.
- **Files modified:** `src/app/(app)/candidates/[id]/actions.ts`
- **Verification:** `pnpm typecheck` clean; test suite green.
- **Committed in:** `6602d80` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — type-safety, no behaviour change)
**Impact on plan:** No scope creep; the fix only makes an already-correct runtime invariant visible to the type checker.

## TDD Gate Compliance

Task 2 (`generateBrandedCvAction`) followed the full RED → GREEN cycle: `0909e06` (test, 12/13 failing with `generateBrandedCvAction is not a function`, confirmed before implementation) → `6602d80` (feat, all 13 green).

Task 1 (`candidate_branded_cvs` db helper) is marked `tdd="true"` in the plan but landed as a **single combined commit** (`f8db4be`, labeled `test(...)`) containing both the test file and the implementation — the RED phase (a verified-failing test run before the implementation existed) was not separately committed. All 24 tests were run and confirmed green before commit, and the implementation was verified against the plan's seven listed behaviours one-for-one, so there is no functional gap — this is a process note, not a correctness concern. Flagging per the TDD Gate Compliance instruction rather than silently passing over it.

## Issues Encountered
- The initial worktree HEAD was on a stale Phase-7 line (missing all Phase-8 work through the 08-05 merge). Corrected per the mandatory `<worktree_branch_check>` protocol: working tree was clean, so `git reset --hard` to the orchestrator-specified base commit (`afae0fd5`) was safe and expected — not a deviation, this is the documented startup procedure.
- Two self-caught bugs in my own new test file before first green run: (1) the static "no `@/lib/ai` import" regex initially matched the literal string inside my own explanatory code comment — narrowed the regex to only match actual `from '@/lib/ai...'` import syntax; (2) a `createClient` mock spread-argument typed as a 0-arity function tripped `tsc` (TS2556) — simplified to a no-arg call, matching the real `createClient()` signature. Both fixed before any commit; neither reached a committed state as a bug.

## User Setup Required
None - no external service configuration required. (The `candidate_branded_cvs` table itself is still pending the founder's manual `db push` from 08-01 — this plan's entire migration-tolerance design exists specifically so that gap causes no breakage in the meantime.)

## Next Phase Readiness
- 08-08 (delivery route + export audit) can now build the `View`/`Download` control against a real `candidate_branded_cvs` row shape and a working generation path — `getBrandedCvForCandidate` is already exported and DbResult-shaped for that plan's route handler to consume.
- 08-09 (acceptance gate: authed smoke, code review, pre-smoke, founder UAT) is the first point this feature gets exercised against a live, migrated database — this plan's local verification (`pnpm vitest run`, `pnpm typecheck`, `pnpm lint`, all green) is necessarily a substitute, not a replacement, for that live check.
- No blockers. The feature is fully invisible on production today (table not yet migrated), by design.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12*

## Self-Check: PASSED

- FOUND: src/lib/db/postgrest-errors.ts
- FOUND: src/lib/db/candidate-branded-cvs.ts
- FOUND: src/app/(app)/candidates/[id]/actions.ts
- FOUND: src/app/(app)/candidates/[id]/branded-cv-panel.tsx
- FOUND: src/app/(app)/candidates/[id]/branded-cv-generate-button.tsx
- FOUND: src/app/(app)/candidates/[id]/page.tsx
- FOUND: tests/unit/lib/db/candidate-branded-cvs.test.ts
- FOUND: tests/unit/app/candidates/generate-branded-cv-action.test.ts
- FOUND commit: f8db4be (Task 1)
- FOUND commit: 0909e06 (Task 2 RED)
- FOUND commit: 6602d80 (Task 2 GREEN)
- FOUND commit: 4bbbc04 (Task 3)
- Full suite: `pnpm vitest run` → 88 passed | 4 skipped (92 files), 1125 passed | 1 skipped | 28 todo (1154 tests)
- `pnpm typecheck` → clean
- `pnpm lint` → 0 errors (37 pre-existing/unrelated warnings across the repo, none new besides the accepted underscore-prefixed-unused-param pattern already used by sibling test files)
