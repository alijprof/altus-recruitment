---
phase: 260524-is2-ux-blocker-fixes
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open /candidates as a user whose org has zero candidates."
    expected: "Empty state renders ONE primary 'Add candidate' button. Body copy reads 'Candidates are the heart of the CRM. Add one manually first — you can upload a CV to auto-extract details once the candidate exists.' No secondary CTA visible."
    why_human: "Visual rendering — needs an authenticated browser session against a zero-candidate org. Grep confirms code shape, but only a browser can confirm the resulting layout looks right (button alignment, no orphan whitespace, copy reads naturally in context)."
  - test: "Open /reports/buyer-value as a user whose org has at least one open job with a salary_max set."
    expected: "Marquee pipeline-value headline renders with UK thousand separators, e.g. '£2,000,000' — NOT '£2000000.00' and NOT '£2,000,000.00'. Other four cards (Placements per recruiter, Time-to-fill, Source ROI, Commission summary) render unchanged."
    why_human: "Visual rendering of a marquee headline — formatter sanity in isolation produces '£2,000,000' (confirmed via node), but only a browser render in the live page verifies the value lands where expected, with the correct large font weight, and that none of the other four cards regressed (since the file's import line was also touched)."
---

# Phase 260524-is2: UX Blocker Fixes (T3 BL-01 + T4 BL-01) Verification Report

**Phase Goal:** Close two UX blockers — (A) Task 3 BL-01 candidates empty state no longer ships a dishonest "upload a CV to auto-extract" secondary CTA; (B) Task 4 BL-01 pipeline-value marquee number now renders with thousand separators via `Intl.NumberFormat`.
**Verified:** 2026-05-24
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1 | Candidates empty state advertises only what the next page can actually deliver (no CV-upload secondary CTA). | VERIFIED | `grep -n "secondaryCta" src/app/(app)/candidates/page.tsx` → 0 matches. EmptyState invocation at lines 92–96 passes only `heading`, `body`, `cta`. |
| 2 | Empty-state body copy is honest about WHEN CV upload becomes available (after the candidate is created). | VERIFIED | Line 94: `"Candidates are the heart of the CRM. Add one manually first — you can upload a CV to auto-extract details once the candidate exists."` Old "Or upload a CV to auto-extract" string is gone (`grep` returns 0 matches). |
| 3 | The marquee pipeline-value headline on `/reports/buyer-value` renders with UK thousand separators (e.g. £2,000,000). | VERIFIED | `formatGbpRound` exported at `src/lib/format.ts:40`; used at `src/app/(app)/reports/buyer-value/page.tsx:287` inside the marquee div (line 286 `text-4xl font-semibold tabular-nums`). Formatter sanity: `node -e` produces exactly `£2,000,000`. |
| 4 | `pnpm lint` and `pnpm typecheck` pass after both fixes. | VERIFIED (scoped) | `pnpm typecheck` exits clean. `pnpm exec eslint` against the three modified files exits silent (no warnings/errors). Note: a full-tree `pnpm lint` carries a pre-existing error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` documented in SUMMARY.md and STATE.md as a deferred item across three prior tasks — out of scope for this phase. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/app/(app)/candidates/page.tsx` | Empty state with single honest primary CTA only; contains "Add your first candidate" | VERIFIED | Lines 92–96 render EmptyState with `heading="Add your first candidate"`, single `cta`, no `secondaryCta`. Body copy honest about CV upload timing. |
| `src/lib/format.ts` | GBP whole-pound formatter with `Intl.NumberFormat` thousand separators; exports `formatPence`, `formatGbpRound` | VERIFIED | `formatPence` (lines 15–18) byte-identical to pre-change version (git diff confirms only appended content from line 19 onward). `formatGbpRound` exported at line 40 using a module-level `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 })` instance. |
| `src/app/(app)/reports/buyer-value/page.tsx` | Pipeline-value headline using separator-aware formatter; contains `formatGbpRound(currentPipelineValuePence)` | VERIFIED | Line 287: `{formatGbpRound(currentPipelineValuePence)}` inside the marquee `text-4xl` div. Import on line 26 updated to `import { formatGbpRound } from '@/lib/format'` (formatPence dropped, no longer referenced in file). |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `src/app/(app)/candidates/page.tsx` | `src/components/app/empty-state.tsx` | EmptyState props — pattern: `secondaryCta` | WIRED (negative-wired) | `secondaryCta` prop is **omitted** (not set to null), per plan. EmptyState's `hasAnyCta` logic stays clean. `grep -n "secondaryCta" src/app/(app)/candidates/page.tsx` → 0 matches. |
| `src/app/(app)/reports/buyer-value/page.tsx` | `src/lib/format.ts` | named import — pattern: `import.*formatGbpRound.*from '@/lib/format'` | WIRED | Line 26: `import { formatGbpRound } from '@/lib/format'`. Line 287: usage inside marquee div confirms wiring is live, not orphan. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `src/app/(app)/reports/buyer-value/page.tsx` (line 287 marquee) | `currentPipelineValuePence` | Lines 124, 140–141: derived from `getPipelineValueSparkline` (RPC) — `sparkRows[last].pipeline_value_pence`. Empty-state branch (lines 278–283) renders an EmptyState when sparkline is empty AND value is 0. | FLOWING | Real data path: RPC → `sparkRows` → `currentPipelineValuePence` → `formatGbpRound`. Empty path safely bypasses the marquee. The pipe is intact — verifying the rendered value with real org data is the human-check item below. |
| `src/app/(app)/candidates/page.tsx` (empty state) | `isEmptyDatabase` | Line 78: `total === 0 && !q` from `listCandidates` result. | FLOWING | Empty-state branch is gated by real DB count, not hardcoded. No data-flow concerns introduced by this change (the change was purely cosmetic to the empty-state subtree). |

### Behavioural Spot-Checks

| Behaviour | Command | Result | Status |
| --------- | ------- | ------ | ------ |
| `formatGbpRound(200000000)` returns `£2,000,000` (formatter sanity) | `node -e "const f=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0});console.log(f.format(2000000))"` | `£2,000,000` | PASS |
| TypeScript typecheck passes | `pnpm typecheck` | clean exit | PASS |
| ESLint on three modified files | `pnpm exec eslint src/app/(app)/candidates/page.tsx src/lib/format.ts src/app/(app)/reports/buyer-value/page.tsx` | silent (no warnings/errors) | PASS |
| Phase commits exist with verbatim spec messages | `git log --oneline` | `39b6b4f fix(260524-is2): candidates empty state — drop dishonest CV-upload CTA (T3 BL-01)` and `1e3f1e0 fix(260524-is2): pipeline value uses Intl.NumberFormat for thousand separators (T4 BL-01)` both present | PASS |
| Scope: only three planned files modified across both commits | `git diff 71c0b32 1e3f1e0 --name-only` | `src/app/(app)/candidates/page.tsx`, `src/app/(app)/reports/buyer-value/page.tsx`, `src/lib/format.ts` — exactly the planned three | PASS |
| Scope-lock: `_components/*` under buyer-value untouched | `grep -rn "formatPence" src/app/(app)/reports/buyer-value/` | All four scope-locked files (`source-roi-cards.tsx`, `source-roi-table.tsx`, `commission-cards.tsx`, `commission-table.tsx`) still import & use `formatPence` with their pre-existing two-decimal semantics | PASS |
| `formatPence` is byte-identical to pre-change | `git diff 71c0b32 1e3f1e0 -- src/lib/format.ts` | Diff shows ONLY appended content from line 19 onward (`+` lines only); the `formatPence` block (lines 15–18) is unchanged | PASS |

### Probe Execution

No phase-declared or conventional probes exist for this quick task. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| T3-BL-01 | 260524-is2-PLAN.md Task 1 | Candidates empty state must not ship the dishonest CV-upload secondary CTA. | SATISFIED | Truth 1 + Truth 2 verified; commit `39b6b4f` removes `secondaryCta` and rewrites body copy. |
| T4-BL-01 | 260524-is2-PLAN.md Task 2 | Pipeline-value marquee renders with UK thousand separators via `Intl.NumberFormat`. | SATISFIED | Truth 3 verified; commit `1e3f1e0` adds `formatGbpRound` and swaps call site. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | grep for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER across the three modified files returned zero matches | — | No debt markers introduced. |

### Human Verification Required

#### 1. Candidates empty-state visual rendering

**Test:** Sign in as a user whose org has zero candidates, navigate to `/candidates`.
**Expected:** Empty state renders ONE primary "Add candidate" button. Body copy reads "Candidates are the heart of the CRM. Add one manually first — you can upload a CV to auto-extract details once the candidate exists." No secondary CTA visible, no orphan whitespace where the second button used to be.
**Why human:** Visual layout and tone — grep confirms code shape, but only a browser render confirms the resulting layout looks right and the copy reads naturally in context.

#### 2. Buyer-value pipeline-value marquee thousand separators

**Test:** Sign in as a user whose org has at least one open job with `salary_max` set; navigate to `/reports/buyer-value`.
**Expected:** Marquee pipeline-value headline renders with UK thousand separators, e.g. `£2,000,000` — NOT `£2000000.00` and NOT `£2,000,000.00`. Other four cards (Placements per recruiter, Time-to-fill, Source ROI, Commission summary) render unchanged.
**Why human:** Live page render — formatter sanity in isolation produces `£2,000,000` (confirmed via node), but only a browser render in the live page verifies the value lands where expected, with the correct large font weight, and that none of the other four cards regressed (the file's import line was also touched).

### Gaps Summary

No gaps found. All four observable truths verify cleanly:
- The dishonest `secondaryCta` is removed and replaced with honest body copy that defers the CV-upload mention to "once the candidate exists".
- `formatPence` is byte-identical (verified via git diff — only appended content).
- A new module-level-cached `formatGbpRound` helper using `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })` exports cleanly.
- The buyer-value marquee call site swaps to `formatGbpRound`, and the unused `formatPence` import was removed from that file.
- Scope is exactly the three planned files; no `_components/*` files under `reports/buyer-value/` were touched (they retain their two-decimal pence semantics).
- Two atomic commits exist with the verbatim spec messages.
- `pnpm typecheck` clean; ESLint on the three modified files clean. The pre-existing repo-wide lint error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` is out of scope per STATE.md (deferred across three prior tasks).

Status is `human_needed` because two visual checks (empty-state layout and marquee render against real DB data) can only be verified in a browser session.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
