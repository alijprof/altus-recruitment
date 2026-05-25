---
phase: 260525-ucn-fix-buyer-value-ssr-false-in-server-comp
plan: 01
subsystem: reports
tags:
  - nextjs-16
  - rsc
  - recharts
  - build-fix
dependency_graph:
  requires:
    - quick/260524-cwd (buyer-value dashboards introduced the broken pattern)
  provides:
    - Server-Component-safe dynamic chart imports for /reports/buyer-value
  affects:
    - src/app/(app)/reports/buyer-value/page.tsx
    - src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx
tech_stack:
  added: []
  patterns:
    - "Move `dynamic({ ssr: false })` calls out of RSC pages into co-located `_components/*-bundle.tsx` Client Components when SSR-skip semantics are required (Next 15+/16 enforcement)"
key_files:
  created:
    - src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx
  modified:
    - src/app/(app)/reports/buyer-value/page.tsx
decisions:
  - "Named re-exports (`export { StackedBar, HorizontalBar, Sparkline }`) chosen over wrapper components so page.tsx call sites compile byte-identically and prop-type inference passes through `next/dynamic` generics."
  - "Single charts-bundle.tsx (rather than three sibling files) because the three wrappers are co-consumed only by /reports/buyer-value and have identical SSR-skip semantics — keeps the indirection in one place."
metrics:
  duration: "~5 minutes"
  completed: 2026-05-25
requirements:
  - QUICK-260525-ucn
---

# Quick 260525-ucn: Fix buyer-value `ssr: false` in Server Component — Summary

Production-build break on `/reports/buyer-value` after the Next.js 16 upgrade — Next 15+/16 disallows `next/dynamic({ ssr: false })` from Server Components. Lifted the three Recharts dynamic imports (`StackedBar`, `HorizontalBar`, `Sparkline`) into a new co-located Client Component (`_components/charts-bundle.tsx`) so the RSC page is now `next/dynamic`-free while preserving identical loading-placeholder heights, SSR-skip semantics, and call-site prop types.

## Commits

| Hash | Files | Description |
|------|-------|-------------|
| `3948075` | `_components/charts-bundle.tsx` (NEW), `page.tsx` (EDIT) | `fix(260525-ucn): move dynamic({ssr:false}) chart imports into Client wrapper (Next 16)` |

## What changed

### `src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx` (new, 41 lines)

- Starts with `'use client'` directive — required so `ssr: false` is legal here.
- Imports `dynamic` from `'next/dynamic'`.
- Declares three `const`s wrapping the existing Recharts wrappers:
  - `StackedBar` → `h-72` loading placeholder
  - `HorizontalBar` → `h-72` loading placeholder
  - `Sparkline` → `h-20` loading placeholder
- All three use `{ ssr: false, loading: () => <div className="h-XX w-full animate-pulse rounded-md bg-muted/40" /> }` — verbatim transposition from the old page.tsx.
- Named exports preserve the existing import shape: `export { StackedBar, HorizontalBar, Sparkline }`.

### `src/app/(app)/reports/buyer-value/page.tsx` (edited)

- Removed `import dynamic from 'next/dynamic'` (line 1).
- Removed the three top-level `dynamic(...)` declarations (old lines 54-82).
- Added `import { HorizontalBar, Sparkline, StackedBar } from './_components/charts-bundle'` adjacent to the existing `CommissionShell` / `SourceRoiShell` imports (Tailwind/Prettier ordering puts these alphabetically before the other `./_components` imports).
- Updated the explanatory comment block to reflect the new architecture and the Next 15+/16 SSR-rule rationale.
- Every JSX usage of `<StackedBar ... />`, `<HorizontalBar ... />`, `<Sparkline ... />` is byte-identical — the named imports from charts-bundle resolve through `next/dynamic`'s generic inference to the underlying typed props.

## Verification

| Gate | Result | Notes |
|------|--------|-------|
| `pnpm typecheck` | PASS | Clean (`tsc --noEmit`, exit 0). Call-site prop types in page.tsx still resolve correctly through the dynamic-wrapped re-exports. |
| `pnpm lint` | PASS on touched files | Pre-existing `cv-review-panel.tsx:98` `react-hooks/purity` error remains (logged across prior task SUMMARYs as out-of-scope per Scope Boundary rule). No new warnings introduced on either touched file — confirmed via `pnpm lint 2>&1 \| grep -E "(buyer-value\|charts-bundle\|charts/...)"` returning empty. |
| `pnpm build` | PARTIAL — see note below | Turbopack compilation completes (`✓ Compiled successfully in 7.6s`) and TypeScript validation completes (`Finished TypeScript in 4.8s`). The SSR-rule violation that previously failed compile is gone. Build then fails at the page-data-collection phase due to the env-validator throwing on missing `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the worktree has no `.env.local`. This is anticipated and called out in the orchestrator's constraints; the real build will run in the main repo (with the user's real env values) post-merge. |

### Why the build-env failure does not block this fix

The fix being verified is "compilation no longer rejects `ssr: false` in an RSC". That check runs during Turbopack page-bundle compilation, which now passes (`✓ Compiled successfully in 7.6s`). The env-validator failure is much later in the build pipeline (`Collecting page data using 10 workers`), triggered by `accept-invite/[token]` route reading runtime env. The SSR-rule fix is structurally verified by:

1. `_components/charts-bundle.tsx` exists with `'use client'` at line 1, all three `ssr: false` declarations present.
2. `page.tsx` no longer imports `next/dynamic` and no longer contains any `dynamic(...)` call.
3. Turbopack reaches `Compiled successfully` (previously it errored before this line with the SSR-rule violation).

## Deviations from Plan

None — plan executed exactly as written. Single atomic commit, two files, exact commit message from the plan.

## Self-Check: PASSED

- Created file present: `src/app/(app)/reports/buyer-value/_components/charts-bundle.tsx` — FOUND
- Modified file present: `src/app/(app)/reports/buyer-value/page.tsx` — FOUND
- Commit present in worktree branch: `3948075` — FOUND (`fix(260525-ucn): move dynamic({ssr:false}) chart imports into Client wrapper (Next 16)`)
- charts-bundle.tsx line 1 == `'use client'` — verified
- page.tsx grep for `next/dynamic` / `dynamic(` returns only the comment reference, no live import or call — verified
