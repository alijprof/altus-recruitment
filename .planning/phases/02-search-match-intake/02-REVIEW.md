---
phase: 02-search-match-intake
reviewed: 2026-05-19T00:00:00Z
depth: deep
files_reviewed: 81
files_reviewed_list:
  - next.config.ts
  - package.json
  - src/app/(app)/clients/[id]/jobs/new/actions.ts
  - src/app/(app)/jobs/[id]/matches/actions.ts
  - src/app/(app)/jobs/[id]/matches/explain-button.tsx
  - src/app/(app)/jobs/[id]/matches/match-card.tsx
  - src/app/(app)/jobs/[id]/matches/page.tsx
  - src/app/(app)/jobs/[id]/page.tsx
  - src/app/(app)/search/page.tsx
  - src/app/(app)/search/search-input.tsx
  - src/app/(app)/search/search-results.tsx
  - src/app/(app)/settings/apply-form-actions.ts
  - src/app/(app)/settings/apply-form-toggle.tsx
  - src/app/(app)/settings/integrations/actions.ts
  - src/app/(app)/settings/integrations/connect-outlook-card.tsx
  - src/app/(app)/settings/integrations/integration-buttons.tsx
  - src/app/(app)/settings/integrations/outlook-actions.ts
  - src/app/(app)/settings/integrations/page.tsx
  - src/app/(app)/settings/page.tsx
  - src/app/(app)/settings/usage/page.tsx
  - src/app/(public)/apply/[orgSlug]/actions.ts
  - src/app/(public)/apply/[orgSlug]/apply-form.tsx
  - src/app/(public)/apply/[orgSlug]/page.tsx
  - src/app/(public)/apply/[orgSlug]/schema.ts
  - src/app/(public)/apply/[orgSlug]/success/page.tsx
  - src/app/(public)/apply/[orgSlug]/success/success-toast.tsx
  - src/app/(public)/layout.tsx
  - src/app/api/inngest/route.ts
  - src/app/api/outlook/callback/route.ts
  - src/app/api/outlook/webhook/route.ts
  - src/components/app/match-score-badge.tsx
  - src/components/app/top-nav.tsx
  - src/lib/ai/claude.ts
  - src/lib/ai/embed-text.ts
  - src/lib/ai/match.ts
  - src/lib/ai/voyage.ts
  - src/lib/db/activities.ts
  - src/lib/db/ai-summaries.ts
  - src/lib/db/candidates.ts
  - src/lib/db/contacts.ts
  - src/lib/db/embeddings.ts
  - src/lib/db/jobs.ts
  - src/lib/db/organizations.ts
  - src/lib/db/outlook-credentials.ts
  - src/lib/encryption.ts
  - src/lib/env.ts
  - src/lib/inngest/functions/bootstrap-vector-index.ts
  - src/lib/inngest/functions/cleanup-stale-summaries.ts
  - src/lib/inngest/functions/create-outlook-subscription.ts
  - src/lib/inngest/functions/embed-batch.ts
  - src/lib/inngest/functions/embed-job-on-jd-change.ts
  - src/lib/inngest/functions/parse-cv.ts
  - src/lib/inngest/functions/precompute-matches-for-job.ts
  - src/lib/inngest/functions/refresh-outlook-subscription.ts
  - src/lib/inngest/functions/sync-outlook-history.ts
  - src/lib/integrations/apply-form-rate-limit.ts
  - src/lib/integrations/outlook.ts
  - src/lib/integrations/turnstile.ts
  - src/lib/legal/apply-form-blocklist.ts
  - src/lib/legal/consent.ts
  - src/lib/observability/inngest.ts
  - src/lib/supabase/middleware.ts
  - src/types/database.ts
  - supabase/migrations/20260519092943_phase2_organizations_extensions.sql
  - supabase/migrations/20260519092944_ai_summaries.sql
  - supabase/migrations/20260519092945_outlook_credentials.sql
  - supabase/migrations/20260519092946_apply_form_rate_limits.sql
  - supabase/migrations/20260519092947_record_audit_anonymous.sql
  - supabase/migrations/20260519092948_hnsw_build_state.sql
  - supabase/migrations/20260519092949_match_candidates_rpc.sql
  - supabase/migrations/20260519092950_match_jobs_rpc.sql
  - supabase/migrations/20260519092951_invalidate_embeddings_triggers.sql
  - supabase/migrations/20260519111500_match_candidates_for_job_rpc.sql
  - supabase/migrations/20260519120000_contacts_email_idx.sql
  - tests/unit/app/apply/confirm-action-inngest-fallback.test.ts
  - tests/unit/app/apply/rate-limit.test.ts
  - tests/unit/app/apply/schema.test.ts
  - tests/unit/app/apply/turnstile.test.ts
  - tests/unit/lib/ai/embed-text.test.ts
  - tests/unit/lib/encryption.test.ts
  - tests/unit/lib/legal/apply-form-blocklist.test.ts
  - tests/unit/outlook-webhook.test.ts
findings:
  critical: 1
  high: 3
  medium: 7
  low: 8
  total: 19
status: issues_found
---

# Phase 2 Code Review

**Reviewer:** gsd-code-reviewer
**Date:** 2026-05-19
**Scope:** 15 commits, `56a9d86..648a644` (Plans 0–4)
**Files reviewed:** 81 (src + supabase/migrations + tests + config)
**LOC reviewed:** ~11,100

## Summary

Verdict: **APPROVE WITH FIXES** — one CRITICAL cross-tenant data exposure via the precompute-matches Inngest function leaks candidate data from foreign orgs into Anthropic's API; three HIGH severity issues around subscription renewal, on-demand explain action, and HNSW privilege escalation; the rest are tightenings.

The vast majority of Phase 2 is well-built. The new attack surfaces (apply form, Outlook OAuth callback, Graph webhook, expanded service-role footprint) are handled with the right discipline: explicit tenant assertions, fail-closed env checks, PII-scrubbed Sentry capture, encrypted token storage, HMAC-derived clientState, single-tenant Entra guard. The R-patch verification holds (M-1..M-8, W-1). The single-instance SDK invariants hold across `Anthropic` (1), `VoyageAIClient` (1), `ConfidentialClientApplication` (1), Graph `Client` (1 — only in outlook.ts), and `googleapis/gmail` greps return nothing. Phase 1's C1 class (cross-tenant candidate_cvs FK guard) is reused as a pattern at every new write boundary, and the FK guard trigger naming follows the `_verify_same_org_check` convention so trigger-order ordering bug doesn't recur on `ai_summaries`.

But the precompute-matches Inngest function (Plan 2 Task 2.1) calls `match_candidates_for_job` via service-role, which bypasses RLS on the underlying SELECT against `candidates`. The function returns a TOP-N over the GLOBAL candidate pool (across all orgs) rather than the requesting tenant's pool. Sonnet is then called with foreign-tenant candidate summaries (cost billed to the requesting org), exposing other orgs' candidate names, roles, locations, and skill tags via Anthropic API logs. The subsequent `upsertMatchSummary` would fail with "organization_id required" (the requesting org's set_org trigger errors on the foreign candidate), so the leaked data doesn't land in `ai_summaries` — but the exposure to Anthropic has already happened, and the recruiter's cost ledger is poisoned. This is the C1 class of bug repeated through a different mechanism: the executors carefully boundary-checked the JOB row but trusted the candidate-side RPC to RLS-filter when RLS is the very thing service-role bypasses.

Top three to fix before release:
1. **Fix C1 — precompute-matches cross-tenant candidate fetch.** Either revoke EXECUTE on `match_candidates_for_job` from public/service_role and require an org filter param, OR add an explicit `where organization_id = p_organization_id` filter inside the RPC. Sonnet must never see foreign-org candidate data even if the write later fails.
2. **Fix H1 — refresh-outlook-subscription writes empty-string clientState back when the original was null.** A subscription that survived without a recorded clientState gets reused with `subscription_client_state = ''`, and the webhook's `n.clientState === ''` check then accepts unauthenticated notifications for that subscription. Defence in depth gone.
3. **Fix H2 — explainCandidateMatchAction has no rate limit; an authenticated recruiter can fire Sonnet calls in a tight loop until the £100 monthly ceiling is reached.** The precompute Inngest function has the spend guard; the synchronous on-demand action does not.

## Findings

### CRITICAL

#### C1: `precompute-matches-for-job` Inngest function leaks cross-tenant candidate data to Anthropic (Sonnet) via service-role RPC

**File:** `src/lib/inngest/functions/precompute-matches-for-job.ts:171-258`
**Supporting:** `src/lib/db/embeddings.ts:272-288` (`getTopCandidatesForJob`), `supabase/migrations/20260519111500_match_candidates_for_job_rpc.sql:32-83` (`match_candidates_for_job` RPC), `supabase/migrations/20260519092949_match_candidates_rpc.sql:37-119` (`match_candidates` RPC)
**Severity:** CRITICAL
**Category:** multi-tenancy / cross-tenant data exposure / cost leak

**Finding:**

`precomputeMatchesForJob` is invoked from `embed-job-on-jd-change.ts:115-122` (`step.sendEvent('rescore-after-embed', ...)`) and `createJobAction:94-101` (`inngest.send({ name: 'job/score-top-candidates', ... })`). Inside the function, line 110 instantiates `createServiceClient()` (RLS-bypass) and line 171-181 calls `getTopCandidatesForJob(supabase, { jobId: job_id, limit: 10 })`, which calls the `match_candidates_for_job` RPC.

`match_candidates_for_job` (migration 20260519111500, lines 47-49) is declared `security invoker` with `set search_path = public`. The body reads `select j.job_embedding into v_embedding from public.jobs j where j.id = p_job_id` (which has been pre-validated by the function's tenant boundary check at line 119, so the job is in the requesting org), then calls `match_candidates('', v_embedding, p_match_count, 0)`. That nested RPC's body (migration 20260519092949) is also `security invoker` and contains `from public.candidates c where c.candidate_embedding is not null` — with NO `where organization_id = ?` filter.

When invoked under service-role (which has the `bypassrls` attribute by Supabase convention), the function executes as service-role and RLS on `public.candidates` does NOT apply. The trigram CTE's `from public.candidates` likewise reads across all orgs. Result: `getTopCandidatesForJob` returns the top-10 vector-similar candidates ACROSS THE ENTIRE DATABASE, not just the requesting tenant's pool.

The function then iterates each candidate (line 199-258):

1. `getCandidateForEmbedding(supabase, candidate.id)` — service-role read, returns the foreign-tenant candidate's full_name, current_role_title, current_company, location, skills, sector_tags, seniority, years_experience (`src/lib/db/candidates.ts:485-503`).
2. `buildMatchInputs` (`src/lib/ai/match.ts:157-183`) packages that into the candidate summary string.
3. `scoreCandidateForJob(...)` (line 233-238) — calls Sonnet via `runWithLogging(model: 'claude-sonnet-4-6', organizationId: <requesting-org>, ...)` (`src/lib/ai/match.ts:98-127`). Anthropic now has the foreign tenant's CV summary in its prompt logs, attributed to the requesting org.
4. `upsertMatchSummary(...)` (line 240-248) — runs as service-role. The `ai_summaries_set_org` BEFORE INSERT trigger calls `public.current_organization_id()` which returns NULL (no session), then `set_organization_id` raises "organization_id is required and could not be resolved from auth context". The upsert fails — captured silently as a "no-op" comment at line 249-255. The Sonnet call HAS BEEN MADE, the ai_usage row HAS BEEN WRITTEN (charged to requesting org), the foreign-tenant data HAS LEAKED via Anthropic API. Only the cache row is missing.

Net effect, per job-embed event in org A:
- Service-role reads candidates across orgs A, B, C, …
- Up to 10 Sonnet calls hit Anthropic with arbitrary candidates' CV data
- ai_usage rows accumulate in org A's spend ledger
- ai_summaries inserts fail silently
- Recruiter in org A sees the precompute "complete" with `scored: 0, cache_hits: 0, top_n: 10` — looks like a clean run

**Why it matters:**

Three distinct harms:
1. **Cross-tenant data exposure via third party.** Anthropic logs prompts. Foreign-tenant candidate PII (name, role, company, location, skills) is now in those logs, attributed to a different paying customer.
2. **Cost mis-attribution.** Org A's ai_usage.cost_pence accumulates for matches over org B's candidates. The £100/month ceiling fires for the wrong tenant.
3. **CLAUDE.md core principle violation.** "Cross-tenant data leakage is the worst possible bug." Even though the data doesn't land in *our* DB, the exposure to a third-party LLM IS a leak.

The exact same class of bug as Phase 1 C1 — executors carefully validated the JOB row's `organization_id` but trusted RLS to gate the candidate-side fetch. The lesson from Phase 1 was "don't trust RLS when service-role is in play." It was repeated.

**Recommended fix:**

Multiple layers; the executor should pick the strongest:

(A) **RPC-side org filter.** Modify `match_candidates_for_job` to accept `p_organization_id uuid` and inject `where c.organization_id = p_organization_id` into BOTH CTEs of `match_candidates` (or wrap with an org-scoped view). This is the principled fix — RLS bypass is the threat model, so the RPC must defend without relying on RLS:

```sql
-- New signature:
create or replace function public.match_candidates_for_job(
  p_job_id uuid,
  p_organization_id uuid,
  p_match_count integer default 10
) ...
declare
  v_embedding halfvec(1024);
  v_org_id uuid;
begin
  select j.job_embedding, j.organization_id
    into v_embedding, v_org_id
    from public.jobs j
   where j.id = p_job_id;
  if v_embedding is null then return; end if;
  if v_org_id is distinct from p_organization_id then
    raise exception 'job/org mismatch';
  end if;
  -- Then call a new match_candidates that filters by org_id.
end;
```

(B) **Caller-side filter** (weaker but trivial). After `getTopCandidatesForJob` returns, immediately drop any candidate whose `organization_id !== organization_id`. Requires `getCandidateForEmbedding` to be called first (per candidate) before the Sonnet call. The current code DOES call `getCandidateForEmbedding` before `scoreCandidateForJob` — so an explicit guard there closes the leak:

```ts
if (candidateResult.data.organization_id !== organization_id) {
  // Foreign-tenant candidate — should have been filtered by RPC.
  // Fail closed.
  throw new NonRetriableError('cross-tenant candidate in match top-N')
}
```

This is `O(N)` extra reads and a CR fence that catches the RPC's tenant-leak before the Sonnet call. Pair with (A) for defence-in-depth.

(C) Audit every other service-role + `security invoker` RPC chain in the codebase for the same pattern. Specifically `hybridSearchCandidates` and `hybridSearchJobs` — both are called by recruiter-facing paths today (service-role would be an issue if any future caller uses it; today they're safe).

The fix MUST land before the next Inngest deployment.

---

### HIGH

#### H1: `refresh-outlook-subscription` writes empty-string `subscription_client_state` when the original was null — allows unauthenticated webhook notifications for affected subscriptions

**File:** `src/lib/inngest/functions/refresh-outlook-subscription.ts:152-157`
**Supporting:** `src/app/api/outlook/webhook/route.ts:136-149` (clientState validation), `src/lib/db/outlook-credentials.ts:178-204` (`updateOutlookAccessToken`), `supabase/migrations/20260519092945_outlook_credentials.sql:60-61` (subscription_client_state column)
**Severity:** HIGH
**Category:** security / webhook authentication bypass

**Finding:**

In the renew path (lines 148-171):

```ts
const writeResult = await updateOutlookSubscriptionState(serviceClient, {
  userId: cred.user_id,
  subscriptionId: cred.subscription_id,
  subscriptionClientState: cred.subscription_client_state ?? '',
  subscriptionExpiresAt: expirationDateTime,
})
```

The `?? ''` clause replaces a null `subscription_client_state` with an empty string. If a credential row reached this code path with `subscription_client_state IS NULL` (e.g., a partially-written row where create-subscription persisted `subscription_id` but the clientState write failed; or a manual DBA insert), the PATCH-renew writes `subscription_client_state = ''` back.

Later, a Graph notification arrives at `/api/outlook/webhook` POST. The handler checks (route.ts:136-139):

```ts
const allClientStateOk = forSub.every(
  (n) => n.clientState === cred.subscription_client_state,
)
```

A forged notification with `clientState: ''` (just omit the field; Graph notifications without clientState pass `undefined`, which `=== ''` is false — but `clientState: ''` literal IS `=== ''`). So an attacker who knows or guesses a subscription_id and posts `{ value: [{ subscriptionId, clientState: '' }] }` matches, the handler fires `outlook/history-changed`, and the Inngest sync function runs a delta query that imports activity rows into the org.

**Why it matters:**

`clientState` is the ONLY authentication signal on the Graph webhook (Microsoft doesn't sign notifications). An empty-string clientState bypass equates to "no auth" for that subscription. The blast radius is bounded to the affected org's Outlook sync (no cross-tenant), but a malicious actor with knowledge of the subscription_id can inject arbitrary delta-sync triggers, potentially DoS'ing the Inngest concurrency budget and the Anthropic AI-usage spend ceiling (since each sync triggers downstream embed flows for any newly-matched candidates' emails).

The `subscription_client_state` column is NULLABLE in the migration (line 61) — the schema allows the empty-state scenario.

**Recommended fix:**

(A) Refuse to renew when `subscription_client_state IS NULL`. Treat it as a corrupted row, log Sentry, mark the row as needing recreation. Don't write `''` back:

```ts
if (!cred.subscription_client_state) {
  // Row is incomplete — schedule a recreate rather than carrying ''
  // forward as a forged-friendly clientState.
  await tryRecreate(...)
  return
}
```

(B) In the webhook validator, reject empty clientState explicitly:

```ts
const allClientStateOk = forSub.every(
  (n) =>
    typeof n.clientState === 'string' &&
    n.clientState.length > 0 &&
    cred.subscription_client_state &&
    n.clientState === cred.subscription_client_state,
)
```

Both should land — A prevents the corrupted-row from ever existing; B is defence-in-depth for any other path that might null the column.

---

#### H2: `explainCandidateMatchAction` has no per-org spend ceiling or per-user rate limit — synchronous Sonnet exposure to a runaway clicker

**File:** `src/app/(app)/jobs/[id]/matches/actions.ts:62-171`
**Supporting:** `src/lib/inngest/functions/precompute-matches-for-job.ts:149-166` (the ceiling guard that DOES exist)
**Severity:** HIGH
**Category:** cost protection / DoS resistance

**Finding:**

`precomputeMatchesForJob` reads `getOrgMatchSpendThisMonth` and bails when `>= env.MAX_MONTHLY_MATCH_SPEND_PENCE` (default £100). `explainCandidateMatchAction` does NOT. The action is synchronously callable from any authenticated org member, takes 3-6s per Sonnet call (W-1 documented exception), and writes a real ai_usage row each time.

A recruiter who clicks "Explain match" repeatedly (or a malicious org-member with API access who fires the action in a loop) can burn through the £100 ceiling in minutes — and worse, the precompute ceiling won't catch it because spend has already crossed the line before the next Inngest batch runs. There is no per-user rate limit; the only constraint is RLS-scoped candidate/job existence + the cache hit on second-click.

There's also no idempotency window: each click that lands as a cache-miss fires a Sonnet call. If two recruiters click the same Explain button simultaneously, two Sonnet calls fire (the upsertMatchSummary unique constraint catches the second insert, but the cost is already spent — see L4 in Phase 1 for the parallel pattern).

**Why it matters:**

The match-spend ceiling is the cost-bomb defence. Bypassing it via the on-demand action means a single org member can DoS the company's monthly AI budget without the precompute path's protection firing. This is the kind of bug that's invisible until the Anthropic bill arrives.

**Recommended fix:**

(A) Read `getOrgMatchSpendThisMonth` at the start of the action and return a "spend ceiling reached" error before calling Sonnet. Cheap; uses the same helper:

```ts
const spendResult = await getOrgMatchSpendThisMonth(supabase, organizationId)
if (spendResult.ok && spendResult.data >= env.MAX_MONTHLY_MATCH_SPEND_PENCE) {
  return { ok: false, error: 'Match scoring is paused for this month. Contact your administrator.' }
}
```

(B) Add a per-user rate limit (e.g. 30 explains per recruiter per hour). Reuse the Postgres-backed rate-limit pattern from `apply-form-rate-limit.ts`; or use Inngest concurrency with a per-user key on a `match/explain-requested` event + poll (would also remove the W-1 synchronous exception). Phase 3 follow-up if not urgent.

---

#### H3: `triggerHnswBuildAction` has no role check — any authenticated user (any org) can fire the build event

**File:** `src/app/(app)/settings/integrations/actions.ts:66-101`
**Supporting:** `src/lib/inngest/functions/bootstrap-vector-index.ts:41-211` (the function fires globally — table-level CONCURRENTLY DDL)
**Severity:** HIGH
**Category:** authorization / privilege escalation

**Finding:**

```ts
export async function triggerHnswBuildAction(rawInput: unknown) {
  const parsed = buildIndexSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: 'Invalid table name.' }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  try {
    await inngest.send({
      name: 'admin/build-vector-index',
      data: { table_name: parsed.data.table },
    })
```

Only signed-in. No `me.role === 'owner'` check. No org-scoping (the HNSW index is global per migration design — D2-05). So:
- Any recruiter in any tenant can fire the build event for either `candidates` or `jobs`.
- The build is a one-shot ops gesture, but firing it triggers the Sentry "BUILD ME" message + updates ops state shared across all orgs (`hnsw_build_state.last_attempt_at`).
- An attacker with a free recruiter seat in any tenant can spam-clear the operator's "ready to build" signal.

By contrast, `toggleApplyFormEnabledAction` (`apply-form-actions.ts:38-40`) DOES check `me.role !== 'owner'` — the convention exists; this action just skipped it.

The IntegrationsPage renders the BuildIndexButton (`page.tsx:224`) regardless of role. UI is also missing the gate.

**Why it matters:**

Privilege escalation is the standard "shared-app DoS" category. Not catastrophic (the operator notices), but inconsistent with the rest of the codebase's role-based controls. Plus: in Phase 5 SaaS shell, the same path becomes "any SaaS tenant can fire the global HNSW build" — they'd notice fast.

**Recommended fix:**

Mirror the apply-form pattern: read the caller's role via the RLS-scoped users table first, require `role === 'owner'` (or a future `admin`). Also gate the UI in `IntegrationsPage` so non-owners don't even see the button:

```ts
const { data: me } = await supabase
  .from('users')
  .select('role')
  .eq('id', user.id)
  .maybeSingle()
if (!me || me.role !== 'owner') {
  return { ok: false, error: 'Only owners can trigger HNSW build.' }
}
```

Same fix for `triggerCandidateBackfillAction` — currently allows any authenticated user to backfill embeddings for their org, which costs money via the Voyage ai_usage rows. Less severe (org-scoped) but the same hygiene.

---

### MEDIUM

#### M1: `findCandidateByEmail` and `findContactByEmail` use `.ilike` with unescaped user-controlled email — Outlook sync can attribute emails to the wrong candidate

**File:** `src/lib/db/candidates.ts:664-685`, `src/lib/db/contacts.ts:126-147`
**Severity:** MEDIUM
**Category:** input handling / data integrity

**Finding:**

```ts
const normalised = email.toLowerCase().trim()
const { data, error } = await supabase
  .from('candidates')
  .select('id')
  .eq('organization_id', organizationId)
  .ilike('email', normalised)
  .limit(1)
  .maybeSingle()
```

`.ilike(column, pattern)` interprets `%` and `_` in `pattern` as wildcards. Email local-parts can legally contain `_` (per RFC 5321/5322 — `john_doe@x.com` is valid). The sync function's `classifyMessage` (sync-outlook-history.ts:67-83) pulls `fromEmail` and `toEmails` from the Graph payload — these are real-world emails the recruiter received. An incoming email from `john_doe@x.com` triggers `findCandidateByEmail(supabase, 'john_doe@x.com', org)`, which fires `.ilike('email', 'john_doe@x.com')` — but `_` is a wildcard. The query matches:

- `john_doe@x.com` ✓ (intended)
- `johnAdoe@x.com` (false positive)
- `john1doe@x.com` (false positive)
- any single-char substitution at the `_` position

`maybeSingle()` adds a small mercy — if multiple rows match, the helper throws "rows must be unique" and the candidate is treated as "not found" via the error path. But:
- The Postgres `expects exactly 0 or 1 rows` error from `maybeSingle` is captured to Sentry as `error: 'internal'` (line 678), turning a forensic data leak into an opaque internal error.
- If only ONE other candidate matches the wildcard pattern, the activity gets attributed to the wrong candidate without any error. This is a real data-integrity leak inside the org (not cross-tenant, but cross-candidate).

The same applies to `findContactByEmail` (contacts.ts:126-147). The new `contacts_email_idx` indexes `lower(email)` not the wildcards.

**Why it matters:**

Recruiter sees email activity attributed to "Alice" when the actual sender was "Bob" — bad UX, bad data trail, bad reply suggestions downstream. Also: the `candidates.email` field has no `unique(organization_id, email)` constraint, so multiple-candidate matches are possible — the false-positive case isn't hypothetical.

**Recommended fix:**

Escape the wildcard chars or switch to `.eq` with `lower()` via an RPC. Cheapest:

```ts
const escaped = normalised.replace(/[\\%_]/g, '\\$&')
// then .ilike('email', escaped) — Postgres handles the backslash escape
```

Or — cleaner — store email in lowercase at write time and use `.eq` here. The apply form already trims via Zod but doesn't lowercase before insert (`actions.ts:264 email: parsed.data.email`). Adding `.toLowerCase()` to the apply form's email path AND a future `lower()` index lets `.eq` use the index and dodges the wildcard issue entirely.

---

#### M2: Apply form `getCandidateByEmailForOrg` is case-sensitive — `Alice@x.com` and `alice@x.com` create duplicate candidates

**File:** `src/lib/db/candidates.ts:393-413` + `src/app/(public)/apply/[orgSlug]/actions.ts:225-228`
**Severity:** MEDIUM
**Category:** data integrity / duplicate detection

**Finding:**

```ts
const { data, error } = await supabase
  .from('candidates')
  .select('id, market_status')
  .eq('organization_id', args.organizationId)
  .eq('email', args.email)
  .limit(1)
  .maybeSingle()
```

`.eq('email', args.email)` is case-sensitive. The applicant submits `Alice@example.com`. Schema trims but doesn't lowercase (apply schema.ts:42-49). Action calls `getCandidateByEmailForOrg(supabase, { organizationId, email: 'Alice@example.com' })`. Existing candidate with `email = 'alice@example.com'` is NOT matched. A new candidate row is created with `email = 'Alice@example.com'`.

The recruiter now has two candidates that are the same person. The Phase 1 candidates_email_idx on (organization_id, email) doesn't catch it either (case-sensitive index).

By contrast, `findCandidateByEmail` (M1 above) IS case-insensitive — so the Outlook sync attributes the email to whichever variant was created first. Inconsistent semantics between two sibling helpers in the same file.

**Why it matters:**

Phase 1's anchor agency claims 2-3 recruiters. Duplicate candidates inflate the pipeline, double-count outreach effort, and silently break the "one candidate, one record" invariant. The fix is trivial and the bug is reproducible by any applicant typing their email with mixed case.

**Recommended fix:**

Add `.toLowerCase()` to the apply schema (or in the action right before the lookup + insert):

```ts
// schema.ts:
email: z
  .string()
  .trim()
  .toLowerCase()   // normalize before validation
  .max(255, 'Too long')
  .refine(...)
```

And ensure all candidate inserts (including the recruiter-facing /candidates/new path) lowercase the email at the boundary. Eventually back this with a `unique (organization_id, lower(email))` index in a Phase 3 migration.

---

#### M3: `submitApplyAction` honeypot-tripped path returns a distinct error message — gives bots a signal

**File:** `src/app/(public)/apply/[orgSlug]/actions.ts:123-131`
**Severity:** MEDIUM
**Category:** anti-abuse / bot defence

**Finding:**

```ts
if (typeof input?.hp === 'string' && input.hp.length > 0) {
  Sentry.addBreadcrumb({ category: 'apply-form', message: 'honeypot-tripped', level: 'info' })
  return { ok: false, formError: 'Your submission was flagged.' }
}
```

This response is identical to a fixed "flagged" string. Real submission paths return:
- Schema invalid → `{ ok: false, fieldErrors: {...} }`
- Blocklisted email → `{ ok: false, fieldErrors: { email: [...] } }`
- Rate-limited → `{ ok: false, formError: 'Too many submissions...' }`
- Bad slug → `{ ok: false, formError: 'Submissions are not currently accepted.' }`
- Turnstile fail → `{ ok: false, formError: 'Verification failed...' }`

The honeypot message is unique in vocabulary ("flagged"). A bot operator who sees "Your submission was flagged" learns its honeypot was triggered and can retrain to leave that field empty. The spec said "drop silently with success-shape" — instead this is silently distinguishable.

**Why it matters:**

The honeypot is one of the cheapest abuse defences; making it tell-able defeats half its value. Also: a bot that fingerprints "Your submission was flagged" can shape its next attempt.

**Recommended fix:**

Either return the successful-shape (with a no-op fake redirect) or return a generic `formError` that's identical to one of the legitimate-failure paths:

```ts
if (typeof input?.hp === 'string' && input.hp.length > 0) {
  Sentry.addBreadcrumb({ category: 'apply-form', message: 'honeypot-tripped', level: 'info' })
  // Match the rate-limit shape exactly so an attacker can't distinguish.
  return { ok: false, formError: 'Too many submissions from this network. Please try again in a few hours.' }
}
```

---

#### M4: `match_candidates_for_job` is `security invoker` but has PUBLIC EXECUTE grant (default Postgres) — coupled with C1, any role can invoke the global candidate scan

**File:** `supabase/migrations/20260519111500_match_candidates_for_job_rpc.sql:83`, `supabase/migrations/20260519092949_match_candidates_rpc.sql:119`, `supabase/migrations/20260519092950_match_jobs_rpc.sql:93`
**Severity:** MEDIUM
**Category:** privilege / RPC hardening

**Finding:**

The migrations only `grant execute ... to authenticated`. Postgres default function-execution privileges are also granted to `PUBLIC` — the migrations DON'T explicitly `revoke execute on function ... from public`. This means `anon` (the Supabase anonymous role used for `/apply/[orgSlug]` reads) also has EXECUTE. Today `anon` calls go through `createServiceClient` not the anon JWT, so the surface is narrow, but the underlying grant is wider than declared.

Per Plan 0's other RPCs the pattern is `grant execute ... to authenticated` (good) plus an implicit reliance on PUBLIC default — which the `record_audit_anonymous` migration (20260519092947) explicitly RPC-revokes (`revoke all on function ... from public, authenticated, anon`). The pattern is inconsistent.

**Why it matters:**

Coupled with C1, exploitable: any caller (including anon under the right conditions) could trigger the global candidate scan if the surface area expanded. Belt-and-braces dictates revoking PUBLIC first, then granting just the role you mean.

**Recommended fix:**

Pattern after `record_audit_anonymous`:

```sql
revoke all on function public.match_candidates(text, halfvec, integer, real)
  from public, anon;
grant execute on function public.match_candidates(text, halfvec, integer, real)
  to authenticated;
```

Same for `match_candidates_for_job` and `match_jobs`. Service_role's bypass via `usesuper` isn't affected (which is the OTHER fix — see C1 — but defence in depth wants both layers).

---

#### M5: `cleanup-stale-summaries` deletes across all orgs as service-role without per-org cap — runaway-loop risk under degenerate cache key collision

**File:** `src/lib/inngest/functions/cleanup-stale-summaries.ts:43-57` + `src/lib/db/ai-summaries.ts:294-411`
**Severity:** MEDIUM
**Category:** correctness / resilience

**Finding:**

`deleteStaleMatchSummaries` reads ALL `ai_summaries` rows (no LIMIT, no chunking), fetches every referenced candidate/job's embedding_version, computes staleness in JS, and bulk-deletes by id. At anchor scale (<1k summaries) this is fine, but:

1. **No pagination.** If `ai_summaries` grows to 100k rows (one anchor → 50 candidates × 200 jobs × 10 versions = 100k easily), the in-memory build of `staleIds` blows the function's memory budget.
2. **No per-org cap.** A single buggy candidate that frequently updates (triggering invalidate_candidate_embedding → embedding_version bump → cache invalidation) generates one stale row per match per bump. The sweep deletes all of them in one DELETE statement. Should bound at maybe 1000 per run.
3. **Sentry message at line 251-256 in sync-outlook-history.ts** captures setOutlookDeltaLink failure but doesn't escalate. The cleanup function's `step.run('delete-stale')` throws a generic Error if `deleteStaleMatchSummaries` returns not-ok — the onFailure handler catches via `formatErrorForSentry`. OK.

This is more of a scale/perf concern than a correctness bug. Worth tagging though because the deferred decision was "no migration" which forced JS-side computation; if the table grows the function will fail silently (Inngest cron has retry=1, then the breadcrumb hits Sentry and dies).

**Why it matters:**

A Phase 2 sweep that worked at anchor scale silently breaks at SaaS scale. Phase 5 won't catch it because the cleanup happens via cron — recruiters won't notice the matches cache growing.

**Recommended fix:**

Add a `LIMIT 5000` on the initial summaries read; if the sweep deleted exactly that count, fire a follow-up Inngest event to re-run. Or convert to an SQL-side `DELETE FROM ai_summaries WHERE id IN (SELECT...)` RPC that does the staleness logic server-side with bounded result sets.

---

#### M6: `getOrganization`, `getOrganizationBySlug`, `bumpJobEmbedding`, `bumpCandidateEmbedding`, `createCandidate`, `updateCandidate` pass raw Supabase error to Sentry — message may contain SQL fragments that bypass beforeSend

**File:** `src/lib/db/organizations.ts:34,73,109`, `src/lib/db/jobs.ts:152,210,271,331,371,392`, `src/lib/db/candidates.ts:165,204,238,272,286`, `src/lib/db/ai-summaries.ts:101-103,144,170,242,322,357,376,404`, `src/lib/db/outlook-credentials.ts:96-99,120-126,164-167,197-201,228-232,254-257,283-286,321-323,378-381,425-428`
**Severity:** MEDIUM
**Category:** PII discipline / R4 carry-over

**Finding:**

The R4 pattern (lift error.name + status into a new Error, never pass the raw err) is applied rigorously in Inngest functions but inconsistently in `src/lib/db/*` helpers. Most are PostgrestError objects, which typically don't contain row data in `error.message` — but the err.details and err.hint fields can contain row values (Postgres "duplicate key violates unique constraint ..., key (organization_id, email) = (..., john@x.com)").

The Supabase JS client surfaces `details` as part of the captured exception. Sentry's beforeSend scrubs `event.extra` only, not `error.message` or attached object properties.

The new Voyage SDK errors (the most likely PII channel — they can echo input prompts) — but `listCandidates` semantic branch at line 130-133 ALREADY passes raw `err` to Sentry. That's a regression of the R4 rule for the Voyage path specifically.

**Why it matters:**

Phase 1 review flagged this exact class (M8). The R4 pattern was the fix. Phase 2 has more entry points to the same risk: Voyage SDK (line 130 above), Anthropic SDK calls inside scoreCandidateForJob, Microsoft Graph SDK errors. Most are caught via `captureScrubbed` in outlook.ts and `formatErrorForSentry` in inngest paths — but the db helper layer hasn't been updated.

**Recommended fix:**

For db helpers that catch Voyage/Anthropic/Graph errors, switch to `formatErrorForSentry`:

```ts
import { formatErrorForSentry } from '@/lib/observability/inngest'

// ...
catch (err) {
  Sentry.captureException(formatErrorForSentry(err, 'listCandidates.semantic:'), {
    tags: { layer: 'db', helper: 'listCandidates', branch: 'semantic-embed' },
  })
}
```

For PostgrestError captures (most db helpers), the practical risk is lower but still — wrap as `new Error(\`${helper}: ${err.code ?? 'unknown'}\`)`. The Phase 1 M8 recommendation called for `event.exception.values[*].value` scrub in beforeSend; that would close all of these at once.

---

#### M7: `refresh-outlook-subscription` cron has no `TZ=Europe/London` — inconsistent with other Phase 2 crons

**File:** `src/lib/inngest/functions/refresh-outlook-subscription.ts:41`
**Severity:** MEDIUM
**Category:** consistency / ops hygiene

**Finding:**

```ts
triggers: [{ cron: '0 */6 * * *' }],
```

vs `embed-batch.ts:79` (`TZ=Europe/London */10 * * * *`) and `cleanup-stale-summaries.ts:27` (`TZ=Europe/London 0 4 * * 1`). The Outlook renewal cron defaults to UTC. For an every-6-hours cron the difference is irrelevant in practice (subscription renewal lifetime is 70.5h, lookahead is 12h, no edge case bites), but the inconsistency makes ops harder. Phase 1's pattern was always TZ-explicit.

**Why it matters:**

When the operator debugs "why didn't this cron run", they need to know whether to interpret the cron expression in UTC or BST. The whole codebase says BST except this one cron.

**Recommended fix:**

```ts
triggers: [{ cron: 'TZ=Europe/London 0 */6 * * *' }],
```

---

### LOW

#### L1: `submitApplyAction` step 6 service-role anonymous-user-id leak via `getCandidateByEmailForOrg` Sentry capture

**File:** `src/app/(public)/apply/[orgSlug]/actions.ts:225-231` + `src/lib/db/candidates.ts:393-413`
**Severity:** LOW
**Category:** PII discipline edge case

**Finding:**

`getCandidateByEmailForOrg` captures `error` to Sentry. The captured PostgrestError includes the SELECT details — most don't include the email VALUE in the message, but the helper passes the raw err. Per M4, see broader pattern.

**Fix:** Wrap as `new Error('getCandidateByEmailForOrg failed')` only.

---

#### L2: `apply-form.tsx` File API: file is uploaded BEFORE the confirm-action verifies tenant boundary — orphan storage object on confirm failure

**File:** `src/app/(public)/apply/[orgSlug]/apply-form.tsx:163-196`
**Severity:** LOW
**Category:** resource cleanup

**Finding:**

The two-stage upload flow PUTs the file to the signed URL (`uploadResponse = await fetch(signedUrl, ...)`) BEFORE calling `confirmApplyAction`. If `confirmApplyAction` then fails (e.g., the candidate_cv row was deleted between submit and confirm by an admin), the storage object remains. No cleanup.

The storage path includes a UUID so there's no name collision risk, but the orphan accumulates over time. No retention policy yet.

**Fix:** Either DELETE the storage object inside the confirm-failure branch (server-side, via service-role), or wait until Phase 2 retention cleanup. Note in `docs/outlook-integration-setup.md` or equivalent.

---

#### L3: `bootstrap-vector-index` `state?.built_at` early return rare race with manual operator setting `built_at` between count and signal

**File:** `src/lib/inngest/functions/bootstrap-vector-index.ts:91-93`
**Severity:** LOW
**Category:** correctness

**Finding:**

Two consecutive Inngest invocations could both pass the `state?.built_at` check and both signal the operator. Race window is small; operator notices duplicate Sentry capture. Concurrency limit 1 mostly closes this; the cross-invocation case is the edge.

**Fix:** Optional — add a 2nd check inside `signal-build-needed` step that re-reads built_at and exits if set. Or document as acceptable.

---

#### L4: `bootstrap-vector-index` `await step.run('count-rows', ...)` reads against `tableName` parameter — type narrowed but used as dynamic SQL identifier

**File:** `src/lib/inngest/functions/bootstrap-vector-index.ts:98-108`
**Severity:** LOW
**Category:** security (defence in depth)

**Finding:**

`tableName` is validated as `'candidates' | 'jobs'` (line 51-53) before reaching the supabase call, so SQL injection isn't possible. But the supabase `.from(tableName)` is a dynamic identifier route. The pattern is fine here because of the upfront validation, but a future maintainer who adds a third valid table name without re-auditing the call site could broaden the surface.

**Fix:** Map `tableName` to a fixed `from(...)` call rather than dynamic interpolation:

```ts
const query = tableName === 'candidates'
  ? supabase.from('candidates')
  : supabase.from('jobs')
```

Same for the update at line 124-129 and 163-169.

---

#### L5: `applyFormSchema.email` doesn't `.toLowerCase()` — see M2; also `applyFormSchema.salary_expectation` doesn't reject `'00000000'` (8 zeros) which is technically valid digits

**File:** `src/app/(public)/apply/[orgSlug]/schema.ts:42-49,58-62`
**Severity:** LOW
**Category:** validation edge cases

**Finding:**

`salary_expectation: z.string().trim().regex(/^\d{0,8}$/, ...).optional()` accepts `'00000000'`. It also accepts `''` (because `\d{0,8}` matches empty string AND `.optional()` is set). The action then passes this through to the candidate row as `null` only via the coalescing in `actions.ts:259`. Belt-and-braces zod could add `.refine((v) => v.length === 0 || /^[1-9]\d{0,7}$/.test(v))` to reject leading-zero salaries.

**Fix:** Optional.

---

#### L6: `submitApplyAction` step 2 `dev-bypass` token in production check — fail-closed but UI doesn't communicate "dev affordance unavailable in prod"

**File:** `src/app/(public)/apply/[orgSlug]/actions.ts:137-153`
**Severity:** LOW
**Category:** UX / debugging

**Finding:**

If `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset in production but `TURNSTILE_SECRET_KEY` IS set, the form renders the "Skip captcha (dev)" button (apply-form.tsx:435-451). User clicks it; client sends `turnstile_token='dev-bypass'`; server rejects with "Verification failed. Please retry the challenge." The user is stuck because the widget is replaced with the dev button.

**Fix:** Server-side env validation should require `NEXT_PUBLIC_TURNSTILE_SITE_KEY` whenever `NODE_ENV === 'production'`. Or the form should detect production via a server prop and refuse to render the dev button.

---

#### L7: `recordRenewalAttempt` writes `last_renewal_error: 'unknown'` when args.error is absent — opaque ops state

**File:** `src/lib/db/outlook-credentials.ts:372`
**Severity:** LOW
**Category:** observability

**Finding:**

```ts
last_renewal_error: args.success ? null : (args.error ?? 'unknown'),
```

`'unknown'` is human-unfriendly. Use a stable code like `'renewal_unspecified'` so ops can filter on it.

**Fix:** Trivial rename.

---

#### L8: `Outlook OAuth callback` state-mismatch returns 400 with a Location header — semantically incoherent

**File:** `src/app/api/outlook/callback/route.ts:79-83`
**Severity:** LOW
**Category:** error handling

**Finding:**

```ts
const res = redirectToSettings(request, { outlook_error: 'state_mismatch' })
res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 })
return new NextResponse(res.body, {
  status: 400,
  headers: res.headers,
})
```

`res` is a 307 redirect; `res.body` is null; `res.headers` still has `Location: /settings/integrations?outlook_error=state_mismatch`. The new response is `400` with a `Location` header — browsers don't follow 4xx Location, so the user gets a blank 400. The cookie-clearing intent works, but the redirect to settings is silently dropped. This is the CSRF-fail path so a hard 400 is defensible (don't smuggle the user to a misleading "connected" state), but the inherited Location header is confusing.

**Fix:** Either strip Location:

```ts
const headers = new Headers(res.headers)
headers.delete('location')
return new NextResponse(null, { status: 400, headers })
```

Or change the model: on state mismatch redirect to a dedicated error page (`/auth/csrf-error?source=outlook`) so the user gets a recovery breadcrumb.

---

## Invariants verified

- `grep "new Anthropic" src/` → only `src/lib/ai/claude.ts:16` ✔
- `grep "new VoyageAIClient" src/` → only `src/lib/ai/voyage.ts:69` ✔
- `grep "new ConfidentialClientApplication" src/` → only `src/lib/integrations/outlook.ts:112` ✔
- `grep "GraphClient.init\|new Client(" src/` → only `src/lib/integrations/outlook.ts:120` ✔
- `grep "@azure/msal-node\|@microsoft/microsoft-graph-client" src/` → confined to `outlook.ts:4,5` ✔
- `grep "googleapis\|gmail" src/` → empty ✔ (Gmail pivot complete)
- `grep "decrypt(" src/` → only `encryption.ts` (def) + `outlook.ts:277,289` (consumer) ✔
- `grep "console\." src/` → empty ✔
- `grep "TODO\|FIXME\|XXX\|HACK" src/` → empty ✔
- M-1 verified: `bootstrap-vector-index.ts` does NOT contain `CREATE INDEX CONCURRENTLY` — runbook-only ✔
- M-2 verified: `submitApplyAction:313` has explicit `storagePath.startsWith(\`${org.id}/applicants/\`)` assertion BEFORE `createSignedUploadUrl` ✔
- M-3 verified: webhook POST returns 503 at `route.ts:74-83` when `OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET` is missing, BEFORE reading body ✔
- M-4 verified: `Sentry.captureException` calls in apply-form actions use `err.name + status` only — no email/full_name in messages ✔ (apply-form path) ✗ (db layer; see M6)
- M-6 verified: encryption key rotation deferred — pending docs/outlook-integration-setup.md not in scope of this review
- M-7 verified: `refresh-outlook-subscription.ts:49-55` emits heartbeat Sentry message ✔ — but cron lacks TZ prefix (see M7)
- M-8 verified: `tests/unit/app/apply/confirm-action-inngest-fallback.test.ts` exists and asserts the fallback ✔
- W-1 verified: `explainCandidateMatchAction` has the documented exception JSDoc at `actions.ts:47-61` ✔ — BUT the action has no spend ceiling guard (see H2)
- `ai_summaries_verify_same_org_check` named correctly (sorts after `ai_summaries_set_org` alphabetically) ✔
- `outlook_credentials_set_org` + `outlook_credentials_set_updated_at` triggers in place ✔ — no FK guard (explicitly exempt per D2-20 because user_id is the RLS gate)
- `record_audit_anonymous` REVOKEd from public/authenticated/anon, GRANTed to service_role only ✔
- `apply_form_rate_limits` REVOKEd from authenticated/anon, service-role only ✔ — no RLS by design
- `hnsw_build_state` REVOKEd from authenticated/anon ✔
- `from('` grep in `src/app/`: 14 hits — most are legitimate (settings team/owner role reads, pipeline page filter lists, usage page ai_usage read, apply form's candidate_cvs verify) but the convention drift (M3 in Phase 1) persists in Phase 2 ✗
- New cron functions write to `ai_usage` with correct purpose: `candidate_embed`, `job_embed`, `search_query_embed`, `match_score` ✔ (verified via voyage.ts + match.ts + claude.ts paths)

## Strengths

1. **Outlook OAuth callback is rigorous.** State-cookie validation, single-tenant Entra guard (`tokens.account.tenantId !== env.OUTLOOK_TENANT_ID`), encrypted refresh + access tokens before any DB write, explicit redirect with PII-safe error codes (`outlook_error=...`), HttpOnly+Secure+SameSite=lax cookie. All five checks land in the right order, all in `route.ts:67-117` — easy to audit, easy to verify.
2. **Microsoft Graph webhook fail-closed posture is exemplary.** `OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET` is checked BEFORE the body is parsed (line 74-83), the validationToken handshake returns within the route handler's natural latency (sub-100ms), per-subscription `clientState` validation happens on every notification, and the resource-prefix allowlist defends against subscription-theft. The whole route is 197 lines, including the test mock surface area — appropriately small.
3. **Encryption boundary is clean.** `src/lib/encryption.ts` is the single point of `aes-256-gcm`; `decrypt()` is called only from `outlook.ts` (token refresh + RT rotation path). Key validation at call time (64 hex chars, 32 bytes), random IV per encryption, packed format is self-describing. The unit tests cover round-trip, multibyte UTF-8, tampered authTag, tampered ciphertext, and malformed packed input. Five tests for ~80 lines of code is appropriate density.
4. **Sliding refresh-token rotation is handled.** `getValidAccessToken` (`outlook.ts:253-356`) reads the MSAL cache after `acquireTokenByRefreshToken` to extract the rotated RT (Microsoft doesn't surface it on the response object directly), re-encrypts both new access + new refresh tokens, persists them atomically via `updateOutlookAccessToken`. The terminal `invalid_grant`/`interaction_required` codes revoke the row and throw `OutlookReconnectRequiredError`. This is the most subtle bit of the whole Outlook integration and the executors got it right.
5. **PII discipline in the new Inngest functions is consistent.** `formatErrorForSentry` is the canonical wrapper; `captureScrubbed` (Outlook) is the in-file mirror. Both lift name + statusCode/code into a fresh Error so prompt fragments in raw error.message can't bypass beforeSend. Applied across embed-batch, embed-job-on-jd-change, precompute-matches-for-job, sync-outlook-history, create-outlook-subscription, refresh-outlook-subscription. Phase 1 R4 carried forward without slippage.
6. **The match-spend ceiling pattern is the right design.** `precompute-matches-for-job` reads `getOrgMatchSpendThisMonth` BEFORE issuing Sonnet calls, fires a Sentry warning (not an error) at the ceiling, returns `{ stopped: 'cost-ceiling' }`, falls back to vector-only ranking. This is the textbook cost-bomb defence for AI APIs. (Then H2 happens — but the pattern itself is right.)
7. **Apply form trust boundary is well-documented.** The header comment block in `actions.ts:1-30` lists the three trust signals (slug lookup, storage path prefix, service-role-derived org.id), explicitly forbids reading org from client input, references Phase 1 C1. The M-2 explicit `storagePath.startsWith` assertion at line 313 is documented as "machine-checkable assertions prevent future regressions." This is the comment style that would have prevented Phase 1 C1.

## Recommendations (prioritized)

1. **FIX C1 BEFORE NEXT DEPLOY.** Add the org-filter to `match_candidates_for_job` AND `match_candidates` AND a caller-side guard in `precompute-matches-for-job.ts`. Three layers; the SQL change is the strongest. Audit all `security invoker` RPCs called from service-role Inngest functions for the same pattern.
2. **Fix H1, H2, H3 within the same change set.** H1 is a webhook auth bypass; H2 is a cost-bomb DoS; H3 is privilege escalation. All are small one-screen fixes. H2 is the most likely to bite production within Phase 2's lifetime — a single recruiter clicking Explain repeatedly will hit it.
3. **Lower-case all email storage paths and add `unique (organization_id, lower(email))` index.** Closes M1 and M2 together. Phase 3 migration.
4. **Convert raw `Sentry.captureException(err)` calls in `src/lib/db/*` to `formatErrorForSentry(err)`** — pattern is already imported in inngest functions; lift it to db helpers. Closes M6 plus Phase 1's M8 in one pass. Alternative: extend `beforeSend` to scrub `event.exception.values[*].value` globally.
5. **Add explicit `revoke all on function ... from public` to the three match_* RPCs.** Trivial migration. Closes M4 and aligns with the `record_audit_anonymous` pattern.
6. **Add `TZ=Europe/London` to `refresh-outlook-subscription` cron** (M7). One-character fix.
7. **Defer L1-L8.** Real but small. Several are forward-looking (Phase 5 SaaS implications: M5 cleanup-stale-summaries pagination; M2 unique email index; L2 orphan storage cleanup).

---

_Reviewed: 2026-05-19_
_Reviewer: gsd-code-reviewer_
_Depth: deep_
