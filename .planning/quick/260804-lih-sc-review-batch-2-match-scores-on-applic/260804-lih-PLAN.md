---
phase: quick/260804-lih
plan: 01
type: execute
wave: 1
depends_on: [260804-lfz]
autonomous: true
requirements: [SF-3, TEL-SEARCH, TEL-ATTRIB, TEL-VIEW, TEL-ANALYTICS, STRIPE-SAFETY]
files_modified:
  # Task 1 — match scores on applications
  - src/lib/inngest/functions/score-application-match.ts
  - src/lib/inngest/enqueue-match-score.ts
  - src/lib/inngest/enqueue-match-score.test.ts
  - src/app/api/inngest/route.ts
  - src/app/(app)/jobs/[id]/actions.ts
  - src/app/(app)/jobs/[id]/shortlist/actions.ts
  - src/app/(app)/candidates/[id]/shortlist-actions.ts
  - src/app/(app)/candidates/[id]/floats/actions.ts
  - src/lib/db/ai-summaries.ts
  - src/lib/db/applications.ts
  - src/lib/db/pipeline-stages.ts
  - src/lib/db/match-score-enrichment.test.ts
  - src/components/app/pipeline-card.tsx
  - src/app/(app)/jobs/[id]/applications-list.tsx
  - src/components/app/pipeline-mobile-list.tsx
  # imported, not modified — created by Batch 1 (260804-lfz):
  # src/lib/ai/profile-completeness.ts
  # Task 2 — telemetry + attribution + analytics
  - src/lib/db/audit.ts
  - src/app/(app)/search/page.tsx
  - src/app/(app)/candidates/page.tsx
  - src/app/(app)/jobs/[id]/page.tsx
  - src/app/(app)/clients/[id]/page.tsx
  - src/app/admin/[orgId]/export/route.ts
  - supabase/migrations/20260804130000_set_created_by_trigger.sql
  - src/app/layout.tsx
  - package.json
  - pnpm-lock.yaml
  # Task 3 — Stripe webhook safety net
  - supabase/migrations/20260804130100_stripe_webhook_event_status.sql
  - src/app/api/stripe/webhook/route.ts
  - src/app/api/stripe/webhook/route.test.ts
  - src/lib/inngest/functions/stripe-reconcile.ts

must_haves:
  truths:
    - "Adding a candidate to a job produces a cached match_score row in ai_summaries for that exact candidate x job pair"
    - "Re-firing the same application-create path does not produce a second Sonnet call or a second summary row"
    - "A candidate whose profile is effectively empty is never match-scored"
    - "The recruiter sees the match score on the job's applications table and on BOTH pipeline surfaces (desktop card and mobile list)"
    - "A concurrent double-fire resolves as a benign duplicate — no second Sonnet call, no Sentry exception"
    - "Every /search render writes an audit_log row carrying mode, semantic_ok and result_count — in all three branches"
    - "Newly created candidates, companies, contacts, jobs and applications carry created_by without app-code changes"
    - "A Stripe webhook whose handler throws leaves a ledger row that is NOT 'processed', and Stripe still re-delivers and re-drives it"
    - "The Stripe webhook returns its normal response even when the new status columns are absent from the database"
  artifacts:
    - path: "src/lib/inngest/functions/score-application-match.ts"
      provides: "Inngest fn: cached Sonnet match score for one candidate x job pair, tenant-verified"
      contains: "application/score-match"
    - path: "src/lib/inngest/enqueue-match-score.ts"
      provides: "Single fire-point used by all four application-create paths; no-ops when jobId is null"
      exports: ["enqueueApplicationMatchScore"]
    - path: "src/lib/db/audit.ts"
      provides: "recordViewAudit / recordSearchAudit / recordServiceAudit — never-throw audit writers"
      exports: ["recordViewAudit", "recordSearchAudit", "recordServiceAudit", "NIL_UUID"]
    - path: "supabase/migrations/20260804130000_set_created_by_trigger.sql"
      provides: "set_created_by() BEFORE INSERT trigger on the 5 entity tables"
      contains: "set_created_by"
    - path: "supabase/migrations/20260804130100_stripe_webhook_event_status.sql"
      provides: "status / error_detail / processed_at columns on stripe_webhook_events"
      contains: "processed_at"
  key_links:
    - from: "src/app/(app)/jobs/[id]/actions.ts"
      to: "src/lib/inngest/enqueue-match-score.ts"
      via: "enqueueApplicationMatchScore after successful createApplication"
      pattern: "enqueueApplicationMatchScore"
    - from: "src/lib/inngest/enqueue-match-score.ts"
      to: "src/lib/inngest/functions/score-application-match.ts"
      via: "inngest.send({ name: 'application/score-match' })"
      pattern: "application/score-match"
    - from: "src/lib/db/applications.ts"
      to: "src/lib/db/ai-summaries.ts"
      via: "listLatestMatchScoresForPairs enrichment on listApplicationsForJob / listAllApplicationsByStage"
      pattern: "listLatestMatchScoresForPairs"
    - from: "src/app/(app)/search/page.tsx"
      to: "public.record_audit"
      via: "recordSearchAudit in all three branches"
      pattern: "await recordSearchAudit\\("
    - from: "src/app/api/stripe/webhook/route.ts"
      to: "public.stripe_webhook_events.status"
      via: "received -> processed / error stamping with column-missing fallback"
      pattern: "PGRST204|42703"
---

<objective>
Close Batch 2 of the Steele Charles feature review (2026-07-31): put AI where the recruiter
actually works, make invisible surfaces measurable, and give the Stripe webhook a safety net.

Purpose: The customer's 7 live applications have ZERO match scores — the AI value-prop is
absent exactly where recruiters work (audit SF-3). Search is 100% invisible (zero
`search_query_embed` rows ever — nobody can tell whether semantic search is unused or
silently broken). The buyer-value report is attribution-blind because `created_by` is never
stamped. And a Stripe webhook that fails leaves no durable trace.

Output: match scores generated + displayed on every application-create path with an
idempotency guard; search/view/export/attribution telemetry; Vercel Web Analytics; Stripe
webhook status ledger + reconcile alerting.

Source of record: `.planning/audits/STEELE-CHARLES-FEATURE-REVIEW-2026-07-31.md` sections
2, 4 (Batch 2 items 7-11) and 5. Trust its file:line citations — they were adversarially
verified.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/audits/STEELE-CHARLES-FEATURE-REVIEW-2026-07-31.md

Read before Task 1:
@src/lib/inngest/functions/precompute-matches-for-job.ts
@src/app/(app)/jobs/[id]/matches/actions.ts
@src/lib/db/ai-summaries.ts
@src/lib/db/applications.ts

Read before Task 2:
@src/lib/db/candidates.ts
@src/app/(app)/search/page.tsx

Read before Task 3:
@src/app/api/stripe/webhook/route.ts
@src/app/api/stripe/webhook/route.test.ts
</context>

<environment_notes>
**pnpm is the only package manager.** If `pnpm` is not on PATH in your shell, use
`corepack pnpm` (verified working: pnpm 11.20.0). Never use npm/npx/yarn.

**The plain `pnpm build` env failure is NOT a task failure.** `src/lib/env.ts` validates at
module load and `.env.local` lacks the required values. The verified working local build
gate (exit 0 confirmed on the current tree at plan time) is:

    NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy \
    SUPABASE_SERVICE_ROLE_KEY=dummy \
    ANTHROPIC_API_KEY=sk-ant-dummy \
    INNGEST_EVENT_KEY=dummy \
    INNGEST_SIGNING_KEY=dummy \
    OPENAI_API_KEY=sk-dummy \
    pnpm build

Unit tests: `pnpm exec vitest run <path>` (bare `pnpm test` starts watch mode).
</environment_notes>

<hard_rules>
Inherited, non-negotiable. Violating any of these fails the task regardless of green gates.

1. **pnpm only.** No npm, npx, yarn.
2. **Migrations are append-only FILES ONLY.** Write the `.sql` file. NEVER run
   `supabase db push`, NEVER use the Supabase MCP `apply_migration` or `execute_sql` to
   apply DDL, NEVER touch production schema. The founder applies migrations manually.
   Never edit a committed migration — add a new one.
3. **All new code must run correctly BEFORE the migration lands.** The founder may deploy
   code first and push the migration later. Every code path touching a new column must
   degrade gracefully when the column does not exist (Task 3 especially).
4. **TypeScript strict.** No `any` without an explanatory `// reason:` comment.
   `noUncheckedIndexedAccess` is on — index access yields `T | undefined`.
5. **RLS is the tenancy authority.** Never disable it. Service-role clients get an explicit
   tenant-boundary check before any read (see `precompute-matches-for-job.ts:121`).
6. **Never log PII to Sentry** — no CV text, candidate names, emails, or raw error
   `.message` from third-party SDKs. Log `err.name` + tags only.
7. **Match existing patterns.** Prettier: no semicolons, single quotes, 2-space, width 100,
   trailing commas. Kebab-case files except PascalCase components.
8. **One atomic commit per task**, conventional-commit style, referencing the audit item.
9. **No auto-sent emails.** Nothing in this plan sends email.
10. **This is a live production system with real customer data.** Nothing here deletes or
    rewrites existing rows. Existing behaviour must be preserved on every path.
</hard_rules>

<package_legitimacy_audit>
One new dependency. Verified against the npm registry at plan time (2026-08-04):

| Package | Status | Evidence |
|---------|--------|----------|
| `@vercel/analytics` | **[OK]** | Scoped to the official `@vercel` org; repo `git+https://github.com/vercel/analytics.git`; maintainers include `vercel-release-bot`; latest 2.0.1 (published 2026-03-12); 67 versions since 2022-10-24; MIT; **zero runtime dependencies**; 5,253,142 weekly downloads; peer `react: ^18 \|\| ^19` and `next: >= 13` both satisfied (React 19.2.4 / Next 16.2.6). First-party package from the project's own hosting provider. |

No `[ASSUMED]` / `[SUS]` / `[SLOP]` packages — no install checkpoint required.
Install exactly `@vercel/analytics` at the latest 2.x. Add NOTHING else.
</package_legitimacy_audit>

<batch1_coordination>
A parallel Batch 1 plan (`260804-lfz`) executes FIRST on this same branch. It touches
`src/lib/inngest/functions/parse-cv.ts`, `cv-review-panel.tsx`, the apply actions,
`src/lib/ai/claude.ts`, and adds a new reconciler Inngest function.

This plan deliberately avoids all of those files with one intentional overlap:
`src/app/api/inngest/route.ts` (both register a new function) — expect to merge, do not
revert Batch 1's registration.

**Reuse Batch 1's empty-profile guard — it has an exact, known name and location.**

    import { isProfileEffectivelyEmpty } from '@/lib/ai/profile-completeness'

`src/lib/ai/profile-completeness.ts` is created by Batch 1 (`260804-lfz`), declared in its
frontmatter and asserted by its own verify gate (`test -f
src/lib/ai/profile-completeness.ts`). Batch 1 also wires the same predicate into
`parse-cv.ts`, `embed-batch.ts`, `precompute-matches-for-job.ts` and `match-card.tsx`, so it
is already the single source of truth for "this profile has nothing in it". The signature is
`isProfileEffectivelyEmpty(candidate)` over the `CandidateEmbedFields` set. It has no
`server-only` import (an RSC card consumes it), so it is safe to import anywhere.

**Do NOT write a second predicate.** Two divergent definitions of "empty" is precisely how a
candidate gets embedded from nothing and then scored from nothing (audit SF-1).

Fallback, only if that file genuinely does not exist on the branch — meaning Batch 1 failed
or was skipped: confirm with `grep -rn "isProfileEffectivelyEmpty\|profile-completeness"
src/lib src/app`, then **STOP and surface the coordination failure to the coordinator**.
Do not re-implement the predicate and do not proceed with Task 1 Step 2c.
</batch1_coordination>

<source_coverage_audit>
Sources: the audit report's Batch 2 list (§4 items 7-11) and the pre-scoped task constraints.

| ID | Source item | Plan coverage |
|----|-------------|---------------|
| SRC-1 | §4.7 / SF-3 — match scores on every application-create path, idempotency guard, show on pipeline cards | Task 1 — COVERED |
| SRC-2 | §4.8 — `record_audit` in all three SearchPage branches (+ /candidates when `q` set) | Task 2 step A — COVERED |
| SRC-3 | §4.9 — `set_created_by()` trigger migration on 5 tables + `owner_user_id` in `createApplication` | Task 2 step B — COVERED |
| SRC-4 | §4.11 — job/client detail-view audits; export audit | Task 2 step C — COVERED |
| SRC-5 | §4.11 — Vercel Web Analytics | Task 2 step D — COVERED |
| SRC-6 | §4.10 — Stripe webhook status/error_detail/processed_at + reconcile alert on stuck rows | Task 3 — COVERED |

**Explicitly NOT covered — surfaced, not silently dropped:**

1. §4.11 third clause, *"Weekly read-only usage rollup query saved."* Excluded from this
   batch's task constraints. It is a saved SQL snippet, not app code, and it is only
   meaningful once SRC-2/SRC-4 telemetry has accumulated data. **Recommend the founder run
   it as a follow-up quick task ~2 weeks after this batch ships.** Do not add it here.

2. **The public apply flow creates no application row.** The task constraint listed it as a
   fourth application-create path. Verification at plan time found
   `src/app/(public)/apply/[orgSlug]/actions.ts` (604 LOC) contains **zero** references to
   `applications`, `job_id`, or `jobId` — it creates a candidate + `candidate_cvs` row only.
   There is therefore no application-create path to instrument there. **Re-confirm in Task 1
   with the grep in that task's action; if Batch 1 has since added one, wire it.**

3. **Floats have no job** (`addFloatAction` hard-codes `job_id: null`), so a float cannot be
   match-scored — there is no job to score against. It is still wired to the shared
   enqueue helper, which no-ops on a null `jobId`, so a future float-with-job works for free.
</source_coverage_audit>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Match scores on every application-create path (SF-3) + idempotency + display</name>
  <files>
src/lib/inngest/functions/score-application-match.ts (new)
src/lib/inngest/enqueue-match-score.ts (new)
src/lib/inngest/enqueue-match-score.test.ts (new)
src/lib/db/match-score-enrichment.test.ts (new)
src/app/api/inngest/route.ts
src/app/(app)/jobs/[id]/actions.ts
src/app/(app)/jobs/[id]/shortlist/actions.ts
src/app/(app)/candidates/[id]/shortlist-actions.ts
src/app/(app)/candidates/[id]/floats/actions.ts
src/lib/db/ai-summaries.ts
src/lib/db/applications.ts
src/lib/db/pipeline-stages.ts
src/components/app/pipeline-card.tsx
src/components/app/pipeline-mobile-list.tsx
src/app/(app)/jobs/[id]/applications-list.tsx
src/lib/ai/profile-completeness.ts (IMPORT ONLY — created by Batch 1, do not edit)
  </files>

  <behavior>
    - `enqueueApplicationMatchScore` returns without calling `inngest.send` when `jobId` is null (floats).
    - `enqueueApplicationMatchScore` sends exactly one `application/score-match` event when jobId, candidateId and organizationId are all present.
    - `enqueueApplicationMatchScore` never throws when `inngest.send` rejects — it captures to Sentry and resolves.
    - `listLatestMatchScoresForPairs` keys results by `candidateId:jobId` and returns only exact-pair matches (never a cross-product row from the `.in()` over-fetch).
    - `listLatestMatchScoresForPairs` returns the NEWEST summary per pair when several exist.
    - `listLatestMatchScoresForPairs` returns an empty map (not an error) for an empty input list, without issuing a query.
    - `upsertMatchSummary` maps a 23505 unique violation to code `'duplicate'` and does NOT call `Sentry.captureException`.
    - `upsertMatchSummary` still maps any non-23505 error to `'internal'` AND captures it to Sentry.
  </behavior>

  <action>
This task is context-heavy (15 files). Work in the order below — contracts first, then
implementation, then wiring, then display. Do not explore beyond the files listed.

**Step 0 — reconnaissance (cheap, do it first).**
Confirm `src/lib/ai/profile-completeness.ts` exists and exports
`isProfileEffectivelyEmpty` (`grep -n "export function isProfileEffectivelyEmpty"
src/lib/ai/profile-completeness.ts`). If it is missing, follow the STOP instruction in
`<batch1_coordination>` — do not invent a replacement. Then re-confirm finding 2 of
the source audit by running:
`grep -n "applications\|job_id\|jobId" "src/app/(public)/apply/[orgSlug]/actions.ts"`
Expect zero matches. If matches now exist (Batch 1 changed it), wire that path too.

**Step 1 — the enqueue contract (`src/lib/inngest/enqueue-match-score.ts`).**
Export `async function enqueueApplicationMatchScore(args: { organizationId: string;
applicationId: string; candidateId: string; jobId: string | null; userId: string | null }):
Promise<void>`. Behaviour: return immediately when `jobId` is null or any of
organizationId/candidateId is empty (a float has no job to score against — document this in
a comment). Otherwise `await inngest.send({ name: 'application/score-match', data: {
organization_id, application_id, candidate_id, job_id, user_id } })` inside try/catch.
On rejection, `Sentry.captureException(new Error(\`${err.name}: inngest.send
application/score-match failed\`), { tags: { layer: 'lib', helper:
'enqueueApplicationMatchScore', subop: 'inngest.send' } })` and resolve — mirror the
existing pattern at `src/app/(app)/jobs/new/actions.ts:69-90`. Swallowing is correct HERE:
the application row is already committed and the score is an enhancement, not the
deliverable. Never rethrow — a scoring hiccup must not fail "add candidate to job".

**Step 2 — the Inngest function (`src/lib/inngest/functions/score-application-match.ts`).**
Model it directly on `precompute-matches-for-job.ts`; reuse its imports and idioms.
Config: `id: 'score-application-match'`, `triggers: [{ event: 'application/score-match' }]`,
`concurrency: { limit: 2, key: 'event.data.organization_id' }`, `retries: 3`, and an
`onFailure` that captures to Sentry with `formatErrorForSentry` and tags
`{ layer: 'inngest', function: 'score-application-match', handler: 'onFailure' }`.

Body, in order:
  a. Validate `organization_id`, `candidate_id`, `job_id` are non-empty strings; throw
     `NonRetriableError('missing required fields')` otherwise. This runs BEFORE any
     `step.run` so a forged payload costs no attempt.
  b. `step.run('verify-and-load')` using `createServiceClient()`:
     `getCandidateForEmbedding` and `getJobForEmbedding`, then assert BOTH rows'
     `organization_id === organization_id` from the event. **Service-role bypasses RLS —
     this comparison is the only barrier against a forged cross-tenant event** (copy the
     comment style from `precompute-matches-for-job.ts:118-123`). Throw
     `NonRetriableError` on mismatch. Also read the embedding versions via
     `getCandidateEmbeddingVersion` / `getJobEmbeddingVersion`.
  c. **Empty-profile skip (T-lih-02, audit SF-1's "scored from nothing").** Call
     `isProfileEffectivelyEmpty(candidate)` from `@/lib/ai/profile-completeness` on the row
     already loaded in step (b). If the profile is effectively empty, add a Sentry
     breadcrumb (`category: 'inngest'`, level `info`) and return
     `{ skipped: 'empty-profile' }` — no Sonnet call, no summary row. A score computed from
     an empty profile is worse than no score: it is a confident lie in the pipeline.
  d. **Idempotency guard (fixes the 07-07 double-fire, audit SF-3).** `getMatchSummary` for
     the exact `(candidateId, jobId, candidateEmbeddingVersion, jobEmbeddingVersion)` tuple.
     On a hit return `{ skipped: 'cached' }` before spending anything. Note in a comment
     that the unique constraint on `ai_summaries` is the concurrent-double-fire backstop and
     a 23505 from the upsert is a no-op, not an error.
  e. Spend ceiling: `getOrgMatchSpendThisMonth` vs `env.MAX_MONTHLY_MATCH_SPEND_PENCE`.
     At/over the ceiling emit `Sentry.captureMessage(..., { level: 'warning' })` and return
     `{ stopped: 'cost-ceiling' }` — warning, NOT throw (same rationale as precompute).
  f. `buildMatchInputs` then `scoreCandidateForJob({ candidateSummary, jobSummary,
     organizationId, userId })`. This goes through the typed `src/lib/ai/claude.ts` wrapper,
     which logs tokens + cost to `ai_usage` with `purpose='match_score'` — do not bypass it.
     Catch `CapExceededError` exactly as precompute does: Sentry warning, return, no retry
     (the call can never succeed until the month resets).
  g. `upsertMatchSummary` with `model: 'claude-sonnet-4-6'`, `costPence: 1`, and the
     already-verified `organizationId` passed explicitly (a NULL org raises in
     `set_organization_id()` under service-role — see the comment block at the top of
     `src/lib/db/ai-summaries.ts`). Treat a `'duplicate'` result as **success**: return
     normally, do NOT throw, do NOT retry, do NOT Sentry-capture. A concurrent worker won
     the race and the cache is populated — that is the desired end state. See Step 4b.
  Register the export in `src/app/api/inngest/route.ts` alongside `precomputeMatchesForJob`,
  keeping Batch 1's registration intact.

**Step 3 — wire all four application-create paths.** Each call site fires the helper AFTER
its successful write and AFTER `revalidatePath`, and ignores the result:
  - `src/app/(app)/jobs/[id]/actions.ts` `addCandidateToJobAction` (~line 41-69):
    `createApplication` already returns the full row, so `result.data.organization_id`,
    `.candidate_id`, `.job_id`, `.id` are all in hand. Also read
    `supabase.auth.getUser()` once and pass `userId`.
  - `src/app/(app)/jobs/[id]/shortlist/actions.ts` `addToShortlistAction`: widen the insert's
    `.select('id')` to `.select('id, organization_id, candidate_id, job_id')`.
  - `src/app/(app)/candidates/[id]/shortlist-actions.ts`
    `convertShortlistToApplicationAction`: widen the pre-update `.select(...)` to include
    `organization_id`; fire after the successful UPDATE.
  - `src/app/(app)/candidates/[id]/floats/actions.ts` `addFloatAction`: widen `.select('id')`
    to include `organization_id, candidate_id, job_id` and call the helper — it no-ops on the
    null `job_id`. Add a one-line comment saying so, so a future float-with-job works free.

**Step 4a — pair enrichment (`src/lib/db/ai-summaries.ts`).** Add
`listLatestMatchScoresForPairs(supabase, pairs: Array<{ candidateId: string; jobId: string }>)`
returning `DbResult<Map<string, { score: number; note: string | null }>>` keyed
`` `${candidateId}:${jobId}` ``. Return an empty Map without querying when `pairs` is empty.
Otherwise ONE query: `.from('ai_summaries').select('candidate_id, job_id, content,
created_at').eq('kind', 'match_score').in('candidate_id', [...unique])
.in('job_id', [...unique]).order('created_at', { ascending: false })`. The two `.in()`
clauses form a cross-product, so **filter client-side to the requested pairs only** and keep
the first (newest) row per pair — document that over-fetch as acceptable at anchor scale.
`note` is `content.strengths[0] ?? null` (`noUncheckedIndexedAccess` makes the `?? null`
mandatory). Follow the file's existing `asAiSummariesClient` cast idiom. On error, Sentry-
capture and return `{ ok: false, code: 'internal' }`; callers must degrade to no scores, not
to a broken page.

**Step 4b — make the 23505 race actually benign (`src/lib/db/ai-summaries.ts`).**
`upsertMatchSummary` currently Sentry-captures and returns `{ ok: false, code: 'internal' }`
for EVERY insert error, including a unique-constraint violation — so the "concurrent worker
already inserted; no-op" claim in the existing comments is asserted but not implemented, and
every double-fire files a false Sentry exception. Special-case it exactly like
`createApplication` in `src/lib/db/applications.ts:287-290`: read `(error as { code?: string
}).code`, and on `'23505'` return `{ ok: false, code: 'duplicate' }` **without** calling
`Sentry.captureException` — it is an expected concurrency outcome, not a fault. All other
errors keep today's `'internal'` + Sentry behaviour. `'duplicate'` is ALREADY in the
`DbResult` union (`src/lib/db/types.ts`) — do not widen the type. Update the JSDoc so the
promise and the code agree, and make the two existing callers
(`precompute-matches-for-job.ts:317` and `matches/actions.ts:190`) tolerant of the new code
without changing their observable behaviour.

**Step 5 — thread the score through the card shape.** Add `match_score: number | null` and
`match_note: string | null` to `PipelineCardData` in `src/lib/db/pipeline-stages.ts`
(document that they are null until the async score lands). Default both to `null` in
`shapeCard`. In `src/lib/db/applications.ts`, after building rows in `listApplicationsForJob`
and in `listAllApplicationsByStage`, call `listLatestMatchScoresForPairs` for the rows that
have a non-null `job_id` and merge. If the enrichment returns not-ok, return the cards
unenriched — never fail the list.

**Step 6 — display (minimal).**
  - `src/app/(app)/jobs/[id]/applications-list.tsx`: add a "Match" `<TableHead>` after
    "Stage" and a cell rendering `<MatchScoreBadge score={row.match_score} />` when non-null,
    else a muted `—`. Put `row.match_note` on the cell's `title` attribute so hovering shows
    the one-line explanation.
  - `src/components/app/pipeline-card.tsx`: render the same badge in the bottom row beside
    the days-in-stage chip, again with `match_note` as `title`.
  - `src/components/app/pipeline-mobile-list.tsx`: **the mobile pipeline is a SEPARATE render
    tree, not CSS-hidden.** `src/app/(app)/jobs/[id]/pipeline/pipeline-shell.tsx:48-53`
    switches between `<PipelineBoard>` and `<PipelineMobileList>` via `useSyncExternalStore`,
    so a badge added only to `PipelineCard` is invisible to every mobile recruiter. Render
    the same `<MatchScoreBadge>` in the mobile row beside the existing
    `{card.days_in_stage}d in stage` chip (~line 247), same null-guard, same `title`.
    `MatchScoreBadge`
    (`@/components/app/match-score-badge`) imports only `Badge` + `cn`, has no `server-only`
    import, and is safe inside this client component — use `score` mode (`<MatchScoreBadge
    score={...} />`), never the cosine variant.

**Step 7 — tests.** Write the `<behavior>` cases as two node-environment vitest files
mirroring `src/lib/db/create-application.test.ts` (`@vitest-environment node`,
`vi.mock('server-only', () => ({}))`, mocked `@sentry/nextjs`):
`src/lib/inngest/enqueue-match-score.test.ts` (mock `@/lib/inngest/client`) and
`src/lib/db/match-score-enrichment.test.ts` (hand-rolled chainable stub client).

Do NOT backfill scores for the 7 existing applications — that is a founder data decision
listed separately in the audit's "Data remediation" section.
  </action>

  <verify>
    <automated>pnpm typecheck && pnpm lint && pnpm exec vitest run src/lib/inngest/enqueue-match-score.test.ts src/lib/db/match-score-enrichment.test.ts src/lib/db/create-application.test.ts && grep -q "application/score-match" src/lib/inngest/functions/score-application-match.ts && grep -q "scoreApplicationMatch" src/app/api/inngest/route.ts && test "$(grep -rl 'enqueueApplicationMatchScore' 'src/app/(app)/jobs/[id]/actions.ts' 'src/app/(app)/jobs/[id]/shortlist/actions.ts' 'src/app/(app)/candidates/[id]/shortlist-actions.ts' 'src/app/(app)/candidates/[id]/floats/actions.ts' | wc -l)" -eq 4 && grep -q "getMatchSummary" src/lib/inngest/functions/score-application-match.ts && grep -q "listLatestMatchScoresForPairs" src/lib/db/applications.ts && grep -q "MatchScoreBadge" src/components/app/pipeline-card.tsx && grep -q "MatchScoreBadge" src/components/app/pipeline-mobile-list.tsx && grep -q "isProfileEffectivelyEmpty" src/lib/inngest/functions/score-application-match.ts && grep -q "23505" src/lib/db/ai-summaries.ts && grep -q "duplicate" src/lib/db/ai-summaries.ts</automated>
  </verify>

  <done>
All four application-create paths fire `application/score-match`; the Inngest function
verifies the tenant on both parents, skips empty profiles, skips when a fresh cached summary
exists for the exact pair, honours the monthly spend ceiling and the AI cap, and writes a
cost-logged `ai_summaries` row. It reuses Batch 1's `isProfileEffectivelyEmpty` rather than a
second predicate, and a concurrent 23505 resolves as `'duplicate'` with no Sentry noise. The
score plus its one-line note render on the job's applications table AND on both pipeline
surfaces (desktop card + mobile list). Tests green, typecheck + lint clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Telemetry — search, attribution, view/export audits, Vercel Analytics</name>
  <files>
src/lib/db/audit.ts (new)
src/app/(app)/search/page.tsx
src/app/(app)/candidates/page.tsx
src/app/(app)/jobs/[id]/page.tsx
src/app/(app)/clients/[id]/page.tsx
src/app/admin/[orgId]/export/route.ts
supabase/migrations/20260804130000_set_created_by_trigger.sql (new)
src/app/layout.tsx
package.json
pnpm-lock.yaml
  </files>

  <action>
Four independent steps. Do them in order; commit once at the end.

**Step A — search instrumentation (audit §4.8, closes the "Dark" telemetry gap).**
Create `src/lib/db/audit.ts` with `import 'server-only'` at the top, exporting:
  - `NIL_UUID = '00000000-0000-0000-0000-000000000000'` — `audit_log.entity_id` is
    `uuid NOT NULL` and a search has no entity. The nil-UUID convention already exists in
    this codebase (see `supabase/migrations/20260601000000_buyer_value_rpc_fixes.sql:62`).
    There is no FK on `entity_id`, so this is safe.
  - `recordViewAudit(supabase, entityType: string, entityId: string, metadata?: Record<string, unknown>)`
    — copy the try/catch + Sentry shape from `src/lib/db/candidates.ts:290-309` verbatim
    (`supabase.rpc('record_audit', { p_action: 'view', p_entity_type, p_entity_id,
    p_metadata })`). It must NEVER throw and NEVER return a rejected promise.
  - `recordSearchAudit(supabase, metadata)` — thin wrapper: `recordViewAudit(supabase,
    'search', NIL_UUID, metadata)`.
  - `recordServiceAudit(serviceClient, args)` — see Step C.

`record_audit` is already `grant execute ... to authenticated` and resolves the org from
`current_organization_id()`, so **no migration is needed** for search/view audits.

Wire `src/app/(app)/search/page.tsx` in **all three** branches, each `await`ed right before
its `return` so `result_count` is known:
  1. trigram branch (~line 98-127): `{ mode: 'trigram', semantic_ok: false, result_count: rows.length, surface: 'search' }`
  2. semantic success (`rows?.ok` true): `{ mode: 'semantic', semantic_ok: true, result_count: rows.data.length, surface: 'search' }`
  3. semantic-failure fallback (`!rows?.ok`): `{ mode: 'semantic', semantic_ok: false, result_count: fallbackRows.length, surface: 'search' }`
  Compute the metadata before the JSX and make exactly three `await recordSearchAudit(` call
  sites. `semantic_ok` is the whole point — it is what finally distinguishes "semantic search
  is unused" from "semantic search is silently broken" (audit SF-6).

`src/app/(app)/candidates/page.tsx`: when `q` is set (and the list read succeeded), fire
`{ mode: 'keyword', semantic_ok: false, result_count: total, surface: 'candidates_list' }`.

**PII rule: never put the raw query string in the metadata.** Mode, flag and count only.

**Step B — attribution (audit §4.9, unblocks the buyer-value report).**
Create `supabase/migrations/20260804130000_set_created_by_trigger.sql`. Contents:
  - A header comment explaining the purpose, that it mirrors `set_organization_id()` from
    `20260513152244_phase1_domain_schema.sql:86`, and — critically — the trigger-ordering
    lesson from `20260518213836_fix_same_org_trigger_order.sql`: Postgres fires same-timing
    triggers in alphabetical order by trigger NAME. `set_created_by` sorts before both
    `set_org` and `verify_same_org_check`, which is harmless because no guard reads
    `created_by` (the cross-tenant guards only inspect `candidate_id`, `job_id`,
    `company_id`, `organization_id`).
  - `create or replace function public.set_created_by() returns trigger language plpgsql
    set search_path = public as $$ begin new.created_by := coalesce(new.created_by,
    auth.uid()); return new; end; $$;` — SECURITY INVOKER (the default; do NOT add
    `security definer`, the audit already flagged 11 anon-executable definer functions).
    `set search_path` is deliberate — the audit flagged 8 mutable-search_path functions.
  - Five `drop trigger if exists <t>_set_created_by on public.<t>;` + `create trigger
    <t>_set_created_by before insert on public.<t> for each row execute function
    public.set_created_by();` for `candidates`, `companies`, `contacts`, `jobs`,
    `applications`. Idempotent so a re-push is safe.
  - `coalesce` means an explicitly-supplied `created_by` always wins, and service-role
    inserts (Inngest, apply form) where `auth.uid()` is NULL keep today's NULL behaviour.
    Existing rows are untouched — this is INSERT-only, zero backfill, zero data risk.

Then `src/lib/db/applications.ts`: add `ownerUserId?: string | null` to
`CreateApplicationInput` and include `owner_user_id` in the insert payload when provided.
In `src/app/(app)/jobs/[id]/actions.ts` `addCandidateToJobAction`, pass the current user id
(you already read `auth.getUser()` there for Task 1 — reuse that read). This matches the
shortlist and float actions, which already stamp `owner_user_id` (M-6b), and feeds
`coalesce(owner_user_id, created_by)` in the buyer-value RPCs.

**Step C — view + export audits (audit §4.11).**
Do NOT put the audit inside `getJob` / `getClient` — both are called from list, edit and
server-action contexts (5 callers each), which would pollute the log. Follow the candidates
convention ("Detail-view audits ONLY") and call at the **detail page** level:
  - `src/app/(app)/jobs/[id]/page.tsx`: after `getJob` succeeds,
    `await recordViewAudit(supabase, 'job', id)`.
  - `src/app/(app)/clients/[id]/page.tsx`: after `getClient` succeeds,
    `await recordViewAudit(supabase, 'company', id)` — `company` matches the table name,
    which is what the audit_log index is keyed on.
  - `src/app/admin/[orgId]/export/route.ts`: `record_audit` cannot be used here — it is
    `authenticated`-only and resolves the org from the CALLER's session, so a super-admin
    exporting another org would file the row against their own org. Instead add
    `recordServiceAudit(serviceClient, { organizationId, actorUserId, action, entityType,
    entityId, metadata })` to `src/lib/db/audit.ts`, which inserts directly into
    `public.audit_log` with the service client (bypasses RLS by design) using columns
    `organization_id, actor_user_id, action, entity_type, entity_id, metadata`. Call it
    after `collectOrgExport` succeeds with `action: 'export'`, `entity_type:
    'organization'`, `entity_id: orgId`, and `actorUserId` from `requireSuperAdmin()`'s
    return value (it returns `{ id, email }` — use `id`, never the email). The
    `audit_action` enum already contains `'export'`, so **no migration is needed**.
    Best-effort: a failed audit must not block the download.

**Step D — Vercel Web Analytics (audit §4.11).**
`pnpm add @vercel/analytics` (verified `[OK]` in this plan's package-legitimacy audit — zero
runtime deps). In `src/app/layout.tsx` add `import { Analytics } from
'@vercel/analytics/next'` and render `<Analytics />` inside `<body>` next to `<Toaster />`.
Two lines. Add nothing else — no Speed Insights, no config.
  </action>

  <verify>
    <automated>pnpm typecheck && pnpm lint && test "$(grep -c 'await recordSearchAudit(' 'src/app/(app)/search/page.tsx')" -eq 3 && grep -q "recordSearchAudit" "src/app/(app)/candidates/page.tsx" && grep -q "recordViewAudit" "src/app/(app)/jobs/[id]/page.tsx" && grep -q "recordViewAudit" "src/app/(app)/clients/[id]/page.tsx" && grep -q "recordServiceAudit" "src/app/admin/[orgId]/export/route.ts" && test "$(grep -v '^--' supabase/migrations/20260804130000_set_created_by_trigger.sql | grep -c 'execute function public.set_created_by()')" -eq 5 && grep -q "set search_path = public" supabase/migrations/20260804130000_set_created_by_trigger.sql && ! grep -q "security definer" supabase/migrations/20260804130000_set_created_by_trigger.sql && grep -q "owner_user_id" src/lib/db/applications.ts && grep -q "@vercel/analytics" package.json && grep -q "<Analytics" src/app/layout.tsx && ! grep -q "query: q\|p_query" "src/app/(app)/search/page.tsx"</automated>
  </verify>

  <done>
`/search` writes an audit row in every branch carrying `semantic_ok`, so the four-week
telemetry window can finally distinguish unused-vs-broken semantic search. `/candidates?q=`
is instrumented. Job and client detail views are audited; admin export writes an `export`
audit against the EXPORTED org. The `set_created_by` migration file exists (unapplied,
awaiting founder push), `owner_user_id` is stamped on the main add-to-job path, and
`<Analytics />` is live in the root layout. Typecheck + lint clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Stripe webhook status ledger + reconcile alerting (defensive, migration-independent)</name>
  <files>
supabase/migrations/20260804130100_stripe_webhook_event_status.sql (new)
src/app/api/stripe/webhook/route.ts
src/app/api/stripe/webhook/route.test.ts
src/lib/inngest/functions/stripe-reconcile.ts
  </files>

  <behavior>
    - Bad signature → 400, handler never runs, no ledger write at all.
    - A prior row with status 'processed' (or legacy NULL status) → 200, handler NOT re-run.
    - A prior row with status 'received' or 'error' → the handler IS re-run (a failed event must never be de-duped away forever).
    - Handler throws → 500, and the ledger row is stamped 'error' with `error_detail`, never 'processed'.
    - Successful processing → 200 and the row is stamped 'processed' with a `processed_at`.
    - When the status columns do not exist (PGRST204 / 42703) → the route falls back to the legacy `{ stripe_event_id, event_type }` insert shape and still returns its normal response.
    - `error_detail` never contains a third-party `err.message` — name + event type only.
  </behavior>

  <action>
**Read `src/app/api/stripe/webhook/route.ts:88-144` and `route.test.ts` before writing.**

**Step A — the migration file.** Create
`supabase/migrations/20260804130100_stripe_webhook_event_status.sql`, append-only:
  - `alter table public.stripe_webhook_events add column if not exists status text not null
    default 'processed';` — the default is `'processed'` **on purpose**: every pre-existing
    row was written ONLY on successful completion, so back-dating them to 'processed' is the
    truthful value and preserves today's idempotency semantics for historical rows.
  - `add column if not exists error_detail text;`
  - `add column if not exists processed_at timestamptz;`
  - `alter table ... add constraint stripe_webhook_events_status_check check (status in
    ('received','processed','error'));` guarded by an `if not exists` DO block or
    `drop constraint if exists` first, so a re-push is safe.
  - A partial index on stuck rows for the reconcile query:
    `create index if not exists stripe_webhook_events_unprocessed_idx on
    public.stripe_webhook_events (created_at) where status <> 'processed';`
  - Header comment: RLS stays enabled with zero policies (service-role only); the table is a
    global ledger excluded from org export/erasure; no rows are modified by this migration.

**Step B — route changes. THE CODE MUST WORK BEFORE THE MIGRATION LANDS.** The founder may
deploy this code and push the migration hours later. Every new-column write is wrapped so a
missing column degrades to today's behaviour and NEVER changes the HTTP response.

`src/types/database.ts` is generated and will not know the new columns until the founder
regenerates types post-push — **do not run `pnpm db:types`**. Use a narrow local cast at the
`.from('stripe_webhook_events')` boundary with a `// reason:` comment, exactly like the
`asAiSummariesClient` idiom in `src/lib/db/ai-summaries.ts`.

Add a module-level helper `isMissingColumnError(err)` returning true when the PostgREST
error `code` is `'PGRST204'` (schema-cache write miss) or `'42703'` (undefined_column).

Rework the flow at lines 98-144:
  1. **Seen-check (line 98).** Select `'stripe_event_id, status'`. If that select fails with
     `isMissingColumnError`, retry selecting just `'stripe_event_id'` and treat any existing
     row as processed (legacy behaviour). **Short-circuit to `{ received: true }` ONLY when a
     row exists AND (`status` is null OR `status === 'processed'`).** This is the load-bearing
     change: a `'received'` or `'error'` row MUST fall through and re-drive processing.
     Getting this wrong reintroduces the exact bug SECURITY INVARIANT 4 was written to fix —
     "a single transient failure de-duped the event away forever… a paid customer could end
     up with no subscription row." Update that comment block to describe the new contract.
  2. **Up-front 'received' stamp**, placed AFTER the short-circuit: upsert
     `{ stripe_event_id, event_type, status: 'received' }` with
     `{ onConflict: 'stripe_event_id', ignoreDuplicates: true }` — `DO NOTHING` so an existing
     `'processed'` row is never downgraded. If it errors: `isMissingColumnError` → skip
     silently (fall back to record-on-completion only); any other error → Sentry-capture and
     continue. **Never return non-200 because of ledger bookkeeping.**
  3. **Handler failure path (line 117).** Keep the Sentry capture and the 500 response
     unchanged, and add a best-effort stamp: upsert `{ stripe_event_id, event_type, status:
     'error', error_detail }` with `ignoreDuplicates: false` (DO UPDATE). `error_detail` is
     `` `${err instanceof Error ? err.name : 'UnknownError'}: ${event.type}` `` — **never
     `err.message`**: Stripe SDK messages can echo customer emails and payload fragments,
     and this row is long-lived. Wrap in try/catch; on failure Sentry-capture and still
     return the 500. Stripe must still re-deliver.
  4. **Success path (line 128).** Upsert `{ stripe_event_id, event_type, status: 'processed',
     processed_at: new Date().toISOString(), error_detail: null }` with `onConflict:
     'stripe_event_id'` and `ignoreDuplicates: false` so it upgrades the `'received'` row.
     On `isMissingColumnError`, retry the legacy shape `{ stripe_event_id, event_type }` with
     `ignoreDuplicates: true`. Any residual error: Sentry-capture, still return 200 (as today
     — processing already succeeded).

**Step C — update the existing tests.** `route.test.ts` currently asserts
"handler throw → 500 and NO ledger write" (line 195) — that contract intentionally changes.
Update `makeServiceClient` so `maybeSingle` resolves `{ data: alreadyProcessed ?
{ stripe_event_id: <id>, status: 'processed' } : null, error: null }`, then:
  - keep "bad signature → 400, no ledger write" unchanged;
  - keep "duplicate event → 200, handler NOT re-run, no ledger write" (the short-circuit
    still precedes the 'received' stamp);
  - **rewrite** the throw case to: 500, `ledgerUpsert` called with `status: 'received'` then
    `status: 'error'`, and **never** with `status: 'processed'`;
  - update the success case to assert `status: 'processed'` and a `processed_at`;
  - **add**: a prior `{ status: 'received' }` row does NOT short-circuit — the handler runs
    and the route returns 200;
  - **add**: a `PGRST204` from the ledger write degrades to the legacy shape and the route
    still returns its normal status.

**Step D — reconcile alerting (`src/lib/inngest/functions/stripe-reconcile.ts`).** Inside the
existing `step.run('reconcile', ...)`, add a stuck-row sweep: select
`stripe_event_id, event_type, status, created_at` from `stripe_webhook_events` where
`status` is in `('received','error')` and `created_at < now - 1h`. If the query errors with
`isMissingColumnError` (export the helper from the route module or duplicate it locally with
a comment), **skip silently** — the migration is not applied yet. On any rows found, emit
`Sentry.captureMessage('stripe_webhook_events_stuck', { level: 'error', tags: { phase: 'p5',
layer: 'inngest', function: 'stripe-reconcile', subop: 'stuck-events' }, extra: { count,
sample_event_ids: firstFive } })`. Stripe event ids are not PII — event bodies would be, so
log ids and counts only. Include the count in the function's return object alongside
`anomalies`. Do not attempt to auto-reprocess; loud is the deliverable, per the standing
"no safety net" handover item.
  </action>

  <verify>
    <automated>pnpm typecheck && pnpm lint && pnpm exec vitest run src/app/api/stripe/webhook/route.test.ts && grep -q "processed_at" supabase/migrations/20260804130100_stripe_webhook_event_status.sql && grep -q "error_detail" supabase/migrations/20260804130100_stripe_webhook_event_status.sql && grep -q "PGRST204" src/app/api/stripe/webhook/route.ts && grep -q "42703" src/app/api/stripe/webhook/route.ts && grep -q "stripe_webhook_events" src/lib/inngest/functions/stripe-reconcile.ts && grep -q "stripe_webhook_events_stuck" src/lib/inngest/functions/stripe-reconcile.ts && ! grep -q "err.message" src/app/api/stripe/webhook/route.ts && NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy ANTHROPIC_API_KEY=sk-ant-dummy INNGEST_EVENT_KEY=dummy INNGEST_SIGNING_KEY=dummy OPENAI_API_KEY=sk-dummy pnpm build</automated>
  </verify>

  <done>
The ledger records receipt AND outcome, but only a `'processed'` row short-circuits — a
failed webhook is still re-delivered and re-driven by Stripe. All ledger writes degrade
silently when the columns are absent, so deploying this code before the migration is safe.
`error_detail` carries no PII. The daily reconcile alerts loudly on rows stuck over an hour
and skips silently pre-migration. Webhook tests green (including the two new cases), full
dummy-env build passes.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Inngest event → service-role function | Event payloads are untrusted; the service-role client bypasses RLS entirely |
| Browser → RSC search/list pages | Recruiter-supplied query text crosses into audit metadata |
| Stripe → webhook route | Unauthenticated internet POST; HMAC is the only gate |
| Super-admin → cross-org export | The one path that legitimately reads another org's data |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-lih-01 | Spoofing / Information disclosure | `score-application-match.ts` | mitigate | Re-verify `candidate.organization_id` AND `job.organization_id` against the event's `organization_id` before any read or AI call; `NonRetriableError` on mismatch (mirrors `precompute-matches-for-job.ts:118-123`) |
| T-lih-02 | Denial of service (cost) | `score-application-match.ts` | mitigate | Cached-summary idempotency read before spending; `ai_summaries` unique constraint as the concurrent backstop; `MAX_MONTHLY_MATCH_SPEND_PENCE` ceiling; `CapExceededError` bail; Inngest `concurrency { limit: 2, key: organization_id }`; empty-profile skip |
| T-lih-03 | Information disclosure | `search/page.tsx`, `candidates/page.tsx` | mitigate | Audit metadata restricted to `{mode, semantic_ok, result_count, surface}`; the raw query string is NEVER recorded; verify gate greps for its absence |
| T-lih-04 | Repudiation | `set_created_by()` trigger | accept | `coalesce` lets an explicit value win, but no client-reachable path sets `created_by`; worst case is in-org attribution spoofing with no cross-tenant impact — unchanged from today's risk |
| T-lih-05 | Elevation of privilege | `set_created_by()` | mitigate | Returns `trigger` (not PostgREST-RPC callable), SECURITY INVOKER, `set search_path = public`, no `grant execute` added — deliberately avoids widening the audit's 11-anon-executable-definer finding |
| T-lih-06 | Tampering | `stripe/webhook/route.ts` | mitigate | Short-circuit ONLY on `status = 'processed'` (or legacy NULL); `'received'`/`'error'` rows must re-drive. Up-front stamp uses `DO NOTHING` so a `'processed'` row is never downgraded |
| T-lih-07 | Information disclosure | `stripe_webhook_events.error_detail` | mitigate | Store `err.name` + `event.type` only; never `err.message` (Stripe SDK messages can echo customer emails). Reconcile logs event ids + counts, never bodies |
| T-lih-08 | Information disclosure | `admin/[orgId]/export/route.ts` | mitigate | `recordServiceAudit` files the `export` row against the EXPORTED org with the super-admin's user id, so cross-org reads are attributable; actor email is never stored |
| T-lih-SC | Tampering (supply chain) | `pnpm add @vercel/analytics` | mitigate | Verified `[OK]` against the npm registry at plan time (official `@vercel` org, `vercel-release-bot` maintainer, `github.com/vercel/analytics`, MIT, zero runtime deps, 5.25M weekly downloads). Sole permitted new dependency |
</threat_model>

<founder_handoff>
**Two migration files are produced but NOT applied. Nothing in this plan touches production.**

**Version prefixes are deliberately `202608041300xx`, not `202608041200xx`.** Batch 1
(`260804-lfz`) already claims `20260804120000_candidate_cvs_parse_error_detail.sql` and
`20260804120100_revoke_anon_execute_security_definer.sql`. Supabase's migration ledger keys
on the numeric prefix, so two files sharing a version is exactly the `db push` drift the
founder hit on 2026-07-08. If Batch 1's filenames change, re-check for a collision before
committing.

- `supabase/migrations/20260804130000_set_created_by_trigger.sql`
- `supabase/migrations/20260804130100_stripe_webhook_event_status.sql`

Both are additive only: new trigger, new nullable/defaulted columns, new index. No DROP, no
DELETE, no rewrite of existing rows. Apply via the founder's manual `pnpm exec supabase
db push --linked` flow — **not** via MCP `apply_migration`, which stamps the ledger version
as the current UTC timestamp rather than the filename and causes `db push` drift (known
since 2026-07-08).

Task 3's code is written to run correctly whether the migration lands before or after the
deploy, so ordering is not a blocker. Task 2's `created_by` stamping simply does not happen
until the migration is applied.

After applying, regenerate types with `pnpm db:types` and drop the narrow casts added in
Task 3 in a follow-up.
</founder_handoff>

<verification>
Run in order after all three tasks:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm exec vitest run` (full suite — nothing pre-existing may regress)
4. The dummy-env `pnpm build` from `<environment_notes>`
5. `git log --oneline -3` — exactly three atomic commits, one per task
6. `git diff --stat main...HEAD -- supabase/migrations/` — exactly two NEW files, zero
   modifications to any previously committed migration

**MANDATORY before any human UAT (global HARD RULE #1 — the founder is a non-coding vibe
coder and cannot proofread this):**
- `/gsd-code-review` over every file in `files_modified`. Pay specific attention to:
  silent-fail mutations, fire-and-forget without `onError`, mutation payload fields that do
  not exist in the schema, missing idempotency guards, and cache-invalidation gaps.
- Vercel preview browser-automation pre-smoke covering: add candidate to job → score badge
  appears on the job's applications table and the pipeline card; run a `/search` query in
  both modes; open a job detail and a client detail page.
- Fix everything found, then re-run. The founder should only ever UAT residual
  subjective/cross-flow issues.
</verification>

<success_criteria>
- Adding a candidate to a job (any of the four paths) produces exactly one `ai_summaries`
  `match_score` row for that candidate x job pair, and re-firing produces none.
- A candidate with an effectively empty profile is never scored (audit SF-1's "score
  computed from nothing" cannot recur).
- The score and its one-line note are visible on `/jobs/[id]` and on pipeline cards.
- `/search` writes an audit row in all three branches with `semantic_ok` present.
- Both migration files exist, are append-only and additive, and are unapplied.
- The Stripe webhook stamps received → processed/error, degrades silently pre-migration,
  and a failed event is STILL re-delivered and re-driven by Stripe.
- `@vercel/analytics` is the only new dependency; `<Analytics />` renders in the root layout.
- Full test suite green; dummy-env build green; three atomic commits.
</success_criteria>

<output>
Create `.planning/quick/260804-lih-sc-review-batch-2-match-scores-on-applic/260804-lih-SUMMARY.md`
when done. Include: the two migration filenames for the founder handoff, whether Batch 1's
empty-profile guard was reused or newly created, and the re-confirmed answer on whether the
public apply flow creates application rows.
</output>
