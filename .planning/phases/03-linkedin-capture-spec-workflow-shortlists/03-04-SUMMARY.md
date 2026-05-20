---
phase: 03-linkedin-capture-spec-workflow-shortlists
plan: 03-04-job-ads-inclusivity
subsystem: ai-feature
tags:
  - sonnet
  - inclusivity
  - job-ads
  - server-actions
  - rls
  - tdd

requires:
  - phase: 03-00 (Plan 0 hardening)
    provides: ai-inclusivity.test placeholder + Sentry tag conventions
  - phase: 03-02 (spec workflow)
    provides: (soft) jobs may originate from approved spec drafts; no code coupling

provides:
  - "New `job_ads` table — id, organization_id, job_id, body_markdown, inclusivity_score 0-100, inclusivity_dimensions/suggestions jsonb, model, cost_pence + RLS + _set_org / _verify_same_org_check triggers (D3-12 / D3-33)"
  - "Sonnet 4.6 wrapper `src/lib/ai/ad-generate.ts` with two functions: generateAdWithInclusivity (ad + score in one call, D3-13) and scoreInclusivityOnly (pasted-ad path, D3-14)"
  - "Vendored Kat Matfield Gender Decoder lexicon at `src/lib/ai/inclusivity-lexicon.ts` (D3-15)"
  - "Three server actions: generateAdAction (synchronous, Sentry-spanned), scoreInclusivityAction (ephemeral D3-31), saveJobAdAction (persists per D3-33)"
  - "Job-detail UI: <Sheet>-mounted AdPanel with Generate + Score-existing tabs; SavedAdsList renders newest-first"

affects: [03-05 dormant-clients-outreach plan can reuse the AI cost-span pattern]

tech-stack:
  added:
    - "Inclusivity rubric prompt + Gender Decoder seed lexicon (vendored)"
  patterns:
    - "Sentry.startSpan around any synchronous Sonnet server action (D3-25 measurability for the 5s p95 escape hatch)"
    - "Pasted-AI ephemeral scoring: scorer never persists by default; recruiter opts in via a separate save action"
    - "Multi-variant table (no dedup) for AI outputs that recruiters iterate on — D3-33"

key-files:
  created:
    - "supabase/migrations/20260520020702_phase3_job_ads.sql"
    - "src/lib/ai/inclusivity-lexicon.ts"
    - "src/lib/ai/ad-generate.ts"
    - "src/lib/ai/ad-generate.test.ts"
    - "src/lib/db/job-ads.ts"
    - "src/lib/db/job-ads.test.ts"
    - "src/app/(app)/jobs/[id]/ad-panel/actions.ts"
    - "src/app/(app)/jobs/[id]/ad-panel/ad-panel.tsx"
    - "src/app/(app)/jobs/[id]/ad-panel/ad-panel-trigger.tsx"
    - "src/app/(app)/jobs/[id]/ad-panel/saved-ads-list.tsx"
  modified:
    - "src/app/(app)/jobs/[id]/page.tsx (mount AdPanelTrigger + SavedAdsList)"
  deleted:
    - "src/lib/ai/ad-inclusivity.test.ts (Plan 0 placeholder, replaced by ad-generate.test.ts)"

key-decisions:
  - "D3-13 implemented: single Sonnet call returns ad + inclusivity score together via tool_use generate_inclusive_job_ad"
  - "D3-14 implemented: pasted-ad path uses a separate tool (score_ad_inclusivity) and a different ai_usage purpose for spend-bucket separation"
  - "D3-15 rubric weights baked into the system prompt: gender 25 / age 20 / jargon 20 / accessibility 15 / salary_transparency 20"
  - "D3-25 measurability: Sentry.startSpan('ad-generate', op:'ai.sonnet') wraps both Sonnet server actions so p95 is visible from day one; lift-to-Inngest escape hatch documented"
  - "D3-33 implemented: createJobAd inserts a new row every time — no upsert / dedup. Recruiter keeps full variant history."
  - "Plan referenced jobs columns must_haves/nice_to_haves/culture_notes which DO NOT exist in the current `jobs` schema; wrapper accepts them as optional inputs for future spec-draft→job hydration but currently only title/description/location/job_type/salary_*/currency flow from getJob() to the prompt"
  - "Inclusivity-lexicon stems matched as PREFIXES (e.g. 'aggress' covers 'aggressive', 'aggressor') — Sonnet instructed in the system prompt"

patterns-established:
  - "AI wrapper file template: sibling to claude.ts; imports runWithLogging; defines its own Anthropic.Tool; preserves the one-`new Anthropic` grep invariant"
  - "Cost-pence return from the wrapper duplicates the canonical ai_usage truth so feature tables (job_ads.cost_pence) match without an extra round-trip"
  - "Three-action shape for a synchronous AI feature: produce / score / save — clean separation between AI compute and persistence"

requirements-completed:
  - AD-01

duration: 15min
completed: 2026-05-20
---

# Phase 03 Plan 04: Job ads + inclusivity score Summary

**Recruiters can generate an inclusive job ad and inclusivity score (0-100) in ~3 seconds from any job detail page, with copy-to-clipboard, save-to-history, and a separate "score an existing ad" path that never persists by default.**

## Performance

- **Duration:** ~15 min wall-clock (TDD RED→GREEN→UI in three commits after Task D.1)
- **Started:** 2026-05-20T02:07:02Z
- **Completed:** 2026-05-20T02:17:52Z
- **Tasks:** 3 (D.1 migration+lexicon, D.2 wrapper+helpers+actions, D.3 UI)
- **Files created:** 10 (+1 modified, -1 deleted placeholder)

## Accomplishments

### Task D.1 — Migration + Gender Decoder lexicon

- `supabase/migrations/20260520020702_phase3_job_ads.sql` creates the table with: id / organization_id / job_id (FK CASCADE) / created_by (FK SET NULL) / body_markdown / inclusivity_score (smallint, CHECK 0-100) / inclusivity_suggestions jsonb / inclusivity_dimensions jsonb / model / cost_pence + four tenant RLS policies + `job_ads_set_org` (s) and `job_ads_verify_same_org_check` (v) triggers ordered alphabetically per Phase 1 commit `3f748f8`.
- Header comment cites the trigger-ordering bug-class + four manual smoke tests (same-org insert, cross-tenant insert, ordering query, CHECK violation).
- `src/lib/ai/inclusivity-lexicon.ts` vendors Kat Matfield's Gender Decoder masculine/feminine word stems (public domain) with attribution + rationale + match-as-prefix instruction for the Sonnet rubric.

### Task D.2 — Sonnet wrapper + DB helpers + server actions (TDD)

**RED:** wrote `src/lib/ai/ad-generate.test.ts` (replacing Plan 0 placeholder) and `src/lib/db/job-ads.test.ts` first — 13 failing specs covering tool schema, purpose strings, system-prompt anchors, calibration bands, organization_id trigger contract, Sentry tag shape.

**GREEN:**
- `src/lib/ai/ad-generate.ts` exports `generateAdWithInclusivity` (purpose=`ad_generate`, tool=`generate_inclusive_job_ad`) and `scoreInclusivityOnly` (purpose=`ad_inclusivity_score`, tool=`score_ad_inclusivity`). System prompt encodes the D3-15 rubric (gender 25 / age 20 / jargon 20 / accessibility 15 / salary_transparency 20) and seeds the Gender Decoder lexicon. Triple-quote-fenced prompt-injection guard. Imports `runWithLogging` from `@/lib/ai/claude` — the `grep -rn 'new Anthropic' src/` invariant still returns ONE line.
- `src/lib/db/job-ads.ts` exports `createJobAd` + `listJobAdsForJob`. Cast pattern per `ai-summaries.ts` (job_ads not yet in regenerated Database types). The insert payload MUST NOT include `organization_id` — the trigger fills it.
- `src/app/(app)/jobs/[id]/ad-panel/actions.ts` exports three actions: `generateAdAction({ jobId })` (synchronous, Sentry.startSpan-wrapped), `scoreInclusivityAction({ adText, jobId? })` (ephemeral by default), `saveJobAdAction({ jobId, ...result })` (per D3-33 no dedup). All capture err.name + status only (R4 — never raw error which can echo prompt fragments).

### Task D.3 — Side panel UI + saved-ads list

- `ad-panel.tsx` Client Component: two tabs. Generate calls `generateAdAction`, renders markdown, score pill (color-coded by band), per-dimension table with flagged phrases + rationales, suggestions list, copy-to-clipboard + save CTAs. Score-existing pastes ad text, calls `scoreInclusivityAction`, shows score + suggestions, optional Save (the only persistence path for the pasted variant).
- `ad-panel-trigger.tsx` Client Component: pairs the "Generate ad" button with the `<Sheet>` so the parent page can stay an RSC.
- `saved-ads-list.tsx` RSC: newest-first; score pill, model + cost, created_at, body preview (240-char trunc).
- `page.tsx`: mounts `<AdPanelTrigger>` in the header button row + `<SavedAdsList ads={await listJobAdsForJob(...)}>` below applications.

## Verification

- `pnpm typecheck` → clean
- `pnpm test -- --run src/lib/ai/ad-generate.test.ts src/lib/db/job-ads.test.ts` → 154 passed, 48 todo, 0 failed (full suite)
- `pnpm exec eslint` on all created files → clean
- `grep -rn "new Anthropic" src/` → ONE line (claude.ts:16) — invariant preserved
- Migration not yet applied to a fresh DB; smoke tests embedded in header for the local apply step.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-table | `supabase/migrations/20260520020702_phase3_job_ads.sql` | New tenant-scoped table; RLS + `_set_org` + `_verify_same_org_check` (alphabetical) match the Phase 1 hardened pattern. `body_markdown` and `inclusivity_*` columns store recruiter-side AI output (not PII), but `created_by` links to `users` and an unintended INSERT path leaking another tenant's job_id would be caught by `assert_same_org('public.jobs', new.job_id, new.organization_id)`. |
| threat_flag: synchronous-ai-call | `src/app/(app)/jobs/[id]/ad-panel/actions.ts` | Two server actions call Sonnet inline (~3s). Wrapped in `Sentry.startSpan` so p95 is measurable. CLAUDE.md "never >2s synchronous AI" — acceptable per D3-25 because UX is recruiter-in-the-loop at the keyboard; escape hatch to Inngest documented in plan risks. |

## TDD Gate Compliance

- RED commits: `8dee353` (placeholder deletion) + `8ed17e0` (test files) — both prefix `test(03-04):`
- GREEN commit: `8c07e2b` — prefix `feat(03-04):` — implements both `ad-generate.ts` + `job-ads.ts` to satisfy the failing specs
- UI follow-up: `117422c` (Task D.3) — pure additive UI; no behaviour change to the AI / DB layer.

## Deferred / not-in-scope

- Soft 5-generations-per-job-per-day cap (RESEARCH §"Cost drivers to watch") — flagged in plan risks for post-rollout follow-up if observed in practice. NOT implemented.
- Playwright stub `tests/e2e/job-ad-generation.spec.ts` — deferred to Phase 3 verification step.
- `pnpm db:reset --local` smoke test — not run from this executor (no local Docker / Supabase stack); migration smoke tests embedded as psql snippets in the header for the human applier.
- Generated Database types regen (`pnpm db:types`) — deferred to the orchestrator's post-merge sweep so multiple parallel-wave migrations regen together.

## Deviations from Plan

### [Rule 1 - Schema mismatch] Plan referenced non-existent jobs columns

- **Found during:** Task D.2 server action implementation
- **Issue:** Plan body cites `jobs.must_haves`, `jobs.nice_to_haves`, `jobs.culture_notes`, and `jobs.salary_range_min/max` — none of these exist in the current Phase 1 `jobs` schema. The actual columns are `salary_min`, `salary_max`, `currency`, plus `description` (long-form JD text), `location`, `job_type`.
- **Fix:** `JobAdSummary` type in `ad-generate.ts` accepts `must_haves` / `nice_to_haves` / `culture_notes` as optional readonly arrays so the wrapper is forward-compatible when spec-draft→job hydration eventually persists them, but the `generateAdAction` server action only threads the columns that currently exist. The description column carries the JD text as a single body.
- **Files modified:** `src/lib/ai/ad-generate.ts`, `src/app/(app)/jobs/[id]/ad-panel/actions.ts`
- **Commit:** `8c07e2b`

### [Rule 1 - Schema shape] Plan spec said `inclusivity_suggestions text[]`

- **Found during:** Task D.1 migration drafting
- **Issue:** PATTERNS §3 says `inclusivity_suggestions text[]`, but the plan body specifies a structured `{ original, improved, reason }` shape returned by Sonnet. text[] cannot hold structured triples without lossy serialization.
- **Fix:** Migration uses `inclusivity_suggestions jsonb` (matches the tool schema returned by Sonnet); also added `inclusivity_dimensions jsonb` for the per-dimension breakdown.
- **Files modified:** `supabase/migrations/20260520020702_phase3_job_ads.sql`
- **Commit:** `f4a1f89`

### [Rule 2 - Trigger completeness] Added `set_updated_at` trigger

- **Found during:** Task D.1
- **Issue:** Plan body's Detail block lists `job_ads_set_org` and `job_ads_verify_same_org_check` but omits `job_ads_set_updated_at`. Every domain table in the project has an `updated_at` column auto-bumped by a trigger (project convention).
- **Fix:** Added `job_ads_set_updated_at` to match the convention (and to keep the column non-stale).
- **Files modified:** `supabase/migrations/20260520020702_phase3_job_ads.sql`
- **Commit:** `f4a1f89`

### [Rule 3 - Commit sequencing] Two RED commits instead of one

- **Found during:** Task D.2 RED commit
- **Issue:** First `git add` invocation included `ad-inclusivity.test.ts` (the deleted placeholder) and the staged delete went through but the `git add` of the two new test files silently failed at the same pathspec — resulting in a deletion-only commit (`8dee353`). Test files were left untracked.
- **Fix:** Made a second commit (`8ed17e0`) cleanly adding the two test files. Both commits are tagged `test(03-04):` and the GREEN commit (`8c07e2b`) references the test commits — TDD gate sequence is fully visible in `git log`.
- **Files modified:** none (commit-sequencing only)
- **Commits:** `8dee353`, `8ed17e0`

## Authentication gates

None — no human-in-the-loop secrets / OAuth flow required for this plan.

## Self-Check: PASSED

Manual verification:
- All 10 created files exist on disk (`ls` confirmed).
- All 5 commits exist in `git log --oneline a39d7aa..HEAD`.
- One-Anthropic-instance grep invariant holds (1 line in claude.ts).
- Typecheck + lint + 154-test suite all green.
