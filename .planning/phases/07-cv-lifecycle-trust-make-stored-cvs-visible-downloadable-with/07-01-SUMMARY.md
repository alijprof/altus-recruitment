---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 01
subsystem: candidates-cv
tags: [nextjs, server-actions, supabase-storage, signed-url, audit-log, rls]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "candidate_cvs table, cvs Storage bucket + tenant RLS policies (migration 20260517204501)"
  - phase: 06-cv-parse-hardening
    provides: "parse-messages.ts shared predicate module, isUploadIncomplete, cv-review-panel.tsx CvReviewPanel"
provides:
  - "cvDisplayFilename / isCvFileDownloadable pure module (src/lib/cv/cv-file-display.ts)"
  - "getCvFileUrlAction server action — signed-URL file access, audited"
  - "recordExportAudit helper (src/lib/db/audit.ts) — action='export', never deduped"
  - "Always-rendered CV files section on the candidate detail page (D-01)"
affects: [07-02, 07-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server action reads back a tenant's own document via createSignedUrl(60s) — RLS-scoped read + Storage RLS as two independent tenancy gates, no requireEntitledOrg (reading your own data is never billing-gated)"
    - "export-vs-view audit action split: 'export' bypasses the per-hour view dedupe (migration 20260804140000) so every document access stays a distinct audit_log row"
    - "Pure display-formatting module (no 'import server-only') shared across RSC page, client component, and future Playwright spec"

key-files:
  created:
    - src/lib/cv/cv-file-display.ts
    - tests/unit/lib/cv/cv-file-display.test.ts
    - src/app/(app)/candidates/[id]/cv-file-link.tsx
    - src/app/(app)/candidates/[id]/cv-files-panel.tsx
  modified:
    - src/lib/db/audit.ts
    - src/app/(app)/candidates/[id]/actions.ts
    - src/app/(app)/candidates/[id]/page.tsx

key-decisions:
  - "isCvFileDownloadable is independent of parsing_status — a 'failed' row whose failure is a damaged/password-protected PDF still has a real stored file, which is exactly the case a recruiter most needs to open"
  - "Audit is filed against the CANDIDATE (entity_type='candidate', entity_id=cv.candidate_id), not the CV row, so a download surfaces in the existing per-candidate access history via audit_log_org_entity_idx"
  - "No requireEntitledOrg gate on getCvFileUrlAction — withholding a customer's own document behind a billing state is a data-hostage posture the app deliberately avoids elsewhere (erasure/export paths)"
  - "60s signed-URL TTL, matching existing prior art at apply/[orgSlug]/actions.ts:155"

patterns-established:
  - "Pure display/eligibility predicate modules live under src/lib/cv/ with no import 'server-only', mirroring parse-messages.ts, so RSC + client + Playwright can all import the same source of truth"

requirements-completed: [CLT-01, CLT-02]

# Metrics
duration: 20min
completed: 2026-08-11
---

# Phase 7 Plan 01: Signed-URL CV File Access + Export Audit Summary

**Every candidate_cvs row now shows its filename, upload date, and a working "View" control that opens a 60s signed Storage URL via a new server action, auditing every access as a distinct `export` row.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-11T14:53:00+01:00
- **Completed:** 2026-08-11T15:10:00+01:00
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- The customer's #1 trust complaint ("I can't see the CV you're holding for me") is closed: `cvDisplayFilename` / `isCvFileDownloadable` (pure, dependency-free) derive a human filename and a download-eligibility gate from `storage_path` + `parse_error`.
- `getCvFileUrlAction` mints a 60s `createSignedUrl` behind two independent tenancy gates (RLS-scoped `getCandidateCV` read, then the `Tenant select own org CVs` Storage policy) and awaits `recordExportAudit` before the URL ever reaches the browser.
- `recordExportAudit` (audit.ts) files `action='export'` — deliberately a separate helper from `recordViewAudit`, since `export` is excluded from the per-hour `view` dedupe (migration 20260804140000), so every access stays its own row.
- The candidate detail page's `CV files` section now renders for EVERY candidate with 1+ CVs (not just multi-version ones, the old "Previous CVs" behaviour) — filename, `v{version}`, a `Latest` badge on the newest row, absolute upload date (`formatDateLong`), parse status, and the `View` control.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure CV-file display module** - `73446be` (feat) — includes its own unit test in the same commit (see TDD Gate Compliance below)
2. **Task 2: Signed-URL server action with export audit** - `df63811` (feat)
3. **Task 3: CV files section on the candidate page** - `1014d4b` (feat)

**Follow-up:** `7ebf1c2` (style) — printWidth-100 line wraps confined to lines Tasks 2/3 added (see Deviations).

_No plan-metadata commit was made — the executor's instructions for this run explicitly withheld the docs commit; SUMMARY.md/STATE.md/ROADMAP.md are left for the orchestrator to commit._

## Files Created/Modified

- `src/lib/cv/cv-file-display.ts` - `cvDisplayFilename`, `isCvFileDownloadable`, `CV_FILE_FALLBACK_NAME`, `CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY`. No `import 'server-only'`; only dependency is `parse-messages.ts`.
- `tests/unit/lib/cv/cv-file-display.test.ts` - 13 cases covering every behavior bullet in the plan (uuid-prefix strip, no-prefix passthrough, empty/null/undefined fallback, downloadable gating by upload-incompleteness and storage_path presence).
- `src/lib/db/audit.ts` - added `recordExportAudit` (never-throw, same shape as `recordViewAudit`, `p_action: 'export'`).
- `src/app/(app)/candidates/[id]/actions.ts` - added `getCvFileUrlAction`: zod-validated `candidateCvId` → auth check → `getCandidateCV` (RLS) → `isCvFileDownloadable` server mirror → `createSignedUrl(60s)` → `recordExportAudit` awaited → return `{ ok: true, url }`. No `requireEntitledOrg`, no `revalidatePath` (read-only).
- `src/app/(app)/candidates/[id]/cv-file-link.tsx` (new) - client "View" control; `useTransition` + `getCvFileUrlAction` + `window.open(url, '_blank', 'noopener,noreferrer')`; disabled with the shared copy as `title` when not downloadable; `toast.error` on failure (never silent).
- `src/app/(app)/candidates/[id]/cv-files-panel.tsx` (new) - server component rendering the always-present "CV files" section; no `Alert` import, no `role="alert"` anywhere (protects the frozen Phase-6 smoke assertions).
- `src/app/(app)/candidates/[id]/page.tsx` - swapped the `olderCvs.length > 0` "Previous CVs" block for `cvRows.length > 0 ? <CvFilesPanel cvs={cvRows} /> : null`; deleted the dead inline filename/status derivation; removed the now-unused `olderCvs` binding.

## Decisions Made

- `isCvFileDownloadable`'s signature takes only `{ storage_path, parse_error }` (no `parsing_status`) per the plan's interface spec — parsing outcome doesn't gate file access, only whether a Storage object exists and whether the upload itself completed.
- Kept `recordExportAudit` as a standalone function (not `recordViewAudit(..., 'export')`) so the doc comment can explain the dedupe-exclusion rationale at the call site, matching the existing `recordViewAudit` / `recordSearchAudit` split style in the same file.
- Used a throwaway, gitignored `.env.local` with dummy values to push `pnpm build` past `src/lib/env.ts`'s zod validation locally (documented project reality: local `pnpm build` fails on env validation; Vercel is the real build gate). Confirmed full Turbopack compile + typecheck + static/dynamic route collection succeeds with the CV-files changes included, then deleted the file — nothing env-related was committed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/scope-boundary — style] Wrapped two newly-added lines under printWidth 100**
- **Found during:** post-Task-3 formatting check (`prettier --check`)
- **Issue:** the import line added to `actions.ts` in Task 2 and the props-destructure line added to `cv-file-link.tsx` in Task 3 exceeded the project's 100-char printWidth.
- **Fix:** ran `prettier --write` scoped to the exact lines this plan's own tasks authored (`actions.ts`, `cv-file-link.tsx`, `cv-files-panel.tsx`).
- **Files modified:** `src/app/(app)/candidates/[id]/actions.ts`, `src/app/(app)/candidates/[id]/cv-file-link.tsx`, `src/app/(app)/candidates/[id]/cv-files-panel.tsx`
- **Committed in:** `7ebf1c2`

### Out-of-scope discovery (NOT fixed — logged, not touched)

- **`src/app/(app)/candidates/[id]/page.tsx` fails `prettier --check` on regions this plan never touched.** The installed `prettier` resolves to `3.8.3` (package.json pins `^3.3.3`) and reformats several pre-existing lines differently than whatever prettier version last formatted the file (`FieldGroup`'s prop destructure, `formatSalary`'s param wrapping, a Tailwind class-order swap, `CandidateDetailPage`'s param destructure, etc.). Running `prettier --write` on the whole file would have produced a large unrelated diff, so — per the executor's scope-boundary rule — it was left exactly as committed by prior work. `pnpm lint` (this plan's actual verify gate) passes regardless; ESLint's `eslint-config-prettier` only disables conflicting rules, it does not enforce formatting itself. A dedicated project-wide formatting pass (or pinning an exact prettier version) should resolve this, not a per-file fix inside a feature plan.

---

**Total deviations:** 1 auto-fixed (style, scope-confined), 1 out-of-scope discovery logged (not fixed)
**Impact on plan:** No functional or security impact. No scope creep — the pre-existing formatting drift in `page.tsx` was deliberately left untouched rather than expanding this plan's diff.

## TDD Gate Compliance

Task 1 carried `tdd="true"`. The plan-level `type: tdd` gate-sequence enforcement (separate `test(...)` then `feat(...)` commits) does not apply here — this plan's frontmatter is `type: execute`, not `type: tdd` — but the general per-task TDD flow in the executor workflow still calls for a RED commit (failing test) followed by a GREEN commit (passing implementation).

**Deviation:** the test file and the implementation module were authored together and committed as a single `feat(07-01): Task 1: pure CV-file display module` commit (`73446be`), not as separate `test(...)` → `feat(...)` commits. All 13 test cases were written directly from the plan's `<behavior>` bullets before final verification, and `pnpm vitest run tests/unit/lib/cv/cv-file-display.test.ts` was confirmed green before moving to Task 2 — so the *content* guarantee (tests encode every behavior bullet, all pass) holds, but the *process* guarantee (a red run proven on record) does not. No functional risk: the module is pure, has 100% behavior-bullet coverage, and full-suite `pnpm vitest run` (793 passed, 0 failed) confirms no regression.

## Issues Encountered

- Local `pnpm build` fails immediately on `src/lib/env.ts` zod validation with no `.env.local` present (documented, pre-existing project reality — Vercel is the real build gate). Worked around locally with a throwaway, gitignored, dummy-valued `.env.local` (deleted before finishing) purely to confirm the Turbopack compile + page-data collection succeeds with this plan's changes included. No real credentials were used or exposed.
- `prettier` resolved to `3.8.3` locally (package.json pins `^3.3.3`), which reformats parts of `page.tsx` this plan never touched differently from whatever version last formatted it — logged as an out-of-scope discovery above rather than fixed inline.

## User Setup Required

None - no external service configuration required. No migration was added (the plan's `export` audit action already exists in the `audit_action` enum, migration 20260513152244; the per-hour dedupe migration 20260804140000 already excludes `export` by design).

## Next Phase Readiness

- `cv-file-display.ts`'s exports (`cvDisplayFilename`, `isCvFileDownloadable`, `CV_FILE_UPLOAD_INCOMPLETE_DISABLED_COPY`) and `getCvFileUrlAction` are stable, importable contracts for Plan 07-08's Playwright smoke coverage of this feature.
- `CvFilesPanel` / `CvFileLink` are ready to be reused or extended by later 07-xx plans (e.g. a future branded-CV or download-all affordance) without re-deriving filename/eligibility logic.
- No blockers. All plan verification gates green: `pnpm typecheck`, `pnpm lint`, `pnpm build` (with local dummy env), `pnpm vitest run tests/unit/lib/cv/cv-file-display.test.ts`, and the full `pnpm vitest run` (793 passed, no new failures vs. baseline).

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 8 created/modified files confirmed present on disk; all 4 commits
(`73446be`, `df63811`, `1014d4b`, `7ebf1c2`) confirmed present in `git log`.

## Addendum — superseded (2026-08-11)

`getCvFileUrlAction` and the client `cv-file-link` machinery it drove were replaced by the GET route handler `src/app/(app)/candidates/[id]/cv-file/[cvId]/route.ts` (302 to a signed URL) after the production View-CV incident — see `07-HOTFIX.md`. All audit, tenancy and PII properties were ported verbatim; `getCvFileUrlAction` is no longer a stable importable contract.
