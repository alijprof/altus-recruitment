# Plan 1: Semantic Search

**Phase:** 2 — Search, Match & Intake
**Plan:** 1 of 4 (semantic-search)
**Depends on:** Plan 0 (`src/lib/ai/voyage.ts`, `src/lib/ai/embed-text.ts`, `src/lib/db/embeddings.ts`, `match_candidates` + `match_jobs` RPCs, `invalidate_embeddings_triggers`, `(public)` layout, regenerated `database.ts`, Phase 2 env vars)
**Requirements covered:** SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04 (the SEARCH-04 "auto-suggest top candidates on a new job" half of the success criterion; the AI-explained version is finished by Plan 2)
**Success criterion satisfied:** ROADMAP #1 — "Recruiter can type 'senior Python engineer with offshore wind experience in Aberdeen' into search and receive ranked candidates ordered by semantic similarity — no keyword matching required"
**Mode:** mvp — vertical slice (Inngest embed on CV-parse → `/search` page wired to hybrid RPC → backfill helper for existing candidates — recruiter can perform a natural-language search end-to-end after this plan ships)

## Goal

After this plan, every candidate and job carries a Voyage `voyage-3` embedding in `halfvec(1024)`; new CV parses trigger an embed automatically; new/edited jobs trigger an embed automatically; an existing-data backfill is one click away in `/settings/integrations`; and `/search` is a working RSC page where a recruiter types natural language ("senior Python developer with offshore wind experience in Aberdeen") and receives ranked candidates with cosine + trigram + RRF scores visible. The existing `/candidates?q=...` page also gains a `mode=semantic|trigram` toggle (defaulting to semantic) so recruiters can fall back if they want raw keyword. SEARCH-04's "new job auto-suggests top candidates" lands as a vector-only ranked list on `/jobs/[id]/matches` (Plan 2 layers Sonnet explanations on top).

## Phase Goal (MVP user story)

**As a** recruiter at the anchor agency, **I want to** type a natural-language description of a role into a single search box and immediately see ranked candidates from across our database — **so that** I can answer "who fits this brief?" in seconds without remembering specific keywords or skill tags.

## Required reading for executor

- `.planning/phases/02-search-match-intake/02-CONTEXT.md` — decisions **D2-01 (hybrid embedding input), D2-02 (Voyage wrapper), D2-03 (re-embed only on material change), D2-04 (RRF k=60), D2-05 (HNSW deferred), D2-20 (FK-guard naming, already in Plan 0), D2-22 (`ai_usage` purpose values)**
- `.planning/phases/02-search-match-intake/02-RESEARCH.md` — **§A.1 (Voyage embed shape — wrapper already exists from Plan 0; this plan CONSUMES it), §A.2 (what to embed), §A.3 (pgvector ops; halfvec; index timing), §A.4 (RPC — already exists), §A.5 (invalidation triggers — exist; reactive embed on parse + scheduled sweep), §A.6 (search UX + extending `listCandidates`), §E.26 (Inngest function table — first 4 rows of the new functions)**
- `.planning/phases/02-search-match-intake/02-PATTERNS.md` — every "Inngest functions" row, the `src/app/(app)/search/...` rows, and the `listCandidates` extension row
- `.planning/phases/02-search-match-intake/02-00-hardening-PLAN.md` — Plan 0 SUMMARY/details for what's already in place
- `.planning/phases/01-internal-ats/01-LEARNINGS.md` — **"Single Claude wrapper with mandatory cost logging" + "Service-role usage ONLY in Inngest functions with explicit tenant boundary check"** patterns
- `CLAUDE.md` — Voyage non-negotiable cost logging, Inngest for >2s AI calls, no PII in Sentry
- `src/lib/inngest/functions/parse-cv.ts` — canonical Inngest pattern this plan extends in Task 1.1 (add Step 5: embed)
- `src/lib/ai/voyage.ts` (Plan 0) — the `embed()` function this plan calls
- `src/lib/ai/embed-text.ts` (Plan 0) — `candidateEmbeddingText` and `jobEmbeddingText`
- `src/lib/db/embeddings.ts` (Plan 0) — `hybridSearchCandidates`, `hybridSearchJobs`, `getTopCandidatesByVector`
- `src/lib/db/candidates.ts` lines 80–155 — the existing `listCandidates` trigram branch we will extend with `mode=semantic`
- `src/app/(app)/candidates/page.tsx` + `src/app/(app)/candidates/search-input.tsx` + `src/app/(app)/candidates/candidate-table.tsx` — canonical RSC list shape this plan mirrors for `/search`
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` lines 199–246 (candidates table) and lines 263–293 (jobs table) — confirm `candidate_embedding halfvec(1024)`, `embedding_version`, `embedded_at` columns
- `supabase/migrations/<ts>_match_candidates_rpc.sql` and `<ts2>_match_jobs_rpc.sql` (Plan 0) — the RPCs being called

## Tasks

### Task 1.1: Embed on CV-parse complete (reactive) + Inngest scheduled sweep + job-embed Inngest function

**Files:**
- modify `src/lib/inngest/functions/parse-cv.ts` (add Step 5: embed-candidate)
- create `src/lib/inngest/functions/embed-candidates-batch.ts` (scheduled sweep every 10 min)
- create `src/lib/inngest/functions/embed-job-on-jd-change.ts` (event-driven)
- modify `src/app/api/inngest/route.ts` (register the two new functions)
- modify `src/lib/db/candidates.ts` (add `bumpCandidateEmbedding` helper used by both Inngest paths)
- modify `src/lib/db/jobs.ts` (add `bumpJobEmbedding` helper)
- modify `src/lib/db/jobs.ts` (extend create/update mutations to fire `job/embed` Inngest event — see implementation note below)
- modify `src/app/(app)/clients/[id]/jobs/new/actions.ts` (call `inngest.send('job/embed', ...)` after a successful job create)
- modify `src/app/(app)/jobs/[id]/actions.ts` (call `inngest.send('job/embed', ...)` after a successful job description/material update)

**Pattern to copy:** `src/lib/inngest/functions/parse-cv.ts` — the entire 4-step pattern including `NonRetriableError` boundary check + `readStatus(err)` Sentry-safe helper + `Sentry.captureException(new Error(name + ': ' + status))` PII-safe error capture. RESEARCH §A.5 lines 380–404 + §E.26 row for `embed-candidate` and `embed-job` and `embed-candidates-batch`. PATTERNS.md "Inngest function shape" cheat-sheet.

**Implementation:**

1. **`parse-cv.ts` Step 5 — reactive embed.** Add a new `step.run('embed-candidate', async () => { ... })` AFTER the existing `write-extracted` step (lines 226–260 of the file). Inside:
   - Read the freshly-written candidate row + the latest CV's extracted text via the existing service-role client. (Re-use the variables from earlier steps; do not re-fetch the candidate by `from('candidates')` outside the helper — call a new `getCandidateForEmbedding(supabase, candidate_id)` we add to `src/lib/db/candidates.ts` that selects exactly the columns `embed-text.ts` needs.)
   - Build the embedding input via `candidateEmbeddingText(candidateRow, parsed_cv_text)`. If both the structured summary and CV text would render to an empty string (impossible for parsed CVs but defensive), skip the embed and return early.
   - Call `await embed({ organizationId: organization_id, userId: user_id, purpose: 'candidate_embed', inputType: 'document', inputs: [embeddingText] })`. The wrapper writes `ai_usage` automatically.
   - Persist via `bumpCandidateEmbedding(supabase, { candidateId: candidate_id, embedding: vectors[0], embeddingVersion: (currentVersion ?? 0) + 1 })` — the helper writes `candidate_embedding`, increments `embedding_version`, sets `embedded_at = now()`, all in one update.
   - **Critical:** ensure this step's body is wrapped by the existing outer try/catch (lines 165–285). On embed failure, the candidate's parse still committed — that's the desired behaviour. We don't want to NULL out the parse just because the embed step transiently failed; the scheduled sweep (next step) will pick up the candidate on its next run.
   - The reactive path is the HIGHEST-LEVERAGE embed moment (CV freshly parsed, candidate fields populated). Do NOT remove the Phase 1 retry semantics — the embed step inherits them.

2. **`embed-candidates-batch.ts`** — scheduled Inngest function:
   - `id: 'embed-candidates-batch'`
   - `triggers: [{ cron: 'TZ=Europe/London */10 * * * *' }]` (every 10 min)
   - `concurrency: { limit: 1 }` — single global runner; no per-org concurrency key (cron events have no org payload).
   - `retries: 1` — sweep failures recover on the next run; no need for aggressive retry.
   - Body: SELECT `id, organization_id` FROM `candidates` WHERE `candidate_embedding is null` AND `embedded_at is null` LIMIT 256. Group rows by `organization_id`. For EACH org bucket, take up to 128 candidates (Voyage's per-call max), fetch their embed inputs (structured + latest CV text), call `embed({ purpose: 'candidate_embed', inputType: 'document', inputs: [...] })` ONCE per org, then `bumpCandidateEmbedding` for each result. Per-org batching keeps `ai_usage.organization_id` truthful — never mix orgs in a single Voyage call.
   - Tenant boundary check is implicit (every row carries its own `organization_id` from the SELECT, which is the only trust source).
   - Wrap each per-org batch in `step.run(\`embed-org-\${org_id}\`, ...)` so Inngest can resume mid-sweep if one org's call fails. Independent steps.
   - On any error inside a step, `Sentry.captureException(new Error(\`\${err.name}: \${readStatus(err)}\`), { tags: { layer: 'inngest', function: 'embed-candidates-batch', org_id } })` — PII-safe wrapping per Phase 1 LEARNINGS.

3. **`embed-job-on-jd-change.ts`** — event-driven:
   - `id: 'embed-job-on-jd-change'`
   - `triggers: [{ event: 'job/embed' }]`
   - `concurrency: { limit: 5, key: 'event.data.organization_id' }`
   - `retries: 3`
   - Event payload: `{ organization_id: string; job_id: string; user_id: string | null }`.
   - Tenant boundary check BEFORE any step.run: `if (!event.data.organization_id || !event.data.job_id) throw new NonRetriableError('missing required fields')`. Then look up the job via service-role; assert `job.organization_id === event.data.organization_id`; else `throw new NonRetriableError('job not in claimed organization')`.
   - Steps: (1) `read-job` — service-role select of jobs columns needed by `jobEmbeddingText`. (2) `embed` — call `embed({ purpose: 'job_embed', inputType: 'document', inputs: [jobEmbeddingText(job)] })`. (3) `persist` — `bumpJobEmbedding(supabase, { jobId, embedding, embeddingVersion: (currentVersion ?? 0) + 1 })`.

4. **`bumpCandidateEmbedding` + `bumpJobEmbedding`** in db helpers:
   - Pattern: read current `embedding_version`, write back vector + `embedding_version + 1` + `embedded_at = now()` in one UPDATE statement (use `embedding_version + 1` inline so we don't race against concurrent writes). Returns `DbResult<{ id: string; embedding_version: number }>`.
   - Helper takes the embedding as `number[]` (Voyage returns this); the supabase JS client serializes correctly to the halfvec column.

5. **Wire `job/embed` event dispatches** from the existing job mutations:
   - In `src/app/(app)/clients/[id]/jobs/new/actions.ts` after a successful `createJob` call: `await inngest.send({ name: 'job/embed', data: { organization_id: <from session>, job_id: result.data.id, user_id: <from session> } })`. Wrap in try/catch + Sentry — same pattern Phase 1 uses to send `cv/uploaded`.
   - In `src/app/(app)/jobs/[id]/actions.ts` after a job update that touched any of the embed inputs (`title`, `location`, `job_type`, `hiring_context`, `salary_min`, `salary_max`, `currency`, `description`) — fire `job/embed`. **The invalidate trigger from Plan 0 NULLs the embedding regardless; this event re-populates it.** A simple-but-correct policy: always fire the event on any update through this action; if nothing material changed the embed result will be identical (mild waste — embed cost is sub-pence).
   - Add a fallback path for existing Phase 1 jobs that have NO embedding: the scheduled sweep (Task 1.1 extends to jobs).
   - **Extend `embed-candidates-batch.ts`** OR create a sibling `embed-jobs-batch.ts` that does the same sweep for `jobs` where `job_embedding is null`. **Recommendation:** rename to `embed-batch.ts` (one function, two queries) — keeps Inngest function count down. Or keep separate; planner picks. Document the choice in the commit message.

6. **Register** both new functions in `src/app/api/inngest/route.ts` — `functions: [parseCVOnUpload, embedCandidatesBatch, embedJobOnJDChange]`.

7. **PII safety in Sentry** — every Inngest catch path uses the `readStatus(err)` helper from `parse-cv.ts:89` (lift it into `src/lib/observability/inngest.ts` if you want to share between functions; otherwise duplicate the helper into each function file — small enough that duplication is fine).

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run` pass
- Start `pnpm dev:all`. Upload a real PDF CV through the Phase 1 recruiter UI. Within ~60 s, the candidate row's `candidate_embedding is not null`, `embedding_version = 1`, `embedded_at is not null`. The Inngest dev UI shows the new Step 5 of `parse-cv-on-upload` completed successfully.
- `select count(*) from ai_usage where purpose = 'candidate_embed' and created_at > now() - interval '5 minutes'` returns at least 1; `cost_pence` ≤ 1 per row.
- Update an existing candidate's `current_role_title` via the Phase 1 edit page. Confirm via SQL that `candidate_embedding` is now NULL (invalidation trigger fired). Wait ≤ 10 min for the sweep, then confirm `candidate_embedding is not null` and `embedding_version` incremented by 1.
- Create a new job through `clients/[id]/jobs/new`. Within ~30 s, `jobs.job_embedding is not null` for that row. `ai_usage` has a fresh `purpose='job_embed'` row.
- Cross-tenant Inngest payload smoke (from Inngest dev UI): send `job/embed` with `{ organization_id: '<org-A>', job_id: '<job-in-org-B>', user_id: null }` — expect `NonRetriableError('job not in claimed organization')` and NO Voyage call (`ai_usage` row count unchanged).

**Done:**
- All embed paths (reactive on CV parse, scheduled sweep, job event) write halfvec embeddings; `ai_usage` is populated; tenant boundary is enforced; Inngest dev UI shows all three functions registered and running.

### Task 1.2: `/search` page + extend `listCandidates` for semantic mode + match-score badges

**Files:**
- create `src/app/(app)/search/page.tsx`
- create `src/app/(app)/search/search-input.tsx` (Client Component — debounced query input)
- create `src/app/(app)/search/search-results.tsx` (RSC presentation component)
- create `src/components/app/match-score-badge.tsx` (shared — semantic colour by score bucket)
- modify `src/lib/db/candidates.ts` (extend `listCandidates` to branch on `mode='semantic'` — calls `match_candidates` via `embeddings.ts`; preserve trigram fallback at `mode='trigram'`)
- modify `src/components/app/top-nav.tsx` (add a "Search" link to the recruiter nav — between "Candidates" and "Pipeline")

**Pattern to copy:** PATTERNS.md rows under "App routes — recruiter-facing". `src/app/(app)/candidates/page.tsx` is the closest analog for the RSC + searchParams shape. `src/app/(app)/candidates/search-input.tsx` is the canonical debounced-search-input pattern; copy nearly verbatim and adapt to `/search`. RESEARCH §A.6 for the search UX rules.

**Implementation:**

1. **`src/app/(app)/search/page.tsx`** — async RSC. `await searchParams` (Next 15 promise pattern). Reads `q` (string), `mode` (`'semantic' | 'trigram'`, default `'semantic'`), `page` (number, default 1).
   - If `q` is empty: render an empty state with the natural-language input + an explainer ("Search candidates by skill, role, location, sector — natural language works"). NO results table.
   - If `q.trim().length < 2`: render the input + a hint "Enter at least 2 characters".
   - If `q` is present and `mode === 'semantic'`: (a) call `embed({ purpose: 'search_query_embed', inputType: 'query', inputs: [q.trim()] })` — single embed for the query (RESEARCH §A.6 — don't cache; ~50-150ms; freshness matters); (b) call `hybridSearchCandidates(supabase, { queryText: q.trim(), queryEmbedding: vectors[0], matchCount: 50, minCosineSimilarity: 0.3 })`; (c) pass the `HybridCandidateRow[]` into `<SearchResults rows={...} />`.
   - If `mode === 'trigram'`: fall back to the existing `listCandidates(supabase, { q, sort: 'created_at', dir: 'desc', offset, limit: 50 })` path. Render results WITHOUT score badges (trigram path doesn't surface a score).
   - **First-time UX nudge:** if `count(*) from candidates where candidate_embedding is null > 0` (call a new `countCandidatesWithoutEmbedding(supabase)` helper in `embeddings.ts`), render a yellow `<Alert>` above the results: "N candidates haven't been embedded yet. They may not appear in semantic results until the next sweep (10 min)." Auto-dismisses when count is zero. Cheap select; cached at the RSC level naturally.
   - Audit policy: this is a SEARCH (list) view → no `record_audit` call (Phase 1 D-16 carries forward). The detail view still audits.

2. **`/search/search-input.tsx`** — `'use client'`. Mirror `src/app/(app)/candidates/search-input.tsx` exactly: `useRouter`, `usePathname`, controlled input, 300 ms debounce, `router.replace(pathname + '?' + params)`. Placeholder must read EXACTLY (per CONTEXT.md `<specifics>`): `"e.g. senior Python developer with offshore wind experience in Aberdeen"`. A small `<Select>` next to the input switches `mode` between "Semantic" (default) and "Keyword" — driven by URL search param, no React state. The Select's labels are user-facing (the URL param stays `semantic`/`trigram`).

3. **`/search/search-results.tsx`** — RSC. Renders shadcn `<Table>` with columns: Name, Role, Company, Location, Market Status, Source, Score (semantic only), Last Contacted. Empty state ("No candidates match this query"). For semantic mode, each row's "Score" column renders `<MatchScoreBadge cosine={r.cosine_similarity} trigram={r.trigram_similarity} rrf={r.rrf_score} />`. When `r.rrf_score` is small (below 0.02 — both ranks are deep), render the row in `text-muted-foreground` to soft-deprioritise; do NOT hide it. Recruiter sees all 50 with the noisy ones de-emphasised — better than aggressive filtering.

4. **`src/components/app/match-score-badge.tsx`** — `'use client'` NOT needed (pure presentational). Props `{ cosine: number; trigram: number; rrf: number }`. Display a single `<Badge>` whose text is `${Math.round(cosine * 100)}%` (cosine is the most intuitive surface) with semantic colour: green if cosine ≥ 0.7, amber if 0.5–0.69, neutral if < 0.5. Tooltip (shadcn `<Tooltip>`) shows the full breakdown: `Cosine: 0.78 / Trigram: 0.32 / RRF: 0.0312`. Tailwind classes per UI-SPEC §3 confidence badge pattern.

5. **Extend `listCandidates`** in `src/lib/db/candidates.ts`:
   - Add a `mode?: 'semantic' | 'trigram'` parameter to `ListCandidatesArgs`.
   - If `q && q.trim().length >= 2 && (mode === 'semantic' || mode === undefined)`: import `embed` and `hybridSearchCandidates`; embed the query (`purpose: 'search_query_embed'`); call `hybridSearchCandidates`. Map the rows to `CandidateListRow` shape so existing callers' types don't break. Return a synthesised `total = rows.length` (vector results are inherently top-N; no exact `count` is meaningful at this layer).
   - If `mode === 'trigram'`: existing path unchanged.
   - **Keep both paths.** `/candidates` page can default to `mode='semantic'`; pass it through via search params. A user explicitly setting `?mode=trigram` falls back to keyword.
   - Sentry tags: `{ layer: 'db', helper: 'listCandidates', branch: 'semantic' }`.

6. **Top-nav link.** Add `{ href: '/search', label: 'Search', icon: 'Sparkles' }` to the `NAV_ITEMS` array in `src/components/app/top-nav.tsx`. Order: between Candidates and Pipeline (or wherever the Phase 1 array places nav items — match existing convention).

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Navigate to `/search` while signed in. Empty state renders with the explainer and the exact placeholder text from CONTEXT.md.
- Type `"senior Python developer with offshore wind experience in Aberdeen"`. Within ~500 ms, results render. At least one row appears IF seed data includes a matching candidate (run `tests:e2e:reset` to seed if needed). The placeholder text on the input matches exactly.
- Check Network panel: a single fetch to `/search?q=...` triggers, and inside the Server Component handler a single Voyage embed (no client-side AI call).
- `select * from ai_usage where purpose = 'search_query_embed' order by created_at desc limit 1` returns a row with `input_tokens` matching the query length and `cost_pence ≤ 1`.
- Toggle the Keyword/Semantic select; the URL updates `?mode=trigram`; results change to the trigram-ranked output (no score badges).
- Tooltip on a score badge shows the cosine/trigram/RRF breakdown.
- **Cross-tenant smoke:** sign in as a user in org A; verify the search results contain ONLY candidates from org A. The RPC is `security invoker` so RLS does the gating naturally — but the smoke confirms.

**Done:**
- `/search` is functional end-to-end; recruiters can type natural language and get ranked candidates with visible scores
- The exact ROADMAP success-criterion sentence is demonstrable on screen
- `ai_usage` records every search query embed

### Task 1.3: SEARCH-04 job → candidates auto-suggest + existing-candidates backfill UI + bootstrap-vector-index Inngest function

**Files:**
- create `src/app/(app)/jobs/[id]/matches/page.tsx` (vector-only ranked list — Plan 2 layers Sonnet explanations)
- create `src/app/(app)/jobs/[id]/matches/match-row.tsx` (presentation — kept minimal so Plan 2 can swap in `<MatchCard>`)
- modify `src/app/(app)/jobs/[id]/page.tsx` (add a "Matches" link/tab linking to `/jobs/[id]/matches`)
- create `src/app/(app)/settings/integrations/page.tsx` (initial scaffold; Plan 4 fleshes out Gmail UI)
- create `src/app/(app)/settings/integrations/actions.ts` (`triggerCandidateBackfillAction` — fires Inngest event; recruiter-callable)
- create `src/lib/inngest/functions/bootstrap-vector-index.ts` (HNSW build per D2-05)
- modify `src/app/api/inngest/route.ts` (register `bootstrap-vector-index`)
- modify `src/lib/db/embeddings.ts` (add `countCandidatesWithoutEmbedding(supabase)` + `getJobMatchCandidatesByVector` helpers if not already in Plan 0)

**Pattern to copy:** `src/app/(app)/jobs/[id]/page.tsx` for the job-detail RSC shape; PATTERNS.md row `src/app/(app)/jobs/[id]/matches/page.tsx`; RESEARCH §B.8 (hybrid match: vector-only this plan, Sonnet next plan); `src/app/(app)/settings/page.tsx` for the settings shell. `src/lib/inngest/functions/parse-cv.ts` for the scheduled cron Inngest function shape.

**Implementation:**

1. **`/jobs/[id]/matches/page.tsx`** — async RSC. `await params`. Look up the job; if `job_embedding is null`, render a banner: "This job hasn't been embedded yet. Matches will appear within ~30 seconds — refresh shortly." (No retry loop; recruiter refreshes.) Otherwise call `getTopCandidatesByVector(supabase, { jobId: params.id, limit: 10 })`; for each row, also select the candidate's basic display fields (name, role, current_company, location) via a `listCandidatesByIds(supabase, ids)` helper added to `src/lib/db/candidates.ts`. Render via `<MatchRow>` with score, name, role, company, link to candidate detail.
   - Plan 2 will replace `<MatchRow>` with `<MatchCard>` that includes strengths/gaps/screening questions. Keep `<MatchRow>` simple (score badge + name + role + link). This is the SEARCH-04 minimum.
   - Audit policy: matches view is a search/list — no audit row.

2. **`/jobs/[id]/page.tsx` "Matches" link.** Add a tab/link near the existing applications/pipeline tabs that routes to `/jobs/[id]/matches`. One line of JSX; do NOT refactor.

3. **`/settings/integrations/page.tsx`** — async RSC. `await createClient()` + `auth.getUser()` (the `(app)/layout.tsx` guard already protects this). Render:
   - A "Backfill embeddings" section. Call `countCandidatesWithoutEmbedding(supabase)`. If > 0, render `<BackfillButton count={n} />` (Client Component triggering `triggerCandidateBackfillAction()`); else render "All candidates have embeddings. ✓"
   - A "HNSW index" section. Read `hnsw_build_state` for both `candidates` and `jobs`. Show built-or-pending status. If `count(candidate_embedding is not null) >= 100` AND `hnsw_build_state.candidates.built_at is null`, surface a `<BuildIndexButton table="candidates">` that fires `inngest.send('admin/build-vector-index', { data: { table_name: 'candidates' } })`. (Plan 4 will extend this page with the Gmail Connect UI — for now this page is the integration hub.)
   - Auth note: this page is recruiter-only. No special role check; the org-scoped RLS handles it.

4. **`triggerCandidateBackfillAction`** in `src/app/(app)/settings/integrations/actions.ts`:
   - `'use server'`. Read `auth.getUser()` via `createClient()`. Bail if no user.
   - Fire `inngest.send({ name: 'embed/backfill-org', data: { organization_id, user_id } })`. **Extend `embed-candidates-batch.ts`** to accept this event (in addition to the cron) — when triggered by event, sweep ONLY the requesting org's null embeddings; when triggered by cron, sweep across orgs. Inngest functions can list multiple `triggers`.
   - Returns `{ ok: true }` so the Client Component shows a toast.

5. **`bootstrap-vector-index.ts`** — Inngest function (per VERIFICATION M-1, this function **does NOT run `CREATE INDEX CONCURRENTLY` itself**; it tracks state and signals the operator to run the DDL manually via the Supabase Dashboard SQL editor):
   - `id: 'bootstrap-vector-index'`
   - `triggers: [{ event: 'admin/build-vector-index' }]`
   - `concurrency: { limit: 1 }`
   - `retries: 0`
   - Steps: (1) `check-state` — read `hnsw_build_state` row for `event.data.table_name`. If `built_at is not null`, return early ("already built"). (2) `count-rows` — `SELECT count(*) FROM <table> WHERE <embedding> IS NOT NULL`. If < 100, write `last_attempt_at = now(), last_error = 'too few rows ('||count||')'`, return. (3) `signal-build-needed` — write `last_attempt_at = now(), last_error = NULL`, emit a Sentry breadcrumb (level=`info`, tag `action=hnsw_build_requested`, with `table_name` + `row_count`), and return `{ ok: true, awaitingManualBuild: true }`. The Client Component "Build index" button surfaces a toast: "Build queued — see the Phase 2 runbook for the manual DDL step." (4) **Manual operator step (outside the function):** run the DDL via Supabase Dashboard SQL editor:
     ```sql
     CREATE INDEX CONCURRENTLY <table>_embedding_hnsw_idx
       ON public.<table>
       USING hnsw (<embedding_col> halfvec_cosine_ops)
       WITH (m = 16, ef_construction = 64);
     ```
     Then run `UPDATE public.hnsw_build_state SET built_at = now(), last_error = NULL WHERE table_name = '<table>'`. Document both SQL snippets in `docs/hnsw-build-runbook.md` (new file this task creates) so the operator can copy-paste.
   - Rationale: `CREATE INDEX CONCURRENTLY` cannot run in a transaction. `supabase-js` does not expose raw DDL, so we'd need to add `pg` as a Phase 2 dependency just for one statement that runs once per table per cluster. Plan 0 already commits to `pg`-free; the manual-DDL path matches CONTEXT D2-05's "deferred" framing exactly.

6. **`countCandidatesWithoutEmbedding(supabase)`** + **`listCandidatesByIds(supabase, ids: string[])`** in respective db helpers. Tight selects, Sentry-tagged failures, `DbResult<T>` return.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` pass
- Navigate to `/jobs/[id]/matches` for a job that has an embedding. Up to 10 candidates appear with cosine-score badges, ordered by similarity desc.
- For a job WITHOUT an embedding (created before Plan 1, or whose embedding was invalidated), the banner renders and no candidates show. Within 30 s the scheduled sweep populates the embedding; refresh shows results.
- Sign in to `/settings/integrations`; if seed has unembedded candidates, click "Backfill". Inngest dev UI shows `embed-candidates-batch` fired by `embed/backfill-org` event scoped to the current org. Within 30 s the count drops to zero.
- HNSW (per VERIFICATION M-1 manual-DDL path): with < 100 candidates the "Build index" button is hidden. With ≥ 100, clicking it fires `admin/build-vector-index`; Inngest dev UI shows the function ran; `hnsw_build_state.candidates.last_attempt_at` is updated; a Sentry breadcrumb tagged `hnsw_build_requested` is emitted; the toast surfaces the runbook reference. Operator then runs the `CREATE INDEX CONCURRENTLY ...` DDL manually per `docs/hnsw-build-runbook.md`, followed by `UPDATE hnsw_build_state SET built_at = now() WHERE table_name = 'candidates'`. After that `\\di` shows `candidates_embedding_hnsw_idx` and the Build button hides again on next render.
- `select count(*) from ai_usage where purpose in ('candidate_embed', 'job_embed', 'search_query_embed') and created_at > now() - interval '1 hour'` is non-zero (proves SEARCH-01 cost logging end-to-end).

**Done:**
- SEARCH-04 minimum surface (job → top-10 by vector) is live
- A recruiter can trigger a one-shot backfill from `/settings/integrations`
- HNSW build mechanism exists; ready to fire at scale

## Plan-level verification

- [ ] `pnpm lint && pnpm typecheck && pnpm test --run && pnpm build` all pass
- [ ] Demo: open `/search`, type "senior Python developer with offshore wind experience in Aberdeen", get ranked candidates (ROADMAP success #1 verbatim on screen)
- [ ] `select count(*) from ai_usage where purpose in ('candidate_embed', 'jd_embed', 'job_embed', 'search_query_embed') and created_at > now() - interval '1 hour'` returns > 0
- [ ] `select count(*) from candidates where candidate_embedding is not null` ≥ the number of CV-parsed candidates from Phase 1 + this plan's test runs (no embedding skipped)
- [ ] Update a candidate's `current_role_title`, confirm `candidate_embedding` becomes NULL, wait ≤ 10 min, confirm it's re-populated with a higher `embedding_version`
- [ ] Inngest dev UI shows `parse-cv-on-upload` (now with Step 5: embed), `embed-candidates-batch`, `embed-job-on-jd-change`, `bootstrap-vector-index` all registered
- [ ] Cross-tenant smoke: from Inngest dev UI, send `job/embed` with mismatched org/job IDs → `NonRetriableError`; NO Voyage call (no new `ai_usage` row)
- [ ] `grep -rn "new Anthropic\|new VoyageAIClient" src/ --include='*.ts*'` returns exactly two lines (one per wrapper)
- [ ] No `record_audit` call in `/search` or `/jobs/[id]/matches` paths (D-16 carry-forward)

## Out of scope for this plan (deferred or other plans)

- Sonnet-generated match scores / strengths / gaps / screening questions on `/jobs/[id]/matches` — Plan 2
- Recruiter-facing "explain this match" on-demand action — Plan 2
- Cost-ceiling guard rails per org — Plan 2 (where Sonnet costs start to matter)
- The Apply form's contribution to embedding pipeline — Plan 3 fires the same `cv/uploaded` event used in Phase 1, which already chains into the new Step 5 embed; no Plan 1 change needed
- Gmail Connect button on `/settings/integrations` — Plan 4
- HNSW BUILD against the cloud DB at scale — manual; this plan ships the trigger function
- Reverse-search (candidate → similar jobs) UI surface (SEARCH-03's reverse direction) — out of scope for this MVP slice; helper `hybridSearchJobs` exists from Plan 0 so a recruiter-facing surface can be added in Plan 3 without backend changes
- Anthropic / Voyage pricing reverification — periodic; not phase-gated
