---
phase: 04-voice-marketing-reporting
plan: "06"
subsystem: ui
tags: [dashboard, follow-up, jobs, sector, reporting, server-actions, react]

requires:
  - phase: 04-voice-marketing-reporting
    plan: "01"
    provides: "jobs.sector scalar column added in wave 0 migration"

provides:
  - LogCallDialog: inline 'Log call' Dialog on FollowUpWidget rows (REMIND-01 quick-action)
  - sector Input on job create/edit form threading to jobs.sector column (REPORT-02 gap)

affects:
  - dashboard UX (FollowUpWidget rows now have quick-action CTA)
  - buyer-value report (time_to_fill_by_sector RPC now receives real sector buckets)
  - any plan editing the FollowUpWidget or job form

tech-stack:
  added: []
  patterns:
    - "LogCallDialog pattern: ghost Button trigger + stopPropagation + Dialog + server action + toast"
    - "sector field: optional free-text form field → schema trim + max → action null-coerce → DB scalar"

key-files:
  created:
    - src/app/(app)/_dashboard/_components/log-call-dialog.tsx
  modified:
    - src/app/(app)/_dashboard/follow-up-widget.tsx
    - src/app/(app)/jobs/new/schema.ts
    - src/app/(app)/jobs/new/job-form.tsx
    - src/app/(app)/jobs/new/actions.ts
    - src/lib/db/jobs.ts

key-decisions:
  - "LogCallDialog uses a default body 'Logged a call.' when notes textarea is blank — satisfies logActivityAction min-1 body constraint while keeping the UI field optional"
  - "stopPropagation + preventDefault on the trigger click prevents the parent row Link from firing alongside the Dialog open"
  - "sector placed between Location and Salary fields in job-form.tsx — logical grouping with other geography/context fields"
  - "UpdateJobPatch now includes sector so edit-job flows can update it without a separate code path"

requirements-completed: [REMIND-01, REPORT-02]

duration: 18min
completed: 2026-06-10
---

# Phase 04 Plan 06: LogCallDialog + FollowUpWidget + jobs.sector Summary

**Inline 'Log call' quick-action on follow-up widget rows (REMIND-01) and free-text Sector field on job create form persisting to jobs.sector scalar for time-to-fill-by-sector reporting (REPORT-02)**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-10T00:00:00Z
- **Completed:** 2026-06-10T00:18:00Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- REMIND-01 complete: recruiters can log a call directly from the follow-up widget row without navigating away. The existing `logActivityAction` (kind='call') is reused, the Postgres trigger bumps `last_contacted_at`, and the candidate naturally drops off the widget on next dashboard load
- REPORT-02 sector gap closed end-to-end: sector field threads through schema → form → action → createJob insertPayload → updateJob UpdateJobPatch → jobs.sector scalar column, so the `time_to_fill_by_sector` RPC (04-01) now receives real sector buckets instead of a single 'Unspecified'
- LogCallDialog handles empty notes gracefully: sends `'Logged a call.'` as the body default so the min-1 body constraint is satisfied while keeping the UI textarea optional
- `pnpm lint` 0 errors, `pnpm typecheck` clean

## Task Commits

1. **Task 1: LogCallDialog + FollowUpWidget REMIND-01 quick-action** — `323b5c6` (feat)
2. **Task 2: jobs.sector form field + schema + persistence** — `60b715c` (feat)

## Files Created/Modified

- `src/app/(app)/_dashboard/_components/log-call-dialog.tsx` — new 'use client' component: Phone icon ghost trigger with stopPropagation, Dialog with optional notes Textarea, calls logActivityAction kind='call'
- `src/app/(app)/_dashboard/follow-up-widget.tsx` — rows split from single Link to flex li: Link (name+days) + MarketStatusBadge + LogCallDialog; empty state unchanged
- `src/app/(app)/jobs/new/schema.ts` — added optional sector string field (trim, max 200, empty → null)
- `src/app/(app)/jobs/new/job-form.tsx` — Sector Input after Location with helper hint; default value '' wired through form state
- `src/app/(app)/jobs/new/actions.ts` — sector threaded from parsed form data to createJob call (null-coerced when blank)
- `src/lib/db/jobs.ts` — sector added to CreateJobInput, insertPayload, and UpdateJobPatch

## Decisions Made

- Used `stopPropagation` + `preventDefault` on the trigger click (not just `stopPropagation`) to reliably prevent the row Link from activating when the Log call button is clicked
- LogCallDialog keeps its own `isPending` state (not `useTransition`) because the dialog open/close interlock needs synchronous control during the async call; `useTransition` would give a stale `isPending` at closure time
- Sector placed between Location and Salary in the form — logical geographic/context grouping before financial fields

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- `pnpm build` fails in the worktree environment due to missing env vars (no `.env.local`) — this is a known limitation per project memory (Vercel is the real build gate). Verification relied on `pnpm typecheck` (clean) and `pnpm lint` (0 errors) which are the in-repo quality gates.

## Known Stubs

None — both features are fully wired. LogCallDialog calls the real `logActivityAction` server action; sector writes to the real `jobs.sector` DB column via `createJob`/`updateJob`.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced. `logActivityAction` already validates input with Zod (kind enum + body min 1). The sector field is a plain string validated with Zod (trim + max 200) before reaching the DB layer.

## Next Phase Readiness

- REMIND-01: fully complete — follow-up widget quick-action live
- REPORT-02: sector input live — time-to-fill-by-sector report will show real buckets for any jobs created or edited after this deployment
- No blockers for subsequent wave 2 plans

---
*Phase: 04-voice-marketing-reporting*
*Completed: 2026-06-10*

## Self-Check: PASSED

- `src/app/(app)/_dashboard/_components/log-call-dialog.tsx` — FOUND (created in this plan)
- `src/app/(app)/_dashboard/follow-up-widget.tsx` — FOUND (modified in this plan)
- `src/app/(app)/jobs/new/schema.ts` — FOUND (modified in this plan)
- `src/app/(app)/jobs/new/job-form.tsx` — FOUND (modified in this plan)
- `src/app/(app)/jobs/new/actions.ts` — FOUND (modified in this plan)
- `src/lib/db/jobs.ts` — FOUND (modified in this plan)
- Commit 323b5c6 — FOUND in git log
- Commit 60b715c — FOUND in git log
