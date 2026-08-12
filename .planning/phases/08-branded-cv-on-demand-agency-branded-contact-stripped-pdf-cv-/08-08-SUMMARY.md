---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 08
subsystem: candidates
tags: [nextjs, route-handler, supabase-storage, gdpr, audit-log, sentry]

# Dependency graph
requires:
  - phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv- (08-07)
    provides: candidate_branded_cvs db helper (getBrandedCvForCandidate/getBrandedCvState/upsertBrandedCv), generateBrandedCvAction, BrandedCvPanel/BrandedCvGenerateButton
  - phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
    provides: the plain-anchor + signed-URL + export-audit-before-302 delivery pattern (cv-file/[cvId]/route.ts), the 2026-08-11 incident lesson never to put a client promise in the View click path
provides:
  - GET /candidates/[id]/branded-cv delivery route (302 to a 60s signed URL, export audit filed BEFORE the redirect, cache-control no-store on both the 302 and the 502)
  - View control on BrandedCvPanel wired to the route (plain <a>, rel=noopener noreferrer nofollow)
  - candidate_branded_cvs storage-path capture in deleteCandidateAction, folded into the existing cvs-bucket removal, missing-table tolerant
  - candidate_branded_cvs in ORG_EXPORT_TABLES; org-logos in ORG_STORAGE_BUCKETS
  - missing-bucket tolerance in listAllObjectPaths (a not-yet-created bucket degrades to zero objects instead of aborting an org erasure)
affects: [08-09 (smoke), any future phase that adds a new private Storage bucket or GDPR-scoped table]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "File-delivery route handlers (ROUTE-HANDLER EXCEPTION to the Server-Action-only mutation rule) mint a short-TTL signed URL server-side and 302-redirect, with the export audit row awaited BEFORE the response — never a client-awaited Server Action for anything that opens a document"
    - "Storage bucket-not-found is a distinct, tolerated failure mode (isMissingBucketError, matched on HTTP 404 + a 'bucket' message substring) separate from Postgres/PostgREST's isMissingTableError — both exist because this project's migrations AND bucket creation are pushed to production by hand, so code routinely reaches prod ahead of its own schema/storage setup"

key-files:
  created:
    - src/app/(app)/candidates/[id]/branded-cv/route.ts
    - tests/unit/app/candidates/branded-cv-route.test.ts
    - tests/unit/app/candidates/delete-candidate-branded-sweep.test.ts
    - tests/unit/lib/admin/org-erasure-coverage.test.ts
  modified:
    - src/app/(app)/candidates/[id]/branded-cv-panel.tsx
    - src/app/(app)/candidates/[id]/actions.ts
    - src/lib/admin/org-erasure.ts

key-decisions:
  - "recordExportAudit is filed against candidateId (the path param), not brandedCv.candidate_id — the table is keyed 1:1 on candidate_id so the two are always equal, but using the local var keeps the interfaces-block contract literal and avoids an extra field read."
  - "isMissingBucketError is a new, deliberately looser predicate than isMissingTableError: storage-js exposes no machine-readable 'bucket not found' code, so it matches on HTTP 404 + a case-insensitive 'bucket' substring in the message rather than a stable error code."
  - "The View control's requireEntitledOrg absence is enforced by a static source-scan test (readFileSync + regex), not a mock-based call-count assertion — the route does not import that gate at all, so a static pin is the honest way to assert 'never calls' for an identifier that literally isn't in the module."

requirements-completed: [BCV-05, BCV-06]

# Metrics
duration: 15min
completed: 2026-08-12
---

# Phase 8 Plan 08: Branded CV delivery route + GDPR erasure sweeps Summary

**GET /candidates/[id]/branded-cv 302-redirect delivery route (export-audit-before-release, mirroring the Phase-7 cv-file route exactly) plus the two GDPR sweeps the new table and bucket opened: candidate_branded_cvs storage-path capture on candidate delete, and candidate_branded_cvs/org-logos coverage in org erasure with missing-bucket tolerance.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-12T14:10:29+01:00 (worktree base commit)
- **Completed:** 2026-08-12T14:25:02+01:00
- **Tasks:** 2
- **Files modified:** 7 (3 created, 4 modified — including 3 new test files)

## Accomplishments
- Branded PDFs are now actually reachable: the View control on the Branded CV panel opens the real, agency-branded PDF via the same plain-anchor + server-side-signed-URL + 302 architecture the Phase-7 hotfix proved in production, with no client promise anywhere in the click path.
- Every access to a branded PDF files an `export` audit row against the candidate BEFORE the signed URL is released — release and delivery are the same HTTP response, so a row can never be filed for a document the recruiter never received.
- A cross-tenant candidate id, a missing row, and a missing `candidate_branded_cvs` table (pre-migration deploy) all collapse to the identical bare 404 — no existence oracle for either tenancy or feature-availability.
- Deleting a candidate now also removes its branded PDF from Storage (captured before the FK cascade), and an org erasure now also sweeps `candidate_branded_cvs` (export) and the `org-logos` bucket (deletion) — closing both halves of BCV-06 for this phase's new surface.
- A Storage bucket that doesn't exist yet in an environment (e.g. `org-logos` before its migration is pushed) can no longer abort an entire Art.17 org erasure — it now degrades to "zero objects" with a Sentry note instead of throwing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Branded CV delivery route + View control** - `dcb4d08` (feat)
2. **Task 2: GDPR sweeps — candidate delete and org erasure** - `7b1ed21` (feat)

**Plan metadata:** (this commit) `docs(08-08): complete branded CV delivery route + GDPR sweeps plan`

_No TDD RED/GREEN split commits — tests and implementation were written and verified together per task, consistent with this plan's `tdd="true"` tag being satisfied by test-first authoring within each single commit rather than separate test/feat commits (see TDD Gate Compliance note below)._

## Files Created/Modified
- `src/app/(app)/candidates/[id]/branded-cv/route.ts` - GET route: UUID shape-gate, auth defence-in-depth, RLS-scoped `getBrandedCvForCandidate` read (missing row/cross-tenant/missing-table all 404 identically), signed URL mint on the `cvs` bucket, export audit row awaited BEFORE the 302, cache-control no-store on both the 302 and the 502
- `src/app/(app)/candidates/[id]/branded-cv-panel.tsx` - View control (plain `<a>`, `rel="noopener noreferrer nofollow"`, `target="_blank"`) rendered only in the `ready` state, alongside the existing Generate/Regenerate button
- `src/app/(app)/candidates/[id]/actions.ts` - `deleteCandidateAction`: captures `candidate_branded_cvs.storage_path` before the `delete_candidate` RPC, folds it into the `cvs`-bucket removal, tolerates a missing table via `isMissingTableError`
- `src/lib/admin/org-erasure.ts` - `candidate_branded_cvs` added to `ORG_EXPORT_TABLES`; `org-logos` added to `ORG_STORAGE_BUCKETS`; new `isMissingBucketError` predicate + missing-bucket tolerance inside `listAllObjectPaths`
- `tests/unit/app/candidates/branded-cv-route.test.ts` - Ported from `cv-file-route.test.ts`; 7 tests covering all pinned behaviours
- `tests/unit/app/candidates/delete-candidate-branded-sweep.test.ts` - 6 tests covering capture ordering, bucket concatenation, error tolerance, and the two missing-table error-code variants
- `tests/unit/lib/admin/org-erasure-coverage.test.ts` - 6 tests covering the two constant additions and the missing-bucket tolerance in both `listAllObjectPaths` and `deleteAllOrgStorage`

## Decisions Made
- `isMissingBucketError` was written as a NEW predicate (matched on HTTP 404 status + a "bucket" substring in the message) rather than reusing or extending `isMissingTableError` — the two failure classes are structurally different (Postgres/PostgREST error codes vs. an HTTP Storage API response with no stable machine-readable code for this condition), and conflating them would have made the existing table predicate's contract looser than its own docstring promises.
- The `requireEntitledOrg` absence pin in `branded-cv-route.test.ts` is a static `readFileSync` + regex test, not a mock-call-count assertion — the route does not import that gate at all (same as `cv-file/[cvId]/route.ts`), so asserting "never calls X" on an identifier that is structurally absent from the module is more honestly expressed as "the source never mentions it" than as a spy that would trivially pass by never being invoked regardless of whether it were imported.
- `recordExportAudit`'s `entityId` argument uses the path-derived `candidateId` rather than `brandedCv.candidate_id` — both are guaranteed equal (the row is looked up BY `candidate_id`), but this keeps the call site a literal match of the interfaces-block contract in the plan and avoids reading a field whose only purpose would be to re-derive a value already in scope.

## Deviations from Plan

None - plan executed exactly as written. The plan's own interfaces block fully specified the route's shape, the panel's anchor markup, and the exact capture/tolerance changes needed in `actions.ts` and `org-erasure.ts`; no additional bugs, missing functionality, or blocking issues were discovered during implementation.

## TDD Gate Compliance

Both tasks carry `tdd="true"` in the plan frontmatter, but each was delivered as a single commit containing both the test file and the implementation it exercises, rather than a separate `test(...)` (RED) commit followed by a `feat(...)` (GREEN) commit. Tests were written test-first in-session (verified failing against the not-yet-created route/sweep logic before the implementation was added) and the final commit contains both, matching this plan's own worked example in the codebase (Plan 08-07's `generateBrandedCvAction` used the same single-commit-per-task pattern with `tdd="true"`). No separate RED/GREEN gate commits exist in the git log for this plan — flagging per the TDD Gate Compliance instruction, though the actual RED-then-GREEN authoring discipline was followed within each task.

## Issues Encountered
- The route's own header-comment prose used the literal identifier `requireEntitledOrg` while explaining why the gate is absent, which made the static source-scan test in `branded-cv-route.test.ts` (asserting the source never mentions it) fail against its own file. Reworded the comment to say "billing-entitlement gate" instead of the identifier — the pin now genuinely proves the route never imports or calls that function, rather than accidentally also forbidding prose that explains its absence.
- `src/lib/admin/org-erasure.ts` initially imported `isMissingTableError` on the assumption it would be needed for the `ORG_EXPORT_TABLES` addition, but the existing `collectOrgExport` loop already has its own inline `42P01`/`42703` schema-drift check and needed no change — removed the unused import after `pnpm lint` flagged it.

## User Setup Required
None - no external service configuration required. `candidate_branded_cvs` (migration `20260812120000`) and the `org-logos` bucket (migration `20260812120100`) both remain founder-`db push`-pending per this project's manual-migration workflow; every code path this plan touches was already required to (and does) degrade gracefully in their absence, and that degrade-gracefully contract was itself covered by tests (missing-table tolerance in the delete sweep, missing-bucket tolerance in the org-erasure sweep).

## Next Phase Readiness
- BCV-05 and BCV-06 are functionally complete for this phase's surface: generate → store → view (with audit) → erase (candidate delete or org erasure), all tenant-scoped and migration-tolerant.
- Ready for 08-09 (smoke): the View control is a real, testable document navigation — Phase 7's smoke lesson ("assert the download event, not a client promise") applies identically here.
- No blockers. The founder's manual `db push` for the two Phase-8 migrations remains the only outstanding step before any of this is exercised against live data — this plan does not change or depend on the timing of that push.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 5 claimed files verified present on disk (route.ts, branded-cv-route.test.ts,
delete-candidate-branded-sweep.test.ts, org-erasure-coverage.test.ts, this
SUMMARY.md). Both task commits (`dcb4d08`, `7b1ed21`) verified present in
`git log --oneline --all`.
