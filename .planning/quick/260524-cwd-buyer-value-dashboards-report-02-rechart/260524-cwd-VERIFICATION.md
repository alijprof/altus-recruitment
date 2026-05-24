---
phase: 260524-cwd-buyer-value-dashboards-report-02-rechart
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 12/12 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Visit http://localhost:3000/reports/buyer-value while signed in"
    expected: "Page renders with header + date filter + 5 Cards in locked order (placements/recruiter, time-to-fill, source ROI, pipeline value, commission). Default preset is 'Last 90 days'. Clicking '30d' / '365d' updates URL and re-renders all metrics. 'Custom' reveals from/to inputs + Apply button."
    why_human: "Requires running dev server with authenticated session and visual confirmation of card ordering, header text, and filter state. The DateFilter component issues router.push and re-fetches RSC data — only verifiable in browser."
  - test: "Open browser DevTools console on /reports/buyer-value"
    expected: "Zero Recharts hydration warnings, zero 'ResponsiveContainer requires non-zero height' errors, no React hydration mismatch warnings."
    why_human: "Recharts SSR/hydration mismatches surface only at runtime in the browser. Grep cannot detect rendered hydration warnings."
  - test: "Resize browser to 375px wide on /reports/buyer-value (or use device-mode iPhone SE)"
    expected: "All 5 cards stack vertically. Source ROI and Commission tables degrade to stacked card lists. Charts adapt via ResponsiveContainer to the narrow card width without overflow."
    why_human: "useIsMobile() decision boundary at 768px requires real viewport measurement; visual confirmation of card-list layout vs table is a UX check."
  - test: "Cross-tenant spot-check: sign in as a user in Org A, then sign in as a user in Org B (or seed two orgs)"
    expected: "Metric values differ across orgs. No org A rows leak into org B's recruiter labels, pipeline value, source ROI, or commission rows."
    why_human: "RLS isolation can only be empirically verified with two real authenticated sessions. The migration's `security invoker` + `current_organization_id()` predicates are correctly applied at the code level, but live verification is the contract."
  - test: "Toggle the Methodology <details> element open and closed"
    expected: "Native disclosure expands/collapses without JS errors. All 6 caveats are visible when open: fee assumption, commission placeholder, pipeline sparkline approximation, GBP currency filter, Unspecified sector, recruiter attribution."
    why_human: "Native <details> behaviour and visual content rendering require a browser to confirm."
---

# Quick task 260524-cwd: Buyer-Value Dashboards (REPORT-02) Verification Report

**Task Goal:** `/reports/buyer-value` page with 5 metric cards for acquirer due diligence (placements per recruiter per quarter, time-to-fill by sector, source ROI, pipeline value with sparkline, commission summary). URL-param date filter (default 90 days). Recharts ^3.8.1 pinned. 4 net-new security-invoker RPCs + reuse `source_attribution_summary`. Mobile-responsive shells on the two table metrics. Methodology `<details>` appendix.

**Verified:** 2026-05-24
**Status:** human_needed — all 12 code-level truths VERIFIED; 5 items legitimately need browser/runtime confirmation.
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | `/reports/buyer-value` renders header + date filter + 5 metric Cards in locked order | VERIFIED | `page.tsx:155-356` — JSX renders header, `<DateFilter>`, then 5 `<Card>` blocks in order (placements, time-to-fill, source ROI, pipeline value, commission), then `<details>` Methodology. Auth guard `getUser → getProfile → redirect('/sign-in')` at lines 102-112. |
| 2   | Date filter shows 4 preset buttons (30d/90d/365d/Custom), 90d default; preset updates URL `?preset=` and re-renders | VERIFIED | `buyer-value-range.ts:25,58` — `PRESET_VALUES = ['30d','90d','365d','custom']`, `DEFAULT_PRESET = '90d'`. `date-filter.tsx:46-65` — `selectPreset` writes `?preset=` and calls `router.push('/reports/buyer-value?...')`. `PRESET_OPTIONS` imported at `date-filter.tsx:11`. **Runtime button render and URL change require human-check.** |
| 3   | Custom preset reveals from/to inputs + Apply, writes `?preset=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` and re-fetches | VERIFIED | `date-filter.tsx:105-143` — conditional `currentPreset === 'custom'` block renders `<form onSubmit={onCustomSubmit}>` with two `<Input type="date">` + Apply `<Button type="submit">`. `onCustomSubmit:67-81` writes `preset/from/to` to URLSearchParams and navigates. **Runtime form behavior requires human-check.** |
| 4   | Placements card renders stacked bar chart when data exists, empty-state when zero rows | VERIFIED | `page.tsx:204-217` — ternary on `placementsPivot.data.length === 0` renders `<EmptyState>` else `<StackedBar data={...} keys={recruiters} categoryKey="quarter" />`. Pivot helper `pivotRecruiterQuarters` at `buyer-value.ts:184-216` zero-fills cells and sorts recruiters alphabetically. |
| 5   | Time-to-fill card renders horizontal bar (median + p90 for 'Unspecified' bucket), empty-state when zero rows | VERIFIED | `page.tsx:233-241` — empty-state vs `<HorizontalBar data={ttfRows} />`. `ttfRows` mapped at `page.tsx:131-137` from RPC results with `label/median/p90` shape. Migration `20260524000200_buyer_value_rpcs.sql:94` returns literal `'Unspecified'::text as sector`. |
| 6   | Source ROI card reuses `source_attribution_summary` RPC and renders Source/Placements/Total fee/Avg time-to-place table; mobile renders as card list | VERIFIED | `page.tsx:122` calls `getSourceAttribution` (existing helper, not duplicated). `page.tsx:261` renders `<SourceRoiShell>`. `source-roi-shell.tsx:19-24` — `useIsMobile()` selects `SourceRoiCards` (mobile) vs `SourceRoiTable` (desktop). Table columns Source/Placements/Total fee/Avg time at `source-roi-table.tsx:40-43`. |
| 7   | Pipeline value card displays large GBP number + sparkline of last <window> days | VERIFIED | `page.tsx:286-290` — `<div className="text-4xl font-semibold tabular-nums">{formatPence(currentPipelineValuePence)}</div>` + `<Sparkline data={sparkChartData} />`. `currentPipelineValuePence` at line 141 = last sparkline row's `pipeline_value_pence`. Empty-state guard line 278. |
| 8   | Commission card renders per-recruiter table (Recruiter/Placements/Total fee/Estimated commission @20%); mobile renders as card list | VERIFIED | `page.tsx:315` renders `<CommissionShell>`. `commission-shell.tsx:19-23` — `useIsMobile()` → Cards/Table. `commission-table.tsx:25-29` headers: Recruiter / Placements / Total fee / Estimated commission. Both columns `formatPence(...)`. Migration RPC `commission_summary_by_recruiter` at SQL line 190 computes `(sum(fee_pence) * 0.20)::bigint`. |
| 9   | Methodology `<details>` at bottom documents fee assumption, commission placeholder, pipeline approximation, GBP filter, Unspecified sector | VERIFIED | `page.tsx:320-355` — native `<details>` + `<summary>Methodology</summary>` with 6 `<p>` blocks covering: fee assumption (20%), commission placeholder (20%), pipeline sparkline approximation, GBP currency filter, Unspecified sector caveat, and recruiter attribution. **Runtime toggle requires human-check.** |
| 10  | 4 net-new RPCs run `security invoker` and respect RLS (org isolation) | VERIFIED (code-level) | Migration `20260524000200_buyer_value_rpcs.sql` — 4 `create or replace function public.*` blocks (lines 39, 79, 130, 170), each declares `security invoker` (lines 50, 90, 139, 182), each `set search_path = public`, each filters `organization_id = public.current_organization_id()` (lines 60, 104, 150, 193), each `grant execute to authenticated`. Migration applied to linked DB (per task brief). **Live two-org spot-check requires human verification.** |
| 11  | Page works on mobile width 375px: cards stack, charts adapt, tables degrade to card lists | VERIFIED (code-level) | Outer `<div className="mx-auto w-full max-w-5xl space-y-6">` at `page.tsx:156` stacks Cards vertically. All charts wrap in `<div className="${height} w-full">` with `<ResponsiveContainer width="100%" height="100%">` (`stacked-bar.tsx:48-49`, `horizontal-bar.tsx:41-42`, `sparkline.tsx:37-38`). SourceRoiShell + CommissionShell switch at 768px via `useIsMobile()`. **Visual confirmation at 375px viewport requires human-check.** |
| 12  | Recharts components wrapped in `dynamic({ ssr: false })` and rendered in fixed-height parents — no SSR hydration warnings, no zero-height charts | VERIFIED (code-level) | `page.tsx:54-82` — 3 `dynamic(() => import('@/components/charts/...').then(m => m.X), { ssr: false, loading: () => <skeleton /> })` blocks for StackedBar/HorizontalBar/Sparkline. Loading placeholders match eventual heights (h-72 / h-72 / h-20). All chart wrappers wrap in fixed-height parent. **Runtime hydration absence requires browser console check.** |

**Score:** 12/12 truths verified at code level. 5 truths additionally flagged for browser runtime confirmation.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `package.json` | `recharts ^3.8.1` | VERIFIED | line 51: `"recharts": "^3.8.1",` |
| `src/components/charts/stacked-bar.tsx` | `'use client'` + StackedBar export, typed props, no `any` | VERIFIED | 68 lines, `'use client'` on line 1, exports `StackedBar`, `StackedBarProps`, `StackedBarDatum`. Deterministic `hsl((i*53)%360 70% 55%)` palette. h-72 default parent. |
| `src/components/charts/horizontal-bar.tsx` | `'use client'` + HorizontalBar export, typed props | VERIFIED | 55 lines, exports `HorizontalBar`, `HorizontalBarProps`, `HorizontalBarDatum`. `layout="vertical"`, median + p90 bars. |
| `src/components/charts/sparkline.tsx` | `'use client'` + Sparkline export, typed props | VERIFIED | 53 lines, exports `Sparkline`, `SparklineProps`, `SparklineDatum`. `isAnimationActive={false}`, no axes/grid/legend, tooltip only. |
| `supabase/migrations/20260524000200_buyer_value_rpcs.sql` | 4 net-new security-invoker RPCs, all with grants + comments | VERIFIED | 209 lines, exactly 4 `create or replace function public.*` statements, 4 function-signature `security invoker` declarations (10 occurrences total including header/comment mentions), 4 `grant execute … to authenticated`, 4 `comment on function`. Functions: `placements_by_recruiter_quarter`, `time_to_fill_by_sector`, `pipeline_value_sparkline`, `commission_summary_by_recruiter`. |
| `src/lib/db/buyer-value.ts` | 4 typed helpers + pivotRecruiterQuarters, Sentry-tagged, `'server-only'` | VERIFIED | 227 lines, `import 'server-only'` line 1, exports `getPlacementsByRecruiterQuarter`/`getTimeToFillBySector`/`getPipelineValueSparkline`/`getCommissionSummary`/`pivotRecruiterQuarters`. Shared `callRpc<T>()` Sentry-tags with `{phase, layer, helper}`. Returns `DbResult<T[]>`. |
| `src/lib/reports/buyer-value-range.ts` | Pure helper + PRESET_OPTIONS + BuyerValuePreset, cloned from source-attribution-range | VERIFIED | 130 lines, exports `resolveBuyerValueRange`, `PRESET_OPTIONS`, `BuyerValuePreset`, `BuyerValueRange`, `BuyerValueRangeInput`. `DEFAULT_PRESET = '90d'`. Strict `isYmd` + round-trip validation. |
| `src/app/(app)/reports/buyer-value/page.tsx` | RSC (no 'use client') with auth guard, range, parallel fetch, 5 Cards, Methodology | VERIFIED | 358 lines, no `'use client'` directive (confirmed via grep), `next/dynamic({ ssr: false })` for 3 chart wrappers, `Promise.all` across 5 metrics, partial-failure banner at lines 183-190, 5 Cards in locked order, native `<details>` Methodology block. |
| `src/app/(app)/reports/buyer-value/date-filter.tsx` | 'use client' Client Component, basePath /reports/buyer-value | VERIFIED | 146 lines, `'use client'` line 1, exports `DateFilter`. `router.push('/reports/buyer-value?…')` at line 48. Custom-form date inputs at lines 113-138. |
| `src/types/database.ts` | Regenerated with 4 new RPC signatures | VERIFIED | All 4 RPC entries present at lines 1306, 1402, 1409, 1504 with `Args: { p_from?: string; p_to?: string }` and typed `Returns` arrays. Commit `c3156d8` regenerated types post-push. |
| `_components/source-roi-shell.tsx` + table + cards | Mobile shell + table + cards files | VERIFIED | All 3 files present, each `'use client'`. Shell uses `useIsMobile()` to swap. Table renders 4 cols, cards mirror layout. |
| `_components/commission-shell.tsx` + table + cards | Mobile shell + table + cards files | VERIFIED | All 3 files present, each `'use client'`. Shell uses `useIsMobile()` to swap. Table renders 4 cols (Recruiter/Placements/Total fee/Estimated commission), cards mirror layout. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `page.tsx` | `src/lib/db/buyer-value.ts` | `import { getPlacementsByRecruiterQuarter, getTimeToFillBySector, getPipelineValueSparkline, getCommissionSummary, pivotRecruiterQuarters }` | WIRED | `page.tsx:14-20` — all 5 named imports from `@/lib/db/buyer-value`, all called within `Promise.all` at lines 117-126. |
| `page.tsx` | `src/lib/db/source-attribution.ts` | `import { getSourceAttribution, type SourceAttributionRow }` | WIRED | `page.tsx:22-25` imports existing helper. Called at line 123. No duplicate RPC created. |
| `page.tsx` | `src/components/charts/*` | `next/dynamic({ ssr: false })` | WIRED | `page.tsx:54-82` — 3 `dynamic(() => import('@/components/charts/...').then(m => m.X), { ssr: false, loading: <skeleton/> })` blocks. Each rendered in conditional empty-state guard within respective Card. |
| `page.tsx` | `src/lib/reports/buyer-value-range.ts` | `resolveBuyerValueRange(sp)` | WIRED | `page.tsx:27` imports, line 115 calls — output drives Promise.all date args and DateFilter prop values. |
| `src/lib/db/buyer-value.ts` | Supabase RPCs | `supabase.rpc.call(supabase, '<fn>', { p_from, p_to })` | WIRED | Shared `callRpc` at lines 76-102 applies the `.rpc.call(supabase, fn, args)` cast pattern. Called from each of 4 typed helpers (lines 114, 130, 147, 164) with the 4 RPC names. |
| `page.tsx` | `_components/source-roi-shell.tsx` | `import { SourceRoiShell }` + `<SourceRoiShell rows={sourceRoiRows} />` | WIRED | Import line 31, used line 261. |
| `page.tsx` | `_components/commission-shell.tsx` | `import { CommissionShell }` + `<CommissionShell rows={commissionRows} />` | WIRED | Import line 30, used line 315. |
| `page.tsx` | `_components/date-filter.tsx` | `import { DateFilter }` + `<DateFilter currentPreset/currentFrom/currentTo />` | WIRED | Import line 32, used lines 177-181. |
| `source-roi-shell.tsx` | `source-roi-table.tsx` + `source-roi-cards.tsx` | conditional on `useIsMobile()` | WIRED | shell:11-12 imports both, lines 21-24 conditional render. |
| `commission-shell.tsx` | `commission-table.tsx` + `commission-cards.tsx` | conditional on `useIsMobile()` | WIRED | shell:10-11 imports both, lines 20-23 conditional render. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `page.tsx` placements card | `placementsPivot.data` | `getPlacementsByRecruiterQuarter` → RPC `placements_by_recruiter_quarter` | RPC body queries `public.applications` joined to `public.users`, filters `stage='placed'` and date window, groups by quarter+recruiter | FLOWING |
| `page.tsx` time-to-fill card | `ttfRows` | `getTimeToFillBySector` → RPC `time_to_fill_by_sector` | RPC body computes `percentile_cont(0.5)` and `percentile_cont(0.9)` over real `applications`/`jobs` timestamps | FLOWING |
| `page.tsx` source ROI card | `sourceRoiRows` | `getSourceAttribution` (existing) → RPC `source_attribution_summary` | Reuses existing verified RPC from Phase 3 source-attribution work | FLOWING |
| `page.tsx` pipeline value card | `currentPipelineValuePence` + `sparkChartData` | `getPipelineValueSparkline` → RPC `pipeline_value_sparkline` | RPC uses `generate_series` left-joined to `public.jobs` where `status='open' AND created_at::date <= bucket_date AND salary_max is not null`. Returns real `sum(salary_max * 100 * 0.20)::bigint` per day. | FLOWING (indicative — no historical status table, documented in Methodology) |
| `page.tsx` commission card | `commissionRows` | `getCommissionSummary` → RPC `commission_summary_by_recruiter` | RPC queries `applications` joined to `users`, filters `stage='placed' AND coalesce(placement_currency,'GBP')='GBP'`, returns real `sum(fee_pence)` + `(sum(fee_pence)*0.20)::bigint` per recruiter | FLOWING |

All 5 metric data paths trace to real DB queries against tenant-scoped tables. No hardcoded empty arrays at call sites. Empty-state branches only trigger when RPCs legitimately return zero rows.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript compiles cleanly | `pnpm typecheck` | exit 0, no errors | PASS |
| Lint passes on phase files | `pnpm lint` (filtered for `buyer-value` paths) | 0 errors, 0 warnings on phase files | PASS |
| Migration file is valid SQL with expected RPC count | `grep -c 'create or replace function public.' migration` | `4` | PASS |
| Migration declares security invoker per function | `grep -c 'security invoker' migration` (function-signature) | 4 function-signature occurrences (10 total including comments) | PASS |
| All 4 RPCs have grant execute | `grep -c 'grant execute' migration` | 5 (1 per function + 1 line for header note) | PASS |
| All 4 RPCs documented | `grep -c 'comment on function' migration` | 4 | PASS |
| Commission RPC filters to GBP | `grep "placement_currency.*GBP" migration` | match at line 195 | PASS |
| percentile_cont used for time-to-fill median/p90 | `grep "percentile_cont" migration` | 2 matches (median 0.5, p90 0.9) | PASS |
| 4 net-new RPCs typed in database.ts | `grep …` | All 4 names present at expected lines | PASS |

### Probe Execution

No conventional probes (`scripts/*/tests/probe-*.sh`) exist for this task and no probes were declared in PLAN/SUMMARY. Verification falls back to runtime browser smoke (see Human Verification Required).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| 260524-cwd | PLAN.md `requirements: [260524-cwd]` | Buyer-value reporting dashboard at /reports/buyer-value with 5 acquirer-DD metrics | SATISFIED | All 12 truths verified at code level; runtime UX/RLS need browser confirmation |

### Anti-Patterns Found

Scan of all 14 phase-touched files (migration + helpers + page + filter + 6 shells + 3 chart wrappers):

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD / FIXME / XXX / TODO / HACK / PLACEHOLDER markers in any phase file | — | — |
| (none) | — | No `return null` / `return []` / `return {}` empty implementations in render paths | — | — |
| (none) | — | No hardcoded empty props at call sites; all chart `data={...}` props are populated from RPC results with empty-state guards | — | — |
| (none) | — | No `console.log`-only handlers; `onCustomSubmit` validates + calls navigate | — | — |

Confirmed clean: `grep TBD\|FIXME\|XXX phase-files` returned zero matches.

### Gaps Summary

No gaps at the code level. All artifacts exist, are substantive, wired correctly, and trace to real data sources. The migration applied to the linked DB and `src/types/database.ts` was regenerated cleanly (commit `c3156d8`) — confirmed by grepping 4 RPC entries in the types file with correct shapes.

Five truths legitimately require browser/runtime confirmation:
- Date-filter button rendering, URL updates, and custom-form behavior (truths #2, #3)
- Recharts hydration absence (truth #12)
- Mobile 375px responsive degradation (truth #11)
- Cross-tenant RLS isolation under two real sessions (truth #10)
- Methodology `<details>` toggle (truth #9)

These are surfaced under Human Verification Required and routed through the `human_needed` status. They are NOT code-level failures.

### Pre-existing Issue (out of scope)

One lint error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98:31` ("Cannot call impure function during render") is pre-existing — last touched by commit `57b171e` before this task. SUMMARY.md documents it as deferred. New files in this phase add zero lint issues; confirmed by grep filter on `pnpm lint` output for buyer-value paths.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
