---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 05
subsystem: storage
tags: [supabase-storage, server-actions, org-branding, byte-sniffing, rls]

# Dependency graph
requires:
  - phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv- (plan 01)
    provides: org-logos private Storage bucket + organizations.logo_storage_path migration (20260812120100_org_logos_bucket.sql, not yet founder-pushed)
  - phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv- (plan 03)
    provides: assertUploadableLogo / MAX_LOGO_BYTES PNG/JPEG magic-byte sniffer (src/lib/upload/image-signature.ts)
provides:
  - src/lib/branding/org-logo.ts — buildOrgLogoPath / resolveOrgLogoUrl / downloadOrgLogo, the single implementation of the logo_storage_path > logo_url > null precedence rule
  - uploadOrgLogoAction + removeOrgLogoAction Server Actions (settings/branding/actions.ts), write-new-then-delete-old ordering, owner + entitlement gated
  - logo_storage_path threaded through OrganizationRow / OrganizationApplyRow / UpdateOrganizationPatch (src/lib/db/organizations.ts)
affects: [08-06 (branding settings UI + apply page), 08-07 (branded CV generation action needs downloadOrgLogo for PDF embedding), 08-08 (org erasure sweep needs the org-logos bucket + logo_storage_path)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write-new-then-delete-old Storage ordering for a single-current-object pointer (mirrors deleteAllOrgStorage's storage-first discipline, adapted so the NEW copy is never at risk)"
    - "Byte-sniff before any gate/auth/Storage call (uploadCVAction's established ordering, now shared by logo uploads)"
    - "PII-free Sentry captures: organization_id (a UUID) + a fixed subop tag only — never storage path, org name, or filename"

key-files:
  created:
    - src/lib/branding/org-logo.ts
    - tests/unit/lib/branding/org-logo.test.ts
    - tests/unit/app/settings/org-logo-actions.test.ts
  modified:
    - src/lib/db/organizations.ts
    - src/app/(app)/settings/branding/actions.ts

key-decisions:
  - "uploadOrgLogoAction/removeOrgLogoAction KEEP requireEntitledOrg() + owner-only checks — the founder's no-gate override for the branded-CV feature applies only to generateBrandedCvAction (08-07), never to org-settings mutations."
  - "downloadOrgLogo accepts storagePath: string | null (not just string) so callers can pass org.logo_storage_path directly without a null-check wrapper at every call site."
  - "ActionResult<T> promoted from a file-local type to an exported type so 08-06's UI can reuse the exact same discriminated result the branding form already handles, with zero new error plumbing."

patterns-established:
  - "Pattern: any Storage-backed single-pointer column (one row, one current object) does upload-new → update-row → best-effort-remove-old, never the reverse — a partial failure always leaves the OLD object servable."

requirements-completed: [BCV-04]

# Metrics
duration: 22min
completed: 2026-08-12
---

# Phase 8 Plan 05: Org-Logo Storage Helper + Upload/Remove Actions Summary

**Org-logo storage helper (path/signed-URL/byte-download precedence) plus uploadOrgLogoAction/removeOrgLogoAction Server Actions, with write-new-then-delete-old Storage ordering and the full CV-upload gate stack (byte-sniff, entitlement, owner-only).**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-12T12:12:00Z (approx, worktree setup + context read)
- **Completed:** 2026-08-12T12:34:29Z
- **Tasks:** 2 completed
- **Files modified:** 5 (2 created source, 1 modified source, 2 created tests)

## Accomplishments

- One helper (`src/lib/branding/org-logo.ts`) now answers "what is this org's logo" for every future consumer: `resolveOrgLogoUrl` for the settings UI + apply page (08-06), `downloadOrgLogo` for the PDF generator (08-07) — implementing the three-step precedence rule (`logo_storage_path` > `logo_url` > null) in exactly one place.
- `uploadOrgLogoAction` and `removeOrgLogoAction` give owners a real upload/remove flow: byte-sniffed PNG/JPEG under 2 MiB, org-id-prefixed random path (no client filename ever reaches Storage), write-new-then-delete-old ordering so a mid-flight failure never leaves a broken pointer.
- `organizations.ts`'s three helpers (`getOrganization`, `getOrganizationBySlug`, `updateOrganization`) now carry `logo_storage_path` end-to-end, undefined-preserving on write — matching the existing `brand_primary`/`brand_secondary` cast-boundary convention exactly.
- 34 new unit tests (17 + 17) cover all 17 behaviours from the plan's `must_haves`, including call-order assertions for the replace path and PII-free-Sentry pins on every failure branch.

## Task Commits

Each task was executed TDD-style (failing test → implementation), matching the established 08-03 convention in this repo:

1. **Task 1: Org-logo helper + organizations column plumbing**
   - `0d3bb38` (test): add failing test for org-logo helper + organizations plumbing
   - `a7e804b` (feat): implement org-logo helper + organizations logo_storage_path plumbing
2. **Task 2: uploadOrgLogoAction + removeOrgLogoAction**
   - `a389d67` (test): add failing test for uploadOrgLogoAction + removeOrgLogoAction
   - `d87269a` (feat): implement uploadOrgLogoAction + removeOrgLogoAction

**Plan metadata:** this SUMMARY commit (docs) — see final commit below.

## Files Created/Modified

- `src/lib/branding/org-logo.ts` — `ORG_LOGO_BUCKET`, `ORG_LOGO_SIGNED_URL_TTL_SECONDS` (1h), `buildOrgLogoPath`, `resolveOrgLogoUrl`, `downloadOrgLogo`. `import 'server-only'`.
- `src/lib/db/organizations.ts` — `logo_storage_path: string | null` added to `OrganizationRow`, `OrganizationApplyRow`, `UpdateOrganizationPatch`; all three SELECT strings and the undefined-preserving patch spread extended; cast-boundary comments extended to mention the 08-01 migration.
- `src/app/(app)/settings/branding/actions.ts` — `uploadOrgLogoAction(formData)` and `removeOrgLogoAction()` added alongside the existing `updateBrandingAction`; `ActionResult<T>` promoted to an exported type.
- `tests/unit/lib/branding/org-logo.test.ts` — 17 tests: path shape, precedence rule (3 branches), failed-sign PII pin, download happy/error/missing/re-sniff-fail paths, `getOrganization`/`getOrganizationBySlug`/`updateOrganization` column plumbing.
- `tests/unit/app/settings/org-logo-actions.test.ts` — 17 tests: valid PNG/JPEG upload, replace-ordering, failed-upload/failed-update rollback, SVG/spoofed-MIME/oversized rejection before any Storage call, non-owner/non-entitled gates, best-effort remove on delete, PII-free Sentry pins.

## Decisions Made

- **Entitlement + owner gates retained on both actions.** The parallel-execution briefing explicitly called this out (the founder's no-gate override is scoped to `generateBrandedCvAction` in 08-07 only) — `uploadOrgLogoAction`/`removeOrgLogoAction` are org-settings mutations, not the generation path, so `requireEntitledOrg()` + `users.role === 'owner'` stay exactly as `updateBrandingAction` already established (R8 ordering).
- **Byte-sniff runs before any gate.** Mirrors `uploadCVAction`'s documented reasoning: format/size validation is free (no session, no network) and is the earliest point the action can honestly know what the file really is, since `file.type` is client-supplied and spoofable.
- **`downloadOrgLogo(client, storagePath: string | null)`** — accepting `null` directly (rather than requiring callers to null-check first) matches how the function will actually be called in 08-07 (`org.logo_storage_path` is nullable at the type level).
- **Sentry tags carry `organization_id` (a UUID) but never a storage path or org name**, consistent across all four failure branches (`resolveOrgLogoUrl`'s failed sign, `downloadOrgLogo`'s download/re-sniff failures, both actions' best-effort-remove failures) — verified by dedicated PII-pin tests that serialise every captured call and assert the literal path/filename string is absent.

## Deviations from Plan

None — plan executed exactly as written. The plan's TDD flag on both tasks was honoured with the established repo convention of a separate `test(...)` commit before the `feat(...)` commit (matching plan 08-03's precedent), rather than committing test+implementation together.

## Issues Encountered

- Initial worktree HEAD was one merge behind the expected base commit (`5f165b90a2cdcfee2fe9de7019b2e61b8726d35c`, which carries the 08-01/08-02/08-03 wave-1 outputs this plan depends on). Working tree was clean, so `git reset --hard` to the expected base was safe and matched the `<worktree_branch_check>` protocol exactly — no work was lost.
- `tests/unit/app/settings/org-logo-actions.test.ts` initially wrapped the `createClient` mock as `(...args: unknown[]) => createClientMock(...args)`; TypeScript rejected the spread against a zero-arg mock (`TS2556`). Fixed to `() => createClientMock()`, matching the simpler style already used in `cv-file-route.test.ts`. Caught by `pnpm typecheck` before commit — no functional impact.

## User Setup Required

None — no external service configuration required. The `org-logos` Storage bucket migration (`20260812120100_org_logos_bucket.sql`) was already committed by plan 08-01 and is migration-tolerant per the parallel-execution briefing (this plan's code does not assume the bucket exists at import time; it only touches Storage inside the Server Actions, which will surface a normal upload/download error if the founder has not yet run `pnpm exec supabase db push --linked`).

## Next Phase Readiness

- 08-06 (branding settings UI) can now build the upload widget directly against `uploadOrgLogoAction`/`removeOrgLogoAction` and `ActionResult` — no new error-plumbing needed, and `resolveOrgLogoUrl` gives it a signed URL for both the settings preview and the public apply page.
- 08-07 (branded CV generation) can call `downloadOrgLogo(supabase, org.logo_storage_path)` to get PDF-ready bytes with zero additional validation logic — the re-sniff-on-the-way-out guarantee is already in place.
- **Blocker for functional (not code) completion:** the `org-logos` bucket migration is not yet applied to production Supabase — a real upload will fail at the Storage layer until the founder runs `pnpm exec supabase db push --linked` (per this project's manual-push convention). This is a known, expected state per the parallel-execution briefing, not a defect in this plan.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 5 claimed files verified present on disk; all 4 task commits (`0d3bb38`, `a7e804b`, `a389d67`, `d87269a`) verified present in `git log --all`. No missing items.
