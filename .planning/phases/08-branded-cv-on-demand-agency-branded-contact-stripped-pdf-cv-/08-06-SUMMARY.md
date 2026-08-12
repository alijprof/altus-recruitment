---
phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
plan: 06
subsystem: ui
tags: [next.js, react-hook-form, zod, supabase-storage, sonner, settings, branding]

# Dependency graph
requires:
  - phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-
    provides: >
      uploadOrgLogoAction/removeOrgLogoAction + exported ActionResult
      (settings/branding/actions.ts), resolveOrgLogoUrl/downloadOrgLogo
      precedence helper (src/lib/branding/org-logo.ts), assertUploadableLogo
      + MAX_LOGO_BYTES magic-byte gate (src/lib/upload/image-signature.ts) —
      all delivered by 08-05.
provides:
  - Real logo upload/remove widget on Settings → Branding (logo-upload-field.tsx)
  - Exactly ONE editable logo surface in the app — /settings can no longer write logo_url
  - Apply-page logo precedence (uploaded logo_storage_path over legacy logo_url over wordmark)
  - Source-inspection regression pin (logo-single-surface.test.ts) that fails loudly if a
    second logo_url writer is ever re-added
affects: [08-07 (branded CV PDF generation — consumes resolveOrgLogoUrl/downloadOrgLogo), 08-09 (pre-smoke)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Logo upload is its own submission, deliberately outside the colours <form> — a colour save can never bundle a logo change"
    - "Client-side pre-checks (MIME + size) are UX-only; the server (assertUploadableLogo, magic-byte sniff) remains the sole authority"
    - "Comment-stripped source-inspection regression tests (readFileSync + strip // and * lines) pin architectural invariants without importing server-only modules"

key-files:
  created:
    - src/app/(app)/settings/branding/logo-upload-field.tsx
    - tests/unit/app/settings/logo-single-surface.test.ts
  modified:
    - src/app/(app)/settings/branding/branding-form.tsx
    - src/app/(app)/settings/branding/schema.ts
    - src/app/(app)/settings/branding/actions.ts
    - src/app/(app)/settings/branding/page.tsx
    - src/app/(app)/settings/schema.ts
    - src/app/(app)/settings/actions.ts
    - src/app/(app)/settings/organization-form.tsx
    - src/app/(app)/settings/page.tsx
    - src/app/(public)/apply/[orgSlug]/page.tsx

key-decisions:
  - "Removed logo_url entirely from /settings (schema, action patch, form field) rather than syncing both surfaces — closes 08-RESEARCH.md Pitfall 1 by construction, not convention"
  - "Remove button shown whenever ANY logo is set (uploaded or legacy) — removeOrgLogoAction already nulls both fields, so the UI should offer removal for either state"
  - "Legacy-URL warning only shows when isLegacyUrl is true AND hasUploadedLogo is false — an org that has since uploaded a real file should never see stale legacy-URL copy"

patterns-established:
  - "Single-canonical-surface pattern for tenant-editable branding fields: one Server Action pair owns the write path, all other forms only link to it"

requirements-completed: [BCV-04]

# Metrics
duration: ~10min
completed: 2026-08-12
---

# Phase 08 Plan 06: Branding Logo Upload — Single-Surface Consolidation Summary

**Real PNG/JPEG logo upload widget on Settings → Branding, `/settings`'s duplicate `logo_url` field deleted, and apply-page precedence (uploaded logo wins over legacy pasted URL wins over wordmark) via the shared `resolveOrgLogoUrl` helper.**

## Performance

- **Duration:** ~10 min (commits span 13:55–14:00 UTC+1, after a base reset + `pnpm install`)
- **Started:** 2026-08-12T13:55:53+01:00 (first task commit)
- **Completed:** 2026-08-12T13:59:58+01:00 (last task commit)
- **Tasks:** 3/3
- **Files modified:** 10 (9 modified, 2 created — logo-upload-field.tsx + logo-single-surface.test.ts)

## Accomplishments

- Owners can now upload a real PNG/JPEG logo (with live preview, pending states, and a mandatory toast on every success/failure path) from Settings → Branding, and remove it.
- `logo_url` is now unreachable from `/settings` — the general org page links to Branding instead. `/settings/branding`'s colours form/schema/action also no longer carry `logo_url`; only `uploadOrgLogoAction`/`removeOrgLogoAction` can write it.
- The public apply page resolves its header logo through the single `resolveOrgLogoUrl` precedence helper: uploaded `logo_storage_path` (signed URL) → legacy `logo_url` (display-only) → org-name wordmark. A sign failure degrades to the wordmark, never a 500.
- A source-inspection regression test (`logo-single-surface.test.ts`) pins the invariant: `logo_url` appears zero times in `settings/{schema,actions,organization-form}` and `settings/branding/schema.ts`, and `uploadOrgLogoAction`/`removeOrgLogoAction` remain exported.

## Task Commits

Each task was committed atomically:

1. **Task 1: Logo upload widget on Settings → Branding** — `8ca58a9` (feat)
2. **Task 2: Remove the second logo edit surface (/settings)** — `bc5bed1` (fix)
3. **Task 3: Apply-page logo precedence** — `f9bf4cd` (feat)

**Plan metadata:** commit to follow (docs: complete plan) — added after this SUMMARY per execute-plan.md `<final_commit>`.

## Files Created/Modified

- `src/app/(app)/settings/branding/logo-upload-field.tsx` — new client widget: preview tile, file input (PNG/JPEG only), upload/remove buttons, inline client pre-check errors, legacy-URL warning box
- `src/app/(app)/settings/branding/branding-form.tsx` — `logo_url` FormField removed; `<LogoUploadField>` rendered outside the colours `<form>`
- `src/app/(app)/settings/branding/schema.ts` — `logo_url` + `optionalUrl` helper removed from `updateBrandingSchema`
- `src/app/(app)/settings/branding/actions.ts` — `logo_url` removed from `updateBrandingAction`'s destructure/patch
- `src/app/(app)/settings/branding/page.tsx` — resolves `currentLogoUrl`/`hasUploadedLogo`/`isLegacyUrl` server-side via `resolveOrgLogoUrl` and passes them to `BrandingForm`
- `src/app/(app)/settings/schema.ts` — `logo_url` + `optionalUrl` helper removed from `updateOrganizationSchema`
- `src/app/(app)/settings/actions.ts` — `logo_url` removed from `updateOrganizationAction`'s patch
- `src/app/(app)/settings/organization-form.tsx` — `logo_url` FormField + `initialLogoUrl` prop removed; replaced with a `next/link` pointer to `/settings/branding`
- `src/app/(app)/settings/page.tsx` — drops `initialLogoUrl` prop at the `OrganizationForm` call site, updated card description copy
- `src/app/(public)/apply/[orgSlug]/page.tsx` — logo resolved via `resolveOrgLogoUrl(supabase, org)` instead of reading `org.logo_url` directly; extended SECURITY NOTE to cover the new Storage read
- `tests/unit/app/settings/logo-single-surface.test.ts` — new source-inspection regression pin (5 tests)

## Decisions Made

- Removed `logo_url` from `/settings` entirely instead of keeping it read-only or syncing both forms — the plan's stated intent (single canonical surface) is best enforced by making the second write path structurally impossible, not by UI convention alone.
- The Remove button on the branding widget shows whenever *any* logo value exists (`currentLogoUrl` truthy), not only when `hasUploadedLogo` is true — `removeOrgLogoAction` already nulls both `logo_storage_path` and `logo_url`, so a legacy-URL-only org should also be able to clear it from this one surface.
- The legacy-URL warning renders only when `isLegacyUrl && !hasUploadedLogo` — once an org uploads a real file, `uploadOrgLogoAction` already clears `logo_url` server-side, but this guard avoids any stale-render flash of the warning during the interim RSC refresh.

## Deviations from Plan

None — plan executed exactly as written. All three tasks, the regression test, and the precedence wiring match the plan's `<action>` blocks and `<must_haves>` artifacts.

## Issues Encountered

- Worktree HEAD (`a738fcc`, pre-08-04/08-05 merges) did not have the expected base commit (`afae0fd`) as an ancestor at agent start — `afae0fd` was a *descendant* of the worktree's starting point. Resolved via the plan's own worktree-branch-check step: confirmed the working tree was clean, then `git reset --hard afae0fd...` to pick up wave-1/2 outputs (uploadOrgLogoAction/removeOrgLogoAction, resolveOrgLogoUrl, assertUploadableLogo) as documented in the `<parallel_execution>` briefing. `node_modules` was also missing post-reset; ran `pnpm install --frozen-lockfile` as instructed before starting Task 1.

## User Setup Required

None — no external service configuration required. The `org-logos` Storage bucket migration (from 08-01/08-05) is a separate, already-documented founder-push item; this plan's UI surfaces the upload action's migration-tolerant error honestly if that migration is not yet live on prod, per the `<parallel_execution>` briefing, and does not crash.

## Next Phase Readiness

- BCV-04 is complete: single canonical logo-edit surface, real upload flow, correct apply-page precedence.
- 08-07 (branded CV PDF generation) can safely consume `resolveOrgLogoUrl`/`downloadOrgLogo` knowing there is exactly one writer of `logo_storage_path`/`logo_url` in the entire app — no risk of a stale/clobbered pointer feeding the PDF generator.
- Manual verification (upload/remove/preview on `/settings/branding`, confirm `/settings` shows no logo field) is deferred to 08-09 pre-smoke per this plan's `<verification>` section — not performed here.

---
*Phase: 08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-*
*Completed: 2026-08-12*

## Self-Check: PASSED

- FOUND: `src/app/(app)/settings/branding/logo-upload-field.tsx`
- FOUND: `tests/unit/app/settings/logo-single-surface.test.ts`
- FOUND: `.planning/phases/08-branded-cv-on-demand-agency-branded-contact-stripped-pdf-cv-/08-06-SUMMARY.md`
- FOUND commit: `8ca58a9` (Task 1)
- FOUND commit: `bc5bed1` (Task 2)
- FOUND commit: `f9bf4cd` (Task 3)
