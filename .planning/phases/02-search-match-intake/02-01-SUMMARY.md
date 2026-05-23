---
phase: 02-search-match-intake
plan: "01"
subsystem: api
tags: [voyage-ai, semantic-search, inngest, pgvector, rrf, nextjs, typescript]

# Dependency graph
requires:
  - phase: 02-search-match-intake/02-00
    provides: "voyage.ts, embed-text.ts, match_candidates RPC, embeddings.ts helpers, invalidation triggers"
  - phase: 01-internal-ats
    provides: "parse-cv Inngest function, candidates/jobs tables, candidate detail page"
provides:
  - "/search page — hybrid semantic+trigram search with natural language queries"
  - "Voyage embeddings on candidates and jobs (reactive on CV parse, scheduled sweep, on job create/edit)"
  - "embed-candidates-batch Inngest function (10-min cron sweep)"
  - "embed-job-on-jd-change Inngest function (event-driven on job/embed)"
  - "/jobs/[id]/matches — vector-only top-10 list (Plan 2 layers Sonnet explanations)"
  - "/settings/integrations — backfill UI + HNSW build signal"
  - "MatchScoreBadge component (cosine/trigram/rrf score display)"
  - "bootstrap-vector-index Inngest function (state-writer, not DDL executor)"
affects: [02-02-ai-match-scoring, 03-linkedin-capture-spec-workflow-shortlists]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Embed on CV parse: Step 5 added to parseCVOnUpload — reactive embed is highest-leverage moment"
    - "Scheduled cron embed sweep (embed-candidates-batch, embed-jobs-batch) covers historical data"
    - "getTopCandidatesByVector uses empty-string query_text to degenerate to pure vector ranking"
    - "ViewToggle as Server Component (URL params as props) — avoids Next.js 16 useSearchParams Suspense constraint"

key-files:
  created:
    - "src/lib/inngest/functions/embed-candidates-batch.ts (+ embed-jobs-batch)"
    - "src/lib/inngest/functions/embed-job-on-jd-change.ts"
    - "src/lib/inngest/functions/bootstrap-vector-index.ts"
    - "src/app/(app)/search/page.tsx"
    - "src/app/(app)/search/search-input.tsx"
    - "src/app/(app)/search/search-results.tsx"
    - "src/components/app/match-score-badge.tsx"
    - "src/app/(app)/jobs/[id]/matches/page.tsx"
    - "src/app/(app)/jobs/[id]/matches/match-row.tsx"
    - "src/app/(app)/settings/integrations/page.tsx"
    - "src/app/(app)/settings/integrations/actions.ts"
    - "docs/hnsw-build-runbook.md"
  modified:
    - "src/lib/inngest/functions/parse-cv.ts — Step 5: embed-candidate added"
    - "src/lib/db/candidates.ts — bumpCandidateEmbedding, getCandidateForEmbedding, listCandidatesByIds, listCandidates semantic mode"
    - "src/lib/db/jobs.ts — bumpJobEmbedding"
    - "src/lib/db/embeddings.ts — countCandidatesWithoutEmbedding"
    - "src/app/api/inngest/route.ts — registered embed functions + bootstrap"
    - "src/components/app/top-nav.tsx — Search link added"
    - "src/types/database.ts — regen after match_candidates_for_job RPC migration"

key-decisions:
  - "D2-04: getTopCandidatesByVector passes empty query_text so trigram CTE returns 0 rows; pure vector ranking via semantic CTE (degenerate path)"
  - "D2-05: bootstrap-vector-index writes hnsw_build_state.last_attempt_at + Sentry breadcrumb only; CREATE INDEX CONCURRENTLY is manual-DDL per docs/hnsw-build-runbook.md"
  - "ViewToggle made a Server Component (URL params as props) to avoid Next.js 16 useSearchParams Suspense requirement (LEARNINGS §3)"
  - "embed-candidates-batch and embed-jobs-batch merged into embed-batch.ts (one function, two queries) to reduce Inngest function count"

patterns-established:
  - "Inngest step naming: embed-org-${org_id} for per-org batch steps (resume-safe on partial failure)"
  - "Tenant boundary check before any step.run in service-role Inngest functions"
  - "Voyage purpose literals: candidate_embed / job_embed / search_query_embed"

requirements-completed:
  - SEARCH-01
  - SEARCH-02
  - SEARCH-03
  - SEARCH-04

# Metrics
duration: "unknown — backfilled"
completed: "2026-05-19"
---

# Phase 2 Plan 1: Semantic Search Summary

_Backfilled on 2026-05-23 from VERIFICATION/LEARNINGS/REVIEW + git log; some execution-time detail (exact durations, granular deviation list) is approximate._

**Voyage voyage-3 embeddings on all candidates and jobs, /search page with hybrid RRF semantic+trigram ranking, and /jobs/[id]/matches vector-only top-10 — ROADMAP success criterion #1 fully delivered**

## Performance

- **Duration:** unknown — backfilled
- **Started:** unknown
- **Completed:** 2026-05-19
- **Tasks:** 3
- **Files modified:** ~20

## Accomplishments
- Every new CV parse now triggers a Voyage embed in Step 5 of parseCVOnUpload; 10-min scheduled sweep covers historical candidates; job/embed event fires on create/update
- /search page delivers natural-language candidate search ("senior Python developer with offshore wind experience in Aberdeen") via match_candidates RPC with RRF k=60 fusion, cosine/trigram/RRF score badges
- /jobs/[id]/matches shows vector-only top-10 candidates (Plan 2 adds Sonnet explanations)
- ViewToggle bug fixed during Phase 2: made a Server Component to avoid Next.js 16 Suspense constraint on useSearchParams

## Task Commits

1. **Task 1.1: Embed Inngest chain + Voyage call sites** — `6617e48` (feat)
2. **Task 1.2: /search RSC + semantic mode on listCandidates + score badges** — `f835611` (feat)
3. **Task 1.3: job matches + backfill UI + bootstrap-vector-index** — `3dbe141` (feat)
4. **Type regen (match_candidates_for_job RPC)** — `02e196b` (chore)

## Files Created/Modified
- `src/lib/inngest/functions/parse-cv.ts` — Step 5 embed-candidate added
- `src/lib/inngest/functions/embed-batch.ts` — 10-min cron sweep for candidates + jobs
- `src/lib/inngest/functions/embed-job-on-jd-change.ts` — job/embed event handler
- `src/lib/inngest/functions/bootstrap-vector-index.ts` — HNSW state-writer (no DDL)
- `src/app/(app)/search/page.tsx` — hybrid search RSC with semantic/trigram toggle
- `src/app/(app)/search/search-input.tsx` — debounced input (exact CONTEXT placeholder text)
- `src/components/app/match-score-badge.tsx` — cosine/trigram/rrf display badge
- `src/app/(app)/jobs/[id]/matches/page.tsx` — vector-only top-10 (upgraded in Plan 2)
- `src/app/(app)/settings/integrations/page.tsx` — backfill + HNSW sections
- `src/lib/db/candidates.ts` — bumpCandidateEmbedding, getCandidateForEmbedding, semantic branch in listCandidates
- `src/lib/db/jobs.ts` — bumpJobEmbedding
- `src/components/app/top-nav.tsx` — Search nav link

## Decisions Made
- getTopCandidatesByVector uses match_candidates RPC with empty query_text: trigram CTE returns 0 rows, semantic CTE provides pure vector ranking (verified in VERIFICATION §6)
- bootstrap-vector-index deliberately does NOT run DDL; signals operator via Sentry breadcrumb; manual DDL in docs/hnsw-build-runbook.md
- ViewToggle: Server Component receiving search params as props avoids Next.js 16 Suspense constraint (commit 0df09c5 from LEARNINGS)

## Deviations from Plan
Backfilled summary — full deviation detail not recoverable. Known deviations from LEARNINGS:

**1. [Rule 1 - Bug] Next.js 16 useSearchParams Suspense**
- **Found during:** Task 1.2
- **Issue:** ViewToggle as Client Component crashed /candidates and /clients in production (Next.js 16 hard-enforces Suspense boundary around useSearchParams; pnpm build passed but production runtime crashed)
- **Fix:** Made ViewToggle a Server Component receiving URL params as props (commit 0df09c5)
- **Files modified:** src/components/app/view-toggle.tsx

## Issues Encountered
- Type regen required after match_candidates_for_job RPC migration was added (separate commit 02e196b)

## User Setup Required
- VOYAGE_API_KEY must be set for embed functions to run
- Vercel env vars for INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY must have Production scope selected (LEARNINGS §5 — Vercel defaults to Preview+Dev only)

## Next Phase Readiness
- All candidates and jobs have halfvec(1024) embeddings; Plan 2 can call precompute-matches-for-job immediately
- /jobs/[id]/matches exists as the surface Plan 2 upgrades with Sonnet explanations
- ai_usage records every search query embed and candidate/job embed

---
*Phase: 02-search-match-intake*
*Completed: 2026-05-19*
