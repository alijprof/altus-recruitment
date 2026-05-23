---
phase: 02-search-match-intake
plan: "02"
subsystem: api
tags: [anthropic, claude-sonnet, ai-summaries, inngest, match-scoring, cost-ceiling, typescript]

# Dependency graph
requires:
  - phase: 02-search-match-intake/02-00
    provides: "match.ts scoreCandidateForJob, ai-summaries.ts helpers, ai_summaries table + FK guard, runWithLogging exported"
  - phase: 02-search-match-intake/02-01
    provides: "halfvec embeddings on candidates + jobs, getTopCandidatesByVector, /jobs/[id]/matches page shell"
provides:
  - "precompute-matches-for-job Inngest function — Sonnet scores top-10 candidates per job on create/JD-change"
  - "explainCandidateMatchAction — on-demand Sonnet scoring with documented synchronous exception"
  - "cleanup-stale-summaries Inngest cron (Monday 04:00 BST)"
  - "/jobs/[id]/matches upgraded to MatchCard with score/strengths/gaps/screening questions"
  - "/settings/usage — per-org AI spend dashboard by purpose"
  - "getOrgMatchSpendThisMonth + per-org £100/month ceiling guard"
  - "ai_usage cost logging for match_score purpose"
affects: [03-linkedin-capture-spec-workflow-shortlists]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "precompute-matches-for-job fires from embed-job-on-jd-change via step.sendEvent (idempotent chaining)"
    - "Cache key: (candidate_embedding_version, job_embedding_version) — stale on any embedding bump"
    - "Cost-ceiling check in step 1 before any Sonnet calls"
    - "Synchronous Sonnet documented exception pattern: JSDoc with justification + follow-up tracker"
    - "formatErrorForSentry lifted to src/lib/observability/inngest.ts (shared across Inngest functions)"

key-files:
  created:
    - "src/lib/inngest/functions/precompute-matches-for-job.ts"
    - "src/lib/inngest/functions/cleanup-stale-summaries.ts"
    - "src/app/(app)/jobs/[id]/matches/match-card.tsx"
    - "src/app/(app)/jobs/[id]/matches/explain-button.tsx"
    - "src/app/(app)/jobs/[id]/matches/actions.ts"
    - "src/app/(app)/settings/usage/page.tsx"
    - "src/lib/observability/inngest.ts"
  modified:
    - "src/lib/inngest/functions/embed-job-on-jd-change.ts — step.sendEvent chain to rescore-after-embed"
    - "src/app/(app)/jobs/[id]/matches/page.tsx — upgraded from vector-only to MatchCard with cache"
    - "src/components/app/match-score-badge.tsx — score prop added (0-100 from Sonnet)"
    - "src/lib/db/ai-summaries.ts — getOrgMatchSpendThisMonth helper"
    - "src/lib/db/embeddings.ts — getCandidateEmbeddingVersion, getJobEmbeddingVersion"
    - "src/lib/ai/claude.ts — pricing verified + verified date comment updated"
    - "src/app/api/inngest/route.ts — precompute + cleanup registered"

key-decisions:
  - "D2-06: precompute fires via step.sendEvent inside embed-job-on-jd-change (not from createJobAction) — avoids embed-not-ready race"
  - "D2-07: cache key includes both candidate_embedding_version and job_embedding_version"
  - "Cost ceiling: £100/month default; Sentry warning (not throw) so recruiter still sees vector-only fallback"
  - "Synchronous Sonnet in explainCandidateMatchAction: documented exception with p95 > 8s migration tracker"
  - "H2 REVIEW fix: spend-ceiling guard added to explainCandidateMatchAction (was missing)"

patterns-established:
  - "Inngest chain: embed-job-on-jd-change → job/score-top-candidates event (step.sendEvent is idempotent)"
  - "Independent inner steps per candidate: Inngest retries each candidate score independently"
  - "Match score cache miss = on-demand ExplainButton; cache hit = full card immediately"

requirements-completed:
  - MATCH-01
  - MATCH-02
  - MATCH-03

# Metrics
duration: "unknown — backfilled"
completed: "2026-05-19"
---

# Phase 2 Plan 2: AI Match Scoring Summary

_Backfilled on 2026-05-23 from VERIFICATION/LEARNINGS/REVIEW + git log; some execution-time detail (exact durations, granular deviation list) is approximate._

**Sonnet-powered precomputed match scores (0-100, strengths, gaps, screening questions) with £100/month ceiling, cached in ai_summaries keyed on embedding versions, surfaced on /jobs/[id]/matches — ROADMAP success criterion #2 fully delivered**

## Performance

- **Duration:** unknown — backfilled
- **Started:** unknown
- **Completed:** 2026-05-19
- **Tasks:** 3
- **Files modified:** ~15

## Accomplishments
- precompute-matches-for-job fires automatically on job create and JD change; scores top-10 vector-similar candidates via Sonnet with independent per-candidate Inngest steps
- /jobs/[id]/matches upgraded from vector-only rows to full MatchCard with score badge, 2-3 strengths, 0-2 gaps, 3 screening questions, confidence indicator
- on-demand ExplainButton fills cache misses synchronously (documented exception to CLAUDE.md >2s rule)
- cleanup-stale-summaries weekly cron deletes ai_summaries rows where embedding_version has been bumped
- /settings/usage shows per-org month-to-date AI spend by purpose

## Task Commits

1. **Task 2.1: precompute-matches-for-job Inngest function + cost guard** — `64f03d3` (feat)
2. **Task 2.2: matches page upgrade + on-demand Explain action** — `f9c2b65` (feat)
3. **Task 2.3: cleanup-stale-summaries cron + /settings/usage + pricing reverification** — `65004c3` (feat)
4. **Task 2.3 follow-up: usage page + cleanup cron + pricing dates** — `672ac62` (feat)

## Files Created/Modified
- `src/lib/inngest/functions/precompute-matches-for-job.ts` — Sonnet top-10 precompute with ceiling guard
- `src/lib/inngest/functions/cleanup-stale-summaries.ts` — Monday 04:00 BST cron
- `src/app/(app)/jobs/[id]/matches/match-card.tsx` — full explanation card (score/strengths/gaps/questions)
- `src/app/(app)/jobs/[id]/matches/actions.ts` — explainCandidateMatchAction (synchronous Sonnet, documented exception)
- `src/app/(app)/settings/usage/page.tsx` — per-org AI spend dashboard
- `src/lib/observability/inngest.ts` — readStatus + formatErrorForSentry shared helpers
- `src/lib/db/ai-summaries.ts` — getOrgMatchSpendThisMonth
- `src/lib/ai/claude.ts` — Sonnet pricing verified + verified comment date updated

## Decisions Made
- Chain precompute via step.sendEvent inside embed-job-on-jd-change (not from createJobAction) — avoids race where job has no embedding yet
- Independent inner step.run per candidate so Inngest retries individual candidate scores on Anthropic transient errors
- explainCandidateMatchAction synchronous Sonnet call: documented exception in JSDoc per VERIFICATION W-1; follow-up tracker: migrate to Inngest send+poll if p95 > 8s

## Deviations from Plan
Backfilled summary — full deviation detail not recoverable. Known post-execution fixes from REVIEW:

**1. [Rule 1 - Bug] C1 cross-tenant match candidates (CRITICAL)**
- **Found during:** Code review (post-execution)
- **Issue:** precompute-matches-for-job called match_candidates_for_job under service-role; RPC was security invoker with no org filter; returned candidates from ALL orgs; Sonnet received foreign-tenant CV data
- **Fix:** Migration 20260519130000_match_candidates_for_job_org_filter.sql — added p_organization_id arg + WHERE c.organization_id = p_organization_id; caller-side guard also added (commit 1bc9556)
- **Files modified:** supabase/migrations/20260519130000_match_candidates_for_job_org_filter.sql, src/lib/inngest/functions/precompute-matches-for-job.ts

**2. [Rule 2 - Missing Critical] H2 spend ceiling on explainCandidateMatchAction**
- **Found during:** Code review
- **Issue:** explainCandidateMatchAction had no spend ceiling check; precompute had one, on-demand action did not
- **Fix:** getOrgMatchSpendThisMonth check added at start of action (commit a6d4126)
- **Files modified:** src/app/(app)/jobs/[id]/matches/actions.ts

---

**Total deviations:** At least 2 significant fixes applied post-execution (C1 critical, H2 high)
**Impact on plan:** C1 was a critical cross-tenant data exposure fixed before production use

## Issues Encountered
- ai_usage cost ledger was poisoned by C1 for history before the fix migration; historical rows are untrustworthy for exact cost attribution (documented in LEARNINGS)

## User Setup Required
- MAX_MONTHLY_MATCH_SPEND_PENCE env var (optional, defaults to 10000 = £100)

## Next Phase Readiness
- Match scoring cache operational; Plans 3/4 can rely on ai_summaries being populated
- Cost ceiling guards both precompute and on-demand paths
- /settings/usage gives recruiter visibility into spend

---
*Phase: 02-search-match-intake*
*Completed: 2026-05-19*
