---
phase: 260524-is2-ux-blocker-fixes
plan: 01
subsystem: ui/empty-state, reports/buyer-value, lib/format
tags: [ux, blocker, candidates, reports, formatting, intl]
requires:
  - "src/app/(app)/candidates/page.tsx pre-existing"
  - "src/components/app/empty-state.tsx (optional secondaryCta prop, unchanged)"
  - "src/lib/format.ts (formatPence — unchanged)"
  - "src/app/(app)/reports/buyer-value/page.tsx pre-existing"
provides:
  - "src/lib/format.ts → formatGbpRound (new export)"
  - "Honest candidates empty state (no false CV-upload promise)"
  - "Acquirer-ready pipeline-value headline with UK thousand separators"
affects:
  - "src/app/(app)/candidates/page.tsx (empty-state branch only)"
  - "src/app/(app)/reports/buyer-value/page.tsx (line 287 marquee + import)"
tech-stack:
  added: []
  patterns:
    - "Module-level Intl.NumberFormat instance reused across calls (construction cost minimisation)"
key-files:
  created: []
  modified:
    - path: "src/app/(app)/candidates/page.tsx"
      what: "Removed secondaryCta from zero-state EmptyState; rewrote body copy to honestly defer CV-upload mention to post-creation"
    - path: "src/lib/format.ts"
      what: "Appended formatGbpRound helper using Intl.NumberFormat('en-GB', currency: GBP, maximumFractionDigits: 0); formatPence untouched"
    - path: "src/app/(app)/reports/buyer-value/page.tsx"
      what: "Pipeline-value headline now uses formatGbpRound(currentPipelineValuePence); swapped import from formatPence → formatGbpRound (formatPence no longer used in this file)"
decisions:
  - "Drop the secondary CTA entirely rather than retarget it — there is no candidate-import flow in the codebase, and the empty state already has a clear single CTA"
  - "Add formatGbpRound as a new export rather than overload formatPence — keeps existing two-decimal pence semantics intact across settings/usage, source-attribution, source-roi-table, commission-cards, source-roi-cards, commission-table"
  - "Module-level NumberFormat instance — Intl.NumberFormat construction is non-trivial; reuse keeps marquee renders snappy"
  - "Negative inputs pass through unmodified (matches formatPence philosophy — surface bookkeeping bugs rather than hide them)"
metrics:
  duration_seconds: 241
  completed_date: "2026-05-24"
  tasks_completed: 2
  files_modified: 3
  commits: 2
---

# 260524-is2 — UX Blocker Fixes (T3 BL-01 + T4 BL-01) Summary

**One-liner:** Two surgical BL-01 fixes from the Opus reviews — drop the candidates empty-state's dishonest CV-upload secondary CTA, and render the buyer-value pipeline-value headline with UK thousand separators via `Intl.NumberFormat`.

## Tasks Completed

| # | Task | Files | Commit |
|---|------|-------|--------|
| 1 | T3 BL-01: candidates empty state — drop dishonest CV-upload CTA | `src/app/(app)/candidates/page.tsx` | `39b6b4f` |
| 2 | T4 BL-01: pipeline value uses `Intl.NumberFormat` for thousand separators | `src/lib/format.ts`, `src/app/(app)/reports/buyer-value/page.tsx` | `1e3f1e0` |

## Task 1 — Candidates empty state (T3 BL-01)

The 260524-cjl review (BL-01) flagged that the candidates zero-state advertised a CV-upload secondary CTA that linked to `/candidates/new` — a page whose form contains no `<input type="file">`. The CV upload UI lives only on the candidate **detail** page (`src/app/(app)/candidates/[id]/cv-upload.tsx`), mounted after creation.

The fix:

- Removed the `secondaryCta` prop entirely (omitted, not set to `null`, so the EmptyState's `hasAnyCta` logic stays clean and only the primary button renders).
- Rewrote the body copy: `"Candidates are the heart of the CRM. Add one manually first — you can upload a CV to auto-extract details once the candidate exists."`
- Primary `{ href: '/candidates/new', label: 'Add candidate' }` CTA unchanged.

The non-empty branch (header CTA, search, view toggle, CandidatesShell) is untouched.

## Task 2 — Pipeline value headline (T4 BL-01)

The 260524-cwd review (BL-01) flagged the marquee pipeline-value number on `/reports/buyer-value` rendering as `£2000000.00` — `formatPence` uses `(p/100).toFixed(2)` with no locale separators, which is the right shape for per-row pence amounts but visually amateurish for a six-/seven-figure acquirer-facing headline.

The fix:

1. **`src/lib/format.ts`** — appended a new exported helper `formatGbpRound(p: number): string`. It declares a module-level `gbpRound` instance configured as `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 })` and returns `gbpRound.format(p / 100)`. JSDoc explains it's for marquee acquirer-facing whole-pound headlines where thousand separators matter and sub-pound precision does not.
2. **`src/app/(app)/reports/buyer-value/page.tsx`** — line 287 swapped from `{formatPence(currentPipelineValuePence)}` to `{formatGbpRound(currentPipelineValuePence)}`. Import on line 26 changed from `formatPence` → `formatGbpRound` (formatPence had no other reference in this file, so removed cleanly).

`formatPence` itself is **byte-identical** to its previous state — verified by inspecting the diff. All other call sites (settings/usage, source-attribution, buyer-value `_components/source-roi-cards.tsx`, `_components/source-roi-table.tsx`, `_components/commission-cards.tsx`, `_components/commission-table.tsx`) are untouched and keep their existing two-decimal pence behaviour. None of those `_components/*` files were modified — explicitly scope-locked out per the plan.

### Formatter sanity

```
node -e "Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(2000000)"
→ £2,000,000
```

## Deviations from Plan

None. Plan executed exactly as written. The "Suggested wording" in Task 1 was used verbatim; the `formatPence` import removal in Task 2 was the planned cleanup (file had no other reference).

## Verification

### Automated

| Check | Result |
|-------|--------|
| `pnpm typecheck` | PASS (clean output) |
| `pnpm exec eslint src/app/(app)/candidates/page.tsx` | PASS (no output) |
| `pnpm exec eslint src/lib/format.ts src/app/(app)/reports/buyer-value/page.tsx` | PASS (no output) |
| `grep "Or upload a CV to auto-extract" src/app/(app)/candidates/page.tsx` | 0 matches (expected) |
| `grep "secondaryCta" src/app/(app)/candidates/page.tsx` | 0 matches (expected) |
| `grep "formatGbpRound" src/lib/format.ts` | 2 matches (JSDoc + export) |
| `grep "formatGbpRound(currentPipelineValuePence)" src/app/(app)/reports/buyer-value/page.tsx` | 1 match on line 287 |
| `grep "formatPence" src/app/(app)/reports/buyer-value/page.tsx` | 0 matches (unused import removed) |
| Formatter sanity node script | OK `£2,000,000` |
| `git log --oneline -3` | Both commits present with verbatim plan-spec messages |

### Pre-existing lint error (out of scope)

Full-tree `pnpm lint` returns one pre-existing error at `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` (`useRef(Date.now())` flagged by the React 19 `react-hooks/set-state-in-effect` rule). This error pre-dates 260524-is2 and is logged in STATE.md as a deferred item across three prior tasks (260524-b6v, 260524-cjl, 260524-cwd). It is explicitly out of scope for this quick task per the scope-boundary rule. Lint output on the three files I modified is clean.

### Manual smoke (requires browser)

- `/candidates` with zero candidates → one "Add candidate" CTA, honest body copy, no orphan secondary button.
- `/reports/buyer-value` with at least one open job whose `salary_max` is set → marquee number renders like `£2,000,000` (no decimal places, comma separators); other four cards unchanged.

## Scope Hygiene

- No files modified outside the three named in the plan.
- No DB migrations, no schema changes, no new dependencies.
- No changes to `_components/*` under `reports/buyer-value/` — those still call `formatPence` directly with the same two-decimal behaviour they always had.
- The 260524-cjl WR-01..WR-05 and 260524-cwd HI-01..HI-07 items called out in the same reviews are explicitly **not** touched — they remain on the backlog for follow-up quick tasks.

## Self-Check: PASSED

- `[FOUND] 39b6b4f` — Task 1 commit present in `git log`.
- `[FOUND] 1e3f1e0` — Task 2 commit present in `git log`.
- `[FOUND] src/app/(app)/candidates/page.tsx` — modified, lint-clean.
- `[FOUND] src/lib/format.ts` — modified, formatPence byte-identical, formatGbpRound exported.
- `[FOUND] src/app/(app)/reports/buyer-value/page.tsx` — modified, formatGbpRound applied on line 287, formatPence import removed.
- All four `<verification>` grep audits returned the expected results.
- Formatter sanity output is exactly `£2,000,000`.
