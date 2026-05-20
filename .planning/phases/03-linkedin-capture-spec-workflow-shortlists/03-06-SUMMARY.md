---
phase: 03-linkedin-capture-spec-workflow-shortlists
plan: 06-source-attribution
subsystem: reporting
tags: [postgres, rpc, security-invoker, rls, next.js, rsc, vitest, recruitment]

# Dependency graph
requires:
  - phase: 01-internal-ats
    provides: applications + candidates schema, candidate_source enum, RLS scaffolding, current_organization_id() helper
  - phase: 02-ai-differentiation
    provides: /settings/usage RSC pattern (mirrored for /reports/source-attribution)
  - phase: 03-linkedin-capture-spec-workflow-shortlists
    provides: Wave 1 plans (LinkedIn capture, spec workflow, shortlist + float nullable job_id), Wave 2 plans (ads, outreach) — all merged into worktree base before execution
provides:
  - applications.fee_pence + placed_at columns (with stage_changed_at backfill)
  - source_attribution_summary(p_from, p_to) RPC (security invoker, coalesce-NULL placement-date branch)
  - getSourceAttribution DB helper with Sentry-tagged error capture
  - /reports landing page (hub)
  - /reports/source-attribution RSC + Client DateFilter (30/90/365/custom presets)
  - resolveSourceAttributionRange pure helper (URL-searchParams → date window)
  - formatPence lifted from /settings/usage into src/lib/format.ts (shared)
  - pgsql integration test covering cross-org isolation + CRITICAL-3 (NULL placed_at branch)
  - Playwright auth-redirect stub for /reports/source-attribution
affects: phase-4-reporting-work (P50/median time-to-place, chart library); future SaaS billing pages (formatPence consumer)

# Tech tracking
tech-stack:
  added: []  # no new deps; pure additive feature on existing stack
  patterns:
    - "Security-invoker SQL aggregate functions (mirrors dormant_clients RPC from Plan 03-05) — tenant isolation via RLS on the underlying tables, defence-in-depth current_organization_id() filter in the function body"
    - "Pure URL-searchParams → date-window resolver (testable in isolation; injected `now` for determinism)"
    - "DateFilter Client Component pattern: URL is source of truth, useTransition for navigation pending UI"

key-files:
  created:
    - supabase/migrations/20260520023100_phase3_applications_placement_fields.sql
    - supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql
    - scripts/verify-placement-fields.sh
    - src/lib/db/source-attribution.ts
    - src/lib/db/source-attribution.test.ts
    - src/lib/reports/source-attribution-range.ts
    - src/lib/reports/source-attribution-range.test.ts
    - src/lib/format.ts
    - src/app/(app)/reports/page.tsx
    - src/app/(app)/reports/source-attribution/page.tsx
    - src/app/(app)/reports/source-attribution/date-filter.tsx
    - tests/e2e/source-attribution.spec.ts
  modified:
    - supabase/tests/source-attribution-rpc.test.sql (replaced Plan 0 placeholder with real pgsql integration test)
    - src/app/(app)/settings/usage/page.tsx (imports formatPence from new src/lib/format.ts)
    - src/components/app/top-nav.tsx (added /reports nav item, alphabetical)
    - .planning/phases/03-linkedin-capture-spec-workflow-shortlists/deferred-items.md (restored Plan 03-05 entry after accidental overwrite + appended Plan 03-06 re-observation note)

key-decisions:
  - "Migration was REQUIRED: scripts/verify-placement-fields.sh confirmed neither fee_pence nor placed_at existed in any prior migration. Per CLAUDE.md 'schema choices compound — ask before adding', the additive ALTER TABLE is surfaced here as a Phase 1 omission resolved by Phase 3 (additive only; no breaking change)."
  - "RPC uses coalesce(placed_at, stage_changed_at) for BOTH the date-window filter AND the avg time-to-place calc (CRITICAL-3 fix from plan-check 2026-05-19). Without this, legacy NULL placed_at rows would be silently dropped from the aggregation rather than included with stage_changed_at as a fallback."
  - "Page exposes formatPence via src/lib/format.ts (lifted from /settings/usage/page.tsx) rather than re-implementing — single source of truth for pence rendering across the (app) routes."
  - "DateFilter URL = source of truth (no local form state for the preset). useTransition gives a low-key pending affordance during Next.js client-side route. Custom range uses HTML5 type=\"date\" inputs (no extra dep)."
  - "Playwright spec ships as an auth-redirect-only stub (test.fixme for the two-org seed flow). The global-setup fixture only wires one org currently; full coverage requires extending the fixture and is left as a follow-up TODO inside the spec file."

patterns-established:
  - "Reports hub at /reports with cards-as-links to individual report pages — first report Phase 3 ships; pattern will scale to Phase 4 reporting work"
  - "Pure helper + Vitest contract test for any non-trivial URL → server arg translation (resolveSourceAttributionRange is the prototype)"

requirements-completed:
  - REPEAT-02

# Metrics
duration: 11min
completed: 2026-05-20
---

# Phase 3 Plan 03-06: Source Attribution Summary

**Recruiter can visit `/reports/source-attribution`, pick a 30/90/365-day or custom window, and see placements grouped by candidate `source` with placements count (badge), total fee revenue, and average time-to-place per channel — backed by a security-invoker Postgres RPC that handles legacy NULL `placed_at` rows correctly.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-20T02:30:59Z
- **Completed:** 2026-05-20T02:41:42Z
- **Tasks:** 3 (F.1, F.2, F.3) — F.2 and F.3 were TDD pairs (RED → GREEN)
- **Files created:** 11
- **Files modified:** 4

## Accomplishments

- New report at `/reports/source-attribution` shows placement ROI per source channel for a recruiter-selected date window (30/90/365/custom). Tenant isolation enforced server-side by `security invoker` on `source_attribution_summary` (Postgres RPC) — no client-side org filter.
- CRITICAL-3 fix from plan-check 2026-05-19: the aggregation uses `coalesce(placed_at, stage_changed_at)` for both the BETWEEN filter and the avg time-to-place calc so legacy / quick-place rows (where the recruiter never filled `placed_at`) are NOT silently dropped from the report.
- `applications.fee_pence` (bigint, nullable) + `placed_at` (timestamptz, nullable) added to the Phase 1 schema as an additive migration; existing `stage='placed'` rows are backfilled with `stage_changed_at` so the avg-time calc has a value for every historical placement.
- Reusable `formatPence` helper lifted from `/settings/usage` into `src/lib/format.ts` — first cross-page consumer is the new source-attribution page.

## Task Commits

Each task committed atomically:

1. **Task F.1 — applications.fee_pence + placed_at columns + backfill** — `fe9203f` (feat)
2. **Task F.2 — source_attribution_summary RPC + getSourceAttribution helper**
   - RED: `e62f3bf` (test) — failing helper contract test
   - GREEN: `0638ebb` (feat) — migration + helper + pgsql integration test (replaces Plan 0 placeholder)
   - FIX: `e80d262` (fix) — restored Plan 03-05 entry in `deferred-items.md` after accidental overwrite during GREEN
3. **Task F.3 — /reports/source-attribution page + DateFilter + /reports hub + TopNav**
   - RED: `de233a4` (test) — failing `resolveSourceAttributionRange` resolver test
   - GREEN: `c27dde2` (feat) — resolver implementation, format helper lift, RSC pages, Client DateFilter, TopNav addition, Playwright stub

_TDD tasks F.2 and F.3 each have a RED `test(...)` commit followed by a GREEN `feat(...)` commit per the plan's `tdd="true"` discipline._

## Files Created/Modified

### Created

- `supabase/migrations/20260520023100_phase3_applications_placement_fields.sql` — additive `ALTER TABLE` for `fee_pence` + `placed_at` + idempotent backfill.
- `supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql` — `source_attribution_summary(p_from, p_to)`: security-invoker SQL function aggregating placed applications by `candidates.source`. Coalesces `placed_at` with `stage_changed_at` for both the date filter and avg-days calc.
- `scripts/verify-placement-fields.sh` — preflight gate: greps migrations for `fee_pence`/`placed_at`, exits 1 if missing (drove the decision to write the migration).
- `src/lib/db/source-attribution.ts` — `getSourceAttribution(supabase, { from, to })` DbResult wrapper over the RPC; Sentry-captures with `{ phase: 'p3', layer: 'db', helper: 'getSourceAttribution' }`.
- `src/lib/db/source-attribution.test.ts` — Vitest contract test: arg passthrough, DbResult shape, RPC error → `{ ok: false, code: 'internal' }`, Sentry tag assertion, null data normalisation.
- `src/lib/reports/source-attribution-range.ts` — pure `resolveSourceAttributionRange({ preset, from, to }, now)` → `{ preset, from, to }` resolver with default '90d', custom-fallback semantics, exported `PRESET_OPTIONS` for the DateFilter UI.
- `src/lib/reports/source-attribution-range.test.ts` — 9 Vitest cases pinning every branch (default, each preset, custom, malformed custom, from>to, stray params).
- `src/lib/format.ts` — `formatPence(p)` helper lifted from `/settings/usage`.
- `src/app/(app)/reports/page.tsx` — Reports hub RSC (one card for now).
- `src/app/(app)/reports/source-attribution/page.tsx` — main RSC: parses searchParams, calls RPC, renders headline + main table (Badge for placements) + Top sources by revenue card. Empty-state copy when no rows.
- `src/app/(app)/reports/source-attribution/date-filter.tsx` — Client Component with preset buttons + custom date-input form; navigates via `router.push` inside `useTransition`.
- `tests/e2e/source-attribution.spec.ts` — Playwright auth-redirect stub + `test.fixme` for the full two-org seed flow.

### Modified

- `supabase/tests/source-attribution-rpc.test.sql` — replaced Plan 0 placeholder with full pgsql integration test (cross-org invisibility, CRITICAL-3 NULL-placed_at branch, date-window filter, anon EXECUTE denial).
- `src/app/(app)/settings/usage/page.tsx` — imports `formatPence` from `@/lib/format` instead of defining locally.
- `src/components/app/top-nav.tsx` — added `{ href: '/reports', label: 'Reports' }` between Pipeline and Settings.
- `.planning/phases/03-linkedin-capture-spec-workflow-shortlists/deferred-items.md` — restored Plan 03-05's lint deferral entry after accidental overwrite during F.2 GREEN; appended Plan 03-06 re-observation note.

## Decisions Made

- **`coalesce(placed_at, stage_changed_at)` everywhere**: the only way to handle legacy `stage='placed'` rows without losing them from the report. Documented inline in the migration header and asserted twice in the pgsql test (avg = 27.5 days across both NULL and NOT-NULL branches; without coalesce the result would be 40).
- **Security invoker (not definer)**: mirrors `dormant_clients` (Plan 03-05). Tenant isolation comes from RLS on `applications` + `candidates`; the body adds `organization_id = current_organization_id()` as defence-in-depth.
- **Default preset = '90d'**: per the plan; pinned as the test's "default" case.
- **HTML5 `type="date"` inputs for custom range**: no extra dep (no calendar component pulled in). Native date pickers are good enough for the recruiter use case.
- **Playwright two-org seed left as `test.fixme`**: the global-setup fixture currently wires only one org; full coverage requires fixture extension and is documented as a TODO in the spec file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Accidental overwrite of Plan 03-05's `deferred-items.md` entry**
- **Found during:** Task F.2 GREEN commit (`0638ebb`)
- **Issue:** When I appended my "pre-existing lint error" note, I overwrote the file rather than appending — losing Plan 03-05's original entry for the same shortlist dialog lint error.
- **Fix:** Restored the Plan 03-05 entry verbatim and appended a one-line "re-observed by Plan 03-06" note.
- **Files modified:** `.planning/phases/03-linkedin-capture-spec-workflow-shortlists/deferred-items.md`
- **Verification:** `git show HEAD~1:…/deferred-items.md` confirmed the prior content; restored file diffs cleanly.
- **Committed in:** `e80d262` (fix)

**2. [Rule 3 - Type narrowing] TypeScript indexed-access error in `source-attribution-range.ts`**
- **Found during:** Task F.3 GREEN (`pnpm typecheck` after writing the resolver)
- **Issue:** `PRESET_DAYS[DEFAULT_PRESET]` complained because `DEFAULT_PRESET` was typed as the full `SourceAttributionPreset` (including 'custom') while `PRESET_DAYS` is keyed on `Exclude<…, 'custom'>`.
- **Fix:** Narrowed the `DEFAULT_PRESET` constant's type to `Exclude<SourceAttributionPreset, 'custom'>` so both the default-window helper and the bottom-of-function lookup are well-typed.
- **Files modified:** `src/lib/reports/source-attribution-range.ts`
- **Verification:** `pnpm typecheck` clean; `pnpm test -- --run` 187 passed.
- **Committed in:** `c27dde2` (rolled into F.3 GREEN since the fix was inside the same RED-driven file)

### Out-of-Scope Issues (Not Fixed)

**Pre-existing lint error in `src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx:62`**
- ESLint rule: "Calling setState synchronously within an effect can trigger cascading renders"
- Origin: Plan 03-03 (Wave 1)
- Action: Logged in `deferred-items.md` (re-observation by Plan 03-06). Out of scope per the executor's "only fix issues directly caused by current task's changes" rule.

## TDD Gate Compliance

| Task | RED commit | GREEN commit |
|------|-----------|--------------|
| F.2 — RPC + helper | `e62f3bf` (test) | `0638ebb` (feat) |
| F.3 — Range resolver | `de233a4` (test) | `c27dde2` (feat) |

Both TDD tasks have a `test(...)` commit ahead of their `feat(...)` commit, ordering confirmed via `git log --oneline`.

## Verification

- `pnpm typecheck` — clean (after the type-narrowing fix above).
- `pnpm test -- --run` — 187 passed, 28 todo, 4 skipped.
- `pnpm exec eslint` over all created + modified files — clean.
- `pnpm exec eslint` (full repo) — 1 pre-existing error in `add-to-shortlist-dialog.tsx` (logged in `deferred-items.md`; out of scope).
- `bash scripts/verify-placement-fields.sh` — exit 1 (columns missing); drove the F.1 migration decision.
- pgsql integration test (`supabase/tests/source-attribution-rpc.test.sql`) — DB-level, runs locally with `psql --file …`; not part of the Node CI yet (waiting on a `pnpm db:test` script per the existing applications-float-null-job test).

## Stubs / Threat Flags

- **Playwright stub**: `tests/e2e/source-attribution.spec.ts` ships with only the auth-redirect assertion live; the two-org seed flow is `test.fixme` with explicit TODOs. Documented in the spec file. This is intentional and called out in the plan's Playwright touchpoint section.

- **Threat surface scan**: no new network endpoints, no new auth paths. The RPC is `security invoker` and `EXECUTE` is granted only to `authenticated` — denied to `anon` (asserted in the pgsql test). No threat flags raised.

## Self-Check: PASSED

- `supabase/migrations/20260520023100_phase3_applications_placement_fields.sql` — FOUND
- `supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql` — FOUND
- `src/lib/db/source-attribution.ts` — FOUND
- `src/lib/reports/source-attribution-range.ts` — FOUND
- `src/lib/format.ts` — FOUND
- `src/app/(app)/reports/page.tsx` — FOUND
- `src/app/(app)/reports/source-attribution/page.tsx` — FOUND
- `src/app/(app)/reports/source-attribution/date-filter.tsx` — FOUND
- `tests/e2e/source-attribution.spec.ts` — FOUND
- `scripts/verify-placement-fields.sh` — FOUND
- Commits: `fe9203f`, `e62f3bf`, `0638ebb`, `e80d262`, `de233a4`, `c27dde2` — ALL FOUND in `git log --oneline`.
