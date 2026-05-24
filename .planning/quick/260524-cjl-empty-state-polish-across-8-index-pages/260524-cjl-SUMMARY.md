---
phase: quick-260524-cjl
plan: 01
subsystem: ui-empty-states
tags: [ui, empty-state, copy, polish]
dependency_graph:
  requires:
    - src/components/app/empty-state.tsx (pre-existing)
    - src/components/ui/button.tsx (pre-existing)
  provides:
    - shared EmptyState with optional secondary CTA across 8 index pages
  affects:
    - first-run UX on every main top-level route in the app
tech_stack:
  added: []
  patterns:
    - "secondaryCta?: { href; label } | null prop on EmptyState"
    - "primary + secondary buttons: flex-col on mobile, flex-row sm:+"
key_files:
  created: []
  modified:
    - src/components/app/empty-state.tsx
    - src/app/(app)/candidates/page.tsx
    - src/app/(app)/clients/page.tsx
    - src/app/(app)/jobs/page.tsx
    - src/app/(app)/pipeline/page.tsx
    - src/app/(app)/floats/page.tsx
    - src/app/(app)/spec/page.tsx
    - src/app/(app)/reports/source-attribution/page.tsx
    - src/app/(app)/page.tsx
decisions:
  - "EmptyState gained an additive secondaryCta prop — existing single-CTA callers unaffected"
  - "Jobs empty-state primary CTA points at /spec/new (AI-first path); secondary at /clients (jobs are created against a client)"
  - "Candidates secondary CTA reuses /candidates/new because that form already supports CV upload — no separate route required"
  - "/jobs/new standalone route deferred to Phase 4"
metrics:
  duration: 5m
  completed_date: 2026-05-24
requirements:
  - QUICK-260524-CJL
---

# Quick 260524-cjl: Empty-state polish across 8 index pages — Summary

Consistent, action-oriented empty states across every main index page, all driven by a single shared `EmptyState` component (now supporting an optional secondary CTA).

## What changed

| Page | Before | After |
| ---- | ------ | ----- |
| `src/components/app/empty-state.tsx` | heading + body + single optional CTA | added optional `secondaryCta` (outline-variant button); primary + secondary render side-by-side (column on mobile) |
| `candidates/page.tsx` | "No candidates yet" + single CTA | "Add your first candidate" + body explaining CV auto-extract + secondary "Or upload a CV to auto-extract" |
| `clients/page.tsx` | bespoke `<div>` with `Plus` icon button | shared EmptyState: "Add your first client" + value-explaining body + CTA → `/clients/new` |
| `jobs/page.tsx` | single "View clients" CTA | "Add your first job" + primary "Record a spec call" (`/spec/new`) + secondary "Pick a client" (`/clients`) |
| `pipeline/page.tsx` | one EmptyState branching on filter state | split: filtered branch keeps minimal copy; unfiltered branch gets richer "No candidates in pipeline yet" + dual CTA `/jobs` and `/candidates` |
| `floats/page.tsx` | bespoke `<div>` with inline `<strong>` instructions | shared EmptyState explaining what a float is + CTA → `/candidates` |
| `spec/page.tsx` | inline `<Card>` with underlined `Link` | shared EmptyState: "Record your first spec call" + CTA → `/spec/new` |
| `reports/source-attribution/page.tsx` | flat `<p>` inside "By source" card | shared EmptyState inside the card with body + CTA → `/pipeline` (secondary "Top sources by revenue" card intentionally left as-is to avoid double-stacking) |
| `page.tsx` (dashboard) | double heading: "Welcome to Altus" `<header>` then "Nothing here yet" EmptyState | single EmptyState: "Welcome to Altus" + dual CTA "Add your first candidate" + "Or add your first client"; outer `<header>` removed in empty branch |

## Commits

- `5699230` — feat(260524-cjl): EmptyState supports optional secondary CTA
- `6e50a41` — feat(260524-cjl): wire EmptyState across 8 index pages

## Verification

- `pnpm typecheck` → PASS (full project, clean)
- `pnpm exec eslint` on the 9 modified files → PASS (no errors, no warnings)
- `pnpm lint` (full project) → 1 pre-existing error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` ("Cannot call impure function during render") that exists on the baseline commit `e9618efe7aef…` before any of this plan's changes — out of scope per the GSD deviation scope boundary. Verified by `git stash`-ing this plan's working changes and re-running lint: error still present, file untouched by this plan.
- `git diff package.json` → empty (no new dependencies)
- No new lucide-react icons added.
- No file deletions in either commit (`git diff --diff-filter=D --name-only` confirmed empty for both commits).

## Manual smoke

Not performed in this run — this is a pure copy + props change on Server Components with no runtime branches that aren't visible from the source diff. The shared `EmptyState` component has only two structural cases (single CTA, dual CTA), both covered by the new prop logic. Browser screenshots are appropriate when the next phase tightens visual polish; for an additive prop + caller-only copy update, source review is the proportionate check.

## Deferred items

- **`/jobs/new` standalone route does not exist.** Jobs today can only be created via either (a) recording a spec call and approving the extracted JD, or (b) navigating to a client and adding a job against them. The jobs empty state therefore surfaces both paths (primary: `/spec/new`, secondary: `/clients`) instead of a single "Add job" CTA. **Phase 4 should add a `/jobs/new` standalone form** so jobs can be created without first picking a client or recording a spec call — this would let the jobs empty state collapse to a single primary CTA.

## Deviations from Plan

None — plan executed as written. The plan's `secondaryCta` href for candidates was clarified at the top to `/candidates/new` (which the plan itself spelled out as the final shipping value); shipped exactly that.

## Self-Check: PASSED

- File `src/components/app/empty-state.tsx` FOUND with `secondaryCta` prop.
- File `src/app/(app)/candidates/page.tsx` FOUND, EmptyState uses `secondaryCta`.
- File `src/app/(app)/clients/page.tsx` FOUND, EmptyState imported and used in `if (isEmpty)` branch.
- File `src/app/(app)/jobs/page.tsx` FOUND, EmptyState uses primary + secondary CTAs.
- File `src/app/(app)/pipeline/page.tsx` FOUND, unfiltered branch uses `secondaryCta`.
- File `src/app/(app)/floats/page.tsx` FOUND, bespoke div replaced.
- File `src/app/(app)/spec/page.tsx` FOUND, inline Card replaced.
- File `src/app/(app)/reports/source-attribution/page.tsx` FOUND, "By source" empty-state uses EmptyState.
- File `src/app/(app)/page.tsx` FOUND, single EmptyState in empty branch.
- Commit `5699230` FOUND in `git log`.
- Commit `6e50a41` FOUND in `git log`.
