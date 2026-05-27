# Code & UI Review — 260524-cwd buyer-value dashboards

**Reviewed:** 2026-05-24
**Reviewer:** Opus (autonomous code+UI review pre-UAT)
**Verdict:** PASS-WITH-NITS — proceed to UAT after addressing the BLOCKER-tier `formatPence` headline issue and reviewing the WARNING-tier methodology drift on the pipeline sparkline.

---

## Blockers (must fix before UAT)

### BL-01 — Pipeline-value headline renders without thousand separators (severity: **BLOCKER**, UX/quality)
`src/app/(app)/reports/buyer-value/page.tsx:286-288` calls `formatPence(currentPipelineValuePence)` to render the marquee number. `src/lib/format.ts:15-18` returns `£${(p / 100).toFixed(2)}` — **no thousands separator**. A realistic pipeline of £2,000,000 (200,000,000 pence) renders as `£2000000.00`. The whole point of this card to an acquirer is the headline number; rendering it as a runtogether 7-digit string is the single worst optic on the page.

**Fix:** Either (a) introduce a sibling `formatGbp(pence)` helper that uses `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })` and use it for the headline, or (b) inline the formatter in `page.tsx`. Recommend (a) for reuse on future report headlines. Keep `formatPence` for the in-table fee columns where two-decimal precision matters; the marquee number should drop pence and add separators.

```tsx
// suggestion — src/lib/format.ts
const gbpHeadline = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
})
export function formatPencePoundsRounded(p: number): string {
  return gbpHeadline.format(Math.round(p / 100))
}
```

Then `page.tsx:287` becomes `{formatPencePoundsRounded(currentPipelineValuePence)}`. The same problem affects the in-table "Total fee" / "Estimated commission" columns when a recruiter has £100K+ totals, but the headline is the load-bearing one.

---

## High-priority issues (especially SQL correctness)

### HI-01 — `placements_by_recruiter_quarter` silently drops rows when both `owner_user_id` AND `created_by` are NULL (severity: **WARNING**, correctness)
`supabase/migrations/20260524000200_buyer_value_rpcs.sql:58-59` does `join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)`. Both columns are declared `on delete set null` in `20260513152244_phase1_domain_schema.sql:311-312`. If a recruiter is deleted (or both columns are NULL for any reason), the inner JOIN drops the placement from the count. Same applies to `commission_summary_by_recruiter` at `supabase/migrations/20260524000200_buyer_value_rpcs.sql:191-192`.

Two consequences for an acquirer-facing report:
1. **Throughput under-counts** silently — the headline "placements this quarter" disagrees with the raw count from `select count(*) from applications where stage='placed'`.
2. **Commission totals under-count** for the same reason.

**Fix:** Either (a) `left join` and bucket orphaned placements under a literal `'Unattributed'` recruiter (or omit them from the chart but render a footer note "N placements unattributed"), or (b) document the drop explicitly in the Methodology block. (a) is the buyer-value-correct choice because acquirers will reconcile against the raw placement count.

### HI-02 — `pipeline_value_sparkline` historical accuracy is worse than the Methodology claims (severity: **WARNING**, methodology accuracy)
`supabase/migrations/20260524000200_buyer_value_rpcs.sql:149-153`:
```sql
left join public.jobs j
  on j.organization_id = public.current_organization_id()
  and j.status = 'open'
  and j.created_at::date <= ds.d
  and j.salary_max is not null
```

`status = 'open'` is read as the **current** status, not the status-as-of `ds.d`. A job that is currently `filled` but was `open` for the previous 60 days will be missing from EVERY historical bucket. A job that's currently `open` but was `draft` for the first 30 days of the window will be counted in EVERY historical bucket including the days it was a draft. The Methodology says "under-counts jobs that closed before today and over-counts jobs that opened after a status change" — this is technically true but understates the magnitude. For a 2-3 person agency over 90 days, a single big job going `open → filled` mid-window can swing the whole trend.

**Fix options (pick one):**
- Best: introduce a status-history table; out of scope here.
- Acceptable mitigation: drop the sparkline for now and render only the "current pipeline value" big number (which is correct as-of-today). The sparkline as built is a flat line for most days because every currently-open job is counted at the same value from its `created_at::date` forwards — it doesn't actually trend.
- Minimum: strengthen the Methodology copy to say "the sparkline shows the back-projected current pipeline, not historical pipeline; use the headline number for any external comparison" and add a `<CardDescription>` hint.

### HI-03 — `time_to_fill_by_sector` doesn't guard against placement-before-job-created data anomalies (severity: **WARNING**, correctness)
`supabase/migrations/20260524000200_buyer_value_rpcs.sql:95-100` computes `coalesce(a.placed_at, a.stage_changed_at) - j.created_at`. If `placed_at < j.created_at` (data entry order, backfill, manual edits), the value is negative and `percentile_cont` happily includes it in the order. One bad row at -200 days drags the median down meaningfully when N is small (anchor customer has 2-3 recruiters, low placement volume).

**Fix:** Add `having extract(epoch from (...)) >= 0` or filter `where coalesce(a.placed_at, a.stage_changed_at) >= j.created_at` inside the function body. Belt-and-braces: log how many rows are excluded.

### HI-04 — `placements_by_recruiter_quarter` quarter buckets are presented without window context, making a 30-day window look like a partial quarter (severity: **WARNING**, UX/accuracy)
The RPC groups by `date_trunc('quarter', ...)` regardless of the requested window. If the user picks "Last 30 days" and we're mid-Q2, the chart shows a single bar for Q2 — but that bar is just 30 days of Q2, not the whole quarter. The bar height is meaningless to the reader without inspecting the date filter. An acquirer comparing Q1 (full quarter) to Q2 (30 days) would mis-conclude trend.

**Fix:** Either (a) add the date window underneath the chart title (e.g., "showing placements between {from} and {to}"); (b) document in CardDescription that bars represent placements *within the selected window*, not full quarters; (c) auto-expand the window to whole quarters when preset is 30d/90d. (a) is the smallest acceptable fix.

### HI-05 — Pipeline-value headline can be misleading on custom future-ranged windows (severity: **WARNING**, correctness)
The page does `currentPipelineValuePence = lastSparkRow.pipeline_value_pence` (page.tsx:141), which is the *last day of the requested window*. For a custom range that ends in the past (e.g., from=2025-01-01, to=2025-03-31), the headline is the pipeline-as-of 2025-03-31 — not the current pipeline. The card title says "Pipeline value" without temporal qualification.

**Fix:** Either (a) clamp `to` to today for the headline computation and explicitly say "as of {date}" beneath the big number, or (b) accept the deception and rename the card to "Pipeline value as of end of window". (a) is closer to what an acquirer expects.

### HI-06 — Custom date validation in `date-filter.tsx` short-circuits but still navigates with invalid input (severity: **WARNING**, UX)
`date-filter.tsx:67-81`:
```tsx
if (!from || !to || from > to) {
  // Server helper falls back to the default window; we still navigate
  // so the user sees the URL update and any error UI the page renders.
}
```

The comment claims "the page renders error UI" — it does not. `resolveBuyerValueRange` silently falls back to the 90d default, the page re-renders the default window, and the user has no idea their input was rejected. The URL still shows `?preset=custom&from=...&to=...` but the rendered data is for the default 90d window. This will confuse users debugging "why doesn't my custom range work?".

**Fix:** Either (a) the page actually renders an error/note when `searchParams` indicates `custom` but `resolveBuyerValueRange` falls back, or (b) the date-filter form does client-side validation and refuses to navigate with `from > to`. (b) is the lowest-friction fix and matches user expectation that the Apply button does what it says.

### HI-07 — `Sparkline` renders even when all values are zero, producing a flat baseline (severity: **WARNING**, UX)
`page.tsx:278` — empty state triggers only when `sparkRows.length === 0 && currentPipelineValuePence === 0`. If the org has zero open jobs across the whole window but the RPC returned `[{...zeros}]`, the page renders "£0.00" + a flat sparkline at the chart baseline. That's worse than the empty state because it implies "data exists, line at zero" rather than "no data".

**Fix:** Change the condition to:
```tsx
sparkRows.length === 0 || sparkRows.every(r => r.pipeline_value_pence === 0)
```

---

## Medium-priority issues / chart/UX polish

### MD-01 — `formatPence` table cells use the same truncated format for large fees (severity: **WARNING**, UX)
Same root cause as BL-01 but lower priority. `Total fee £125000.00` reads poorly in tables too. Either reuse the new headline formatter for all £100K+ values, or accept the current presentation for table cells.

### MD-02 — Source ROI and Commission tables aren't aligned with chart cards visually (severity: **INFO**)
The two table-based cards put their content directly in `<CardContent>` — but unlike the chart cards (which have visible chart canvases), the tables sit flush against the card border. Consider `<CardContent className="pt-0">` or a horizontal divider above the table on desktop for visual consistency.

### MD-03 — No `aria-busy` on cards during initial paint (severity: **INFO**, accessibility)
The dynamic chart imports show a skeleton (`bg-muted/40 animate-pulse`) but don't expose `aria-busy="true"` or any `role="status"`. Screen readers announce nothing until the chart resolves. Add `<div role="status" aria-busy="true" aria-label="Loading chart" className="...">` to each loading placeholder.

### MD-04 — Stacked-bar deterministic palette can produce two similar adjacent hues for adjacent recruiters (severity: **INFO**, UX)
`stacked-bar.tsx:61`: `fill={\`hsl(${(i * 53) % 360} 70% 55%)\`}`. With 7 recruiters the hues are 0, 53, 106, 159, 212, 265, 318 — clear separation. With 14 recruiters the wrap brings adjacent hues within 7° (e.g., 53 vs 318+53=11° apart). Anchor customer is 2-3 recruiters so unlikely to matter, but if the SaaS scales to 20+ recruiters, expect collisions.

### MD-05 — Sparkline tooltip shows raw `y` value with no formatting (severity: **INFO**, UX)
`sparkline.tsx:39-41` — default Recharts tooltip will display `y: 200000000`. For a pipeline-value chart this is meaningless to humans. Use Recharts' `formatter` prop on `<Tooltip>` to apply `formatPence` (or the new headline formatter).

### MD-06 — `currentPipelineValuePence` derived from `lastSparkRow.pipeline_value_pence` couples big-number correctness to the sparkline's correctness (severity: **INFO**, design)
A documented optimization in `buyer-value.ts:140-142` ("reuse last row of sparkline instead of a separate RPC call"). Fine in principle, but if HI-02's sparkline rework happens, the big number wires to the wrong source. Add a comment in `page.tsx:140-141` documenting the coupling, or extract a dedicated `pipeline_value_current()` RPC that returns just one number.

### MD-07 — No `aria-label` on the data-only chart wrappers (severity: **INFO**, accessibility)
Charts are entirely visual. `<StackedBar>`, `<HorizontalBar>`, `<Sparkline>` render `<svg>` with no `<title>` or `aria-label`. Screen reader users get nothing. For a buyer-value report (read aloud during due diligence), provide a sibling `<table className="sr-only">` rendering the same data as a fallback for assistive tech, or at minimum `aria-label="Placements per recruiter per quarter, stacked bar chart"` on the chart's containing div.

### MD-08 — `recharts@3.8.1` pulls `react-is@17.0.2` peer (severity: **INFO**, ecosystem)
Verified in `pnpm-lock.yaml` — recharts is bound to `react-is@17.0.2` even though the app uses React 19.2.4. Recharts 3.x doesn't crash on the mismatch but pnpm will emit a peer-deps warning during install. Document this in `package.json` notes or add `react-is` as a top-level dep at 19.x to silence the warning if/when it appears in CI logs. Non-blocking — just noisy.

### MD-09 — The Methodology `<details>` opens *closed* by default, so the caveats are invisible to a casual reader (severity: **INFO**, UX)
The whole point of the buyer-value page is acquirer-facing — caveats matter. Consider `<details open>` for the first visit (server-side rendered always-open is the simplest; "remember-closed" client state is overkill here). Counter-argument: closed-by-default is cleaner. Designer call.

---

## UI/UX observations

### UI-01 — Five `<Card>` cards stacked top-to-bottom on desktop is a long scroll
On a 1440px display, the user sees ~2 cards above the fold. Consider a 2-column grid at `md+` for the chart cards (placements + ttf side-by-side; source-roi + commission side-by-side; pipeline-value full-width). Would also make better use of the `max-w-5xl` container. Optional; current layout is fine for a v1.

### UI-02 — Back link uses small grey text in top-left; an acquirer's eye doesn't find it
Standard pattern for in-app pages, low priority. Match source-attribution.

### UI-03 — Header subtitle reads "Five acquirer-due-diligence metrics across the selected window — 24 Feb 2026 → 24 May 2026."
The em-dash before the date range is slightly off; consider "Five acquirer-due-diligence metrics. Window: 24 Feb 2026 → 24 May 2026." for parseability. Cosmetic.

### UI-04 — Empty-state CTAs link to `/pipeline` and `/jobs` but those routes are not validated in this PR
`page.tsx:208, 258, 282, 312` — assumes these routes exist. They do per the codebase structure (matched in `src/app/(app)/`). OK.

### UI-05 — No "last updated" timestamp on the page
Acquirers want to know when the snapshot was taken. Consider a small `<p className="text-muted-foreground text-xs">Generated {now}</p>` in the header. Low priority.

### UI-06 — `<details>` Methodology block lacks the `prose` classes the plan called for
Plan said `<div className="prose prose-sm mt-3 space-y-2 text-sm">` but the implementation at `page.tsx:324` is `<div className="mt-3 space-y-2 text-sm">` — `prose` styling missing. Likely intentional (tailwind typography may not be installed); cosmetic.

---

## Methodology accuracy review

Each Methodology caveat (`page.tsx:320-355`) cross-referenced against the code:

| Caveat | Code reality | Verdict |
|--------|--------------|---------|
| "Pipeline value uses `salary_max × 20%`" | `(j.salary_max * 100 * 0.20)::bigint` — correct in pence | **Accurate** |
| "Estimated commission = total fee × 20%" | `(coalesce(sum(a.fee_pence), 0) * 0.20)::bigint` | **Accurate**, but doesn't mention that `fee_pence × 0.20` rounds to integer pence (negligible) |
| "Open as of date X = jobs with status='open' AND created_at ≤ X" | Code does this, BUT `status='open'` reads CURRENT status not historical | **MISLEADING** — see HI-02 |
| "Currency. Commission and pipeline aggregations are filtered to GBP placements" | Commission RPC filters `coalesce(a.placement_currency, 'GBP') = 'GBP'`. Pipeline RPC does NOT filter currency (jobs.currency ignored) | **PARTIALLY ACCURATE** — pipeline is "assumed GBP" not "filtered GBP". Reword to "Commission filters to GBP placements; pipeline assumes GBP across all open jobs (jobs.currency is not consulted)." |
| "Sector — single 'Unspecified' bucket" | Matches code | **Accurate** |
| "Recruiter attribution = `owner_user_id` falling back to `created_by`" | Matches code, BUT doesn't mention that placements with BOTH NULL are silently dropped | **PARTIALLY ACCURATE** — see HI-01 |

Three of six caveats need wording tweaks. None invalidate the report's headline conclusions but a sharp-eyed acquirer reviewing the methodology will notice the drift between the prose and the SQL.

---

## Things that look right

- **All 4 RPCs declared `language sql / stable / security invoker / set search_path = public`** with `grant execute … to authenticated` and `comment on function …` — matches the dormant-clients pattern exactly. RLS on `applications` / `jobs` / `users` does the tenant work; the `current_organization_id()` predicate inside each function is correct belt-and-braces.
- **Source ROI metric correctly reuses `source_attribution_summary`** — no duplicate RPC; the existing helper at `src/lib/db/source-attribution.ts:44` is wired directly. Confirmed by `grep` across migrations: only one definition, no duplicate.
- **`pivotRecruiterQuarters` correctly zero-fills missing (quarter, recruiter) cells** (`buyer-value.ts:205-209`) — Recharts' stacked BarChart relies on every datum having every key, otherwise stacks render with gaps. Algorithm is O(quarters × recruiters), trivial.
- **All three chart wrappers are `'use client'` (line 1)** and consumed via `next/dynamic({ ssr: false, loading: skeleton })` in `page.tsx:54-82`. Each wrapper enforces an explicit fixed-height parent (`h-72` / `h-20`) so `ResponsiveContainer` always has a non-zero box. Two-pitfall avoidance correctly applied.
- **Date filter URL-param round-trip is correct**: `resolveBuyerValueRange` validates preset against an allow-list (`isPreset`), validates from/to as strict `YYYY-MM-DD` with calendar round-trip (`isYmd` catches `2026-02-30`), enforces `from <= to`, and silently falls back to the 90d default — same hardened pattern as source-attribution.
- **Default 90-day window is computed UTC** — no DST drift. Defaults to "today inclusive" via `toYmd(now)` with `subtractDaysUtc(now, 90)` for `from`. ✓.
- **Recharts hydration**: `dynamic({ ssr: false })` is correctly applied to every chart wrapper. Loading skeletons match the eventual chart height (h-72 / h-20) preventing layout shift.
- **`callRpc<TRow>` helper** (`buyer-value.ts:76-102`) correctly extracts the `.rpc.call(supabase, …)` cast-at-boundary pattern into a single place — fixes the `this`-binding pitfall the source-attribution helper had to inline four times. Good refactor.
- **Partial-failure handling** (`page.tsx:148-189`) is correct: each RPC's `DbResult` is checked independently, failed metrics are listed in a single error banner, and the rest of the page renders. A new RPC not yet pushed to the DB shows as a card-level empty state plus a single banner — the page does NOT crash.
- **Promise.all parallel fetch** (`page.tsx:117-126`) is correct — five RPCs fire concurrently against the SSR Supabase client, all share the cookie-bound JWT, none block each other.
- **TypeScript types are correctly hand-patched** in `src/types/database.ts:1306-1411` with the four new RPC signatures matching the migration. Verified the orchestrator post-push regen would produce equivalent shapes.
- **Mobile shell pattern** (`source-roi-shell.tsx`, `commission-shell.tsx`) correctly mirrors `candidates-shell.tsx`: `useIsMobile()` from the shared hook, conditional render with no dual-tree DOM, breakpoint at 768px matches `md`. SSR snapshot returns desktop (table) — acceptable one-frame swap on mobile hydration.
- **Page is a Server Component** — no `'use client'` at the top of `page.tsx`. RSC data fetching benefits preserved. Confirmed by grep.
- **`searchParams: Promise<…>`** correctly typed and awaited (Next 16 requirement). `page.tsx:84-86, 114`.
- **No service-role key usage anywhere** in the data-access path — all DB helpers go through `await createClient()` (the cookie-bound SSR client). `'server-only'` import in `buyer-value.ts:1` prevents accidental client-side use as a build error.
- **`grant execute … to authenticated`** on every RPC (lines 67, 111, 158, 201 of migration). No service-role-only locks; no anon access. Correct.
- **GBP filter on commission RPC** correctly uses `coalesce(a.placement_currency, 'GBP') = 'GBP'` even though the column is NOT NULL with default — defends against a future migration dropping NOT NULL.
- **`pnpm typecheck` passes** on the final commit per SUMMARY; recharts 3.8.1 is installed and resolves React-19-compatible peers. Verified `node_modules/recharts/package.json` peer ranges include `^19.0.0`.
- **All page navigation uses `next/link`** (Link import at `page.tsx:2`, used at line 158 for the Back link).

---

## Summary

Three execution commits land cleanly. The largest single risks before UAT are:

1. **Headline £-formatting bug** (BL-01) — a one-line fix; without it the marquee number looks unprofessional to the very audience this report is aimed at.
2. **Pipeline sparkline historical accuracy** (HI-02) — methodology copy paints it as "indicative trend" but the line is actually back-projected current state, which is worse than the prose suggests.
3. **Silently-dropped rows in two RPCs** (HI-01) — needs either fixing or honest documentation; an acquirer who reconciles raw counts against the dashboard will find the drift.

Once BL-01 is fixed and HI-01/HI-02/HI-03 either fixed or documented faithfully in the Methodology, this dashboard is genuinely demonstrable. The SQL, RLS posture, RSC + dynamic-chart wiring, type-safety, and partial-failure handling are all correct.

---

_Reviewed: 2026-05-24_
_Reviewer: Opus (gsd-code-reviewer adversarial pre-UAT pass)_
_Depth: deep (full file reads + cross-reference to schema migrations and existing source-attribution implementation)_
