---
phase: 05-saas-shell
plan: 03
subsystem: ui
tags: [csv-import, papaparse, onboarding, sample-data, wizard, welcome-checklist, server-action]

# Dependency graph
requires:
  - phase: 05-saas-shell/05-00
    provides: PapaParse installed; Stripe/billing foundation; supabase helpers
  - phase: 01-foundation
    provides: createCandidate path, RLS, consent versioning, findCandidateByEmail
  - phase: 03-public-apply
    provides: candidate dedup email lowercasing (260604-cn5 fix)

provides:
  - CSV candidate import wizard (3-step: upload → column-map → summary) at /candidates/import
  - importCandidatesAction Server Action with per-row dedupe, PapaParse, 500-row cap
  - column-map.ts: HEADER_ALIASES + mapRow() pure function (12 unit tests)
  - sample-data.ts: 3 synthetic candidates, 2 clients, 1 job (example.com emails, no PII)
  - seedSampleDataAction: idempotent one-click sample-data seed
  - welcome-checklist.tsx: extended with 'Seed sample data' + 'Import candidates' steps

affects: [05-04, 05-05, 06-marketing, onboarding-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mapRow() pure function + HEADER_ALIASES map enables unit-tested header normalisation separate from Server Action"
    - "ImportSummary discriminated result type: created/skippedNoName/skippedDuplicate/errors/truncated"
    - "applyMappingOverrides() rewrites CSV headers to canonical names before server action — keeps server action API surface clean"
    - "Idempotency guard: check candidate count > 0 before seeding; skip rather than duplicate"

key-files:
  created:
    - src/app/(app)/candidates/import/column-map.ts
    - src/app/(app)/candidates/import/column-map.test.ts
    - src/app/(app)/candidates/import/actions.ts
    - src/app/(app)/candidates/import/page.tsx
    - src/app/(app)/candidates/import/import-wizard.tsx
    - src/lib/onboarding/sample-data.ts
    - src/app/(app)/_dashboard/sample-data-action.ts
  modified:
    - src/app/(app)/_dashboard/welcome-checklist.tsx

key-decisions:
  - "Use 'direct_add' as candidate_source for imports — no 'import' enum value exists; plan explicitly approved this fallback"
  - "Use 'legitimate_interest' as consent_basis for bulk imports — appropriate for professional contacts where agency has pre-existing relationship"
  - "Idempotency guard on seed: skip if org already has ANY candidates (conservative — avoids double-seeding)"
  - "applyMappingOverrides rewrites CSV headers to canonical names before server action, not inside it — keeps column-map unit-tested and the action contract simple"
  - "500-row batch cap in importCandidatesAction (T-05-03-04); truncation reported in summary"
  - "WelcomeChecklist 'Seed sample data' implemented as button (ActionStep) not Link — triggers seedSampleDataAction inline"

patterns-established:
  - "Column-map: HEADER_ALIASES + mapRow() as a pure, unit-tested function separate from the Server Action"
  - "ImportSummary return type surfaces per-row counts including errors — no silent success"

requirements-completed: [SAAS-01]

# Metrics
duration: 66min
completed: 2026-06-04
---

# Phase 5 Plan 03: Onboarding Summary

**CSV candidate import wizard with PapaParse + column-map, idempotent sample-data seed, and extended welcome checklist — brand-new org goes from empty to alive in minutes without founder intervention.**

## Performance

- **Duration:** ~66 min
- **Started:** 2026-06-04T22:04:00Z
- **Completed:** 2026-06-04T23:10:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Built a 3-step CSV import wizard (upload → column mapping with overrides → per-row result toast) at `/candidates/import`, calling `importCandidatesAction` which dedupes by lowercased email via `findCandidateByEmail` and routes every row through the existing `createCandidate` path (RLS, audit, org-trigger)
- Created `column-map.ts` with `HEADER_ALIASES` + `mapRow()` — pure, unit-tested (12 tests covering header variants, null-on-no-name, injection-ish cells as plain strings, whitespace trimming)
- Built `seedSampleDataAction` (idempotent: skips if org already has candidates) + synthetic sample data (3 candidates, 2 clients, 1 job — all example.com emails, fictional names, no real PII)
- Extended `WelcomeChecklist` with 'Seed sample data' (inline action button) and 'Import candidates' (link to `/candidates/import`), both marked done when `candidates > 0` (DB-derived, not localStorage)

## Task Commits

1. **Task 3.1: CSV column-map + Server Action** - `974cd80` (feat)
2. **Task 3.2: Import wizard + sample-data seed + welcome checklist** - `0da3fc4` (feat)

## Files Created/Modified

- `/src/app/(app)/candidates/import/column-map.ts` — HEADER_ALIASES map + mapRow() + detectMapping()
- `/src/app/(app)/candidates/import/column-map.test.ts` — 12 unit tests
- `/src/app/(app)/candidates/import/actions.ts` — importCandidatesAction Server Action
- `/src/app/(app)/candidates/import/page.tsx` — RSC wrapper page
- `/src/app/(app)/candidates/import/import-wizard.tsx` — Client 3-step wizard component
- `/src/lib/onboarding/sample-data.ts` — SAMPLE_CANDIDATES, SAMPLE_CLIENTS, SAMPLE_JOBS
- `/src/app/(app)/_dashboard/sample-data-action.ts` — seedSampleDataAction Server Action
- `/src/app/(app)/_dashboard/welcome-checklist.tsx` — Extended with 2 new steps

## Decisions Made

- **`source: 'direct_add'`** for CSV imports — no 'import' enum value exists in the DB; plan explicitly specified not to invent new enum values; `direct_add` is the closest semantic fit
- **`consent_basis: 'legitimate_interest'`** for imports — appropriate for professional contacts where a pre-existing relationship exists; recruiters are responsible for verifying this basis
- **Idempotency by candidate count** — seed skips entirely if org already has ANY candidates (conservative guard); chosen over tagging approach to avoid schema change
- **Column override rewrites CSV headers** — `applyMappingOverrides` rebuilds the CSV with canonical header names so the server-side `mapRow`/`HEADER_ALIASES` lookup works correctly regardless of the user's original column names

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript type error in column-map.ts `mapped[canonical]` return**
- **Found during:** Task 3.1 (typecheck run)
- **Issue:** `mapped[canonical]` typed as `string | null | undefined` but MappedCandidate required `string | null`
- **Fix:** Added `?? null` coercion on each field in the return object
- **Files modified:** `column-map.ts`
- **Verification:** `pnpm typecheck` passed
- **Committed in:** `974cd80`

**2. [Rule 1 - Bug] Lint error `<a>` element used for page navigation instead of Next.js `<Link>`**
- **Found during:** Task 3.2 (lint run)
- **Issue:** "View candidates" button in ResultStep used `<a href="/candidates">` — next/link rule violation
- **Fix:** Replaced with `<Link href="/candidates">` + added `import Link from 'next/link'`
- **Files modified:** `import-wizard.tsx`
- **Verification:** `pnpm lint` 0 errors
- **Committed in:** `0da3fc4`

---

**Total deviations:** 2 auto-fixed (2 × Rule 1 - Bug)
**Impact on plan:** Both were caught by automated gates (typecheck, lint) during the task, fixed inline, no scope change.

## Issues Encountered

None beyond the auto-fixed items above.

## Known Stubs

None — all functionality is wired. The wizard calls the real `importCandidatesAction`; the seed action calls real DB helpers. The `done` state on the new checklist steps is DB-derived (`candidates > 0`), not mocked.

## Threat Flags

No new threat surface beyond what was modelled in the plan's `<threat_model>`. All four STRIDE entries (T-05-03-01 through T-05-03-04) are mitigated:
- CSV injection: PapaParse yields strings; no eval; validated by createCandidate
- PII in Sentry: counts + tags only
- Org scoping: RLS trigger; org never from CSV
- Bulk abuse: 500-row cap with truncation report

## Self-Check

- [x] `src/app/(app)/candidates/import/column-map.ts` — exists
- [x] `src/app/(app)/candidates/import/actions.ts` — exists
- [x] `src/app/(app)/candidates/import/import-wizard.tsx` — exists
- [x] `src/lib/onboarding/sample-data.ts` — exists
- [x] `src/app/(app)/_dashboard/sample-data-action.ts` — exists
- [x] `src/app/(app)/_dashboard/welcome-checklist.tsx` — modified
- [x] Commit `974cd80` — Task 3.1
- [x] Commit `0da3fc4` — Task 3.2
- [x] `pnpm typecheck` — PASSED
- [x] `pnpm lint` — 0 errors (17 pre-existing warnings in test files)
- [x] `pnpm test -- column-map.test.ts` — 12/12 tests pass

## Self-Check: PASSED

## User Setup Required

None — no new environment variables, no new migrations, no external services.

## Next Phase Readiness

- Plan 05-03 complete. Wave 1 (05-02 branding + 05-03 onboarding) is done.
- Ready for Wave 2: 05-04 (admin portal) and 05-05 (marketing site).
- The import wizard is functional but a design polish pass is deferred to the customer-facing build phase per plan spec.

---
*Phase: 05-saas-shell*
*Completed: 2026-06-04*
