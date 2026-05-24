# Quick Task 260524-cwd: Buyer-Value Reporting Dashboard — Research

**Researched:** 2026-05-24
**Domain:** Recharts client-island in Next.js 16 RSC; 5x Postgres aggregation RPCs over `applications`/`jobs`/`candidates`/`users`
**Confidence:** HIGH

## Summary

Add `/reports/buyer-value` as an RSC that resolves a `preset/from/to` URL window, calls 5 new `security invoker` aggregation RPCs in parallel, and hands each result to a small `'use client'` chart island built with **Recharts 3.8.1** (pin, `^3.8`). The page reuses the proven date-filter and shell patterns from `/reports/source-attribution` and `/candidates`. Source ROI metric reuses the existing `source_attribution_summary(p_from, p_to)` RPC verbatim — no new RPC needed for it; we still ship 5 new RPCs in scope but #3 can be a thin view over the existing one IF a column is missing (it isn't — the existing return shape covers source, placements, total fee, and avg time-to-place). For metric #3 the plan should call the existing RPC directly and ship 4 new RPCs total.

**Primary recommendation:** Recharts 3.8.1; 5 RPCs (4 net-new) in one migration; one shared `<ChartCard>` server wrapper that renders a `<Card>` shell server-side and embeds a small `dynamic(() => import(...), { ssr: false })` client chart leaf per metric to avoid SSR/hydration mismatch on `ResponsiveContainer`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Date-window resolution from URL | Frontend Server (RSC) | — | Mirrors `resolveSourceAttributionRange` — pure helper, server-side |
| 5 aggregations (counts/sums/percentiles) | Database (Postgres) | — | `security invoker` RPCs; RLS does tenant isolation; cheap server-side aggregation |
| Card layout, headers, methodology copy | Frontend Server (RSC) | — | Pure markup; no interactivity |
| Recharts SVG rendering | Browser / Client | — | Recharts uses browser-only APIs (`ResponsiveContainer` reads `getBoundingClientRect`); must be `'use client'` |
| Preset/custom date picker | Browser / Client | — | `useTransition` + `router.push` — same pattern as `date-filter.tsx` |
| Methodology disclosure | Browser / Client | — | Collapsible — Radix `Collapsible` already available via `radix-ui` peer |

## Standard Stack

### Core (net-new)
| Library | Version (pin) | Purpose | Why Standard |
|---------|---------------|---------|--------------|
| `recharts` | `^3.8.1` | Stacked bar, horizontal bar, line/sparkline | shadcn/ui's official chart primitive is Recharts; lowest-friction option in this codebase [VERIFIED: npm registry — `npm view recharts version` → `3.8.1`; peerDependencies include `react ^19`] |

### Already in `package.json` (reused)
| Library | Purpose |
|---------|---------|
| `radix-ui` (`^1.4.3`) | Collapsible for Methodology appendix |
| `@supabase/ssr`, `@supabase/supabase-js` | Server client for RPC calls |
| `@sentry/nextjs` | Error capture on RPC failure |
| shadcn `Card`, `Table`, `Badge`, `Button`, `Input`, `Label` | Layout primitives already used in `/reports/source-attribution` |

### Alternatives Considered (rejected)
| Instead of | Could Use | Why rejected |
|------------|-----------|--------------|
| Recharts | Tremor | Heavier dep; opinionated layout system overlaps with shadcn — duplicates primitives |
| Recharts | visx | Lower-level; no out-of-box stacked bar — more code for same output |
| Recharts | nivo | Larger bundle; SVG-only modules are still 60–80 KB minified per chart type |
| Recharts | Raw SVG | Fine for sparkline only; not viable for stacked bar with hover tooltips |

**Installation:**
```bash
pnpm add recharts@^3.8.1
```

**React 19 / Next.js 16 compatibility note [CITED: https://www.npmjs.com/package/recharts]:** Recharts 3.x ships React-19-compatible peer ranges (`react ^16.8 || ^17 || ^18 || ^19`). Earlier 2.x required a `react-is` override; 3.x does not. No `pnpm.overrides` block needed. Verified locally via `npm view recharts@3.8.1 peerDependencies`.

## Package Legitimacy Audit

> slopcheck not installed in this environment — every recommended package below is `[ASSUMED]`. Pre-flight verification only via `npm view` (registry existence) and known maintainership (recharts is in shadcn/ui's official chart docs).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `recharts` | npm | 10+ yrs (since 2015-08) | ~3M/wk | github.com/recharts/recharts | n/a (not run) | Approved — used by shadcn/ui charts; verified peer deps include react 19 |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none — the planner should still add a `checkpoint:human-verify` task before `pnpm add` since slopcheck did not run.

## Architecture Patterns

### Page Tree

```
/reports/buyer-value (RSC, page.tsx)
  ├─ auth guard (getProfile) — identical to source-attribution/page.tsx
  ├─ resolveBuyerValueRange(searchParams)        ← new pure helper, mirrors source-attribution-range
  ├─ Promise.all([getPlacementsByRecruiterQuarter, getTimeToFillBySector, getSourceAttribution, getPipelineValueSparkline, getCommissionSummary])
  ├─ <DateFilter />                              ← Client island (lift from source-attribution; identical UI)
  ├─ <Card> Placements per recruiter / quarter
  │     └─ <StackedBarClient data={...} />       ← 'use client' island; dynamic({ ssr:false })
  ├─ <Card> Time-to-fill by sector
  │     └─ <HorizontalBarClient data={...} />    ← 'use client' island
  ├─ <Card> Source ROI (table, reuses source_attribution_summary)
  ├─ <Card> Pipeline value
  │     ├─ Big number (RSC text)
  │     └─ <SparklineClient data={...} />        ← 'use client' island
  ├─ <Card> Commission summary (table, RSC)
  └─ <Collapsible> Methodology                   ← Client island (Radix)
```

### Pattern 1: Server-fetch → Client-chart leaf
**What:** RSC owns data + Card chrome; chart leaf is a tiny `'use client'` file that takes pre-shaped data as props and renders Recharts inside `<ResponsiveContainer>`. Each chart is `next/dynamic(() => import('./xyz'), { ssr: false })` to avoid the documented `ResponsiveContainer` hydration mismatch ([CITED: https://nextjs.org/docs/pages/guides/lazy-loading], [CITED: app-generator.dev recharts guide]).

```tsx
// src/app/(app)/reports/buyer-value/_charts/stacked-bar-client.tsx
'use client'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Datum = { quarter: string; [recruiterName: string]: string | number }

export function StackedBarClient({ data, recruiters }: { data: Datum[]; recruiters: string[] }) {
  return (
    <div className="h-72 w-full"> {/* ResponsiveContainer needs a parent with explicit height */}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="quarter" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {recruiters.map((name, i) => (
            <Bar key={name} dataKey={name} stackId="a" fill={`hsl(${(i * 53) % 360} 70% 55%)`} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

```tsx
// In page.tsx (RSC):
import dynamic from 'next/dynamic'
const StackedBarClient = dynamic(() => import('./_charts/stacked-bar-client').then(m => m.StackedBarClient), { ssr: false })
```

### Pattern 2: Date-filter reuse
Lift `date-filter.tsx` (and `source-attribution-range.ts`) into `src/lib/reports/date-window.ts` + `src/components/app/report-date-filter.tsx` as a generic helper that accepts a `basePath` prop, then refactor `/reports/source-attribution` to use the generic one (NOT in scope — leave existing file alone; create a sibling `buyer-value-range.ts` cloned from it). This avoids cross-cutting changes during a quick task.

**Decision:** Clone, don't refactor. The two files diverge by ~10 lines of constant; refactoring source-attribution is out of scope per the locked plan.

### Pattern 3: Mobile-responsive shell
The 260523-ret pattern is `'use client'` shell + `useIsMobile()` hook (`src/hooks/use-is-mobile.ts`) returning true below 768px, then conditionally rendering Cards vs Table. **For chart cards this is unnecessary** — Recharts' `ResponsiveContainer` already adapts width; the parent `<Card>` stacks vertically by default. Only the **Source ROI** and **Commission summary** tables need a responsive shell mirroring `candidates-shell.tsx`: at `<md` render a card list; at `md+` render the `<Table>`. Create `_components/recruiter-commission-shell.tsx` and `_components/source-roi-shell.tsx` following the candidates-shell template (lines 1-61).

### Anti-Patterns to Avoid
- **Calling `recharts` from a Server Component.** Hydration mismatch + `window is not defined` at SSR. Always `'use client'` + `dynamic({ ssr: false })`.
- **No height on `ResponsiveContainer` parent.** Renders zero-height; chart invisible. Always wrap in `<div className="h-72 w-full">` (or similar).
- **Putting `'use client'` on `page.tsx` itself.** Loses RSC data fetching benefits and forces the entire tree client-side.
- **Reading `searchParams` synchronously.** Next.js 16 types `searchParams` as `Promise<…>` — must `await` (confirmed in source-attribution/page.tsx line 54-94, candidates/page.tsx line 50).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-recruiter stacked bar | Custom SVG | Recharts `<BarChart>` + `stackId` | Tooltips, legend, axis ticks are 50+ lines each |
| Sparkline | Manual `<path d=...>` | Recharts `<LineChart>` (or pure SVG IF no tooltip needed) | Acceptable to inline pure SVG for a no-tooltip sparkline — keep this open for the planner |
| Percentile aggregation (p90 time-to-fill) | Compute in JS | Postgres `percentile_disc(0.9) within group (order by ...)` | Aggregation in DB is one round-trip; in JS it's N rows over the wire |
| Quarter bucketing | JS date math | Postgres `date_trunc('quarter', placed_at)` | Half a line of SQL vs 20 lines of TS |
| Sector grouping with fallback | App-side coalesce | SQL `coalesce(nullif(trim(jobs.location), ''), 'Unspecified')` — see RPC sketch below | See pitfall §"jobs has no industry/sector column" |

## Schema Verification (jobs.industry / jobs.sector)

**Verified [VERIFIED: read of `supabase/migrations/20260513152244_phase1_domain_schema.sql` lines 266-290]:** the `jobs` table has **NO** `industry` or `sector` column. Columns are: `id`, `organization_id`, `company_id`, `owner_user_id`, `title`, `location`, `job_type`, `hiring_context`, `status`, `description`, `salary_min`, `salary_max`, `day_rate_min`, `day_rate_max`, `currency`, `fee_percent`, embedding fields, audit fields.

A later migration could have added one — full scan: `grep -rn "alter table.*jobs.*add column" supabase/migrations/` shows none for industry/sector. **Conclusion:** "sector" does not exist on jobs.

**Recommended fallback (per task brief: "if not, group by 'Unspecified'"):**
Option A — Use `companies.name` as a proxy (each company → one sector implicit). Not accurate; reject.
Option B — Use **all rows in a single `'Unspecified'` bucket** until a real sector column is added. The horizontal-bar chart will show one bar — visually weak but honest. Recommend this with a one-line `<CardDescription>` callout: "Sector grouping requires a sector field on jobs — currently bucketed under 'Unspecified'. Add `jobs.sector` to unlock per-sector breakdown."
Option C — Add a new `jobs.sector text` column in the same migration. **Out of scope** for this quick task (would require backfill UX); planner should NOT do this.

**Decision:** Option B. Document in the RPC comment + the card subtitle. The chart still proves the *capability* for an acquirer demo; the data shape is correct.

## 5 RPC Shapes (4 net-new + 1 reused)

All RPCs: `language sql`, `stable`, `security invoker`, `set search_path = public`, `grant execute … to authenticated`. All accept `p_from date, p_to date` with `(now() - interval '90 days')::date` / `now()::date` defaults — same shape as `source_attribution_summary`. All include `where … organization_id = public.current_organization_id()` as belt-and-braces (RLS is the actual authority — pattern verified in `source_attribution_summary` line 74 and `dormant_clients`).

### RPC #1 — `placements_by_recruiter_quarter(p_from, p_to)`
```sql
create or replace function public.placements_by_recruiter_quarter(
  p_from date default (now() - interval '365 days')::date,
  p_to date default now()::date
) returns table (
  quarter date,            -- date_trunc('quarter', ...) start
  recruiter_id uuid,
  recruiter_name text,
  placements_count int
)
language sql stable security invoker set search_path = public as $$
  select
    date_trunc('quarter', coalesce(a.placed_at, a.stage_changed_at))::date as quarter,
    u.id as recruiter_id,
    coalesce(u.full_name, u.email) as recruiter_name,
    count(*)::int as placements_count
  from public.applications a
  join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1, 2, 3
  order by 1 asc, 4 desc;
$$;
```
Recruiter attribution: `owner_user_id` first (the recruiter who owns the application), fallback to `created_by`. App layer pivots rows into `{ quarter, [recruiter1]: count, [recruiter2]: count }` shape for Recharts stack.

### RPC #2 — `time_to_fill_by_sector(p_from, p_to)`
```sql
create or replace function public.time_to_fill_by_sector(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  sector text,
  median_days numeric,
  p90_days numeric,
  placements_count int
)
language sql stable security invoker set search_path = public as $$
  select
    'Unspecified'::text as sector,  -- placeholder: jobs has no sector column (see RESEARCH §"Schema Verification")
    percentile_cont(0.5) within group (
      order by extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400
    )::numeric(10,1) as median_days,
    percentile_cont(0.9) within group (
      order by extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400
    )::numeric(10,1) as p90_days,
    count(*)::int as placements_count
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;
```
Time-to-fill = days from `jobs.created_at` to placement. When `jobs.sector` lands, change the literal to `coalesce(nullif(trim(j.sector), ''), 'Unspecified')` and remove the `group by 1` literal (it'll group on the expression automatically).

### RPC #3 — Source ROI (REUSE `source_attribution_summary`)
Existing RPC at `supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql` already returns `(source, placements_count, total_fee_pence, avg_time_to_place_days)` and accepts `(p_from date, p_to date)` — **exact match** for the brief's columns: source / placements / total fee / avg time-to-place. **No new RPC; no new wrapper.** The buyer-value page imports `getSourceAttribution` from `src/lib/db/source-attribution.ts` directly.

### RPC #4 — `pipeline_value_sparkline(p_from, p_to)`
```sql
create or replace function public.pipeline_value_sparkline(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  bucket_date date,
  pipeline_value_pence bigint    -- sum over open jobs as of bucket_date: salary_max * 100 * 0.20
)
language sql stable security invoker set search_path = public as $$
  with day_series as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  )
  select
    ds.d as bucket_date,
    coalesce(sum((j.salary_max * 100 * 0.20)::bigint), 0)::bigint as pipeline_value_pence
  from day_series ds
  left join public.jobs j
    on j.organization_id = public.current_organization_id()
    and j.status = 'open'
    and j.created_at::date <= ds.d
    and j.salary_max is not null
  group by ds.d
  order by ds.d asc;
$$;
```
**Approximations [ASSUMED]:** (a) `salary_max` is stored as a whole-pound integer (verified in schema line 278: `salary_max integer`) — multiply by 100 for pence; (b) "open as of date X" = `status='open' AND created_at::date <= X` — we have no historical status table, so this UNDER-counts pipeline value for jobs that were once open then closed before today, and OVER-counts for jobs created after a status change to open. Acceptable for an indicative sparkline; flag in Methodology.

**Note for the headline big number:** Use the LAST row of this RPC (`bucket_date = p_to`) as the current pipeline value — saves a second RPC call.

### RPC #5 — `commission_summary_by_recruiter(p_from, p_to)`
```sql
create or replace function public.commission_summary_by_recruiter(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  recruiter_id uuid,
  recruiter_name text,
  placements_count int,
  total_fee_pence bigint,
  estimated_commission_pence bigint   -- total_fee_pence * 0.20 — PLACEHOLDER until per-recruiter rate exists
)
language sql stable security invoker set search_path = public as $$
  select
    u.id as recruiter_id,
    coalesce(u.full_name, u.email) as recruiter_name,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence,
    (coalesce(sum(a.fee_pence), 0) * 0.20)::bigint as estimated_commission_pence
  from public.applications a
  join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by u.id
  order by total_fee_pence desc;
$$;
```

**All five RPCs ship in ONE append-only migration:** `supabase/migrations/<timestamp>_buyer_value_rpcs.sql`. Single file, single deploy, single Sentry blast radius.

## Source Attribution RPC Reuse Confirmation

Read `supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql` lines 44-80: signature is `source_attribution_summary(p_from date default (now() - interval '90 days')::date, p_to date default now()::date)`. Returns `(source, placements_count, total_fee_pence, avg_time_to_place_days)`. **Already parameterised for date window. Already returns exactly what the brief asks for.** Reuse via the existing `getSourceAttribution` helper in `src/lib/db/source-attribution.ts` — no DB wrapper, no new RPC.

## Date-Filter URL-Param Pattern (verified)

[VERIFIED: read of `src/app/(app)/reports/source-attribution/page.tsx` lines 54-94 + `candidates/page.tsx` line 50] Next.js 16 App Router types `searchParams` as `Promise<{ ... }>`. Pattern:

```ts
type PageProps = {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>
}

export default async function Page({ searchParams }: PageProps) {
  const sp = await searchParams
  const range = resolveBuyerValueRange(sp) // → { preset, from, to } strings
  // ... pass range.from / range.to to RPC helpers
}
```

Client filter uses `useRouter().push` inside `useTransition` — copy `date-filter.tsx` verbatim, change the basePath constant.

## Mobile Responsive Shell Pattern (verified)

[VERIFIED: read of `src/app/(app)/candidates/candidates-shell.tsx`, `src/hooks/use-is-mobile.ts`] The pattern is:

1. `'use client'` shell component
2. `useIsMobile()` returns `true` below 768px (uses `useSyncExternalStore` + `matchMedia`)
3. Render `<Cards/>` if mobile, `<Table/>` otherwise — both Client Components

For buyer-value: ONLY the two table-based metrics (Source ROI #3, Commission #5) need this. Charts adapt via `ResponsiveContainer`. Create:
- `_components/source-roi-shell.tsx` (+ `source-roi-table.tsx`, `source-roi-cards.tsx`)
- `_components/commission-shell.tsx` (+ `commission-table.tsx`, `commission-cards.tsx`)

`metric-card.tsx` (existing at `src/components/app/metric-card.tsx`) can be reused for the pipeline-value big number.

## Common Pitfalls

### Pitfall 1: ResponsiveContainer renders zero-height
**What goes wrong:** Chart is invisible.
**Why:** `ResponsiveContainer` inherits height from parent; parent has no fixed height.
**How to avoid:** Always wrap in `<div className="h-72 w-full">` (or `h-64`/`h-80`); never rely on flex grow.

### Pitfall 2: Recharts hydration mismatch in App Router
**What goes wrong:** Console warning + visible flicker on first paint.
**Why:** Recharts measures DOM during render; SSR's measured dimensions differ from client.
**How to avoid:** `dynamic(() => import('./client-chart'), { ssr: false })` for every chart leaf.

### Pitfall 3: Forgetting to await `searchParams`
**What goes wrong:** TS error at build time (Next 16 typing); silent stale params at runtime if cast incorrectly.
**How to avoid:** Type as `Promise<…>`, always `await`. Confirmed pattern in two existing pages.

### Pitfall 4: RPC counted across all orgs because helper forgot to use the typed client
**What goes wrong:** Cross-tenant data leak (worst-possible bug per CLAUDE.md).
**Why:** `security invoker` relies on the caller being an authenticated user with RLS — calling via `service_role` would bypass it.
**How to avoid:** All 4 db helpers in `src/lib/db/` use the `await createClient()` server SSR client (cookie-based auth, NOT service role). Pattern already established by `getSourceAttribution`.

### Pitfall 5: `salary_max` is nullable; sum becomes NULL
**What goes wrong:** Big number displays as "NaN" or empty.
**How to avoid:** RPC #4 already does `coalesce(sum(...), 0)`; app helper does `?? 0` defence-in-depth.

### Pitfall 6: `placement_currency` is per-row (mostly GBP) — summing pence across currencies silently mixes
**What goes wrong:** A USD placement's `fee_pence` added directly to GBP totals.
**How to avoid:** RPCs #4/#5 should filter `where coalesce(a.placement_currency, 'GBP') = 'GBP'` OR document the assumption. Recommend the filter — anchor customer is GBP-only and multi-currency placement display is future work. Add the filter to all aggregations that sum `fee_pence`.

### Pitfall 7: Recharts 3.x `react-is` issue
**What goes wrong:** Build warnings about `react-is` peer.
**Status:** Resolved in 3.x [CITED: npmjs.com/package/recharts]. 2.x required `pnpm.overrides`; 3.8.1 does not. Verified peer range includes `^19.0.0` for `react-is`.

## Code Examples

### Pivoting RPC #1 result for Recharts stacked bar
```ts
// src/lib/db/buyer-value.ts (sketch)
export function pivotRecruiterQuarters(rows: PlacementsByRecruiterQuarterRow[]) {
  const recruiters = Array.from(new Set(rows.map(r => r.recruiter_name)))
  const byQuarter = new Map<string, Record<string, number | string>>()
  for (const r of rows) {
    const key = r.quarter // already YYYY-MM-DD from DATE column
    const bucket = byQuarter.get(key) ?? { quarter: formatQuarter(key) }
    bucket[r.recruiter_name] = r.placements_count
    byQuarter.set(key, bucket)
  }
  // Fill zeros for missing recruiters in each quarter so the stack renders cleanly
  for (const bucket of byQuarter.values()) {
    for (const name of recruiters) if (!(name in bucket)) bucket[name] = 0
  }
  return { data: [...byQuarter.values()], recruiters }
}
```

### Dynamic-import chart wiring in RSC
```tsx
// page.tsx
import dynamic from 'next/dynamic'
const StackedBarClient = dynamic(
  () => import('./_charts/stacked-bar-client').then(m => m.StackedBarClient),
  { ssr: false, loading: () => <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" /> },
)
```

### Collapsible methodology
```tsx
// 'use client' island OR — simpler — a plain <details> tag (no JS needed, no bundle cost)
<details className="rounded-md border bg-muted/30 p-4">
  <summary className="cursor-pointer text-sm font-medium">Methodology</summary>
  <div className="prose prose-sm mt-3">
    <p><strong>Fee assumption:</strong> Pipeline value treats each open job's expected fee as <code>salary_max × 20%</code>, the anchor customer's standard perm rate. Adjust with <code>jobs.fee_percent</code> once it is consistently filled.</p>
    <p><strong>Commission assumption:</strong> Estimated commission = total fee × 20%. This is a placeholder until per-recruiter commission rates are added to the schema.</p>
    <p><strong>Sparkline:</strong> "Open as of date X" = jobs with <code>status='open'</code> and <code>created_at &le; X</code>. We have no historical status table, so this under-counts jobs that closed before today and over-counts jobs that opened after a status change. Indicative trend only.</p>
    <p><strong>Sector:</strong> <code>jobs</code> has no sector column; all rows bucket into "Unspecified" until a sector field is added.</p>
  </div>
</details>
```
**Recommendation:** Use `<details>`, not Radix Collapsible. Zero JS, native a11y, semantically correct.

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Recharts 2.x + `pnpm.overrides` for `react-is` | Recharts 3.x ships React-19-compatible peers natively | No override needed |
| `searchParams` as plain object | `searchParams: Promise<…>` + `await` | Next.js 15+; mandatory in 16 |
| Charts inside RSC tree | `dynamic({ ssr: false })` client leaves | Avoids `ResponsiveContainer` hydration warning |

## Project Constraints (from CLAUDE.md)

| Constraint | How honoured |
|------------|--------------|
| **No `any` without `// reason:`** | RPC helpers cast at the boundary with documented reason — pattern at `source-attribution.ts` lines 48-62 |
| **Multi-tenancy via RLS, never manual filter for security** | All 4 new RPCs are `security invoker`; org filter included as belt-and-braces, not as security |
| **Append-only migrations** | Single new migration, no edits to prior files |
| **No AI calls** | None in scope — task brief is explicit ("NO Sonnet/AI calls") |
| **Sentry error capture** | Helpers wrap `.rpc()` calls in try/catch and `Sentry.captureException` — pattern at `source-attribution.ts` lines 64-72; never log PII (recruiter emails are profile data, not PII per CLAUDE.md, but full_name is — log only `org_id` + helper name in tags) |
| **No new heavy deps** | One new dep (recharts) — justified; aligned with shadcn/ui's official chart primitive |
| **Use Server Actions for mutations** | N/A — this is read-only |
| **`pnpm lint` + `pnpm typecheck` + manual end-to-end check before done** | Add to plan's verification step |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `jobs.salary_max` is whole-pounds integer (not pence) | RPC #4 | Pipeline value off by 100× — easy to spot in dev |
| A2 | `placement_currency` filtered to GBP is acceptable for anchor demo | Pitfall 6 | Non-GBP placements silently excluded; flag in Methodology |
| A3 | "Open job" sparkline approximation (status='open' AND created_at ≤ date) is acceptable | RPC #4 | Sparkline is indicative only — documented in Methodology |
| A4 | `owner_user_id` is the right recruiter for attribution; fallback to `created_by` | RPCs #1, #5 | Some placements may credit the wrong recruiter; spot-check in dev |
| A5 | Single `'Unspecified'` sector bucket is acceptable for v1 | Schema Verification + RPC #2 | Horizontal bar shows one bar; documented in Methodology + card subtitle |
| A6 | 20% commission rate is the placeholder the brief calls out | RPC #5, Methodology | Stated as placeholder in UI — no commercial risk |
| A7 | slopcheck not run for `recharts` — relying on shadcn/ui official chart docs | Package Audit | Planner should add `checkpoint:human-verify` before `pnpm add` |

## Open Questions

None blocking. All decisions either locked by the brief or made above with documented assumptions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pnpm` | install recharts | ✓ | n/a | — |
| Next.js 16 | RSC pattern | ✓ | 16.2.6 | — |
| React 19 | recharts peer | ✓ | 19.2.4 | — |
| Supabase CLI | apply migration | ✓ | 2.98.2 (devDep) | — |
| Supabase linked DB | RPC creation | ✓ assumed | — | manual SQL paste via Studio if `db push` fails — per MEMORY.md `supabase-migrations-manual-push` |

**No blockers.**

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` — jobs/applications schema
- `supabase/migrations/20260520023200_phase3_source_attribution_rpc.sql` — RPC pattern + date param convention
- `supabase/migrations/20260520031200_phase3_dormant_clients_rpc.sql` — `security invoker` + RLS comments pattern
- `supabase/migrations/20260523160000_phase3_placement_type_and_required_fields.sql` — `placement_type`, `placement_currency` confirmation
- `src/app/(app)/reports/source-attribution/page.tsx` — date-filter RSC pattern
- `src/app/(app)/reports/source-attribution/date-filter.tsx` — Client island URL-param pattern
- `src/lib/reports/source-attribution-range.ts` — preset/custom resolver pattern
- `src/app/(app)/candidates/candidates-shell.tsx` + `src/hooks/use-is-mobile.ts` — responsive shell pattern
- `src/lib/db/source-attribution.ts` — RPC helper pattern with Sentry + RPC `.call(supabase, …)` binding fix
- `package.json` — confirmed no chart lib currently installed
- `npm view recharts@3.8.1 peerDependencies` — React 19 compat verified

### Secondary (MEDIUM confidence)
- [Recharts on npm](https://www.npmjs.com/package/recharts) — version + peer ranges
- [Next.js Lazy Loading guide](https://nextjs.org/docs/pages/guides/lazy-loading) — `dynamic({ ssr: false })` pattern
- [Next.js + Recharts integration guide](https://app-generator.dev/docs/technologies/nextjs/integrate-recharts.html) — `'use client'` boundary placement

### Tertiary (LOW confidence)
- Web search consensus on Recharts SSR flicker workaround (2026 articles) — corroborates dynamic-import pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — recharts 3.8.1 verified against npm registry with React 19 peer
- Architecture (RPC + RSC + client-leaf): HIGH — direct read of existing analogous code in this codebase
- RPC shapes: HIGH for schema correctness, MEDIUM for percentile/window semantics (verify against real data in dev before declaring done)
- Pitfalls: HIGH — all sourced from existing project patterns or official docs

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days — Recharts is stable; Next 16 is current)
