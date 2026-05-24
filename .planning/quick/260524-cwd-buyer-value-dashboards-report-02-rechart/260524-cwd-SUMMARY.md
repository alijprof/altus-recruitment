---
phase: 260524-cwd-buyer-value-dashboards-report-02-rechart
plan: 01
subsystem: reports
tags: [reports, dashboards, recharts, postgres-rpc, multi-tenant, due-diligence]

dependency-graph:
  requires:
    - source_attribution_summary RPC (reused, not duplicated)
    - public.current_organization_id() helper
    - public.applications / jobs / users RLS policies
  provides:
    - GET /reports/buyer-value page
    - public.placements_by_recruiter_quarter RPC
    - public.time_to_fill_by_sector RPC
    - public.pipeline_value_sparkline RPC
    - public.commission_summary_by_recruiter RPC
    - src/components/charts/{stacked-bar,horizontal-bar,sparkline} wrappers
    - src/lib/db/buyer-value.ts typed helpers + pivotRecruiterQuarters
  affects:
    - package.json (recharts ^3.8.1 added)
    - pnpm-lock.yaml (35 transitive deps)
    - src/types/database.ts (hand-patched with 4 new RPC signatures pending orchestrator regen)
    - src/components/charts/stacked-bar.tsx (StackedBarDatum type relaxed during Task 3)

tech-stack:
  added:
    - recharts@^3.8.1 — official shadcn/ui chart primitive; React-19-compatible peer
  patterns:
    - "RSC parallel-fetch + dynamic({ ssr: false }) client-chart leaves"
    - "URL-as-source-of-truth date filter (clone of source-attribution pattern)"
    - "useIsMobile() shell + degrade-to-cards for table metrics"
    - "Native <details> for collapsible methodology (zero JS, native a11y)"

key-files:
  created:
    - supabase/migrations/20260524000200_buyer_value_rpcs.sql
    - src/lib/db/buyer-value.ts
    - src/lib/reports/buyer-value-range.ts
    - src/components/charts/stacked-bar.tsx
    - src/components/charts/horizontal-bar.tsx
    - src/components/charts/sparkline.tsx
    - src/app/(app)/reports/buyer-value/page.tsx
    - src/app/(app)/reports/buyer-value/date-filter.tsx
    - src/app/(app)/reports/buyer-value/_components/source-roi-shell.tsx
    - src/app/(app)/reports/buyer-value/_components/source-roi-table.tsx
    - src/app/(app)/reports/buyer-value/_components/source-roi-cards.tsx
    - src/app/(app)/reports/buyer-value/_components/commission-shell.tsx
    - src/app/(app)/reports/buyer-value/_components/commission-table.tsx
    - src/app/(app)/reports/buyer-value/_components/commission-cards.tsx
  modified:
    - package.json (added recharts dependency)
    - pnpm-lock.yaml (lockfile update)
    - src/types/database.ts (hand-patched RPC signatures; orchestrator to regenerate)
    - src/components/charts/stacked-bar.tsx (Rule 1 fix — relaxed StackedBarDatum)

decisions:
  - "Cloned source-attribution-range + date-filter rather than refactoring into a shared module (per RESEARCH §Pattern 2)"
  - "Single 'Unspecified' sector bucket for time-to-fill (jobs.sector does not exist; sector column out of scope)"
  - "Native <details> for Methodology — zero JS bundle, native a11y"
  - "Pipeline sparkline filters jobs to status='open' AND created_at <= bucket_date (indicative trend only; no historical status table)"
  - "Commission/pipeline aggregations filter to GBP placements (anchor customer; multi-currency future work)"
  - "Helpers extract a shared callRpc() so the cast-at-boundary RPC-binding pattern lives in one place"

metrics:
  duration_min: 14
  completed: 2026-05-24
  tasks_completed: 3
  files_touched: 14
  rpcs_added: 4
  loc_added: ~1500
---

# Quick task 260524-cwd: Buyer-Value Reporting Dashboard Summary

## One-liner

`/reports/buyer-value` Server Component renders 5 acquirer-due-diligence metrics — placements per recruiter per quarter (stacked bar), time-to-fill (horizontal bar with median + p90), source ROI (table), pipeline value (big number + sparkline), commission summary (per-recruiter table @20%) — backed by 4 new `security invoker` Postgres RPCs and Recharts client-leaf islands.

## What landed

**Three atomic commits on the current branch:**

| # | Hash    | Message                                              |
|---|---------|------------------------------------------------------|
| 1 | d2eb202 | feat(260524-cwd): recharts dep + chart wrappers      |
| 2 | f13fa5c | feat(260524-cwd): buyer-value RPC migrations + DB helpers |
| 3 | 5bfb6d0 | feat(260524-cwd): buyer-value dashboard page + 5 metric cards |

**RPCs added (single migration `20260524000200_buyer_value_rpcs.sql`):**

1. `placements_by_recruiter_quarter(p_from, p_to)` → `(quarter date, recruiter_id uuid, recruiter_name text, placements_count int)`
2. `time_to_fill_by_sector(p_from, p_to)` → `(sector text, median_days numeric, p90_days numeric, placements_count int)` — single `'Unspecified'` bucket v1
3. `pipeline_value_sparkline(p_from, p_to)` → `(bucket_date date, pipeline_value_pence bigint)` — daily series via `generate_series` left-joined to open jobs
4. `commission_summary_by_recruiter(p_from, p_to)` → `(recruiter_id uuid, recruiter_name text, placements_count int, total_fee_pence bigint, estimated_commission_pence bigint)` — GBP-filtered

All four declared `language sql / stable / security invoker / set search_path = public`, granted to `authenticated`, and `comment on function`'d. The Source ROI metric on the same page reuses the existing `source_attribution_summary(p_from, p_to)` RPC verbatim — no duplicate added.

**Chart wrappers (`src/components/charts/`):**

- `stacked-bar.tsx` — generic `BarChart` + `stackId="a"` + deterministic hue palette (`hsl((i*53)%360 70% 55%)`)
- `horizontal-bar.tsx` — `layout="vertical"` BarChart with `XAxis type="number"` / `YAxis dataKey="label" type="category" width={120}` and two bars (median + p90)
- `sparkline.tsx` — minimal LineChart, no axes/grid/legend, `isAnimationActive={false}`, tooltip only

All three are `'use client'`, take typed props (no `any`), wrap in fixed-height parent (`h-72` / `h-20`) so `ResponsiveContainer` always has a non-zero box.

**Typed DB helpers (`src/lib/db/buyer-value.ts`):**

- `getPlacementsByRecruiterQuarter`, `getTimeToFillBySector`, `getPipelineValueSparkline`, `getCommissionSummary`
- All Sentry-tagged with `{ phase: 'quick-260524-cwd', layer: 'db', helper: '<fnName>' }`
- Shared internal `callRpc<TRow>()` extracts the `.rpc.call(supabase, ...)` cast-at-boundary pattern so RPC-binding pitfall is fixed in one place
- `pivotRecruiterQuarters()` exported pure helper pivots long-format rows into `{ quarter: 'YYYY-Q#', [recruiterName]: count }` shape with zero-fills and alphabetically-sorted `recruiters` array

**Page (`src/app/(app)/reports/buyer-value/page.tsx`):**

- Server Component (no `'use client'`); `searchParams: Promise<…>` awaited per Next 16
- Auth guard: `getUser` → `getProfile` → redirect to `/sign-in` if either fails
- `Promise.all` over 5 metrics; partial failures rendered as a single error banner, not a page-level crash
- 5 Cards in locked order followed by `<details>` Methodology block
- Chart components loaded via `next/dynamic({ ssr: false, loading: skeleton })`
- Date filter wired via URL params; default `90d`

**Mobile responsiveness:** Outer wrapper stacks Cards via `space-y-6`; charts adapt via `ResponsiveContainer`; the two table metrics (Source ROI + Commission) wrap a `useIsMobile()` shell that degrades to card lists below 768px (mirrors `candidates-shell.tsx` pattern).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Relaxed StackedBarDatum type**
- **Found during:** Task 3 typecheck
- **Issue:** `StackedBarDatum = { category: string } & Record<string, string | number>` required a literal `category` property, but `pivotRecruiterQuarters` emits `{ quarter: string, [name]: number }`. TypeScript rejected the assignment despite `categoryKey="quarter"` being valid at runtime.
- **Fix:** Relaxed `StackedBarDatum` to `Record<string, string | number>` — the `categoryKey` prop already selects the label column, so the literal `category` constraint was redundant and over-restrictive.
- **Files modified:** `src/components/charts/stacked-bar.tsx`
- **Commit:** 5bfb6d0 (folded into Task 3 since the bug was a consumer-side type mismatch only surfaced in Task 3)

### Documented hand-patches (planned, not deviation)

**2. Hand-patched src/types/database.ts with 4 new RPC signatures**
- **Reason:** Per plan constraint, `pnpm exec supabase db push --linked` and `pnpm db:types` are NOT run inside the worktree — the orchestrator handles those out-of-band. Without RPC signatures in `database.ts`, Task 3's typecheck would fail.
- **Action:** Added `placements_by_recruiter_quarter`, `time_to_fill_by_sector`, `pipeline_value_sparkline`, and `commission_summary_by_recruiter` entries to the `Functions:` block of `src/types/database.ts`, following the existing pattern (e.g. `source_attribution_summary`).
- **Orchestrator action required:** After running `pnpm db:types`, the generated file will replace this hand-patch with the equivalent (or identical) generated types. No follow-up commit needed from the orchestrator — the helper functions cast `.rpc` at the boundary regardless.
- **Files modified:** `src/types/database.ts`
- **Commit:** f13fa5c (Task 2)

## Authentication Gates

None — the only auth-protected surface (the `/reports/buyer-value` route) reuses the existing `getUser` + `getProfile` pattern that has worked for `/reports/source-attribution` since Phase 3 Plan 06.

## Deferred Issues

**Pre-existing lint error** at `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98:31` (`Error: Cannot call impure function during render`) is **out of scope** for this plan. Last touched by commit `57b171e` (well before 260524-cwd). Logged to `deferred-items.md` in this plan's directory. The new chart wrappers / RPC helpers / page introduced here add **zero** new lint errors.

## Manual smoke test (post-orchestrator db push)

The plan's `<verify>.<human-check>` checklist applies once the orchestrator has run `pnpm exec supabase db push --linked` and `pnpm db:types`. Until then the 5 RPC calls will 404 in dev.

After the migration is applied, visit `http://localhost:3000/reports/buyer-value` while signed in and confirm:

1. Page renders with header + date filter + 5 Cards in order (placements/recruiter, time-to-fill, source ROI, pipeline value, commission)
2. Default preset shows "Last 90 days" as the active button
3. Clicking "Last 30 days" updates URL and re-renders all cards
4. "Custom" reveals from/to inputs
5. Browser console shows no Recharts hydration warnings or "ResponsiveContainer" errors
6. At 375px viewport, source ROI + commission tables degrade to stacked card lists
7. Methodology `<details>` toggles open/closed without JS errors

## Cross-tenancy verification

All 4 new RPCs run `security invoker`, so RLS on `applications` / `jobs` / `users` enforces isolation. The function bodies include `where … organization_id = public.current_organization_id()` as belt-and-braces — never as the primary security control (per CLAUDE.md and the dormant_clients pattern). Cross-tenant spot-check: seed two orgs locally, sign in as each, and confirm metric values differ and no rows leak.

## Threat Flags

None — this plan does not introduce surface beyond what the `<threat_model>` already analysed (5 read-only aggregation RPCs + 1 read-only RSC page + 1 URL-param-driven Client Component). All threats T-cwd-01 through T-cwd-SC are addressed as planned.

## Known Stubs

None.

## Self-Check: PASSED

**Files exist:**

- FOUND: supabase/migrations/20260524000200_buyer_value_rpcs.sql
- FOUND: src/lib/db/buyer-value.ts
- FOUND: src/lib/reports/buyer-value-range.ts
- FOUND: src/components/charts/stacked-bar.tsx
- FOUND: src/components/charts/horizontal-bar.tsx
- FOUND: src/components/charts/sparkline.tsx
- FOUND: src/app/(app)/reports/buyer-value/page.tsx
- FOUND: src/app/(app)/reports/buyer-value/date-filter.tsx
- FOUND: src/app/(app)/reports/buyer-value/_components/source-roi-{shell,table,cards}.tsx
- FOUND: src/app/(app)/reports/buyer-value/_components/commission-{shell,table,cards}.tsx

**Commits exist:**

- FOUND: d2eb202 — feat(260524-cwd): recharts dep + chart wrappers
- FOUND: f13fa5c — feat(260524-cwd): buyer-value RPC migrations + DB helpers
- FOUND: 5bfb6d0 — feat(260524-cwd): buyer-value dashboard page + 5 metric cards

**Verification:**

- `pnpm typecheck` PASSES on final commit
- `pnpm lint` fails ONLY because of the pre-existing `cv-review-panel.tsx` error (logged to deferred-items.md); new files add zero lint issues
- All 3 commits land on `worktree-agent-a8cb3e720baf25949`
