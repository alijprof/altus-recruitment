---
phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with
plan: 07
subsystem: ui
tags: [nextjs, server-actions, inngest, react, sonner, match-scoring]

# Dependency graph
requires:
  - phase: 07 (earlier plans in this phase)
    provides: precompute-matches-for-job Inngest function, explainCandidateMatchAction, MatchCard
provides:
  - Self-refreshing Explain match (router.refresh() replaces "refresh to see" toast copy)
  - scoreAllMatchesAction — bulk trigger for job/score-top-candidates, entitlement-gated, tenant-checked
  - ScoreAllButton — bounded 90s auto-refresh poll after a bulk score kick-off, honest async messaging
affects: [jobs/matches, pipeline, candidate-matching]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded client poll (setInterval + hard-cap + cleared on unmount) for async server work the client can't directly observe completion of — same shape as cv-review-panel.tsx PendingState"
    - "router.refresh() paired with a server action's revalidatePath as the client-side half of cache invalidation"

key-files:
  created:
    - "src/app/(app)/jobs/[id]/matches/score-all-button.tsx"
  modified:
    - "src/app/(app)/jobs/[id]/matches/explain-button.tsx"
    - "src/app/(app)/jobs/[id]/matches/actions.ts"
    - "src/app/(app)/jobs/[id]/matches/page.tsx"

key-decisions:
  - "scoreAllMatchesAction does NOT duplicate the spend ceiling or AI cap check — precompute-matches-for-job owns both; the action only adds a fail-fast RLS-scoped getJob tenant check before spending an Inngest attempt"
  - "Score all button label stays static ('Score all') across pending/polling states — only the icon and disabled attribute change — to avoid accessible-name churn"
  - "Score all control is hidden when every visible match already has a fresh (non-stale) summary, computed from data already fetched in page.tsx (candidateVersions + summaryByCandidate + jobEmbeddingVersion), using the identical staleness comparison as MatchCard's isStale so the two can never disagree"

requirements-completed: [CLT-06]

# Metrics
duration: ~25min
completed: 2026-08-11
---

# Phase 7 Plan 07: Self-refreshing Explain + Score all Summary

**Explain match now upgrades the card in place via router.refresh() instead of a "refresh to see" toast, and a new entitlement-gated Score all control fires the existing precompute pipeline with a bounded 90s auto-refresh poll.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-11T13:40:00Z (approx.)
- **Completed:** 2026-08-11T14:05:06Z
- **Tasks:** 2 completed
- **Files modified:** 3 modified, 1 created

## Accomplishments
- `ExplainButton` calls `router.refresh()` on every success path (including the cache-hit refresh branch), so a scored card upgrades without the recruiter manually reloading. Toast copy no longer references refreshing.
- New `scoreAllMatchesAction` in `matches/actions.ts`: zod-validates the jobId, gates on `requireEntitledOrg` (same posture as Explain — this path drives Sonnet spend), resolves the org via the `current_organization_id` RPC, fail-fast RLS-scoped `getJob` tenant check, then `inngest.send`s the pre-existing `job/score-top-candidates` event — the fourth producer of that event, matching the plan's interfaces block exactly (no new Inngest function created).
- New `ScoreAllButton` client component: on click, calls the action; on success, shows an honest "scoring started" toast (never claims completion it can't observe) and starts a bounded `setInterval` → `router.refresh()` poll (3s interval, 90s hard cap, cleared on unmount) that mirrors `cv-review-panel.tsx`'s `PendingState` shape. On timeout, it stops polling and shows a quiet "may still be running — reload to see the rest" note instead of spinning forever.
- `matches/page.tsx` renders `<ScoreAllButton jobId={id} />` in the header row, only when `matches.length > 0` AND not every visible card already carries a fresh summary — derived from the `summaryByCandidate` map and `candidateVersions`/`jobEmbeddingVersion` already fetched for the page, using the same staleness comparison `MatchCard` uses for its own "Refreshing…" badge (no extra query, no drift risk between the two).

## Task Commits

Each task was committed atomically:

1. **Task 1: Self-refreshing Explain** — `21ac866` (feat)
2. **Task 2: Score all action and control** — `174d75a` (feat)
3. **Formatting follow-up on actions.ts** — `78716d8` (style, no behaviour change)

**Plan metadata:** committed separately below.

## Files Created/Modified
- `src/app/(app)/jobs/[id]/matches/explain-button.tsx` — added `router.refresh()` after a successful explain; toast copy simplified to "Match explained"
- `src/app/(app)/jobs/[id]/matches/actions.ts` — added `scoreAllMatchesAction` + `ScoreAllMatchesActionResult` type; ran a prettier formatting pass on the whole file (a few pre-existing lines had drifted from the project's Prettier config, now clean)
- `src/app/(app)/jobs/[id]/matches/score-all-button.tsx` (new) — bulk-score trigger with bounded 90s auto-refresh poll
- `src/app/(app)/jobs/[id]/matches/page.tsx` — imports and conditionally renders `<ScoreAllButton>`; adds `allCardsFresh`/`showScoreAll` derivation

## Decisions Made
- **Entitlement gate before the tenant check, tenant check before the Inngest send** — mirrors `explainCandidateMatchAction`'s exact ordering so the two actions on this page never diverge on error posture.
- **No spend-ceiling or AI-cap duplication in the new action** — `precompute-matches-for-job` already owns both guards; adding a second copy in the action layer would create a second place for the ceiling logic to drift, which the plan's interfaces block explicitly warned against.
- **Poll bound (90s / 3s interval)** chosen to comfortably cover the ~10-candidate sequential `step.run` loop in `precompute-matches-for-job` under normal Anthropic latency, while still giving up honestly rather than polling indefinitely (SF-5 precedent).
- **Button label stays static** ("Score all") through pending/polling rather than swapping text (as `ExplainButton` does for "Scoring…") — kept simple since the plan only required a stable accessible name and a disabled state during the transition; the spinner icon alone communicates "in progress."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Style] Prettier formatting drift on `matches/actions.ts` after Task 2's edit**
- **Found during:** Task 2 verification (`prettier --check`)
- **Issue:** A few pre-existing lines in the file (an import statement, two union-type declarations, one ternary) were not in the project's Prettier style (multi-line where the 100-char printWidth allows one line). Editing the same file for Task 2 surfaced this as a `prettier --check` failure.
- **Fix:** Ran `prettier --write` on the file. No behavioural change — purely reformatting.
- **Files modified:** `src/app/(app)/jobs/[id]/matches/actions.ts`
- **Verification:** `prettier --check` clean, `tsc --noEmit` still passes, `pnpm lint` still 0 errors.
- **Committed in:** `78716d8`

---

**Total deviations:** 1 auto-fixed (1 style/formatting)
**Impact on plan:** No scope creep — pure formatting cleanup on a file this plan already modifies.

## Issues Encountered

- **`pnpm build` fails locally on missing runtime env vars** (`SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and — once those are stubbed — `OPENAI_API_KEY`, needed by an unrelated OpenAI client module evaluated during Next.js page-data collection for `/api/inngest`). This is a documented, pre-existing environment limitation of this sandbox (see project memory: "Vercel build is the real build gate since local `pnpm build` fails on env validation" — `.claude/.../vercel-project-ids.md`), not something this plan introduced. Verified the limitation is not caused by these changes: with dummy placeholder values injected for the Supabase/Inngest/Anthropic vars, the build got past `Compiled successfully` and `Finished TypeScript` (both clean) and only failed later at the OpenAI-client env check for a route this plan never touches. `pnpm typecheck`, `pnpm lint`, and `pnpm vitest run` (780 passed, 0 new failures) all ran clean against the real toolchain and are the load-bearing local gates here; the founder's existing Vercel preview-deploy workflow is the authoritative build gate per project memory.
- **One unrelated pre-existing hit for `grep -rn "refresh to see" "src/app/(app)/"`** — `src/app/(app)/_dashboard/welcome-checklist.tsx:111` is a code *comment* ("informs the user to refresh to see the new data"), predating this plan (commit `0da3fc4`, Phase 5), in a file outside this plan's `files_modified`. Confirmed no user-facing "refresh to see" copy remains anywhere, and specifically `grep -rn "refresh to see" "src/app/(app)/jobs/[id]/matches/"` returns nothing. Left untouched per the SCOPE BOUNDARY rule (pre-existing, unrelated file); not fixed, not blocking.

## User Setup Required

None — no external service configuration required. No new dependencies, no new Inngest function, no migration.

## Next Phase Readiness

- `precompute-matches-for-job` now has a fourth, recruiter-initiated producer of `job/score-top-candidates`; its existing `concurrency: { limit: 2, key: organization_id }` and per-candidate cache-lookup already tolerate this (verified in the plan's interfaces block, no code change needed there).
- Match-scoring freshness (D-04) is now complete on both halves: Explain self-refreshes, and Score all offers bulk catch-up. No auto-rescore loop was added beyond what the plan called for.
- No blockers for subsequent Phase 7 plans.

---
*Phase: 07-cv-lifecycle-trust-make-stored-cvs-visible-downloadable-with*
*Completed: 2026-08-11*

## Self-Check: PASSED

All created/modified files verified present:
- FOUND: `src/app/(app)/jobs/[id]/matches/score-all-button.tsx`
- FOUND: `src/app/(app)/jobs/[id]/matches/explain-button.tsx`
- FOUND: `src/app/(app)/jobs/[id]/matches/actions.ts`
- FOUND: `src/app/(app)/jobs/[id]/matches/page.tsx`

All commit hashes verified in git log:
- FOUND: `21ac866` (Task 1)
- FOUND: `174d75a` (Task 2)
- FOUND: `78716d8` (formatting follow-up)
