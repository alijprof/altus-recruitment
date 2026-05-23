---
phase: quick-260523-tje
plan: 01
status: complete
completed: "2026-05-23"
duration_mins: 18
tasks_completed: 2
tasks_total: 2
files_created:
  - src/app/(app)/jobs/[id]/ad-panel/saved-ad-row-actions.tsx
  - src/app/(app)/jobs/[id]/ad-panel/saved-ad-view-dialog.tsx
files_modified:
  - src/lib/db/job-ads.ts
  - src/app/(app)/jobs/[id]/ad-panel/actions.ts
  - src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx
  - src/app/(app)/jobs/[id]/page.tsx
commits:
  - hash: 7d28560
    message: "feat(260523-tje): deleteJobAd backend + audit"
  - hash: c469ffa
    message: "feat(260523-tje): full saved-ad render + per-row actions + view dialog"
requirements_closed:
  - UAT-260523-AD-SAVE-UX
decisions:
  - "Extend JobAdsTableClient type (hand-typed) with delete/maybeSingle chains rather than introducing any — keeps the no-migration, no-type-regen constraint clean"
  - "Audit entity_type='job_ad' used as-is; if DB CHECK rejects it, Sentry captures and the delete still succeeds (recruiter-owned artefact, not candidate PII)"
  - "Full body rendered in whitespace-pre-wrap div (not react-markdown) — faithful text reproduction for copy-paste is the primary use case"
---

# Quick 260523-tje: Ad-Save UX Polish — Full Saved-Ad Render + Per-Row Actions

One-liner: Full-body saved-ad render plus Copy/View/Delete row dropdown via a client island, mirroring the application-row-actions.tsx pattern with zero new dependencies.

## What was built

The saved-ads section on `/jobs/[id]` previously showed a 240-char snippet with no actions. This plan delivers:

**Backend (Task 1)**
- `deleteJobAd` in `src/lib/db/job-ads.ts`: read-then-delete pattern matching `deleteApplication`; Sentry captures on both subops; RLS `tenant delete` policy (already present from the Phase 3 migration) scopes the delete to the caller's org
- Extended `JobAdsTableClient` hand-shaped type with `.delete().eq()` and `.select().eq().maybeSingle()` chains — no `any` introduced
- `deleteJobAdAction` in `src/app/(app)/jobs/[id]/ad-panel/actions.ts`: Zod validation, auth guard, `deleteJobAd` call with `not_found` / `internal` discrimination, `record_audit` RPC call (audit failure Sentry-captured but non-blocking), `revalidatePath`
- `DeleteJobAdActionResult` exported for client island typing

**Frontend (Task 2)**
- `saved-ads-list.tsx` overhauled: added `jobId` prop, removed `previewBody`, renders full body in `whitespace-pre-wrap` div, mounts `SavedAdRowActions` per row
- `saved-ad-row-actions.tsx` (new Client Component): `MoreHorizontal` dropdown with three items:
  - **Copy ad**: `navigator.clipboard.writeText` with success/error toasts; guarded against missing clipboard API
  - **View full**: sets `viewOpen` state to open the dialog
  - **Delete**: `window.confirm` → `startTransition` → `deleteJobAdAction` → toast + `router.refresh()`
- `saved-ad-view-dialog.tsx` (new Client Component): `max-w-2xl max-h-[85vh] overflow-y-auto` Dialog with score badge, full body, and (when present) inclusivity suggestions list; `unknown` jsonb narrowed via inline type guard (no `any`)
- `page.tsx`: passes `jobId={id}` to `<SavedAdsList>` (only call site)

## Verification

- `pnpm typecheck`: clean after both tasks
- `pnpm exec eslint src/lib/db/job-ads.ts src/app/(app)/jobs/[id]/ad-panel/...`: clean after both tasks

## Manual smoke test path

1. Navigate to `/jobs/[id]` for a job that has at least one saved ad.
2. Confirm the saved-ad row shows the full markdown body (no `…` truncation) in a `whitespace-pre-wrap` div.
3. Click `...` → **Copy ad** → paste into a text editor; confirm the full body matches.
4. Click `...` → **View full** → Dialog opens; confirm score badge colour matches the list badge, full body renders, and (if the ad has inclusivity suggestions) the suggestion list appears.
5. Click `...` → **Delete** → confirm in the browser prompt → row disappears after Next.js revalidation; success toast fires.
6. Check Supabase `audit_log` table for a row with `action='delete'`, `entity_type='job_ad'`, `entity_id=<deleted-id>`.
7. Generate + Save a new ad and confirm the empty-state placeholder text is gone and the new row appears.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data is wired from the database.

## Threat Flags

None — no new network endpoints or auth paths introduced. The `deleteJobAdAction` is a Server Action scoped by the existing RLS `tenant delete` policy.

## Self-Check: PASSED

- `src/lib/db/job-ads.ts` — exists, contains `deleteJobAd`
- `src/app/(app)/jobs/[id]/ad-panel/actions.ts` — exists, contains `deleteJobAdAction`
- `src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx` — exists, contains `SavedAdsList` with `jobId` prop
- `src/app/(app)/jobs/[id]/ad-panel/saved-ad-row-actions.tsx` — exists, contains `SavedAdRowActions`
- `src/app/(app)/jobs/[id]/ad-panel/saved-ad-view-dialog.tsx` — exists, contains `SavedAdViewDialog`
- Commits `7d28560` and `c469ffa` present in git log
