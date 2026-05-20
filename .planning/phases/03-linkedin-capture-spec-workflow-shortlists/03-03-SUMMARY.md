---
plan: 03-03-shortlists-floats
phase: 03
status: complete
commits:
  - "444c7a7 feat(03-03): application_type='shortlist' + nullable job_id + null-safe FK guard (Task C.1)"
  - "e79c624 test(03-03): RED — D3-17 pipeline filter + shortlists/floats helpers (Task C.2)"
  - "(GREEN commit) feat(03-03): GREEN — shortlists/floats DB helpers + pipeline filter + UI tabs (Task C.2)"
requirements_completed:
  - SHORT-01
  - SHORT-02
decisions_implemented:
  - D3-16
  - D3-17
  - D3-18
  - D3-26
  - D3-27
deviations:
  - "Original executor agent (a49edf47b2b96953d) hit Stream idle timeout after committing C.1 + C.2 RED. Orchestrator finished by staging the agent's uncommitted GREEN files, running typecheck + tests, and committing as the C.2 GREEN commit. Plan body intent fully delivered."
---

# Plan 03-03 SUMMARY — Shortlists + Floats

## What was built

**Migrations (Task C.1 — atomic, ordered):**
- `20260520010418_phase3_application_type_shortlist.sql` — adds `'shortlist'` to `application_type` enum (own migration per Postgres limitation per RESEARCH §M1)
- `20260520010419_phase3_applications_nullable_job_id.sql` — drops `NOT NULL` on `applications.job_id`; adds CHECK constraint so only `application_type='float'` may have `job_id IS NULL`; redoes unique index on `(candidate_id, job_id)` to permit floats
- `20260520010420_phase3_applications_same_org_guard_null_safe.sql` — patches the existing cross-tenant FK guard function to short-circuit on `new.job_id is null` per RESEARCH §Pitfall 7. Phase 1 commit `3f748f8` cited in header per HARD RULE 3.

**DB helpers (Task C.2):**
- `src/lib/db/shortlists.ts` — `listShortlistForJob`, `listFloatsForCandidate`, `listAllFloats` (PATTERNS §7 shape)
- `src/lib/db/applications.ts` patched — `listApplicationsByStage` + `listAllApplicationsByStage` now filter `application_type='standard'` (D3-17 invariant, with comments)
- `src/lib/db/applications-pipeline-filter.test.ts` — Wave 0 placeholder replaced with real tests asserting shortlists/floats never appear in pipeline queries
- `tests/unit/lib/db/shortlists.test.ts` — asserts shortlist queries filter `application_type='shortlist'`; float queries include `.is('job_id', null)`

**UI (Task C.2):**
- `/jobs/[id]/shortlist/page.tsx` — RSC tab; `<Table>` with Convert button per row
- `/jobs/[id]/shortlist/shortlist-list.tsx`, `add-to-shortlist-dialog.tsx` — Client Components
- `/jobs/[id]/shortlist/actions.ts` — `addToShortlistAction` server action
- `/candidates/[id]/floats/page.tsx` + `float-form.tsx` + `actions.ts` — float creation surface on candidate detail
- `/candidates/[id]/shortlist-actions.ts` — `convertShortlistToApplicationAction` (one-way per D3-16; logs `kind='stage_change'` activity)
- `/floats/page.tsx` — org-wide floats list
- `src/components/app/top-nav.tsx` — `Floats` nav item added in alphabetical position

## Key files
- Migrations: `supabase/migrations/20260520010418_*.sql`, `20260520010419_*.sql`, `20260520010420_*.sql`
- DB helpers: `src/lib/db/shortlists.ts`, `src/lib/db/applications.ts` (patched)
- UI: `src/app/(app)/jobs/[id]/shortlist/`, `src/app/(app)/candidates/[id]/floats/`, `src/app/(app)/floats/`, `src/components/app/top-nav.tsx`

## Verification
- `pnpm typecheck` → clean
- `pnpm vitest run src/lib/db/applications-pipeline-filter.test.ts tests/unit/lib/db/shortlists.test.ts` → 9/9 pass

## Self-Check: PASSED

## Open follow-ups (not blocking)
- Local manual E2E (per plan acceptance) — orchestrator will roll into Phase 3 verification step.
- Playwright stub `tests/e2e/shortlist-and-float.spec.ts` deferred to Phase 3 verification.
