---
phase: 260525-ucn-fix-buyer-value-ssr-false-in-server-comp
reviewed: 2026-05-27T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx
  - src/app/(app)/reports/buyer-value/page.tsx
  - src/components/charts/stacked-bar.tsx
  - src/components/charts/horizontal-bar.tsx
  - src/components/charts/sparkline.tsx
  - .planning/quick/260525-ucn-fix-buyer-value-ssr-false-in-server-comp/260525-ucn-PLAN.md
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: clean
---

# Pre-UAT Code Review — 260525-ucn ssr build fix

**Reviewed:** 2026-05-27
**Reviewer:** Opus (pre-UAT pipeline)
**Verdict:** PASS

## Summary

The fix is structurally correct and surgically minimal. The new `charts-bundle.tsx` is a Client Component (`'use client'` is the first line) that owns the three `dynamic({ ssr: false })` calls verbatim from the old page.tsx — same import targets, same `.then((m) => m.Export)` shape, same `loading` JSX, same height tokens (`h-72`, `h-72`, `h-20`). `page.tsx` no longer imports `next/dynamic` and has no `dynamic(...)` call sites; it imports the three named exports from `./_components/charts-bundle` and every JSX call site is byte-identical. No other consumers of `StackedBar` / `HorizontalBar` / `Sparkline` exist in the codebase (grep confirms only `page.tsx` and the bundle reference them), so no further migration is owed.

The pre-existing chart files (`stacked-bar.tsx`, `horizontal-bar.tsx`, `sparkline.tsx`) were not touched — they remain `'use client'` with the same prop contracts they had pre-fix.

## Blockers

None.

## High-priority issues

None.

## Medium-priority / nice-to-haves

### IN-01: `charts-bundle.tsx` does not re-export the chart prop types

**File:** `src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx:42`
**Issue:** The bundle re-exports only the runtime values (`StackedBar`, `HorizontalBar`, `Sparkline`). It does not re-export `StackedBarProps`, `StackedBarDatum`, `HorizontalBarProps`, `HorizontalBarDatum`, `SparklineProps`, `SparklineDatum`. `page.tsx` does not currently import these types (it shapes the data inline), so this is not blocking — but any future consumer that imports from `./_components/charts-bundle` will have to reach past it into `@/components/charts/...` to get the types, which weakens the "single import entry-point" contract the bundle establishes for this page. Type inference at the call sites does still resolve correctly through `next/dynamic`'s generic `ComponentType<P>` return — confirmed by the SUMMARY's clean `pnpm typecheck`.
**Fix:** Optional follow-up — add
```ts
export type {
  StackedBarDatum,
  StackedBarProps,
} from '@/components/charts/stacked-bar'
export type {
  HorizontalBarDatum,
  HorizontalBarProps,
} from '@/components/charts/horizontal-bar'
export type {
  SparklineDatum,
  SparklineProps,
} from '@/components/charts/sparkline'
```
Only worth doing if a second consumer appears.

### IN-02: `pnpm build` was not run to completion locally

**File:** `.planning/quick/260525-ucn-fix-buyer-value-ssr-false-in-server-comp/260525-ucn-SUMMARY.md:74`
**Issue:** The PLAN's verify gate is `pnpm lint && pnpm typecheck && pnpm build`. The SUMMARY records `pnpm build` as PARTIAL: Turbopack compilation reached `✓ Compiled successfully in 7.6s` (which is where the prior `ssr: false`-in-RSC error fired), then failed at page-data collection because the worktree has no `.env.local`. The structural rationale — that the SSR-rule violation surfaces at compile time, not page-data collection — is sound; the fix is verified to the gate the bug lives at. But the must_have truth "`pnpm build` completes successfully" is not literally satisfied locally; it's deferred to Vercel post-merge. This is acceptable for this specific worktree (env-validator is a known orchestrator constraint) but worth flagging so the Vercel green-build observation gets explicit confirmation in the UAT step.
**Fix:** UAT step must include "observe Vercel deploy goes green after this merge" as an explicit checkpoint (the PLAN's `<verification>` block already calls this out).

## Things that look right

1. **`'use client'` directive placement.** First line of `charts-bundle.tsx`, before all imports including `next/dynamic`. Required for `ssr: false` to be legal under Next 15+/16.

2. **SSR-skip semantics preserved.** The `ssr: false` option is what controls server-render skipping, and `next/dynamic` enforces that the `ssr: false` *declaration site* be a Client Component — not the *consumer* of the returned component. So having the Client Component (`charts-bundle.tsx`) declare it and then exporting the result back into the Server Component page is the intended Next 15+ escape hatch. The charts will still skip SSR and render only client-side, with the placeholder shown on first paint until the chunk loads.

3. **Loading placeholders byte-identical.** Heights `h-72` (StackedBar), `h-72` (HorizontalBar), `h-20` (Sparkline) match the old page.tsx exactly. Class strings `h-XX w-full animate-pulse rounded-md bg-muted/40` are unchanged. No CLS regression.

4. **Bundle splitting preserved.** `dynamic(() => import('@/components/charts/...'))` is still a true dynamic import expression — webpack/Turbopack will continue to emit a separate chunk per chart that loads only when `BuyerValuePage` is navigated to. The Client wrapper itself is tiny (re-exports only); it does NOT statically import recharts, so recharts stays out of the page's initial chunk. The charts-bundle.tsx module is the only client boundary the page introduces, and its synchronous footprint is just the three thin `dynamic()` registrations + their loading-placeholder closures.

5. **Type inference at call sites.** `next/dynamic<P>(loader)` returns `ComponentType<P>` where `P` is inferred from the resolved import. `page.tsx`'s call sites (`<StackedBar data={...} keys={...} categoryKey="quarter" />`, etc.) still type-check against the underlying `StackedBarProps` / `HorizontalBarProps` / `SparklineProps`. `pnpm typecheck` in the SUMMARY records PASS.

6. **First paint behaviour.** Server renders the Card shell + the `loading: () => <div className="h-72 ..." />` placeholder. Client hydrates and triggers the dynamic chunk fetch; once recharts + the wrapper land, the placeholder is replaced by the chart in-place. No crash on first paint — the import path is the same one that already worked pre-Next-16.

7. **No hydration warnings expected.** The whole point of `ssr: false` is that the server emits the placeholder and the client emits the chart, so the markup mismatch happens via Next's documented dynamic-loading boundary rather than an unguarded direct mount. Recharts' `ResponsiveContainer` (which reads DOM measurements) never runs server-side, which is the exact mismatch class the original wrapper comments flag as Pitfall 2.

8. **Comment block updated correctly.** Old page.tsx comment "loaded via `next/dynamic({ ssr: false })` to avoid..." is replaced with "loaded via `next/dynamic({ ssr: false })` from `./_components/charts-bundle.tsx` (a Client Component) because Next.js 15+ disallows `ssr: false` from RSCs..." — accurate and references the new bundle path. Pitfall-2 and CLS rationale retained.

9. **No other consumers.** `grep -rn` across `src/` confirms `StackedBar` / `HorizontalBar` / `Sparkline` are referenced only by `page.tsx` (now via the bundle), the bundle itself, and the underlying chart wrappers in `src/components/charts/`. Nothing else needs to migrate to the bundle; existing direct imports from `@/components/charts/...` (if any future consumer is a Client Component) remain valid.

10. **No new dependencies, no schema, no API changes.** Single atomic commit (`3948075`), two files (+49/−35), exact commit message from the plan.

11. **Import ordering compliant.** New import `from './_components/charts-bundle'` sits alphabetically before `./_components/commission-shell` and `./_components/source-roi-shell` in the `./_components/...` group — consistent with the existing Prettier/ESLint sort.

12. **Underlying chart files untouched.** `stacked-bar.tsx`, `horizontal-bar.tsx`, `sparkline.tsx` were not modified — they remain `'use client'` with the same export shape, same Pitfall-1/Pitfall-2 comments, same default heights (`h-72`/`h-72`/`h-20`) which line up with the bundle's loading-placeholder heights and prevent CLS regardless of whether the placeholder or the chart is on-screen.

---

_Reviewed: 2026-05-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
