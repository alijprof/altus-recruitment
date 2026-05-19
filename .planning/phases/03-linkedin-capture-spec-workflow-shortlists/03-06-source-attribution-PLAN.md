# Plan F (03-06): Source attribution report — `/reports/source-attribution` page + `source_attribution_summary` RPC + date filters

**Wave:** 3
**Goal:** Recruiter can visit `/reports/source-attribution`, choose a date range (last 30/90/365 days or custom), and see a table grouped by candidate `source` showing placements count, total fee revenue (pence), and average time-to-place — so they know which channels actually produce ROI.
**Depends on:** Plan C (Wave 1 — needs nullable `job_id` migration applied because the RPC joins through `applications`; if `job_id IS NULL` floats existed before Plan C's CHECK constraint landed, they'd appear in the `placed` aggregation — but floats can never be `stage='placed'` anyway, so this is theoretical). Plan B (Wave 1 — spec-originated jobs feed source attribution via their `candidates.source`). Plan A (Wave 1 — LinkedIn-originated candidates have `source='linkedin'` and contribute to the report).
**Wave 3 placement justification:** safest to land after all Wave 1 + Wave 2 plans have created `applications` rows with varying sources, so the report renders against real data. The single-file nature (one RPC + one page + one helper) makes this a tidy capstone plan.
**Requirements covered:** REPEAT-02 (Success criterion #5)
**Decisions implemented:** D3-22 (`/reports/source-attribution` page + `source_attribution_summary` RPC; aggregates placements per `candidates.source`, count + total fee + avg time-to-place), D3-23 (date filter 30/90/365 + custom; plain table — no chart library; numeric badges only), D3-26 (append-only migration, security-invoker RPC).

---

## Tasks

### Task F.1 — Verify and (if needed) backfill `applications.fee_pence` + `applications.placed_at` columns

**Type:** code (auto) + optional migration

**Files:**
- NEW (conditional) `supabase/migrations/<ts>_phase3_applications_placement_fields.sql` — ONLY if either column is missing per RESEARCH A6
- NEW `scripts/verify-placement-fields.sh` — one-shot grep + introspection script the executor runs first to decide whether to write the migration

**Detail:**

**Verification step (executor MUST run this first):**
```
grep -n "fee_pence\|placed_at" supabase/migrations/*.sql
```
- If BOTH columns exist on `applications`: skip the migration entirely.
- If EITHER is missing: write the migration below. Per CLAUDE.md "Schema choices compound — ask before adding," surface this to the user as a one-line note in the plan summary: "Phase 3 Plan F added `applications.{fee_pence|placed_at}` as it was missing from Phase 1; this is additive only."

**Migration shape (if needed):**
```sql
-- Phase 3 Plan F: source attribution report needs to aggregate fee revenue and
-- time-to-place. These columns are additive — no breaking change. Default NULL allowed.

alter table public.applications add column if not exists fee_pence bigint;
alter table public.applications add column if not exists placed_at timestamptz;

-- Backfill placed_at for existing rows in stage='placed' using stage_changed_at
update public.applications set placed_at = stage_changed_at
  where stage = 'placed' and placed_at is null;

-- No triggers added; recruiters fill fee_pence + placed_at manually via the
-- existing placement-marking UI (Phase 4 may extend this with auto-derivation).
```

**Acceptance:**
- If migration written: `pnpm db:reset --local` applies cleanly; backfill query updates the expected number of historical `placed` rows.
- If migration skipped: a comment in the executor's commit message explicitly notes "fee_pence and placed_at already present; no migration."

---

### Task F.2 — `source_attribution_summary` RPC + DB helper

**Type:** migration + code (auto, tdd="true")

**Files:**
- NEW `supabase/migrations/<ts>_phase3_source_attribution_rpc.sql` — security-invoker SQL function per PATTERNS §3 + RESEARCH §M7
- NEW `src/lib/db/source-attribution.ts` — `getSourceAttribution(supabase, { from, to })` per PATTERNS §7
- NEW `supabase/tests/source-attribution-rpc.test.sql` — REPLACE Plan 0 placeholder; pgTAP or psql-script integration test asserting cross-org invisibility

**Detail:**

**`<ts>_phase3_source_attribution_rpc.sql`** per RESEARCH §M7 + PATTERNS §3:
```sql
-- Phase 3 D3-22 source attribution report.
-- security INVOKER (not DEFINER) so RLS on applications + candidates does the heavy lifting.
-- The function body adds an explicit `applications.organization_id = current_organization_id()`
-- as a defence-in-depth check, though RLS already enforces it for the caller's row visibility.

create or replace function public.source_attribution_summary(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  source public.candidate_source,
  placements_count int,
  total_fee_pence bigint,
  avg_time_to_place_days numeric
)
language sql stable security invoker
set search_path = public
as $$
  select
    c.source,
    count(*)::int                                                  as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint                          as total_fee_pence,
    coalesce(
      avg(extract(epoch from (a.placed_at - a.created_at)) / 86400),
      0
    )::numeric(10, 1)                                              as avg_time_to_place_days
  from public.applications a
  join public.candidates c on c.id = a.candidate_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by c.source
  order by placements_count desc, total_fee_pence desc;
$$;

grant execute on function public.source_attribution_summary(date, date) to authenticated;

-- Smoke test (manual psql, mirrored from match_candidates_rpc.sql):
--   set role authenticated; set request.jwt.claim.sub = '<org-A-user>';
--   select * from source_attribution_summary('2026-01-01','2026-12-31');
--   -- should return only rows whose underlying applications belong to org-A
```

**`source-attribution.ts` helper** per PATTERNS §7:
```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type SourceAttributionRow = {
  source: Database['public']['Enums']['candidate_source']
  placements_count: number
  total_fee_pence: number
  avg_time_to_place_days: number
}

export async function getSourceAttribution(
  supabase: SupabaseClient<Database>,
  args: { from: string; to: string },
): Promise<DbResult<SourceAttributionRow[]>> {
  const { data, error } = await supabase.rpc('source_attribution_summary', {
    p_from: args.from,
    p_to: args.to,
  })
  if (error) {
    Sentry.captureException(new Error(\`source-attribution:${error.name}\`),
      { tags: { phase: 'p3', layer: 'db', helper: 'getSourceAttribution' } })
    return { ok: false, code: 'internal' }
  }
  return { ok: true, data: data as SourceAttributionRow[] }
}
```

**`supabase/tests/source-attribution-rpc.test.sql`** (replaces Plan 0 placeholder):
- Seed: two orgs (A, B); each with **4 placed applications** across different `candidates.source` values.
- **CRITICAL-3 fix (plan-check 2026-05-19) — `coalesce(placed_at, stage_changed_at)` branch must be exercised both ways:**
  - 2 of org-A's placed applications have `placed_at IS NOT NULL` (recruiter filled the fee + placed_at later) — these contribute their `placed_at` to the avg time-to-place calc.
  - 2 of org-A's placed applications have `placed_at IS NULL` (legacy / quick-place) — these fall back to `stage_changed_at`.
  - Assert `avg_time_to_place_days` is the average of all 4 (NOT just the explicit-placed_at ones). If we silently dropped the NULL branch, this test would produce 0 for the NULL rows.
- Set role to org-A user; call RPC; assert rows include only org-A's data; assert counts match.
- Repeat for org-B; assert disjoint.

**Acceptance:**
- `pnpm db:reset --local` applies cleanly.
- Smoke SQL test passes (cross-org invisibility verified).
- **CRITICAL-3 acceptance**: test seeds both `placed_at IS NULL` and `placed_at IS NOT NULL` rows; `avg_time_to_place_days` averages across both branches.
- `pnpm typecheck` clean (RPC return type lands in regenerated `src/types/database.ts` — executor MUST run `pnpm db:types --linked` after the migration applies, per Phase 2 D2-21 pattern).

---

### Task F.3 — `/reports/source-attribution` RSC page + date filter

**Type:** code (auto, tdd="true")

**Files:**
- NEW `src/app/(app)/reports/source-attribution/page.tsx` — RSC; pattern per PATTERNS §6 (mirror `src/app/(app)/settings/usage/page.tsx`)
- NEW `src/app/(app)/reports/source-attribution/date-filter.tsx` — Client Component for the 30/90/365 + custom date picker
- NEW `src/app/(app)/reports/page.tsx` — RSC index/landing if no reports index exists; one card linking to source-attribution (lightweight — just a hub)
- EDIT `src/components/app/top-nav.tsx` — add `Reports` nav item

**Detail:**

**Page structure** per PATTERNS §6 + RESEARCH §M7:
- Parse `searchParams.from`, `searchParams.to`, `searchParams.preset` (one of `30d|90d|365d|custom`); default `preset=90d`.
- Resolve `from`/`to` dates:
  - `30d` → from = today - 30, to = today
  - `90d` → from = today - 90, to = today
  - `365d` → from = today - 365, to = today
  - `custom` → use `searchParams.from` + `searchParams.to` (validated)
- Call `getSourceAttribution(supabase, { from, to })`.
- Layout (mirror `usage/page.tsx` lines 127-264):
  - Back link → `/reports`
  - Header: "Source attribution" + subtitle showing date range
  - `<DateFilter currentPreset={preset} currentFrom={from} currentTo={to} />` (Client Component; updates URL on change → page re-renders RSC)
  - Headline card: total placements across all sources + total fee revenue (`formatPence` helper from `usage/page.tsx`, lifted into `src/lib/format.ts` if not already there)
  - Main table with columns: `Source | Placements | Total fee | Avg time to place`
    - Use `<Table>` from `src/components/ui/table.tsx`
    - `tabular-nums` className for numeric columns
    - Numeric badges (`<Badge variant="secondary">`) for placements count per D3-23
  - "Top sources by revenue" small card listing top 3
  - **No chart library** per D3-23.
- Empty state: "No placements in this date range." with a quiet illustration if zero rows.

**`DateFilter` Client Component:**
- Preset buttons: `Last 30 days | 90 days | 365 days | Custom`
- For custom: two `<DatePicker>` inputs (HTML5 `type="date"` is sufficient — no extra dep)
- On change: `router.push(/reports/source-attribution?preset=...&from=...&to=...)`

**`/reports/page.tsx` (RSC):**
- Simple hub listing one card per available report (Phase 3 has only source-attribution).
- Card: title, one-line description, link.

**TopNav addition:** `{ href: '/reports', label: 'Reports' }` inserted alphabetically.

**Acceptance:**
- `pnpm typecheck` and `pnpm lint` clean.
- Local manual E2E:
  1. Visit `/reports/source-attribution` → page renders with default 90-day window.
  2. Seed: 3 placed applications across `linkedin`, `apply_form`, `referral`.
  3. Table renders 3 rows; counts match seed data; sort order by `placements_count desc`.
  4. Click `Last 30 days` → URL updates; table re-renders with the narrower window.
  5. Custom range: pick from/to dates spanning 2026-01-01 to 2026-06-30 → table updates.
- `tests/e2e/source-attribution.spec.ts` — see Playwright touchpoint.

---

## AI cost
None. Pure aggregate read + UI.

## Risks
- **`fee_pence` data quality.** If recruiters didn't backfill historical fees, the `total_fee_pence` column may be misleading. Mitigation: the page shows the column with a tooltip "Fee revenue from recorded placements only; ensure you mark fee_pence on each placement for accurate ROI."
- **`avg_time_to_place_days` skew on long-running roles.** A 9-month placement skews the average. Mitigation: P50 (median) would be more honest; deferred to Phase 4 reporting work per D3-23 ("plain table for Phase 3").
- **RPC return type missing from generated `database.ts`.** Mitigation: executor MUST regenerate types after the migration applies, per Phase 2 D2-21 lesson.

## Playwright E2E touchpoint
**Stub path:** `tests/e2e/source-attribution.spec.ts` — sign in, seed (via Supabase admin client) two orgs each with one placed application of `source='linkedin'`; navigate to `/reports/source-attribution` as org-A user, assert table shows exactly one row with `source='linkedin'`, `placements_count=1`; click `Last 30 days`, assert URL has `preset=30d`; switch to org-B user, navigate to same URL, assert different result (cross-org isolation).

## Cross-plan dependencies
- **Consumes from Plan 0:** Sentry tags, Vitest scaffolds (`source-attribution-rpc.test.sql`).
- **Consumes from Plan A (soft):** LinkedIn-originated candidates land with `source='linkedin'` — feeds into the report.
- **Consumes from Plan B (soft):** spec-approved jobs land with `created_by=<recruiter>`; if a placed application emerges from those jobs, the candidate's existing `source` value is what aggregates (the spec workflow doesn't change candidate source).
- **Consumes from Plan C (hard):** the nullable `job_id` migration MUST apply before this plan runs because `applications` rows queried by the RPC may include floats (`job_id IS NULL`) — though the RPC filter `stage='placed'` excludes them in practice. Defensive: the RPC does NOT need `job_id IS NOT NULL` because floats can't be placed.
- **Independent of Plans D and E:** zero file overlap.
