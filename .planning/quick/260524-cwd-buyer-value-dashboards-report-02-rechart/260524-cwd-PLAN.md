---
phase: 260524-cwd-buyer-value-dashboards-report-02-rechart
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-lock.yaml
  - src/components/charts/stacked-bar.tsx
  - src/components/charts/horizontal-bar.tsx
  - src/components/charts/sparkline.tsx
  - supabase/migrations/20260524000200_buyer_value_rpcs.sql
  - src/lib/db/buyer-value.ts
  - src/types/database.ts
  - src/lib/reports/buyer-value-range.ts
  - src/app/(app)/reports/buyer-value/page.tsx
  - src/app/(app)/reports/buyer-value/date-filter.tsx
  - src/app/(app)/reports/buyer-value/_components/source-roi-shell.tsx
  - src/app/(app)/reports/buyer-value/_components/source-roi-table.tsx
  - src/app/(app)/reports/buyer-value/_components/source-roi-cards.tsx
  - src/app/(app)/reports/buyer-value/_components/commission-shell.tsx
  - src/app/(app)/reports/buyer-value/_components/commission-table.tsx
  - src/app/(app)/reports/buyer-value/_components/commission-cards.tsx
autonomous: true
requirements: [260524-cwd]

must_haves:
  truths:
    - "Visiting /reports/buyer-value as an authenticated org member renders the page with header, date filter, and 5 metric Cards in order: placements-per-recruiter-per-quarter, time-to-fill, source ROI, pipeline value, commission summary"
    - "Date filter shows four preset buttons (30d / 90d / 365d / Custom) with 90d selected by default; selecting a preset updates the URL ?preset= and re-renders all 5 metrics against the new window"
    - "Custom preset reveals from/to date inputs and Apply button; submitting writes ?preset=custom&from=YYYY-MM-DD&to=YYYY-MM-DD and re-fetches"
    - "Placements-per-recruiter card renders a stacked bar chart (one stack per quarter, one colour band per recruiter) when data exists; renders an empty-state Card when zero rows"
    - "Time-to-fill card renders a horizontal bar showing median + p90 days for the 'Unspecified' sector bucket (single bar v1 — schema has no jobs.sector); empty-state when zero rows"
    - "Source ROI card reuses existing source_attribution_summary RPC and renders the same Source/Placements/Total fee/Avg time-to-place table as /reports/source-attribution; mobile (<md) renders as a card list"
    - "Pipeline value card displays a single large number (sum of jobs.salary_max × 0.20 × 100 in pence, formatted as GBP) plus a sparkline of the last <window> days"
    - "Commission summary card renders a per-recruiter table (Recruiter / Placements / Total fee / Estimated commission @20%); mobile (<md) renders as a card list"
    - "Methodology section appears at the bottom as a native <details> element documenting the fee assumption (20%), commission placeholder (20%), pipeline approximation, GBP-only filter, and 'Unspecified' sector caveat"
    - "All 4 net-new RPCs run security invoker and respect RLS: a user in org A querying via authenticated client returns only org A's data"
    - "Page works on mobile width 375px: cards stack vertically, charts adapt via ResponsiveContainer, source-roi and commission tables degrade to card lists"
    - "Recharts components are wrapped in dynamic({ ssr: false }) and render inside fixed-height (h-72) parent divs — no SSR hydration warnings in console, no zero-height charts"
  artifacts:
    - path: "package.json"
      provides: "recharts ^3.8.1 dependency added"
      contains: '"recharts": "^3.8.1"'
    - path: "src/components/charts/stacked-bar.tsx"
      provides: "Generic 'use client' stacked-bar Recharts wrapper with typed props"
      exports: ["StackedBar"]
      min_lines: 30
    - path: "src/components/charts/horizontal-bar.tsx"
      provides: "Generic 'use client' horizontal-bar Recharts wrapper with typed props"
      exports: ["HorizontalBar"]
      min_lines: 30
    - path: "src/components/charts/sparkline.tsx"
      provides: "Generic 'use client' sparkline Recharts wrapper with typed props"
      exports: ["Sparkline"]
      min_lines: 25
    - path: "supabase/migrations/20260524000200_buyer_value_rpcs.sql"
      provides: "4 net-new security-invoker RPCs: placements_by_recruiter_quarter, time_to_fill_by_sector, pipeline_value_sparkline, commission_summary_by_recruiter"
      contains: "create or replace function public.placements_by_recruiter_quarter"
      min_lines: 80
    - path: "src/lib/db/buyer-value.ts"
      provides: "Typed DB helpers wrapping each of the 4 new RPCs + pivot helpers; Sentry instrumented"
      exports:
        - "getPlacementsByRecruiterQuarter"
        - "getTimeToFillBySector"
        - "getPipelineValueSparkline"
        - "getCommissionSummary"
        - "pivotRecruiterQuarters"
      min_lines: 120
    - path: "src/lib/reports/buyer-value-range.ts"
      provides: "Pure helper that resolves searchParams into { preset, from, to }, cloned from source-attribution-range.ts"
      exports: ["resolveBuyerValueRange", "PRESET_OPTIONS", "BuyerValuePreset"]
      min_lines: 70
    - path: "src/app/(app)/reports/buyer-value/page.tsx"
      provides: "RSC page: auth guard, range resolution, parallel RPC fetch, 5 Cards, Methodology"
      exports: ["default"]
      min_lines: 150
    - path: "src/app/(app)/reports/buyer-value/date-filter.tsx"
      provides: "Client Component cloned from source-attribution date-filter, basePath /reports/buyer-value"
      exports: ["DateFilter"]
      min_lines: 50
  key_links:
    - from: "src/app/(app)/reports/buyer-value/page.tsx"
      to: "src/lib/db/buyer-value.ts"
      via: "import { getPlacementsByRecruiterQuarter, getTimeToFillBySector, getPipelineValueSparkline, getCommissionSummary }"
      pattern: "from '@/lib/db/buyer-value'"
    - from: "src/app/(app)/reports/buyer-value/page.tsx"
      to: "src/lib/db/source-attribution.ts"
      via: "import { getSourceAttribution } — reuse existing helper, no new RPC"
      pattern: "getSourceAttribution"
    - from: "src/app/(app)/reports/buyer-value/page.tsx"
      to: "src/components/charts/*"
      via: "next/dynamic({ ssr: false }) import of StackedBar, HorizontalBar, Sparkline wrappers"
      pattern: "dynamic\\(\\(\\) => import"
    - from: "src/app/(app)/reports/buyer-value/page.tsx"
      to: "src/lib/reports/buyer-value-range.ts"
      via: "resolveBuyerValueRange(searchParams)"
      pattern: "resolveBuyerValueRange"
    - from: "src/lib/db/buyer-value.ts"
      to: "supabase RPCs (placements_by_recruiter_quarter etc.)"
      via: "supabase.rpc.call(supabase, 'placements_by_recruiter_quarter', { p_from, p_to })"
      pattern: "\\.rpc[^(]*\\([^)]*'placements_by_recruiter_quarter'"
---

<objective>
Build the buyer-value reporting dashboard at `/reports/buyer-value` that surfaces 5 acquirer-due-diligence metrics: placements-per-recruiter-per-quarter (stacked bar), time-to-fill-by-sector (horizontal bar, median + p90), source ROI (table — reuses existing RPC), pipeline value (big number + sparkline), and commission summary (per-recruiter table). RSC-driven with a URL-param date filter (presets 30/90/365 + custom, default 90); Recharts client islands for visuals; server-side aggregation via 4 net-new `security invoker` Postgres RPCs.

Purpose: Hand the anchor customer a single-page dashboard they (and a prospective acquirer) can read at a glance — proves the data spine is rich enough to support due-diligence questions about productivity, throughput, channel mix, future revenue, and recruiter economics.

Output: New `/reports/buyer-value` route + chart wrappers under `src/components/charts/` + new migration with 4 RPCs + typed DB helpers + regenerated `src/types/database.ts`. All commits land on the current branch as three atomic commits (one per task).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@.planning/quick/260524-cwd-buyer-value-dashboards-report-02-rechart/260524-cwd-RESEARCH.md
@supabase/migrations/20260513152244_phase1_domain_schema.sql
@supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql
@supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql
@supabase/migrations/20260523160000_phase3_placement_type_and_required_fields.sql
@src/app/(app)/reports/source-attribution/page.tsx
@src/app/(app)/reports/source-attribution/date-filter.tsx
@src/lib/reports/source-attribution-range.ts
@src/lib/db/source-attribution.ts
@src/app/(app)/candidates/candidates-shell.tsx
@src/hooks/use-is-mobile.ts
@src/components/app/metric-card.tsx
@src/lib/format.ts
@package.json

<interfaces>
<!-- Key contracts the executor needs. Extracted from the codebase. -->
<!-- Use these directly — no codebase exploration required. -->

From src/lib/db/source-attribution.ts (REUSE — do not duplicate):
```typescript
export type SourceAttributionRow = {
  source: Database['public']['Enums']['candidate_source']
  placements_count: number
  total_fee_pence: number
  avg_time_to_place_days: number
}
export async function getSourceAttribution(
  supabase: SupabaseClient<Database>,
  args: { from: string; to: string },
): Promise<DbResult<SourceAttributionRow[]>>
```

From src/lib/reports/source-attribution-range.ts (CLONE pattern, do not import directly):
```typescript
export type SourceAttributionPreset = '30d' | '90d' | '365d' | 'custom'
export type SourceAttributionRange = { preset: SourceAttributionPreset; from: string; to: string }
export const PRESET_OPTIONS: ReadonlyArray<{ value: SourceAttributionPreset; label: string }>
export function resolveSourceAttributionRange(
  searchParams: { preset?: string | string[]; from?: string | string[]; to?: string | string[] },
  now?: Date,
): SourceAttributionRange
```

From src/lib/db/types.ts:
```typescript
export type DbResult<T> = { ok: true; data: T } | { ok: false; code: 'internal' | 'not_found' | 'forbidden' | ... }
```

From src/lib/db/profiles.ts:
```typescript
export async function getProfile(supabase, userId): Promise<DbResult<Profile>>
```

From src/lib/supabase/server.ts:
```typescript
export async function createClient(): Promise<SupabaseClient<Database>>
```

From src/lib/format.ts:
```typescript
export function formatPence(pence: number): string  // → "£12,345.67"
```

From src/hooks/use-is-mobile.ts:
```typescript
export function useIsMobile(): boolean  // true below 768px
```

Recharts surface used by the chart wrappers (pin `^3.8.1`):
```typescript
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
```

Existing schema columns this plan touches (read-only):
- applications: id, organization_id, job_id, owner_user_id, created_by, stage, stage_changed_at, placed_at, fee_pence, placement_currency
- jobs: id, organization_id, status, salary_max, created_at
- users (public.users): id, full_name, email
- helper: public.current_organization_id() → uuid

</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add recharts dep + create 3 client chart wrapper components</name>
  <files>
    package.json,
    pnpm-lock.yaml,
    src/components/charts/stacked-bar.tsx,
    src/components/charts/horizontal-bar.tsx,
    src/components/charts/sparkline.tsx
  </files>
  <action>
Add `"recharts": "^3.8.1"` to `package.json` dependencies (alphabetical position between `react-hook-form` and `sonner`). Run `pnpm install` to update `pnpm-lock.yaml`. The Recharts 3.x peer range covers React 19 natively — no `pnpm.overrides` block needed (per RESEARCH §"React 19 / Next.js 16 compatibility note").

Then create three small `'use client'` Recharts wrapper components under `src/components/charts/`. Each wrapper:
- Starts with `'use client'` on line 1
- Defines its own typed props interface (no `any` — RESEARCH §"All chart wrappers should accept typed props")
- Wraps the chart in `<div className="h-72 w-full">` (or `h-64` for sparkline) to give `ResponsiveContainer` an explicit height parent (RESEARCH §"Pitfall 1")
- Uses `ResponsiveContainer width="100%" height="100%"` as the only sizing strategy
- Has no Sentry / no DB / no auth concerns — pure presentational leaves

Wrapper 1 — `src/components/charts/stacked-bar.tsx`:
- Export `StackedBar`
- Props: `{ data: Array<{ category: string } & Record<string, string | number>>; keys: string[]; categoryKey?: string; height?: 'h-64' | 'h-72' | 'h-80' }`
- Renders `BarChart` with `CartesianGrid strokeDasharray="3 3"`, `XAxis dataKey={categoryKey ?? 'category'}`, `YAxis allowDecimals={false}`, `Tooltip`, `Legend`, and one `<Bar dataKey={k} stackId="a" fill={...} />` per key in the `keys` array
- Colour each bar via `fill={\`hsl(${(i * 53) % 360} 70% 55%)\`}` so the palette is deterministic and arbitrary-length

Wrapper 2 — `src/components/charts/horizontal-bar.tsx`:
- Export `HorizontalBar`
- Props: `{ data: Array<{ label: string; median: number; p90: number }>; height?: 'h-64' | 'h-72' | 'h-80' }`
- Renders `BarChart` with `layout="vertical"`, swap axes: `XAxis type="number"`, `YAxis dataKey="label" type="category" width={120}`, `Tooltip`, `Legend`, two `<Bar dataKey="median" fill="hsl(220 70% 55%)" name="Median days" />` and `<Bar dataKey="p90" fill="hsl(280 70% 55%)" name="p90 days" />`

Wrapper 3 — `src/components/charts/sparkline.tsx`:
- Export `Sparkline`
- Props: `{ data: Array<{ x: string; y: number }>; height?: 'h-16' | 'h-20' | 'h-24'; strokeColor?: string }` (default height `h-20`, default stroke `hsl(220 70% 55%)`)
- Renders `LineChart` with no axes, no grid, no legend; just one `<Line type="monotone" dataKey="y" stroke={strokeColor} strokeWidth={2} dot={false} isAnimationActive={false} />` and a minimal `<Tooltip />` showing the value

Do NOT import these wrappers anywhere in this task. Task 3 wires them via `dynamic({ ssr: false })` in `page.tsx`. Do NOT add any new shadcn primitives — wrappers are intentionally framework-agnostic.

Commit message: `feat(260524-cwd): recharts dep + chart wrappers`. Commit `package.json`, `pnpm-lock.yaml`, and the three new files together.
  </action>
  <verify>
    <automated>grep -q '"recharts": "\^3.8.1"' package.json &amp;&amp; ls src/components/charts/stacked-bar.tsx src/components/charts/horizontal-bar.tsx src/components/charts/sparkline.tsx &amp;&amp; head -1 src/components/charts/stacked-bar.tsx | grep -q "^'use client'" &amp;&amp; head -1 src/components/charts/horizontal-bar.tsx | grep -q "^'use client'" &amp;&amp; head -1 src/components/charts/sparkline.tsx | grep -q "^'use client'" &amp;&amp; pnpm typecheck &amp;&amp; pnpm lint</automated>
  </verify>
  <done>
- `package.json` has `"recharts": "^3.8.1"` in alphabetical position
- `pnpm-lock.yaml` updated to resolve recharts 3.8.1
- All three wrappers exist with `'use client'` on line 1 and exported named components
- No `any` in wrapper props
- `pnpm typecheck` passes; `pnpm lint` passes
- Single commit `feat(260524-cwd): recharts dep + chart wrappers` includes the 5 files
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: 4 RPC migration + typed DB helpers</name>
  <files>
    supabase/migrations/20260524000200_buyer_value_rpcs.sql,
    src/lib/db/buyer-value.ts
  </files>
  <action>
Create ONE append-only migration `supabase/migrations/20260524000200_buyer_value_rpcs.sql` containing 4 net-new functions (Source ROI metric reuses the existing `source_attribution_summary` RPC — do not re-create it). Every function: `language sql`, `stable`, `security invoker`, `set search_path = public`, with `grant execute … to authenticated` and a `comment on function` explaining its role. Pattern reference: `supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql`. Add a file-header comment block citing 260524-cwd, listing all 4 functions, and noting "security invoker — RLS on applications/jobs/users does the tenancy work; org-id filters are belt-and-braces only."

Function shapes (copy verbatim from RESEARCH.md §"5 RPC Shapes" — they're already battle-tested SQL):

1. `placements_by_recruiter_quarter(p_from date default (now() - interval '365 days')::date, p_to date default now()::date)` → `returns table (quarter date, recruiter_id uuid, recruiter_name text, placements_count int)`. Group by `date_trunc('quarter', coalesce(a.placed_at, a.stage_changed_at))::date`. Recruiter attribution: `u.id = coalesce(a.owner_user_id, a.created_by)`. Filter `a.stage = 'placed'` + date window + `a.organization_id = public.current_organization_id()`. Order `quarter asc, placements_count desc`.

2. `time_to_fill_by_sector(p_from date default (now() - interval '90 days')::date, p_to date default now()::date)` → `returns table (sector text, median_days numeric, p90_days numeric, placements_count int)`. Use literal `'Unspecified'::text as sector` (per locked decision and RESEARCH §"Schema Verification" — jobs has no sector column; single bucket v1). Compute `percentile_cont(0.5) within group (order by extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400)::numeric(10,1)` for median; same with `0.9` for p90. Filter `a.stage = 'placed'` + date window + org. Group by 1.

3. `pipeline_value_sparkline(p_from date default (now() - interval '90 days')::date, p_to date default now()::date)` → `returns table (bucket_date date, pipeline_value_pence bigint)`. Use `generate_series(p_from, p_to, interval '1 day')::date as d` CTE. Left join `public.jobs j` where `j.status = 'open' AND j.created_at::date <= ds.d AND j.salary_max is not null AND j.organization_id = public.current_organization_id()`. Compute `coalesce(sum((j.salary_max * 100 * 0.20)::bigint), 0)::bigint as pipeline_value_pence`. Group by `ds.d`, order asc. (No currency filter on jobs — `currency` is per-job not per-placement; assume GBP. Add a NOTE comment.)

4. `commission_summary_by_recruiter(p_from date default (now() - interval '90 days')::date, p_to date default now()::date)` → `returns table (recruiter_id uuid, recruiter_name text, placements_count int, total_fee_pence bigint, estimated_commission_pence bigint)`. Same join + attribution pattern as #1. **MUST include `and coalesce(a.placement_currency, 'GBP') = 'GBP'`** (per locked decision — filter fee aggregations to GBP). Commission = `(coalesce(sum(a.fee_pence), 0) * 0.20)::bigint`. Group by `u.id`, order `total_fee_pence desc`.

Then create `src/lib/db/buyer-value.ts` (model after `src/lib/db/source-attribution.ts` — same `'server-only'` import, same Sentry pattern, same `DbResult<T>` return type, same `.rpc.call(supabase, ...)` binding fix). One typed helper per RPC:

- `export type PlacementsByRecruiterQuarterRow = { quarter: string; recruiter_id: string; recruiter_name: string; placements_count: number }`
- `export type TimeToFillBySectorRow = { sector: string; median_days: number; p90_days: number; placements_count: number }`
- `export type PipelineValueSparklineRow = { bucket_date: string; pipeline_value_pence: number }`
- `export type CommissionSummaryRow = { recruiter_id: string; recruiter_name: string; placements_count: number; total_fee_pence: number; estimated_commission_pence: number }`
- `export async function getPlacementsByRecruiterQuarter(supabase, { from, to }): Promise<DbResult<PlacementsByRecruiterQuarterRow[]>>`
- `export async function getTimeToFillBySector(supabase, { from, to }): Promise<DbResult<TimeToFillBySectorRow[]>>`
- `export async function getPipelineValueSparkline(supabase, { from, to }): Promise<DbResult<PipelineValueSparklineRow[]>>`
- `export async function getCommissionSummary(supabase, { from, to }): Promise<DbResult<CommissionSummaryRow[]>>`

Each helper: tag Sentry with `{ phase: 'quick-260524-cwd', layer: 'db', helper: '<fnName>' }`. Use the same `.rpc as unknown as (fn, args) => Promise<…>).call(supabase, '<fn>', { p_from, p_to })` cast pattern from `source-attribution.ts` lines 48-62 (regenerated `database.ts` will lag the migration in the executor's working copy until the orchestrator runs `pnpm db:types` post-push). Document the cast with `// reason: ...` referencing the RPC name and the binding pitfall.

Also export a pure pivot helper for chart wiring:
```ts
export function pivotRecruiterQuarters(rows: PlacementsByRecruiterQuarterRow[]): {
  data: Array<{ quarter: string } & Record<string, string | number>>
  recruiters: string[]
}
```
that pivots `{ quarter, recruiter_name, placements_count }[]` into the `{ quarter: 'YYYY-Q#', [name]: count }` shape Recharts' stacked bar expects, with zero-fills for missing (quarter, recruiter) cells and a stable `recruiters` array sorted alphabetically. Quarter labels: convert `YYYY-MM-DD` quarter-start dates to `YYYY-Q#` using `Math.floor(month / 3) + 1`.

Commit message: `feat(260524-cwd): buyer-value RPC migrations + DB helpers`. Commit the migration + helper together. **Do NOT** run `pnpm exec supabase db push --linked` or `pnpm db:types` here — the orchestrator runs these out-of-band after the executor's verify block (per MEMORY.md `supabase-migrations-manual-push`; per plan constraint).
  </action>
  <verify>
    <automated>test -f supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; grep -c 'create or replace function public.' supabase/migrations/20260524000200_buyer_value_rpcs.sql | grep -q '^4$' &amp;&amp; grep -c 'security invoker' supabase/migrations/20260524000200_buyer_value_rpcs.sql | grep -q '^4$' &amp;&amp; grep -q 'placements_by_recruiter_quarter' supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; grep -q 'time_to_fill_by_sector' supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; grep -q 'pipeline_value_sparkline' supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; grep -q 'commission_summary_by_recruiter' supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; grep -q "placement_currency.*GBP" supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; grep -q "percentile_cont" supabase/migrations/20260524000200_buyer_value_rpcs.sql &amp;&amp; test -f src/lib/db/buyer-value.ts &amp;&amp; grep -q "import 'server-only'" src/lib/db/buyer-value.ts &amp;&amp; grep -q "getPlacementsByRecruiterQuarter" src/lib/db/buyer-value.ts &amp;&amp; grep -q "getTimeToFillBySector" src/lib/db/buyer-value.ts &amp;&amp; grep -q "getPipelineValueSparkline" src/lib/db/buyer-value.ts &amp;&amp; grep -q "getCommissionSummary" src/lib/db/buyer-value.ts &amp;&amp; grep -q "pivotRecruiterQuarters" src/lib/db/buyer-value.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm lint</automated>
  </verify>
  <done>
- Migration file exists with exactly 4 `create or replace function public.…` statements
- All 4 functions are `security invoker` with `set search_path = public`
- All 4 functions have `grant execute … to authenticated` + a `comment on function`
- Commission + sparkline RPCs filter to GBP via `coalesce(a.placement_currency, 'GBP') = 'GBP'` (commission) or document GBP assumption (sparkline)
- `src/lib/db/buyer-value.ts` exports all 4 typed helpers + `pivotRecruiterQuarters`
- Each helper Sentry-tags errors and returns `DbResult<T>`
- `pnpm typecheck` passes; `pnpm lint` passes
- Single commit `feat(260524-cwd): buyer-value RPC migrations + DB helpers`
- **Orchestrator out-of-band step (NOT in executor verify):** after commit, orchestrator runs `pnpm exec supabase db push --linked` then `pnpm db:types` to apply migration and regenerate `src/types/database.ts`
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: /reports/buyer-value page + date filter + 5 metric Cards + Methodology + mobile shells</name>
  <files>
    src/lib/reports/buyer-value-range.ts,
    src/app/(app)/reports/buyer-value/page.tsx,
    src/app/(app)/reports/buyer-value/date-filter.tsx,
    src/app/(app)/reports/buyer-value/_components/source-roi-shell.tsx,
    src/app/(app)/reports/buyer-value/_components/source-roi-table.tsx,
    src/app/(app)/reports/buyer-value/_components/source-roi-cards.tsx,
    src/app/(app)/reports/buyer-value/_components/commission-shell.tsx,
    src/app/(app)/reports/buyer-value/_components/commission-table.tsx,
    src/app/(app)/reports/buyer-value/_components/commission-cards.tsx
  </files>
  <action>
Three logical sub-steps in one task. Match existing codebase conventions (no semicolons, single quotes, 2-space indent, named exports, `@/` path alias).

**Sub-step A — Range helper (`src/lib/reports/buyer-value-range.ts`):** Clone `src/lib/reports/source-attribution-range.ts` verbatim. Rename exported symbols (`SourceAttributionPreset` → `BuyerValuePreset`, `SourceAttributionRange` → `BuyerValueRange`, `resolveSourceAttributionRange` → `resolveBuyerValueRange`). Keep `PRESET_VALUES = ['30d','90d','365d','custom']`, `DEFAULT_PRESET = '90d'`, `PRESET_DAYS = { '30d': 30, '90d': 90, '365d': 365 }`. Keep all helper functions (`firstString`, `isYmd`, `toYmd`, `subtractDaysUtc`, `isPreset`, `defaultWindow`). Re-export `PRESET_OPTIONS` (same shape). Update the leading comment block to reference this plan (260524-cwd) and the buyer-value page path. Do NOT touch the original source-attribution-range file — clone, don't refactor (per RESEARCH §"Pattern 2: Date-filter reuse — Decision: Clone, don't refactor").

**Sub-step B — Date filter (`src/app/(app)/reports/buyer-value/date-filter.tsx`):** Clone `src/app/(app)/reports/source-attribution/date-filter.tsx` verbatim. Two changes: (1) import `BuyerValuePreset` + `PRESET_OPTIONS` from `@/lib/reports/buyer-value-range`, (2) change every `/reports/source-attribution` → `/reports/buyer-value` in the `router.push` calls (lines 45, 76). Keep the `'use client'`, the `useTransition` pattern, the URL-as-source-of-truth design, and the custom from/to form. Rename prop type to `DateFilterProps` (already is) — keep the named export `DateFilter`.

**Sub-step C — Mobile shells for the two table metrics (Source ROI + Commission):**

Following the `candidates-shell.tsx` pattern (`'use client'` + `useIsMobile()` + conditional render):

`source-roi-shell.tsx`: `'use client'`. Props `{ rows: SourceAttributionRow[] }`. If `useIsMobile()` returns true, render `<SourceRoiCards rows={rows} />`, else `<SourceRoiTable rows={rows} />`.

`source-roi-table.tsx`: `'use client'`. Renders the same table layout as `/reports/source-attribution` page lines 191-218 (Source / Placements / Total fee / Avg time to place). Reuse the `SOURCE_LABEL` map (define inline — do NOT import the private constant from source-attribution/page.tsx). Use `Badge variant="secondary"` for the placements column, `formatPence(row.total_fee_pence)` for total fee, `row.avg_time_to_place_days.toFixed(1) + ' days'` for the avg column.

`source-roi-cards.tsx`: `'use client'`. Renders each row as a compact card stacked vertically: source name as heading, then three labeled rows for placements / total fee / avg time-to-place. Use `space-y-3` between cards, `rounded-md border p-3` per card. Match the visual density of `candidate-cards.tsx`.

`commission-shell.tsx`: `'use client'`. Props `{ rows: CommissionSummaryRow[] }`. Same shell pattern as source-roi.

`commission-table.tsx`: `'use client'`. Columns: Recruiter / Placements / Total fee / Estimated commission. `Badge variant="secondary"` for placements; `formatPence(row.total_fee_pence)` and `formatPence(row.estimated_commission_pence)` for the two money columns; right-align numeric cells (`text-right tabular-nums`).

`commission-cards.tsx`: `'use client'`. Mobile card list mirroring `source-roi-cards.tsx` for the 4 commission fields.

**Sub-step D — Page (`src/app/(app)/reports/buyer-value/page.tsx`):**

Server Component (no `'use client'`). Mirror the structure of `src/app/(app)/reports/source-attribution/page.tsx` lines 81-260.

1. Imports — group by: react/next, lucide-react, shadcn ui, app components, db helpers, lib. Use `next/dynamic` to lazy-load the three Recharts wrappers with `{ ssr: false, loading: () => <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" /> }`:
   - `const StackedBar = dynamic(() => import('@/components/charts/stacked-bar').then(m => m.StackedBar), { ssr: false, loading: ... })`
   - Same for `HorizontalBar` (h-72 placeholder) and `Sparkline` (h-20 placeholder)

2. `type PageProps = { searchParams: Promise<{ preset?: string; from?: string; to?: string }> }`

3. `export default async function BuyerValuePage({ searchParams }: PageProps)`:
   - `const supabase = await createClient()`
   - Auth guard: same pattern as source-attribution lines 82-92 (`getUser` → if missing `redirect('/sign-in')`; `getProfile` → if not ok `redirect('/sign-in')`)
   - `const sp = await searchParams`
   - `const range = resolveBuyerValueRange(sp)`
   - Parallel fetch ALL 5 metrics with `Promise.all`:
     ```ts
     const [placements, ttf, sourceRoi, sparkline, commission] = await Promise.all([
       getPlacementsByRecruiterQuarter(supabase, { from: range.from, to: range.to }),
       getTimeToFillBySector(supabase, { from: range.from, to: range.to }),
       getSourceAttribution(supabase, { from: range.from, to: range.to }),
       getPipelineValueSparkline(supabase, { from: range.from, to: range.to }),
       getCommissionSummary(supabase, { from: range.from, to: range.to }),
     ])
     ```
   - Derive display data:
     - `const placementsPivot = placements.ok ? pivotRecruiterQuarters(placements.data) : { data: [], recruiters: [] }`
     - `const ttfRows = ttf.ok ? ttf.data.map(r => ({ label: r.sector, median: r.median_days, p90: r.p90_days })) : []`
     - `const sourceRoiRows = sourceRoi.ok ? sourceRoi.data : []`
     - `const sparkRows = sparkline.ok ? sparkline.data : []`
     - `const currentPipelineValuePence = sparkRows.length > 0 ? sparkRows[sparkRows.length - 1].pipeline_value_pence : 0` (per RESEARCH §RPC #4 note: reuse last sparkline row for the big number)
     - `const sparkChartData = sparkRows.map(r => ({ x: r.bucket_date, y: r.pipeline_value_pence }))`
     - `const commissionRows = commission.ok ? commission.data : []`

4. Render layout (server-side JSX):
   - Outer wrapper `<div className="mx-auto w-full max-w-5xl space-y-6">`
   - Back link: `<Link href="/reports">` with `<ChevronLeft />` (same chrome as source-attribution page lines 109-118)
   - `<header>` with title "Buyer-value report" and subtitle echoing `rangeSubtitle(range.from, range.to)` (define inline — same helper as source-attribution page lines 68-79)
   - `<DateFilter currentPreset={range.preset} currentFrom={range.from} currentTo={range.to} />`
   - **Error banner:** if any of the 5 results is `!ok`, render a single `<Card>` with `<CardContent className="text-destructive py-4 text-sm">` listing which metrics failed to load. Don't kill the whole page on partial failure.
   - **Card 1 — Placements per recruiter per quarter:** `<CardTitle>` "Placements per recruiter per quarter", `<CardDescription>` "Stacked bars show each recruiter's placement count by quarter. Higher and more even = healthier team distribution." If `placementsPivot.data.length === 0`, render `<EmptyState heading="No placements yet" body="..." />`; otherwise `<StackedBar data={placementsPivot.data} keys={placementsPivot.recruiters} categoryKey="quarter" />`.
   - **Card 2 — Time-to-fill by sector:** `<CardDescription>` includes "Sector grouping is bucketed under 'Unspecified' until a sector field is added to jobs." Empty state if `ttfRows.length === 0`; else `<HorizontalBar data={ttfRows} />`.
   - **Card 3 — Source ROI:** `<CardDescription>` "Placements grouped by candidate source, with fee revenue and average time-to-place per channel." Render `<SourceRoiShell rows={sourceRoiRows} />` (or `EmptyState` if empty). Import SourceRoiShell from `./_components/source-roi-shell`.
   - **Card 4 — Pipeline value:** `<CardDescription>` "Sum of `salary_max × 20%` across open jobs. Sparkline shows the trend over the selected window." Render the big number prominently: `<div className="text-4xl font-semibold tabular-nums">{formatPence(currentPipelineValuePence)}</div>`. Below it the `<Sparkline data={sparkChartData} />`. Empty state if `sparkRows.length === 0` AND `currentPipelineValuePence === 0`.
   - **Card 5 — Commission summary:** `<CardDescription>` "Per-recruiter commission, computed as 20% of recorded fees (placeholder until per-recruiter rates exist). GBP placements only." Render `<CommissionShell rows={commissionRows} />`. Empty state if empty.
   - **Methodology — native `<details>` block at the bottom:**
     ```tsx
     <details className="rounded-md border bg-muted/30 p-4">
       <summary className="cursor-pointer text-sm font-medium">Methodology</summary>
       <div className="prose prose-sm mt-3 space-y-2 text-sm">
         <p><strong>Fee assumption.</strong> Pipeline value uses <code>salary_max × 20%</code> as expected fee per open job.</p>
         <p><strong>Commission placeholder.</strong> Estimated commission = total fee × 20%. Replace with per-recruiter rates once schema supports them.</p>
         <p><strong>Pipeline sparkline.</strong> "Open as of date X" = jobs with <code>status='open'</code> and <code>created_at ≤ X</code>. We lack a historical status table, so the trend is indicative only.</p>
         <p><strong>Currency.</strong> Commission and pipeline aggregations are filtered to GBP placements (<code>placement_currency = 'GBP'</code>).</p>
         <p><strong>Sector.</strong> The <code>jobs</code> table has no sector column; time-to-fill rolls up into a single "Unspecified" bucket until a sector field is added.</p>
         <p><strong>Recruiter attribution.</strong> Placements credit <code>owner_user_id</code>, falling back to <code>created_by</code>.</p>
       </div>
     </details>
     ```
     Use native `<details>` — zero JS bundle, native a11y (per RESEARCH §"Collapsible methodology — Recommendation: Use `<details>`, not Radix Collapsible").

5. Mobile responsiveness:
   - The outer wrapper already stacks Cards vertically via `space-y-6`
   - Charts use `ResponsiveContainer` so they adapt to Card width automatically
   - Source ROI + Commission cards use their `*-shell.tsx` Client wrappers which auto-degrade to card lists below 768px
   - Date filter already wraps via `flex-wrap` in the cloned `date-filter.tsx`
   - No new mobile-specific code needed at page level

6. Use `next/link` for every navigation (only the Back link in this page — internal CTAs from empty states use `<EmptyState cta={{ href: ..., label: ... }} />` which already wraps Link).

Commit message: `feat(260524-cwd): buyer-value dashboard page + 5 metric cards`. Commit all 9 files in this task together.

After commit, manual smoke: `pnpm dev`, visit `/reports/buyer-value`, confirm: (a) default 90d window selected, (b) clicking 30d / 365d updates URL + re-renders, (c) Custom reveals date inputs, (d) all 5 cards render (with empty states acceptable on dev data), (e) browser console has zero Recharts hydration warnings, (f) on a 375px wide window all cards stack and tables degrade to card lists. The orchestrator should also confirm the executor ran `pnpm exec supabase db push --linked` and `pnpm db:types` from Task 2 — without those, Card-data RPCs will 404.
  </action>
  <verify>
    <automated>test -f src/lib/reports/buyer-value-range.ts &amp;&amp; grep -q "resolveBuyerValueRange" src/lib/reports/buyer-value-range.ts &amp;&amp; grep -q "BuyerValuePreset" src/lib/reports/buyer-value-range.ts &amp;&amp; test -f src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; ! grep -q "^'use client'" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "resolveBuyerValueRange" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "getPlacementsByRecruiterQuarter" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "getTimeToFillBySector" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "getSourceAttribution" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "getPipelineValueSparkline" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "getCommissionSummary" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "dynamic" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "ssr: false" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; grep -q "&lt;details" src/app/(app)/reports/buyer-value/page.tsx &amp;&amp; test -f src/app/(app)/reports/buyer-value/date-filter.tsx &amp;&amp; head -1 src/app/(app)/reports/buyer-value/date-filter.tsx | grep -q "^'use client'" &amp;&amp; grep -q "/reports/buyer-value" src/app/(app)/reports/buyer-value/date-filter.tsx &amp;&amp; test -f src/app/\(app\)/reports/buyer-value/_components/source-roi-shell.tsx &amp;&amp; test -f src/app/\(app\)/reports/buyer-value/_components/source-roi-table.tsx &amp;&amp; test -f src/app/\(app\)/reports/buyer-value/_components/source-roi-cards.tsx &amp;&amp; test -f src/app/\(app\)/reports/buyer-value/_components/commission-shell.tsx &amp;&amp; test -f src/app/\(app\)/reports/buyer-value/_components/commission-table.tsx &amp;&amp; test -f src/app/\(app\)/reports/buyer-value/_components/commission-cards.tsx &amp;&amp; pnpm typecheck &amp;&amp; pnpm lint</automated>
    <human-check>Visit http://localhost:3000/reports/buyer-value while signed in. Confirm: (1) page renders with header + date filter + 5 Cards in order (placements/recruiter, time-to-fill, source ROI, pipeline value, commission); (2) default preset shows "Last 90 days" as the active button; (3) clicking "Last 30 days" updates URL and re-renders all cards; (4) "Custom" reveals from/to inputs; (5) browser console shows no Recharts hydration warnings or "ResponsiveContainer" errors; (6) at 375px viewport, source ROI + commission tables degrade to stacked card lists; (7) Methodology `<details>` toggles open/closed without JS errors.</human-check>
  </verify>
  <done>
- `src/lib/reports/buyer-value-range.ts` exists, cloned + renamed from source-attribution-range; original file untouched
- `src/app/(app)/reports/buyer-value/page.tsx` is a Server Component (no `'use client'`), uses `next/dynamic` for the three Recharts wrappers with `ssr: false`, fetches all 5 metrics in parallel via `Promise.all`, renders 5 Cards in the locked order + Methodology `<details>`
- `src/app/(app)/reports/buyer-value/date-filter.tsx` is `'use client'`, cloned from source-attribution date-filter, basePath changed to `/reports/buyer-value`
- Six `_components/*` shell + table + cards files exist with `'use client'` and degrade at 768px via `useIsMobile()`
- All chart wrapper consumption is wrapped in `<div className="h-72 w-full">` (or sparkline equivalent) parents
- All page links use `next/link` Link primitives
- `pnpm typecheck` passes; `pnpm lint` passes
- Manual smoke check confirms the 7 human-check items
- Single commit `feat(260524-cwd): buyer-value dashboard page + 5 metric cards` includes the 9 new files
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Next.js RSC | Authenticated org member requests `/reports/buyer-value`; session cookie carries `auth.uid()` |
| Next.js RSC → Supabase Postgres (over PostgREST) | Server SSR Supabase client (cookie-derived JWT, NOT service role) invokes RPCs; RLS enforces tenancy |
| Browser → Next.js (Client Components) | Date-filter Client Component issues `router.push`; only writes URL params (no DB mutations) |
| Postgres function body → underlying tables | `security invoker` functions inherit caller's RLS; `current_organization_id()` reads from session JWT |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-cwd-01 | Information Disclosure | 4 new RPCs | mitigate | All RPCs declared `security invoker`; org isolation enforced by RLS on `applications` / `jobs` / `users` — verified by reading dormant_clients pattern. Belt-and-braces `where … organization_id = public.current_organization_id()` clause in each query. No service-role client used. |
| T-cwd-02 | Information Disclosure | Recruiter names in chart labels | accept | `users.full_name` is profile data within the org; rendering it to authenticated org members is the intended behaviour and aligns with the existing pipeline / commission patterns. Sentry tags use only `org_id` + helper name, never names. |
| T-cwd-03 | Spoofing | Date filter URL params | mitigate | `resolveBuyerValueRange` validates preset against an allow-list, validates from/to as YYYY-MM-DD (`isYmd`), silently falls back to default window on malformed input (cloned pattern). No SQL injection surface: dates are bound via PostgREST `p_from` / `p_to` parameters. |
| T-cwd-04 | Tampering | Direct client call to RPC | mitigate | DB helpers are marked `'server-only'`; RPCs require authenticated role grant; no client-side fetch wires to RPC endpoints. |
| T-cwd-05 | Denial of Service | Sparkline RPC over wide custom range (e.g. 10 years) | accept | `generate_series` over 365-day default is cheap; even 10-year ranges produce ~3650 rows. Cost-vs-mitigation skewed; acceptable for a 2-3 person anchor customer. Add an upper-bound check in a later phase if abuse appears. |
| T-cwd-06 | Repudiation | Reporting reads (audit logging) | accept | Buyer-value page is read-only aggregation; CLAUDE.md "every access to candidate data is logged" applies to PII detail views (candidate detail). Aggregated counts/sums per recruiter don't expose individual candidate data; consistent with existing /reports/source-attribution which does not audit. |
| T-cwd-SC | Tampering | npm install of recharts | mitigate | RESEARCH.md §"Package Legitimacy Audit" lists recharts as the official shadcn/ui chart primitive, ~3M weekly downloads, 10+ year old, github.com/recharts/recharts. slopcheck not available in this environment — the planner accepts recharts on the basis of established npm registry presence and shadcn/ui canonical-status. The locked plan explicitly approves `recharts ^3.8.1`; no `[ASSUMED]`/`[SUS]` checkpoint inserted because the user already approved the dep choice during /gsd discuss. |
</threat_model>

<verification>
## Phase-Level Checks

After all three tasks land and the orchestrator runs the out-of-band `supabase db push --linked` + `pnpm db:types`:

1. `pnpm typecheck` passes against regenerated `src/types/database.ts`
2. `pnpm lint` passes
3. `pnpm exec supabase db push --linked` exits clean (no migration conflicts)
4. `pnpm dev` boots; `/reports/buyer-value` renders without server-side errors in the terminal
5. In a logged-in session, browser DevTools Network panel shows the page request returns 200 and Recharts chunks lazy-load on demand
6. Manual cross-tenant spot-check: switch to a second test org (or seed two orgs locally); confirm metrics differ across orgs and no row leaks
7. Add `?preset=custom&from=2026-01-01&to=2026-03-31` to the URL: page re-renders with that window; toggling to preset 30d clears `from`/`to` and re-renders
8. Resize browser to 375px width: all 5 cards stack; source ROI + commission render as card lists; charts adapt to narrow Card widths
9. View source on the page: no `'use client'` directive at the top of `page.tsx` (still an RSC); chart components are loaded via dynamic imports
</verification>

<success_criteria>
- `/reports/buyer-value` renders for an authenticated org member with 5 metric Cards in the locked order
- Date filter (30d / 90d / 365d / custom, default 90d) is URL-param-driven; changing preset re-renders the page server-side
- All 4 net-new RPCs exist, are `security invoker`, and respect RLS — verified by manual two-org spot-check
- Source ROI metric reuses existing `source_attribution_summary` RPC verbatim (no duplicate RPC)
- All 3 Recharts wrappers are `'use client'`, dynamically imported with `ssr: false`, and render inside explicit-height parents
- Methodology disclosure is a native `<details>` element with all 6 locked caveats documented
- Mobile responsive at 375px: cards stack, tables degrade to card lists via `useIsMobile()` shells
- All page navigation uses `next/link` Link primitives
- No new shadcn primitives installed (reuses Card, Table, Badge, Button, Input, Label)
- Three atomic commits land on the current branch, one per task
- `pnpm typecheck` + `pnpm lint` pass on the final commit
- Browser console shows zero Recharts hydration warnings on first visit
</success_criteria>

<output>
After all three tasks complete and the orchestrator has pushed the migration + regenerated types, write `.planning/quick/260524-cwd-buyer-value-dashboards-report-02-rechart/260524-cwd-SUMMARY.md` describing: commits landed, RPCs added, chart wrappers added, page route added, and any deltas vs the plan.
</output>
