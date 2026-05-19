# Phase 2 Plan Verification

**Date:** 2026-05-19
**Plans verified:** 02-00-hardening, 02-01-semantic-search, 02-02-ai-match-scoring, 02-03-public-apply-form, 02-04-outlook-integration
**Verdict:** PASS WITH REVISIONS

> **OUTLOOK PIVOT 2026-05-19 (post-verification):** Plan 4 was pivoted from Gmail to Microsoft 365 / Outlook after this verification ran. Gmail-specific findings (M-3 Pub/Sub fail-closed, M-6 GMAIL_TOKEN_ENCRYPTION_KEY rotation, M-7 Gmail-watch-refresh heartbeat, W-4 `/api/gmail/callback` middleware exact-match) were translated to their Outlook equivalents inside the rewritten `02-04-outlook-integration-PLAN.md`:
> - M-3 Pub/Sub → Microsoft Graph webhook clientState + missing-env-503 fail-closed (POST handler step 1)
> - M-6 GMAIL_TOKEN_ENCRYPTION_KEY → generalised `EMAIL_TOKEN_ENCRYPTION_KEY`; rotation deferred to Phase 5, documented in `docs/outlook-integration-setup.md`
> - M-7 daily renewal → 6-hourly renewal + 404-recreate fallback + Sentry Crons heartbeat (Plan 4 Task 4.4)
> - W-4 middleware exact-match → confirmed for `/api/outlook/callback` and `/api/outlook/webhook` (Plan 0 Task 0.4 step 7)
>
> All other findings (M-1 HNSW manual DDL, M-2 storage-path tenant assertion, W-1 sync-Sonnet exception, M-4 db-helper PII grep, M-8 failed-Inngest-send fallback) are provider-agnostic and remain applied unchanged.
>
> The Gmail-named items in this document below (file path "02-04-gmail-integration", `gmail_credentials`, `googleapis`, `Pub/Sub`, etc.) reflect the verification at the time it was generated. Read alongside `02-RESEARCH-OUTLOOK.md` and the rewritten Plan 4 for the actual implementation contract.

## Verdict summary

The five plans deliver Phase 2's four ROADMAP success criteria and cover all ten requirement IDs (SEARCH-01..04, MATCH-01..03, APPLY-01..02, EMAIL-01). Decision honoring is strong: 22/22 locked decisions are implemented with the right primitives. Sequencing is sound: Plan 0 gates Plans 1–4; Plan 2 correctly depends on Plan 1; Plan 4 is independent and Plan 3 reuses the Plan 1 / Phase 1 `cv/uploaded` chain. Eight inline revisions are required before execution — none of them require re-spawning the planner. Two of them are non-trivial (HNSW transaction handling, signed-upload-URL Storage-path defence) and must be applied to the plan text before the first executor runs.

## A. Goal coverage

### Success-criterion → plan mapping

| ROADMAP # | Success criterion | Plan | Verifying task | Coverage |
|-----------|-------------------|------|----------------|----------|
| 1 | Natural-language search returns ranked candidates | 02-01 | Task 1.2 (`/search` page, exact placeholder text from CONTEXT) | Full |
| 2 | Top-matching candidates with score / strengths / gaps / questions | 02-02 | Task 2.2 (matches page upgrade) + Task 2.1 (precompute) | Full |
| 3 | Public apply form -> candidate created + CV parsing triggered | 02-03 | Tasks 3.1 + 3.2 (form, schema, signed upload + confirm) | Full |
| 4 | Gmail OAuth -> inbound emails on activity timelines | 02-04 | Tasks 4.2 + 4.3 (connect UI, push webhook, sync function) | Full |

### REQ-ID coverage

| Req | Plan(s) | Task(s) | Notes |
|-----|---------|---------|-------|
| SEARCH-01 | 02-00, 02-01 | 0.4 (RPCs, invalidation triggers), 1.1 (embed paths) | embedding_version + embedded_at tracked |
| SEARCH-02 | 02-01 | 1.2 | RRF k=60; placeholder text matches CONTEXT verbatim |
| SEARCH-03 | 02-00, 02-01 | 0.4 (`match_jobs` RPC + `hybridSearchJobs` helper) | reverse-search UI surface deliberately deferred — helper exists |
| SEARCH-04 | 02-01, 02-02 | 1.3 (vector-only list), 2.2 (Sonnet explanations layered) | full requirement delivered after Plan 2 |
| MATCH-01 | 02-02 | 2.1 + 2.2 | 0-100 score, 2-3 strengths, 0-2 gaps |
| MATCH-02 | 02-00, 02-02 | 0.3 (`ai_summaries` table + version key), 2.1 (cache lookup), 2.3 (cleanup) | cache key = (cand_v, job_v) |
| MATCH-03 | 02-02 | 2.1 + 2.2 | `screening_questions: minItems 3, maxItems 3` |
| APPLY-01 | 02-00, 02-03 | 0.3 (`organizations.apply_form_enabled` + slug check), 3.1 + 3.2 | five abuse layers in place |
| APPLY-02 | 02-03 | 3.2 (`confirmApplyAction` fires `cv/uploaded`) | chains into Phase 1 parse-cv + Plan 1 embed |
| EMAIL-01 | 02-00, 02-04 | 0.3 (`gmail_credentials`), 4.1-4.4 | Pub/Sub + JWT + 7d watch renewal |

No requirement is missing or partially covered.

## B. Decision honoring (D2-01..D2-22)

| Decision | Status | Plan / Task | Notes |
|----------|--------|-------------|-------|
| D2-01 hybrid candidate-embedding input | Honored | 02-00 T0.2 (`embed-text.ts` builds structured + 30k CV text) | MAX_CV_CHARS_FOR_EMBED = 30_000 |
| D2-02 Voyage wrapper with mandatory `record_ai_usage` | Honored | 02-00 T0.2 (`voyage.ts` skeleton incl. cost-row write) | `purpose` literals match D2-22 |
| D2-03 re-embed only on material change | Honored | 02-00 T0.4 (invalidate triggers); 02-01 T1.1 (`bumpCandidateEmbedding`) | `embedded_at` reset on invalidation |
| D2-04 RRF k=60 in single RPC | Honored | 02-00 T0.4 (RPC body) | trigram + cosine via FULL OUTER JOIN |
| D2-05 HNSW deferred + state table | Honored (partial) | 02-00 T0.3 (`hnsw_build_state`), 02-01 T1.3 (`bootstrap-vector-index`) | see M-1 below: CONCURRENTLY-in-transaction risk |
| D2-06 hybrid match trigger | Honored | 02-02 T2.1 (precompute on create + on JD-change); on-demand fill in 2.2 | event chain via `step.sendEvent` |
| D2-07 `ai_summaries` cache + version key | Honored | 02-00 T0.3 (table, FK guard, RLS) | unique constraint matches RESEARCH §B.10 |
| D2-08 input cap (no raw CV/JD) | Partially honored | 02-02 T2.1 step 3 caps at 2k chars CV + 4k chars JD | actual CV snippet included rather than "structured-summary-only" wording from CONTEXT — see W-3 |
| D2-09 `src/lib/ai/match.ts` wrapper | Honored | 02-00 T0.2 (file created, `runWithLogging` exported from `claude.ts`) | one-Anthropic-instance grep invariant preserved |
| D2-10 path-based `/apply/[orgSlug]` + slug format | Honored | 02-00 T0.3 (slug CHECK), 02-03 T3.1 | uses `notFound()` for anti-enumeration |
| D2-11 signed upload URL flow | Honored | 02-03 T3.2 (two-stage submit + confirm) | see M-2 below: storage-path tenant assertion only in verify block |
| D2-12 layered abuse defence (5 layers) | Honored | 02-03 T3.2 (Turnstile + rate-limit + honeypot + blocklist + consent) | rate-limit fails OPEN — documented |
| D2-13 apply-form candidate-row defaults | Honored | 02-03 T3.2 step 2 | `source='apply_form'`, `consent_basis='consent'`, `market_status='actively_looking'` |
| D2-14 record_audit anonymous-actor support | Honored (variant) | 02-00 T0.3 (`record_audit_anonymous` sibling function) | sibling instead of overload — safer; PATTERNS Option A |
| D2-15 separate Gmail OAuth (not Supabase Auth) | Honored | 02-04 T4.1 (`googleapis` wrapper) | `gmail.readonly` scope explicit |
| D2-16 aes-256-gcm token storage + env key | Honored | 02-00 T0.2 (`encryption.ts`); 02-00 T0.3 (`gmail_credentials`) | text columns instead of bytea — Plan 0 corrected and documented |
| D2-17 History API + Pub/Sub push + daily watch renewal | Honored | 02-04 T4.3 + T4.4 | JWT verification BEFORE state change |
| D2-18 subject + 200-char snippet only | Honored | 02-04 T4.3 step 3 (`createGmailActivity` row shape) | full body deliberately not stored |
| D2-19 inbound-to-candidate matching by exact email | Honored | 02-04 T4.3 step 3 sub-step 3 (`findByEmail`); orphans skipped | new `contacts_email_idx` migration added in Plan 4 |
| D2-20 verify_same_org_check naming | Honored | 02-00 T0.3 (`ai_summaries_verify_same_org_check`) | manual SQL smoke test included; **CRITICAL** Phase 1 lesson respected |
| D2-21 regen `database.ts` early | Honored | 02-00 T0.1 | three-path fallback (`--local` / `--linked` / manual) documented per Phase 1 lesson |
| D2-22 `purpose` literals for `ai_usage` | Honored | 02-00 T0.2 (Voyage purposes); 02-02 (match_score); D2-22 `gmail_sync` reserved (not written this phase) | per-tenant cost ledger intact |

**Decision contradictions:** None.
**Deferred-idea leaks into plans:** None.
**Scope reduction:** None. D2-08's CV-snippet inclusion is an addition to (not a reduction of) the CONTEXT wording — flagged as a warning to confirm intent, not a blocker.

## C. Sequencing

### Plan 0 gate

Plan 1: `Depends on: Plan 0 (...)`. OK.
Plan 2: `Depends on: Plan 0 ... AND Plan 1`. OK.
Plan 3: `Depends on: Plan 0 (...) AND independent of Plans 1 and 2`. OK.
Plan 4: `Depends on: Plan 0 (...). Independent of Plans 1 / 2 / 3`. OK.

Wave layout: Plan 0 -> { Plan 1 } -> { Plan 2 } with { Plan 3, Plan 4 } running in parallel any time after Plan 0. This is the correct fan-out.

### Inter-plan claims verified

- **Plan 2 -> Plan 1** (`getTopCandidatesByVector`, `/jobs/[id]/matches`, `match-row.tsx` swapped to `<MatchCard>`): all three are produced in Plan 1 Task 1.3 and consumed in Plan 2 Task 2.2. OK.
- **Plan 4 -> Plan 1** (`/settings/integrations/page.tsx` skeleton): Plan 1 Task 1.3 creates this page; Plan 4 Task 4.2 step 1 extends it. OK.
- **Plan 3 -> Plan 1** (apply form -> `cv/uploaded` -> Phase 1 parse-cv -> Plan 1 embed): chain verified — Phase 1 parse-cv.ts:101–134 already triggers on `cv/uploaded`; Plan 1 Task 1.1 step 1 adds the embed step to it. OK.
- **Plan 2 -> Plan 0** (`runWithLogging` exported from `claude.ts`): Plan 0 Task 0.2 step 3 explicitly adds the `export` keyword. Verified the current `claude.ts:51` is `async function runWithLogging(...)` (private) — Plan 0's one-character export delta is correct. OK.

### Phase 1 -> Phase 2 dependency assumptions

- `record_audit` extension — Plan 0 sidesteps by adding `record_audit_anonymous` instead of overloading. Existing Phase 1 callers unchanged. OK.
- `parse-cv` chaining — Plan 1 Task 1.1 adds Step 5 inside the **existing** outer try/catch of `parseCVOnUpload`, preserving Phase 1's retry semantics. OK.
- `candidate_cvs.same_org_guard` precedent — Plan 0 mirrors this for `ai_summaries`. OK.
- `assert_same_org` helper — re-used, not redefined. OK.

No broken dependencies.

## D. Planner-flagged open issues

1. **`gmail.readonly` Google verification lead time (1–6 wk)** — **OUT OF SCOPE (procurement, not engineering).** One-line patch: Plan 4 Task 4.2 step 7 should explicitly state "anchor uses Internal Workspace app type; SaaS path deferred to Phase 5." Already mentioned but bury the recommendation in the runbook header so the executor doesn't accidentally configure External.

2. **`gmail_credentials.last_renewal_error` + `last_renewal_attempt_at` columns added late by Plan 4** — **NON-BLOCKING.** Genuinely additive (no FK, no RLS change), Plan 4 Task 4.4 ships the migration. Patch: cross-reference the column in Plan 0 Task 0.3 step 4's `gmail_credentials` schema list with a one-line comment `-- additionally extended by Plan 4 migration for renewal error tracking`.

3. **Pub/Sub topic + GCP project setup out-of-band** — **OUT OF SCOPE.** Plan 4 Task 4.2 step 7 ships a runbook entry. Acceptable. No patch.

4. **Apply-form `submitApplyAction` writes explicit `organization_id` under service-role** — **NON-BLOCKING.** Read of Plan 3 Task 3.2 step 2 confirms: (a) org.id is sourced from the slug lookup, never from client input; (b) `set_organization_id` trigger is no-op when column already set (per Phase 1 migration `20260513152244_phase1_domain_schema.sql:86-99`); (c) FK guard `candidates` table doesn't have a cross-table FK so no cross-tenant FK risk on the candidate insert itself; (d) for the `candidate_cvs` insert, `candidate_cvs_verify_same_org_check` (Phase 1 commit `0966875`) gates it — the candidate row's org and the cv row's org must match, and both are server-constructed. Defence layers hold. Patch: add a one-line `// FK guard: candidate_cvs_verify_same_org_check enforces same-org on candidate_id` comment near the candidate_cvs insert in Plan 3 Task 3.2 step 2 to make the gate visible at review time.

5. **Anthropic pricing reverification in Plan 2 Task 2.3** — **NON-BLOCKING.** Phase 1 LEARNINGS Opus-3x-too-high incident already inoculates against this. Patch: in Plan 2 Task 2.3 step 2, add a bullet "If discrepancy found, update `PRICING_PENCE_PER_MTOK` AND backfill `ai_usage.cost_pence` is OUT OF SCOPE — historical rows stay at their then-prevailing rate."

6. **`getTopCandidatesByVector` degenerate empty-string approach in RRF** — **NON-BLOCKING.** Traced through `match_candidates` body in RESEARCH §A.4: trigram CTE's `where c.full_name % p_query_text or c.current_role_title % p_query_text` — pg_trgm `%` against `''` returns false at default similarity_threshold=0.3, so trigram CTE returns empty. Semantic CTE returns top N×4 ordered by vector. FULL OUTER JOIN leaves all semantic rows with `t.*` null. Final `where coalesce(s.cosine_similarity, 0) >= 0 or coalesce(t.trigram_similarity, 0) > 0.3` — first branch always true. Ordering by `rrf_score desc` (which becomes `1/(60+s.semantic_rank)`) is correct. **However:** Plan 0 Task 0.4 step 4 should add a one-line code comment in `getTopCandidatesByVector` flagging the degenerate path so a future maintainer doesn't refactor it into pure SELECT and lose the RPC's centralized RLS / cosine-distance op. Patch: add comment `// Calls match_candidates with empty query_text — trigram CTE returns 0 rows; we get pure vector ranking via the semantic CTE.`

7. **`/api/gmail/callback` middleware path-prefix matching** — **NON-BLOCKING.** Read of `src/lib/supabase/middleware.ts:47`: `pathname === p || pathname.startsWith(\`${p}/\`)`. Next.js `nextUrl.pathname` strips the query string, so `/api/gmail/callback?code=...&state=...` has `pathname === '/api/gmail/callback'` which matches `===`. No nested sub-routes; Plan 4 doesn't create any. Plan 0 Task 0.4 step 7 already cites this analysis. Accepted.

## E. Task quality findings

Sampled tasks: Plan 0 T0.1, T0.3, T0.4; Plan 1 T1.1, T1.2; Plan 2 T2.1, T2.2; Plan 3 T3.1, T3.2; Plan 4 T4.3.

| Plan / Task | Atomicity | Files specific | Verify proves done | Scope creep |
|-------------|-----------|----------------|--------------------|--------------|
| 0.1 (regen types + env + deps) | OK | OK (specific files + grep patterns) | Yes (boot test triggers Zod error on missing key) | None |
| 0.3 (6 migrations) | **Large** — 6 separate migration files in one task | OK | Yes (manual SQL smoke-test per migration documented) | None — but see W-2 below |
| 0.4 (RPCs + triggers + db helpers + middleware + public layout) | **Large** — mixes SQL and TS layer | OK | Yes (psql + curl smoke) | None |
| 1.1 (Inngest: reactive + sweep + job event) | OK | OK | Yes (timing + ai_usage row counts) | None |
| 1.2 (search page + listCandidates extension) | OK | OK | Yes (URL toggle, placeholder text match) | None |
| 2.1 (precompute Inngest + cost guard) | OK | OK | Yes (cross-tenant smoke + cost-ceiling smoke) | None |
| 2.2 (matches page upgrade + Explain action) | OK | OK | Yes (cache-hit twice -> no new ai_usage) | None — but synchronous Sonnet call is borderline (see W-1) |
| 3.1 (apply route + form UI) | OK | OK | E2E Playwright + unit | None |
| 3.2 (server actions — trust boundary) | OK | OK | Full happy path + 4 abuse smokes + cross-tenant smoke | None — but see M-2 |
| 4.3 (Pub/Sub push + sync function) | OK | OK | JWT spoof + dedupe + orphan smokes | None |

### Concrete task-quality issues

- **W-2 (Plan 0 T0.3 — migration sequence ordering):** the six `<ts>` timestamp filenames are not pre-sequenced. The plan instructs `pnpm exec supabase migration new <slug>` to auto-timestamp in creation order. If the executor creates them out of order (e.g., creates `record_audit_anonymous.sql` before `ai_summaries.sql`), the `audit_log` insert in the function references `public.audit_action` enum — present from Phase 1, so independent. But `ai_summaries_same_org_guard` references `public.assert_same_org` which is Phase 1's `20260517204500_cross_tenant_fk_guards.sql` — also independent. **No actual ordering dependency between the six new migrations.** No blocker. But Plan 0 T0.3 step 1 implies a strict creation order that isn't strictly required; tightening the wording prevents confusion.

- **W-4 (Plan 0 T0.4 — middleware exact-vs-prefix gap):** `/api/gmail/callback` matches `===` on `pathname` because Next strips query strings. But if Plan 4 ever adds a sub-route like `/api/gmail/callback/error`, the array would need re-tuning. Add a `// keep this array entry exact — Plan 4 must not introduce sub-routes` comment.

- **W-1 (Plan 2 T2.2 — synchronous Sonnet in `explainCandidateMatchAction`):** Plan 2 admits this is "borderline-OK". CLAUDE.md "Never call Claude in a synchronous request handler when it could take >2s" forbids it. The 4–6s typical latency exceeds the threshold. Recommendation in Plan 2 step 3 is "keep it synchronous" with a hedge. **W-1 verdict:** acceptable for MVP because the recruiter is actively waiting; UI shows a transition spinner. But the rationale in the plan should be promoted from a passing comment to a documented exception. Patch in revisions list.

## F. Risks the planner missed

### M-1. **HNSW `CREATE INDEX CONCURRENTLY` cannot run inside the supabase-js auto-transaction**

Plan 1 Task 1.3 step 5 hedges: "Cannot be inside a transaction — service-role client typically auto-commits per-statement; if Supabase JS wraps in a tx, fall back to `pnpm exec supabase db execute`". **The hedge is too soft.** `supabase-js` `.rpc()` / `.from()` calls are per-statement (no client-side BEGIN), so `CREATE INDEX CONCURRENTLY` via `supabase.rpc('execute_sql', ...)` would not work because supabase doesn't expose raw DDL through the JS client. Realistically the Inngest function must use a low-level `pg` connection (e.g., `node-postgres`) or call out to `psql`. **Patch (BLOCKER):** Plan 1 T1.3 step 5 must commit to one of two implementations:
  - (a) Add `pg` as a Phase 2 dependency and open a direct connection inside the `bootstrap-vector-index` function, OR
  - (b) Document that the function only writes to `hnsw_build_state.last_attempt_at` + emits a Slack/email alert; the actual `CREATE INDEX CONCURRENTLY` is run manually via Supabase Dashboard SQL editor.

  Option (b) is simpler and matches D2-05's "deferred" framing. Pick (b) and update the verification step accordingly.

### M-2. **Apply-form: `storagePath.startsWith(\`${org.id}/\`)` check exists only in the verification block, not the implementation steps**

Plan 3 T3.2 step 2 verification calls out "validate `storagePath.startsWith(\`${org.id}/\`)` before persisting". But the implementation bullet list doesn't include this check explicitly. **Patch (BLOCKER):** add it as an explicit numbered step under T3.2 step 2's "Signed upload URL" bullet, immediately after constructing `storagePath` and BEFORE calling `createSignedUploadUrl`. The check is server-constructed-vs-server-constructed (both come from the same `org.id`), so it's belt-and-braces — but Phase 1's CRITICAL FK-guard finding came from exactly this class of "looks-safe-but-not-asserted" defence layering. Don't repeat the lesson.

### M-3. **Plan 4's Pub/Sub JWT verification: `audience` env var was declared in Plan 0 as `.optional()`**

`GMAIL_PUSH_AUDIENCE: z.string().url().optional()` + `GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: z.string().email().optional()`. If either is missing at runtime when `/api/gmail/push` is hit, `client.verifyIdToken({ idToken, audience: undefined })` will throw or accept any audience. **Patch (BLOCKER):** Plan 4 T4.3 step 1 must explicitly fail-closed with a 503 if either env is missing: `if (!env.GMAIL_PUSH_AUDIENCE || !env.GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL) return new Response(null, { status: 503 })`. Document in the runbook that production deploy must set both.

### M-4. **PII discipline — applicant email/name traversal**

Plan 3 T3.2 step 2 final "Error handling" bullet: `Sentry.captureException(new Error(\`apply-submit: \${err.name ?? 'unknown'}\`), ...)`. OK name+message stripped. But the `findByEmail` failure path and the `getCandidateByEmailForOrg` lookup don't have explicit Sentry guards — the existing db-helper Sentry-tag pattern from Phase 1 may leak the email if a helper passes the raw error. **Patch (WARNING):** Plan 3 should add a verification bullet: `grep -A2 "Sentry.captureException" src/lib/db/candidates.ts src/lib/db/organizations.ts` confirms no error.message -> Sentry path includes email-bearing arguments. Phase 1's pattern already strips this; the verification just confirms.

### M-5. **AI cost-logging coverage on the synchronous Sonnet path**

Plan 2 T2.2 step 3 (`explainCandidateMatchAction`) calls `scoreCandidateForJob(...)` which calls `runWithLogging(...)` which writes `ai_usage` automatically. Verified. OK. No gap.

### M-6. **Encryption-key rotation has no plan**

Plan 0 T0.3 step 4 adds `encryption_key_version integer not null default 1` per PATTERNS forward-compat. Good. But there's no plan for what happens when the operator wants to rotate `GMAIL_TOKEN_ENCRYPTION_KEY`. The version column gives space for a future migration but no executor task implements rotation. **Patch (WARNING):** add to Plan 4 "Out of scope" or to a new runbook section: "Key rotation deferred to Phase 5 SaaS shell; if rotation needed in Phase 2 anchor, document the manual procedure (mint key v2 -> write helper that decrypts v1 and re-encrypts v2 -> swap env -> run helper -> delete v1)." Don't ship a rotation tool now; just acknowledge it.

### M-7. **Gmail watch refresh — failure visibility**

Plan 4 T4.4 step 1 Sentry-warns on N=2 consecutive renewal failures. If the **cron itself** fails (Inngest down, function bug, scheduling regression), there's no secondary signal. **Patch (WARNING):** add a Plan 4 Task 4.4 verification step: monitor Inngest Cloud's "function ran" dashboard via Sentry's heartbeat / cron-monitor add-on (Sentry Crons), or document that the operator must manually check Inngest UI weekly. Belt-and-braces against the "schedule itself silently died" failure mode.

### M-8. **Apply-form Inngest chain visibility**

Chain: `confirmApplyAction` -> `cv/uploaded` -> Phase 1 `parseCVOnUpload` -> `embed-candidate` (Plan 1) -> cascade ends. Five hops. If `cv/uploaded` event itself fails to send (Plan 3 T3.2 step 3 wraps in try/catch + Sentry), the candidate row + `candidate_cvs` row exist but no parse / embed will fire. Phase 1's retry button on the candidate detail re-fires it. **Coverage exists.** OK. But Plan 3 should add a verification bullet: "after a deliberately failed `inngest.send` (mock the SDK to throw), the candidate detail page's Phase 1 retry button still works." Add to Plan 3 T3.2 verification.

### M-9. **Plan 0 vs Plan 4 column-add divergence**

Plan 4 adds `last_renewal_error`, `last_renewal_attempt_at` (T4.4) and `contacts_email_idx` (T4.3) as additive migrations. **Coverage exists** but Plan 0's "Out of scope" section should call this out so a reviewer reading Plan 0 in isolation doesn't think the gmail schema is final. Minor patch.

### M-10. **`(public)` route group + `(app)` route group share parent layout**

Plan 0 T0.4 step 8 creates `src/app/(public)/layout.tsx` as the public frame. Next.js route groups are sibling layouts; both inherit `src/app/layout.tsx` (Phase 1's HTML shell). Phase 1's root layout doesn't run any auth or fetch logic (verified in CLAUDE.md architecture section). OK. No bleed.

## Required revisions (apply inline before execution)

Eight patches. None require re-spawning the planner. Apply in this order:

1. **(BLOCKER, M-1) Plan 1 T1.3 step 5 — HNSW build:** rewrite step 5 to commit to Option (b) — the `bootstrap-vector-index` function only updates `hnsw_build_state.last_attempt_at` and emits a Sentry breadcrumb; the actual `CREATE INDEX CONCURRENTLY` is run manually via Supabase Dashboard SQL editor. Verification step adjusted accordingly. Remove the `pg`-dependency hedge.

2. **(BLOCKER, M-2) Plan 3 T3.2 step 2 — signed-upload-URL tenant assertion:** insert an explicit sub-step between "Compute `storagePath`" and "createSignedUploadUrl" that asserts `if (!storagePath.startsWith(\`${org.id}/applicants/\`)) { Sentry.captureException(new Error('apply: storage path tenant assertion failed'), { tags: { layer: 'server-action', action: 'submitApplyAction' } }); return { ok: false, formError: 'Something went wrong. Please try again.' } }`.

3. **(BLOCKER, M-3) Plan 4 T4.3 step 1 — Pub/Sub fail-closed:** add as the first line of the route handler `if (!env.GMAIL_PUSH_AUDIENCE || !env.GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL) { Sentry.captureMessage('gmail/push received without configured audience', { level: 'error' }); return new Response(null, { status: 503 }) }`. Document the two envs as REQUIRED in production deploys (runbook update).

4. **(WARNING, W-1) Plan 2 T2.2 step 3 — promote synchronous-Sonnet rationale:** convert the inline `// Synchronous Sonnet call — borderline per CLAUDE.md ...` comment into a documented exception block in `explainCandidateMatchAction`'s JSDoc; cross-reference CLAUDE.md "Synchronous AI calls in request handlers" Out-of-Scope row and explain why the on-demand-Explain UX justifies the exception. Optional follow-up task placeholder: "If telemetry shows p95 > 8s, swap to Inngest send + poll."

5. **(WARNING, M-4) Plan 3 T3.2 — db-helper PII verification:** add to plan-level verification: `grep -A2 "Sentry.captureException" src/lib/db/candidates.ts src/lib/db/organizations.ts | grep -i "email\|name\|full_name"` returns nothing.

6. **(WARNING, M-6) Plan 4 — key rotation deferral:** append to "Out of scope for this plan" — "GMAIL_TOKEN_ENCRYPTION_KEY rotation procedure — deferred to Phase 5; manual procedure documented in `docs/gmail-integration-setup.md`."

7. **(WARNING, M-7) Plan 4 T4.4 — Inngest schedule heartbeat:** add a verification bullet: "Sentry Crons monitor configured for `refresh-gmail-watch` (or manual weekly check of Inngest dashboard documented in runbook)."

8. **(WARNING, M-8) Plan 3 T3.2 — failed-Inngest-send fallback test:** add to verification: "mock `inngest.send` to throw; confirm candidate row + cv row still persist; confirm Phase 1's retry button on candidate detail re-fires `cv/uploaded` and the parse completes."

## Sign-off notes for the executor

1. **Plan 0 is the longest task list of any plan in Phase 2** — 4 tasks but each is heavy. Budget ~70% of context per task. Run `pnpm typecheck && pnpm lint` between every sub-step, not just at task end.

2. **The trigger-ordering bug from Phase 1 is the highest-cost mistake to repeat.** Plan 0 T0.3 has explicit `_verify_same_org_check` naming for `ai_summaries`. Do not "clean up" the trigger names; the alphabetical sort is load-bearing.

3. **Type regen (T0.1) is allowed to soft-fail.** Phase 1 spent the entire phase with pre-regen casts and shipped. If `--local` and `--linked` both fail, do not block — document the fallback in the commit message and accept that some Phase 2 helpers will need `as unknown as ...` casts until the next regen attempt.

4. **The single-instance grep invariants are non-negotiable** — `grep -rn "new Anthropic" src/` returns one line, `grep -rn "new VoyageAIClient" src/` returns one line, `grep -rn "from 'googleapis'\|from 'google-auth-library'" src/` returns at most two (the wrapper and the push route's `OAuth2Client` usage for JWT verify). The code-reviewer will check these.

5. **Anthropic / Voyage pricing reverification belongs in Plan 2 T2.3** — but if it's been more than 30 days since the last `verified` comment in `claude.ts` when Phase 2 ships, do the reverification even if you're executing Plan 0 first.

6. **Plan 3's apply form is the first unauthenticated DB writer.** Treat T3.2 with code-review intensity — the executor SHOULD invoke the code-reviewer agent on the diff after this task, not just at end-of-plan.

7. **Plan 4 requires real cloud infrastructure (GCP project, OAuth credentials, Pub/Sub topic, Workspace verification path) before T4.2 onward can be smoke-tested end-to-end.** Plan 4 T4.1 (the library) can land in advance; T4.2-T4.4 should pause executor work until the cloud setup runbook is complete. Plan-level verification calls this out; do not skip.

8. **None of the eight revisions above require re-spawning the planner.** Apply them inline to the plan files, then proceed to execution.
