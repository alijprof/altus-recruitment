---
phase: quick-260524-cjl
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open each of the 8 index pages (candidates, clients, jobs, pipeline, floats, spec, reports/source-attribution, dashboard) in a freshly-seeded / empty org and confirm the rendered empty states match the documented heading + body + CTA copy and that the primary+secondary buttons stack on mobile and sit side-by-side on >=sm breakpoints."
    expected: "Each page renders the new EmptyState container with correct heading/body, primary CTA (and secondary where defined), no double-stacked headings on the dashboard, and no layout shift versus a normal list view."
    why_human: "Visual / responsive verification (mobile vs sm:+) and copy correctness cannot be confirmed by grep — must be observed in a browser."
  - test: "Click each primary and secondary CTA from the empty states and confirm the target route loads."
    expected: "All CTAs navigate to existing routes: /candidates/new, /clients/new, /spec/new, /clients, /jobs, /candidates, /pipeline. No 404s."
    why_human: "Confirms runtime navigation; goes beyond static route-existence checks."
---

# Quick 260524-cjl: Empty-state polish across 8 index pages — Verification Report

**Phase Goal:** Replace bare "No X yet" copy on 8 main index pages with a richer EmptyState (heading + body + primary CTA + optional secondary CTA). EmptyState component extended with optional `secondaryCta` prop. No new dependencies.
**Verified:** 2026-05-24
**Status:** human_needed (all automated checks PASS; visual + responsive smoke remains for the user)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | Every one of the 8 listed index pages, when empty, renders a richer EmptyState (heading + value-explaining body + primary CTA) | VERIFIED | All 8 pages import `EmptyState` from `@/components/app/empty-state` and pass non-trivial `heading` + `body` + `cta` props in their empty branches (see Required Artifacts table). |
| 2  | EmptyState supports an optional secondary CTA rendered as a subdued/outline button next to / below the primary | VERIFIED | `src/components/app/empty-state.tsx:13` adds `secondaryCta?: { href; label } \| null`. Lines 39-52 render a `flex flex-col items-center gap-2 sm:flex-row` row with the primary `Button asChild` (default variant) and a secondary `Button asChild variant="outline"` when present. |
| 3  | Candidates empty state offers a secondary "Or upload a CV to auto-extract" link | VERIFIED | `src/app/(app)/candidates/page.tsx:96` — `secondaryCta={{ href: '/candidates/new', label: 'Or upload a CV to auto-extract' }}`. |
| 4  | Jobs empty state offers two paths (spec call OR creating against a client) as primary + secondary CTAs | VERIFIED | `src/app/(app)/jobs/page.tsx:70-71` — primary CTA → `/spec/new` "Record a spec call", secondary CTA → `/clients` "Pick a client". |
| 5  | Spec calls, clients, floats, reports/source-attribution, and dashboard empty states use the shared EmptyState (no bespoke divs left) | VERIFIED | grep for `bg-card.*rounded-md.*border.*p-` in `floats/page.tsx` and `spec/page.tsx` returned zero matches. All five files import `EmptyState` from `@/components/app/empty-state`. The reports/source-attribution "By source" card now uses `EmptyState` (line 185-189) replacing the previous flat `<p>`. The dashboard's outer `<header>` is removed in the empty branch (only `EmptyState` renders, no double heading). |
| 6  | No CTA links to a route that does not exist; `/jobs/new` is replaced with the existing `/clients` (jobs created against a client) and noted in SUMMARY.md | VERIFIED | Filesystem check confirms `candidates/new`, `clients/new`, `spec/new` exist; `jobs/new` does NOT exist. The jobs empty state uses `/spec/new` (primary) and `/clients` (secondary). SUMMARY.md "Deferred items" section calls out the `/jobs/new` gap and recommends adding it in Phase 4. |
| 7  | `pnpm lint` and `pnpm typecheck` both pass | VERIFIED | `pnpm typecheck` (full project, `tsc --noEmit`) returns clean. `pnpm exec eslint` on the 9 modified files returns no warnings or errors. (SUMMARY.md notes a single pre-existing baseline lint error in `cv-review-panel.tsx` unrelated to this task.) |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/components/app/empty-state.tsx` | Adds optional `secondaryCta` prop; renders primary + secondary as flex row (stacks on mobile); remains Server Component | VERIFIED | Prop added at line 13. Render logic in lines 39-52 matches plan exactly. No `'use client'` directive. No new imports beyond `Button`, `Link`, `cn`. |
| `src/app/(app)/candidates/page.tsx` | EmptyState with primary "Add candidate" + secondary "Or upload a CV to auto-extract" | VERIFIED | Lines 91-97 — both CTAs present with correct labels and hrefs (`/candidates/new` for both per the plan's clarification). |
| `src/app/(app)/clients/page.tsx` | EmptyState replacing bespoke div; primary CTA → /clients/new | VERIFIED | Lines 73-86 — bespoke `<div>` removed; EmptyState used in the `if (isEmpty)` branch with single CTA `Add client` → `/clients/new`. |
| `src/app/(app)/jobs/page.tsx` | Primary "Record a spec call" (/spec/new) + secondary "Pick a client" (/clients) | VERIFIED | Lines 67-72 — both CTAs match plan; `/jobs/new` gap noted in inline comment (54-58). |
| `src/app/(app)/pipeline/page.tsx` | Filter-active branch keeps minimal copy; unfiltered branch gets primary `/jobs` + secondary `/candidates` CTAs | VERIFIED | Lines 75-89 — branches on `ownerId \|\| jobId \|\| clientId`. Filtered branch: heading + body, no CTA. Unfiltered: full EmptyState with secondary CTA `/candidates`. |
| `src/app/(app)/floats/page.tsx` | EmptyState replacing bespoke div; CTA → /candidates | VERIFIED | Lines 29-34 — `EmptyState` with float-explaining body and `Browse candidates` CTA → `/candidates`. No bespoke empty divs remain. |
| `src/app/(app)/spec/page.tsx` | EmptyState replacing inline Card; primary CTA → /spec/new | VERIFIED | Lines 73-78 — inline `<Card>` empty branch replaced with `EmptyState`. CTA → `/spec/new`. |
| `src/app/(app)/reports/source-attribution/page.tsx` | EmptyState in "By source" card only; CTA → /pipeline | VERIFIED | Lines 184-189 — only the "By source" card's empty branch swapped to `EmptyState`. The "Top sources by revenue" card's flat `<p>` correctly left as-is (per plan, to avoid double-stacking). |
| `src/app/(app)/page.tsx` | Dashboard empty branch uses single EmptyState with secondary CTA → /clients/new; outer `<header>` removed | VERIFIED | Lines 37-48 — single `EmptyState` with primary `/candidates/new` + secondary `/clients/new`. No outer `<h1>Welcome to Altus</h1>` header in the empty branch (so no double heading). |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `src/app/(app)/candidates/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState } from '@/components/app/empty-state'` | WIRED | Line 3, used line 92. |
| `src/app/(app)/clients/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 4, used line 79. |
| `src/app/(app)/jobs/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 1, used line 67. |
| `src/app/(app)/pipeline/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 1, used lines 77 and 83. |
| `src/app/(app)/floats/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 1, used line 30. |
| `src/app/(app)/spec/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 3, used line 74. |
| `src/app/(app)/reports/source-attribution/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 5, used line 185. |
| `src/app/(app)/page.tsx` | `src/components/app/empty-state.tsx` | `import { EmptyState }` | WIRED | Line 1, used line 40. |

### Data-Flow Trace (Level 4)

Empty-state copy + props are statically authored — no dynamic data source to trace. The renderable "data" is the prop literals in each page (heading, body, cta, secondaryCta), which were verified above by direct file reading. Not applicable.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript compiles cleanly across the project | `pnpm typecheck` (`tsc --noEmit`) | exit 0, no errors | PASS |
| ESLint clean on the 9 modified files | `pnpm exec eslint <9 files>` | no output (clean) | PASS |
| No new dependencies introduced | `git diff package.json` (working tree); also no recent commits touched `package.json` | empty diff | PASS |
| Routes referenced by CTAs exist | `ls` on each target page file | `/candidates/new`, `/clients/new`, `/spec/new` exist; `/clients`, `/jobs`, `/candidates`, `/pipeline` exist as index routes | PASS |
| `/jobs/new` deliberately missing (deferred item) | `ls src/app/(app)/jobs/new/page.tsx` | "No such file or directory" — matches plan + SUMMARY deferred item | PASS (expected) |
| Commits documented in SUMMARY exist | `git log --oneline -10` | `5699230 feat(260524-cjl): EmptyState supports optional secondary CTA` and `6e50a41 feat(260524-cjl): wire EmptyState across 8 index pages` both present | PASS |

### Probe Execution

No probes defined for this quick task. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| QUICK-260524-CJL | 260524-cjl-PLAN.md | Quick task: polish empty states across 8 index pages with shared EmptyState (extended with optional secondary CTA) | SATISFIED | All 7 must_haves truths verified; all 9 artifacts present and wired; lint + typecheck clean; no new dependencies. |

### Anti-Patterns Found

None. grep for `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER` across all 9 modified files returned zero matches. No `return null`, no empty handlers, no console.log-only implementations, no hardcoded empty fallbacks.

### Human Verification Required

### 1. Visual + responsive smoke on the 8 empty states

**Test:** Open each of the 8 index pages (candidates, clients, jobs, pipeline, floats, spec, reports/source-attribution, dashboard) in a freshly-seeded / empty org and verify the rendered empty states match the documented heading + body + CTA copy. Resize from mobile (<640px) to desktop and confirm primary + secondary buttons stack vertically on mobile and sit side-by-side at the `sm` breakpoint.

**Expected:** Each page renders the new EmptyState container with the correct heading and body. Primary + secondary CTAs render where defined. No double-stacked headings on the dashboard. No layout shift relative to a populated list.

**Why human:** Visual layout, copy correctness, and responsive breakpoints cannot be verified by grep — only by browser observation. SUMMARY.md explicitly notes manual smoke was not performed.

### 2. CTA navigation smoke

**Test:** From each empty state, click every primary and secondary CTA and verify the target route loads successfully.

**Expected:** All CTAs navigate to existing routes (`/candidates/new`, `/clients/new`, `/spec/new`, `/clients`, `/jobs`, `/candidates`, `/pipeline`). No 404s. The `/jobs/new` route is intentionally NOT linked from any CTA (the jobs empty state uses `/spec/new` and `/clients` per the documented deferred item).

**Why human:** Confirms runtime navigation behaviour — goes beyond the static route-existence checks already covered above.

### Gaps Summary

No blocking gaps. All 7 must_haves truths are verified, every artifact exists at all three levels (exists, substantive, wired), every key link is connected, no anti-patterns or debt markers present, and the only "missing" route (`/jobs/new`) is a deliberate deferred item documented in SUMMARY.md as a Phase 4 follow-up. The shared `EmptyState` component is now the single source of truth for empty states on these 8 pages. Status is `human_needed` only because copy + responsive layout warrant a brief browser smoke before sign-off — not because anything in the code is wrong.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
