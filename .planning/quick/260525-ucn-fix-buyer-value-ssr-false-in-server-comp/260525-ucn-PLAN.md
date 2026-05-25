---
phase: 260525-ucn-fix-buyer-value-ssr-false-in-server-comp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx
  - src/app/(app)/reports/buyer-value/page.tsx
autonomous: true
requirements:
  - QUICK-260525-ucn
must_haves:
  truths:
    - "`pnpm build` completes successfully (no `ssr: false` in RSC error)"
    - "`pnpm typecheck` passes — `StackedBar`, `HorizontalBar`, `Sparkline` consumers in page.tsx still type-check identically"
    - "`pnpm lint` passes on both touched files"
    - "`/reports/buyer-value` renders unchanged in dev — same 5 cards, same dynamic-skip-SSR behaviour for charts, same loading placeholders (h-72 / h-72 / h-20)"
    - "No `import dynamic from 'next/dynamic'` remains in page.tsx (Server Component is dynamic-free)"
  artifacts:
    - path: "src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx"
      provides: "Client-Component re-exports of the three Recharts wrappers wrapped in next/dynamic({ ssr: false }) with matching loading placeholders"
      contains: "'use client'"
    - path: "src/app/(app)/reports/buyer-value/page.tsx"
      provides: "Server Component using charts-bundle re-exports instead of inline dynamic() calls"
      contains: "from './_components/charts-bundle'"
  key_links:
    - from: "src/app/(app)/reports/buyer-value/page.tsx"
      to: "src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx"
      via: "named imports of StackedBar / HorizontalBar / Sparkline"
      pattern: "from '\\./_components/charts-bundle'"
    - from: "src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx"
      to: "src/components/charts/{stacked-bar,horizontal-bar,sparkline}"
      via: "dynamic(() => import(...).then(m => m.X), { ssr: false, loading: ... })"
      pattern: "dynamic\\(\\(\\) => import\\('@/components/charts/"
---

<objective>
Fix the Next.js 16 production build break on `/reports/buyer-value`. Next 15+ disallows `dynamic({ ssr: false })` from Server Components; the current page.tsx (a Server Component) declares three such dynamic imports for the Recharts wrappers (`StackedBar`, `HorizontalBar`, `Sparkline`), and every production deploy since 260524-cwd has errored on Vercel.

Purpose: Restore green production builds and unblock UAT against the live Vercel deployment without changing any user-visible behaviour.
Output: A single atomic commit that introduces a Client-Component re-export bundle for the dynamic chart imports and switches page.tsx to consume it.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

@src/app/(app)/reports/buyer-value/page.tsx
@src/components/charts/stacked-bar.tsx
@src/components/charts/horizontal-bar.tsx
@src/components/charts/sparkline.tsx
@src/app/(app)/reports/buyer-value/_components/source-roi-shell.tsx

<interfaces>
<!-- The three chart wrappers are already 'use client'. Re-exports must preserve these exact prop shapes so page.tsx call sites compile unchanged. -->

From src/components/charts/stacked-bar.tsx:
- Named export: `StackedBar`
- `StackedBarDatum = Record<string, string | number>`
- `StackedBarProps = { data: Array<StackedBarDatum>; keys: string[]; categoryKey?: string; height?: 'h-64' | 'h-72' | 'h-80' }`

From src/components/charts/horizontal-bar.tsx:
- Named export: `HorizontalBar`
- `HorizontalBarDatum = { label: string; median: number; p90: number }`
- `HorizontalBarProps = { data: Array<HorizontalBarDatum>; height?: 'h-64' | 'h-72' | 'h-80' }`

From src/components/charts/sparkline.tsx:
- Named export: `Sparkline`
- `SparklineDatum = { x: string; y: number }`
- `SparklineProps = { data: Array<SparklineDatum>; height?: 'h-16' | 'h-20' | 'h-24'; strokeColor?: string }`

Current dynamic() options in page.tsx (must be replicated verbatim in charts-bundle.tsx):
- StackedBar: `{ ssr: false, loading: () => <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" /> }`
- HorizontalBar: `{ ssr: false, loading: () => <div className="h-72 w-full animate-pulse rounded-md bg-muted/40" /> }`
- Sparkline: `{ ssr: false, loading: () => <div className="h-20 w-full animate-pulse rounded-md bg-muted/40" /> }`

Naming convention precedent: `src/app/(app)/reports/buyer-value/_components/source-roi-shell.tsx` already lives under `_components/` and is `'use client'` — the new `charts-bundle.tsx` follows the same pattern.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move dynamic({ssr:false}) chart imports into a Client-Component bundle and re-wire page.tsx</name>
  <files>
    src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx (NEW),
    src/app/(app)/reports/buyer-value/page.tsx (EDIT)
  </files>
  <action>
    Single atomic commit covering both files. Order of edits below; commit only after both pass verify.

    (A) CREATE `src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx`:
    - First line: `'use client'` directive (required so `ssr: false` is legal here in Next 15+/16).
    - Add a short header comment explaining: "Quick task 260525-ucn — Next 15+ disallows `dynamic({ ssr: false })` from Server Components. This Client Component owns the dynamic imports for the three Recharts wrappers used by `/reports/buyer-value/page.tsx` so the Server Component can stay free of `next/dynamic`. Each loading placeholder matches the eventual chart parent height (h-72 for StackedBar/HorizontalBar, h-20 for Sparkline) to prevent CLS." Keep wording terse and aligned with existing in-repo comment style.
    - Import `dynamic` from `'next/dynamic'`.
    - Declare three `const` re-exports — `StackedBar`, `HorizontalBar`, `Sparkline` — each via `dynamic(() => import('@/components/charts/<file>').then((m) => m.<Export>), { ssr: false, loading: () => <div className="h-XX w-full animate-pulse rounded-md bg-muted/40" /> })`. Heights MUST be `h-72`, `h-72`, `h-20` respectively, matching the current page.tsx exactly.
    - `export { StackedBar, HorizontalBar, Sparkline }` (named exports — preserves the existing page.tsx call shape).
    - Do NOT redeclare the prop types. The dynamic-wrapped components inherit the underlying chart components' typed props through `next/dynamic`'s generic inference; page.tsx call sites already match the underlying types and must not need changes.
    - Follow project code style: no semicolons, single quotes, 2-space indent, trailing commas, print width 100, Tailwind classes already sorted.

    (B) EDIT `src/app/(app)/reports/buyer-value/page.tsx`:
    - Remove line 1: `import dynamic from 'next/dynamic'`.
    - Remove the three top-level `dynamic(...)` declarations currently at lines 54-82 (the `StackedBar`, `HorizontalBar`, `Sparkline` consts and their surrounding blank lines).
    - Add a new import alongside the other `./_components/...` imports (so it sits next to `CommissionShell` and `SourceRoiShell`):
      `import { StackedBar, HorizontalBar, Sparkline } from './_components/charts-bundle'`
    - Update the explanatory comment block at lines 47-52 to reflect the new architecture. Replace the two sentences starting "Chart components are loaded via `next/dynamic({ ssr: false })`..." with a note along the lines of: "Chart components are loaded via `next/dynamic({ ssr: false })` from `./_components/charts-bundle.tsx` (a Client Component) because Next.js 15+ disallows `ssr: false` from RSCs. The skip-SSR behaviour avoids the Recharts ResponsiveContainer hydration mismatch (RESEARCH §Pitfall 2); loading placeholders match the eventual fixed-height parent (h-72 for full charts, h-20 for sparkline) to prevent CLS."
    - Leave EVERYTHING ELSE in page.tsx byte-identical: every JSX usage of `<StackedBar ... />`, `<HorizontalBar ... />`, `<Sparkline ... />` stays unchanged; the call-site prop types resolve through the named imports from charts-bundle.

    (C) Do NOT touch `src/components/charts/stacked-bar.tsx`, `horizontal-bar.tsx`, or `sparkline.tsx` — they are already `'use client'` and their exports are stable.

    (D) Stage and commit both files together. Commit message (verbatim):
      `fix(260525-ucn): move dynamic({ssr:false}) chart imports into Client wrapper (Next 16)`

    Constraints:
    - No new npm dependencies.
    - No DB / migration changes.
    - No changes to chart visuals, sizing, animation, or SSR-skip semantics.
    - Preserve named-export shape (`StackedBar`, `HorizontalBar`, `Sparkline`) so page.tsx call sites and any future consumers compile identically.
  </action>
  <verify>
    <automated>pnpm lint && pnpm typecheck && pnpm build</automated>
  </verify>
  <done>
    - `src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx` exists, starts with `'use client'`, imports `dynamic` from `'next/dynamic'`, and exports `StackedBar`, `HorizontalBar`, `Sparkline` wrapped in `dynamic(..., { ssr: false, loading: ... })` with the correct heights (h-72, h-72, h-20).
    - `src/app/(app)/reports/buyer-value/page.tsx` no longer imports `dynamic` from `'next/dynamic'` and no longer contains any `dynamic(...)` call; instead it imports `{ StackedBar, HorizontalBar, Sparkline }` from `./_components/charts-bundle`.
    - The page-level explanatory comment has been updated to reference the new charts-bundle.tsx and the Next 15+ SSR-rule rationale.
    - `pnpm lint` clean on both touched files (no new warnings introduced).
    - `pnpm typecheck` passes (no `any`, no implicit-any inference on the dynamic-wrapped components at the call sites).
    - `pnpm build` completes successfully — the previous `ssr: false is not allowed with next/dynamic in Server Components` error is gone.
    - Single commit on the worktree branch with the exact message `fix(260525-ucn): move dynamic({ssr:false}) chart imports into Client wrapper (Next 16)`; both files in the same commit (atomic).
  </done>
</task>

</tasks>

<verification>
- `pnpm build` MUST succeed locally before commit. This is the key gate this plan adds: typecheck alone does not surface the SSR-rule violation; only the production build does.
- Manual smoke check (post-merge or pre-merge in dev): `pnpm dev`, navigate to `/reports/buyer-value`, confirm the three chart cards still render with the loading placeholder briefly then the chart, no hydration warnings in the browser console.
- After push to main, observe the Vercel build go green (last 3 deploys errored; this should be the green one).
</verification>

<success_criteria>
- Production build (`pnpm build` locally and on Vercel) completes with no `ssr: false`-in-RSC error.
- `/reports/buyer-value` behaves byte-identically to a user: same 5 cards in the same order, same loading placeholders, same chart visuals, same SSR-skip semantics for the three Recharts wrappers.
- Single atomic commit touching exactly two files: the new `_components/charts-bundle.tsx` and the edited `page.tsx`.
- No new dependencies, no schema changes, no API contract changes.
</success_criteria>

<output>
Create `.planning/quick/260525-ucn-fix-buyer-value-ssr-false-in-server-comp/260525-ucn-SUMMARY.md` when done.
</output>
