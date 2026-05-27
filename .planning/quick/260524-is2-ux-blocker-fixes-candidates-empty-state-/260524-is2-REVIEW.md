---
phase: 260524-is2-ux-blocker-fixes
reviewed: 2026-05-27T00:00:00Z
reviewer: Opus (pre-UAT pipeline)
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/app/(app)/candidates/page.tsx
  - src/lib/format.ts
  - src/app/(app)/reports/buyer-value/page.tsx
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
verdict: PASS-WITH-NITS
---

# Pre-UAT Code Review — 260524-is2 UX fixes

**Reviewed:** 2026-05-27
**Reviewer:** Opus (pre-UAT pipeline)
**Verdict:** PASS-WITH-NITS

Both blockers are surgically fixed. Scope is clean (3 files, 2 atomic commits, no creep into the deferred WR/HI items). `formatPence` is byte-identical (diff is pure append). The empty-state and import cleanups are correct. One worth-noting WARNING about `formatGbpRound` swallowing sub-£1 pence amounts silently — relevant for trust if the formatter ever leaks to a non-marquee context. No blockers for UAT.

## Blockers

None.

## High-priority issues

None.

## Medium-priority / nice-to-haves

### WR-01 — `formatGbpRound` renders any pence amount under 50 as `£0` (silent rounding to zero)

**File:** `src/lib/format.ts:40-42`

**Issue:** `formatGbpRound(p)` calls `gbpRound.format(p / 100)` with `maximumFractionDigits: 0` and no flooring. `Intl.NumberFormat` defaults to `roundingMode: 'halfExpand'`, so:

- `formatGbpRound(1)` → `£0` (1 pence)
- `formatGbpRound(49)` → `£0`
- `formatGbpRound(50)` → `£1` (rounded up)
- `formatGbpRound(99)` → `£1`
- `formatGbpRound(-1234)` → `-£12` (loses 34p silently)

For the current call site (`currentPipelineValuePence` = sum of `salary_max × 100 × 0.20` over open jobs, returned as `bigint` from `get_pipeline_value_sparkline`), this is a non-issue in practice — pipeline values are 4-, 6- or 7-figure pound sums; sub-£1 inputs cannot occur. JSDoc correctly scopes the helper to "marquee acquirer-facing whole-pound headlines… for per-row or sub-£1 amounts, keep using `formatPence`".

But the function name `formatGbpRound` does not signal "do not pass sub-£1 here" loudly enough; a future caller who treats it as a general drop-in for `formatPence` will silently lose precision. Two harmless hardenings worth considering for a follow-up (NOT for this UAT):

1. Add a runtime assertion / dev warning if `Math.abs(p) < 100 && p !== 0`, OR
2. Rename to `formatGbpWholePounds` or `formatGbpHeadline` for self-documenting intent.

Not blocking. Behaviour is correct for the one call site that exists today, and the JSDoc warns callers.

**Fix (optional, follow-up):**
```ts
// Option A — assert in dev only
export function formatGbpRound(p: number): string {
  if (process.env.NODE_ENV !== 'production' && p !== 0 && Math.abs(p) < 100) {
    console.warn(`[formatGbpRound] sub-£1 input ${p}p will render as £0 — use formatPence instead`)
  }
  return gbpRound.format(p / 100)
}
```

## Info

### IN-01 — `formatGbpRound(NaN)` / `formatGbpRound(undefined as unknown as number)` renders `£NaN`

**File:** `src/lib/format.ts:40-42`

**Issue:** Per ad-hoc node check:
- `formatGbpRound(NaN)` → `£NaN`
- `formatGbpRound(undefined)` → `£NaN` (when coerced through `/100`)
- `formatGbpRound(Infinity)` → `£∞`

The current call site cannot pass NaN (the type is `number`, and `currentPipelineValuePence` defaults to `0` on line 113 when `lastSparkRow` is undefined; the underlying RPC `get_pipeline_value_sparkline` declares the column as `bigint` with `coalesce(...,0)`). So this is purely defensive — not currently reachable, not a UAT concern.

Matches `formatPence`'s philosophy (no guard there either). Flagging for future awareness only.

### IN-02 — Edge case: `sparkRows` has data but all values are 0

**File:** `src/app/(app)/reports/buyer-value/page.tsx:250`

**Issue:** The empty-state guard is `sparkRows.length === 0 && currentPipelineValuePence === 0`. If a window has sparkline rows but the most recent bucket has `pipeline_value_pence = 0` (e.g. all open jobs were closed by the end of the window, or earlier buckets had jobs and the last one doesn't), the marquee branch renders, showing a literal `£0` headline with a sparkline that decays to zero.

This is arguably correct behaviour (`£0` is the truth, and the sparkline shows the decay narrative), and is pre-existing logic from 260524-cwd, NOT introduced by this commit. The 260524-is2 commit only swapped the formatter on the same line. `formatGbpRound(0)` returns `£0` cleanly (confirmed).

Worth noting because the EmptyState body for the empty branch says "No open jobs in this window" — which would also be true if the most recent bucket is zero. But that's the pre-existing UX choice and out of scope for is2.

No fix in scope. Re-litigation belongs in a separate Task 4 follow-up if at all.

### IN-03 — Empty-state body copy reads naturally but the em-dash + "first" sequencing is slightly stilted

**File:** `src/app/(app)/candidates/page.tsx:94`

**Issue:** Current copy:

> "Candidates are the heart of the CRM. Add one manually first — you can upload a CV to auto-extract details once the candidate exists."

The "first" and "once the candidate exists" sandwich the same idea twice. Slightly cleaner alternatives (subjective, taste-level):

> "Candidates are the heart of the CRM. Add one manually — you'll be able to upload a CV to auto-extract details once they exist."

or simpler:

> "Candidates are the heart of the CRM. Add one manually; CV upload becomes available after the candidate is created."

Neither is materially better than the shipped copy for trust purposes — it's honest and clear about WHEN CV upload becomes available, which is the BL-01 fix's actual job. PASS as-is. Just flagging for a future copy pass if marketing-voice tightening becomes a priority.

## Things that look right

1. **EmptyState orphan-whitespace concern is unfounded.** `EmptyState` (lines 27, 39-52 in `src/components/app/empty-state.tsx`) gates the entire CTA-row `<div>` on `hasAnyCta = Boolean(cta || secondaryCta)`. With `secondaryCta` omitted (not passed as `null`), only the primary button renders, wrapped in `flex gap-2` — no orphan whitespace, no stray container. Verified by reading the component source.

2. **`formatPence` is byte-identical.** `git show 1e3f1e0 -- src/lib/format.ts` shows only `+` lines from line 19 onward (the new `gbpRound` constant + `formatGbpRound` function + JSDoc). The original 4-line `formatPence` body on lines 15-18 is untouched. All 14 existing call sites (`settings/usage`, `source-attribution`, four `_components/*` under `reports/buyer-value`) keep their two-decimal pence semantics.

3. **`formatGbpRound` core correctness.** Verified in node:
   - `formatGbpRound(200000000)` → `£2,000,000` ✓
   - `formatGbpRound(10000000000)` → `£100,000,000` ✓ (£100M)
   - `formatGbpRound(0)` → `£0` ✓
   - `formatGbpRound(-100000000)` → `-£1,000,000` ✓ (minus sign correctly precedes `£`, en-GB locale puts sign before the symbol)
   - `formatGbpRound(200.5)` → `£2` ✓ (sub-£1 fractional pence — rounds to nearest pound, see WR-01)
   - `formatGbpRound(Number.MAX_SAFE_INTEGER)` → `£90,071,992,547,410` — formatter is robust against the entire `number` range; bigint coalescence from the RPC keeps inputs well under this ceiling.

4. **Buyer-value import line is clean.** Line 25 in `src/app/(app)/reports/buyer-value/page.tsx`: `import { formatGbpRound } from '@/lib/format'`. Single-symbol import; no trailing comma, no dangling braces, no leftover `formatPence` reference (`grep` returns zero in the file). The fact that `formatPence` was the only symbol from this module in that file made the swap clean — verified.

5. **Module-level `Intl.NumberFormat` cache is correct.** `gbpRound` is constructed once on module load, reused on every call. This is the idiomatic pattern (`Intl.NumberFormat` construction is non-trivial) and matches the JSDoc on lines 20-21. No risk of mutation since `Intl.NumberFormat` instances are effectively immutable.

6. **Scope-lock verified.** `git diff 71c0b32..1e3f1e0 --name-only` would return exactly the three planned files (`src/app/(app)/candidates/page.tsx`, `src/app/(app)/reports/buyer-value/page.tsx`, `src/lib/format.ts`). The four `_components/*` files under `reports/buyer-value/` still use `formatPence` (confirmed by grep) — their two-decimal display is preserved. No untouched scope was modified.

7. **Commit hygiene is excellent.** Two atomic commits with verbatim spec messages. Each is one logical change. Bodies enumerate exactly what changed and what was deliberately NOT changed (e.g. "`formatPence` definition unchanged"). Reviewable in seconds.

8. **No new dependencies, no schema changes, no migrations.** Pure TS-only patch. RLS, multi-tenancy, AI-cost-logging surfaces are all untouched. No CLAUDE.md hard-rule risk.

9. **Negative pence rendering question:** `currentPipelineValuePence` is sourced from a SQL `bigint` produced by `coalesce(sum((j.salary_max * 100 * 0.20)::bigint), 0)`. `salary_max` is a non-negative GBP value (a salary). The aggregate can mathematically only be `>= 0`. There's no data path that produces a negative pipeline value today, so the `-£X` rendering question is moot in practice. If a future feature adds refunds/clawbacks to pipeline value, the `-£1,234` shape is correct en-GB locale rendering and matches `formatPence`'s pass-through philosophy. No guard needed.

---

_Reviewed: 2026-05-27_
_Reviewer: Claude Opus (gsd pre-UAT pipeline)_
_Depth: standard_
