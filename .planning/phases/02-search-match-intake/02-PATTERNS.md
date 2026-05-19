# Phase 2 Patterns Map

**Purpose.** Map every new/modified file in Phase 2 (Search, Match & Intake) to its closest existing analog plus the exact pattern to copy. Consumed by `gsd-planner` — the planner cites this file in each plan's "Pattern to copy" line.

**Consumed by:** `gsd-planner`
**Date:** 2026-05-18
**Phase scope:** D2-01 .. D2-22 from `02-CONTEXT.md`; cross-references `02-RESEARCH.md` §A–§E
**Files mapped:** ~45 (libs, Inngest fns, routes, migrations)

> **Phase 1 patterns mostly carry forward unchanged.** This file extends `01-PATTERNS.md` rather than re-stating it. Read that first; the cheat-sheet here only flags **Phase 2-specific** additions and the Phase 1 deltas (e.g., trigger-naming fix locked in).

---

## How to read this

Each row: **New/modified file → Closest analog → Pattern to copy → Deviations**. Citations use `RESEARCH §x.y` for `02-RESEARCH.md` and `PHASE1 §...` for `01-PATTERNS.md`.

---

## Conventions cheat-sheet (Phase 2 additions only)

The Phase 1 cheat-sheet (`01-PATTERNS.md` lines 20–193) is the base. Don't restate it. The additions / clarifications below apply to Phase 2.

### Carry-forward (verbatim from Phase 1, unchanged)

| Pattern | Source-of-truth file | Notes |
|---------|----------------------|-------|
| RSC data-fetch shape | `src/app/(app)/layout.tsx` | `params`/`searchParams` are Promises; `await`. |
| Server Action shape | `src/app/(app)/candidates/new/actions.ts` | `{ ok: true, ... } \| { ok: false, fieldErrors } \| { ok: false, formError }` discriminated union. |
| Client form (RHF + zod + shadcn `<Form>`) | `src/app/(app)/candidates/new/candidate-form.tsx` + `schema.ts` | `useTransition` for pending, `form.setError` for server field errors, `toast.error` for submit-level errors. |
| `DbResult<T>` | `src/lib/db/types.ts` | `{ok:true,data} \| {ok:false,code:'not_found'\|'internal'}`. |
| `import 'server-only'` on `src/lib/db/*` | Every existing helper (`candidate-cvs.ts:1`, `candidates.ts:1`) | First line. Non-negotiable. |
| Migration file naming | `supabase migration new <slug>` | Auto-timestamps. Append-only. |
| Single Claude wrapper | `src/lib/ai/claude.ts` | Grep test: `grep -rn "new Anthropic" src/` returns only this file. Phase 2 `match.ts` **MUST NOT** instantiate `Anthropic` — it calls a new `runWithLogging`-style export from `claude.ts`. |
| Sentry scoping | `setRequestScope(user.id, org.id)` in `(app)/layout.tsx` | Inside Inngest functions, `Sentry.setTag('organization_id', event.data.organization_id)`. |

### Phase 2-specific additions

#### Cross-tenant FK guard naming (locked from Phase 1 bug fix)

Source: `supabase/migrations/20260518213836_fix_same_org_trigger_order.sql` lines 32–54.

- Every new tenant-scoped table with FKs to other tenant-scoped tables MUST add a `<table>_verify_same_org_check` trigger.
- Trigger name MUST sort alphabetically AFTER `<table>_set_org` (v > s). Never use `_same_org_check` — that name is the **bug** Phase 1 paid for.
- Use the canonical helper `public.assert_same_org(p_parent_table regclass, p_parent_id uuid, p_child_org_id uuid)`.
- Body: a `<table>_same_org_guard()` plpgsql function that calls `assert_same_org` for each FK; trigger fires `before insert or update of <fk_cols>, organization_id`.

#### Inngest function shape (extending Phase 1)

Source: `src/lib/inngest/functions/parse-cv.ts` (canonical Phase 1 pattern).

```ts
export const someFn = inngest.createFunction(
  {
    id: 'kebab-case-id',
    triggers: [{ event: 'category/event-name' }],
    concurrency: { limit: <N>, key: 'event.data.organization_id' },
    retries: 3,
    onFailure: async ({ event, error }) => {
      // Belt-and-braces: never pass `error` directly to Sentry — wrap in
      // Error(`${error.name}: ${readStatus(error)}`) so the beforeSend PII
      // scrubber can't be bypassed by prompt fragments in error.message.
    },
  },
  async ({ event, step }) => {
    // 1. Tenant-boundary check FIRST (outside any step.run) — NonRetriableError
    //    fires before Inngest spends an attempt on cross-tenant payloads.
    // 2. Then per-checkpoint step.run blocks. Each idempotent. Each output
    //    JSON-serializable (base64 buffers, not ArrayBuffer/Uint8Array).
    // 3. Service-role client only — no auth context inside Inngest functions.
    // 4. Every external AI call MUST go through the wrapper that writes
    //    record_ai_usage (claude.ts or voyage.ts).
  },
)
```

Mandatory per-function rules:
- `import * as Sentry from '@sentry/nextjs'` + `import { NonRetriableError } from 'inngest'`.
- The first guard inside the body: validate `storage_path`/foreign IDs against `organization_id` — service-role bypasses RLS, so this check is the tenant boundary.
- Tag Sentry with `layer: 'inngest', function: '<id>'` on every captureException.
- `readStatus(err)` helper for type-safe status extraction (copy from `parse-cv.ts:89`).

#### Public route group conventions (NEW)

The `(public)` route group does NOT exist yet. Phase 2 creates it for the apply form.

- Path: `src/app/(public)/apply/[orgSlug]/page.tsx`.
- **Middleware**: `(public)` is NOT in `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts:8-15`. **Plan 0 of Phase 2 MUST add `/apply` to `PUBLIC_PATHS`** so unauthenticated requests aren't redirected to `/sign-in`. Add the leading slash; the path-prefix match (`pathname.startsWith('/apply/')`) covers `/apply/<slug>` and `/apply/<slug>/success`.
- **No `auth.getUser()` expectation**: the apply page is anonymous. Use the **anon** client (`createClient()` from `@/lib/supabase/server`) for the **org lookup only**; that respects RLS but the org slug+`apply_form_enabled` column will need a `public select` policy (or use service-role + explicit slug lookup; service-role is cleaner because it bypasses any future RLS tightening on `organizations`).
- **No `(app)/layout.tsx` shell**: write a separate `src/app/(public)/layout.tsx` that gives the apply form its own minimal frame ("Powered by Altus" footer per CONTEXT.md `<specifics>`). Don't reuse the recruiter TopNav.

#### Signed upload URL pattern (NEW — Phase 2 introduces this)

The Phase 1 `uploadCVAction` (`src/app/(app)/candidates/[id]/actions.ts:110-230`) uploads via Vercel and is constrained by the 4.5 MiB serverless body cap. Phase 2 apply form CANNOT do this — Vercel Pro 50 MiB is too high a floor for an anon route to ship through. Pattern:

```
1. submitApplyAction(formData, captchaToken)  [server action]
   - validate Turnstile, rate limit, zod schema, blocklist, honeypot
   - lookup org by slug; bail with notFound() if not found or apply_form_enabled = false
   - service-role: createSignedUploadUrl('cvs', `{org_id}/applicants/{uuid}.{ext}`)
   - service-role: insert candidate + candidate_cvs (parsing_status='pending')
   - return { ok: true, signedUrl, candidateCvId, candidateId }
2. Client: fetch PUT signedUrl with file body
3. confirmApplyAction(candidateId, candidateCvId)  [server action]
   - service-role: verify storage object exists + size + mime
   - inngest.send({ name: 'cv/uploaded', data: { ..., user_id: null } })
   - return { ok: true, redirectTo: '/apply/<slug>/success' }
```

The recruiter-facing upload action (`uploadCVAction`) is unchanged — it's already authenticated and works fine within the body limit for typical CVs.

#### Encryption helper shape (NEW)

Source: `02-RESEARCH.md` §D.20.

- File: `src/lib/encryption.ts` (CONTEXT.md location; RESEARCH suggests `src/lib/security/secret-cipher.ts` — **CONTEXT.md wins**, planner uses `src/lib/encryption.ts`).
- `import 'server-only'` first line.
- Two named exports: `encrypt(plaintext: string): string` / `decrypt(ciphertext: string): string`.
- Algorithm: `aes-256-gcm` via Node `crypto.createCipheriv`. 12-byte random IV per encryption. Pack as `iv.toString('base64') + ':' + authTag.toString('base64') + ':' + ciphertext.toString('base64')`.
- Key: `env.GMAIL_TOKEN_ENCRYPTION_KEY` (32 random bytes, hex-encoded). MUST be added to `src/lib/env.ts` in Plan 0 of Phase 2.
- Never use the key elsewhere. Never log plaintext to Sentry.
- Future key rotation deferred (RESEARCH §D.20); document column `encryption_key_version int default 1` in the migration for forward-compat even though we hard-code version 1 for now.

#### Hybrid search RPC pattern (NEW — extends Phase 1's trigram RPC)

Source: `02-RESEARCH.md` §A.4 + Phase 1 `supabase/migrations/20260517215939_search_candidates_rpc.sql` (the existing trigram RPC).

- `security invoker` (NOT definer) — RLS enforces tenant scoping naturally on the underlying tables.
- `language sql stable set search_path = public`.
- Takes `p_query_text text, p_query_embedding halfvec(1024), p_match_count integer, p_min_cosine_similarity real`.
- Combines a CTE over `<=>` cosine distance + a CTE over `%` trigram similarity using Reciprocal Rank Fusion `1/(60 + rank_semantic) + 1/(60 + rank_trigram)`.
- Over-fetch by `p_match_count * 4` in each CTE before fusion (RRF needs the long-tail ranks).
- `grant execute on function ... to authenticated;` — matches the existing `search_candidates` grant.
- Return columns mirror the trigram RPC plus `cosine_similarity`, `trigram_similarity`, `rrf_score` for UI display.

#### Outlook integration tokens (NEW — pivoted from Gmail 2026-05-19)

- Separate table `outlook_credentials` (NOT a column on `users` — D2-16). Schema in `02-00-hardening-PLAN.md` Task 0.3 step 4.
- Encrypted columns are `text` (base64-packed iv:authTag:ciphertext from `src/lib/encryption.ts`, NOT pgcrypto, NOT `bytea`).
- RLS: `using (user_id = auth.uid())` plus `with check (user_id = auth.uid() and organization_id = public.current_organization_id())`.
- Decrypt only inside `src/lib/integrations/outlook.ts` server-side helpers; never returned to client.
- Trigger pair: `outlook_credentials_set_org` (before insert) + `outlook_credentials_set_updated_at` (before update). No `verify_same_org_check` needed because the only FK is to `users` (auth-tied; RLS by `user_id = auth.uid()` is sufficient).
- **Sliding refresh-token invariant**: on every token refresh, persist BOTH the new access token AND the new refresh token. MSAL rotates RTs; failing to persist = the cached RT expires after 90 days of disuse.

#### Microsoft Graph webhook route (NEW — pivoted from Pub/Sub 2026-05-19)

Source: `02-RESEARCH-OUTLOOK.md` §D.17 + §D.24.

- Path: `src/app/api/gmail/push/route.ts`.
- POST handler only. Returns 200 IMMEDIATELY after JWT verification — actual processing is offloaded to an Inngest function. Pub/Sub retries on non-2xx; long handlers cause duplicate deliveries.
- JWT verification BEFORE any state change:
  ```ts
  import { OAuth2Client } from 'google-auth-library'
  const client = new OAuth2Client()
  const ticket = await client.verifyIdToken({ idToken, audience: env.GMAIL_PUSH_AUDIENCE })
  const payload = ticket.getPayload()
  if (payload?.email !== env.GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL) {
    return new Response('Unauthorized', { status: 401 })
  }
  ```
- Decode the Pub/Sub envelope (`{ message: { data: base64-encoded JSON } }`) and dispatch `gmail/history-changed` Inngest event.
- Add `/api/gmail/push` to middleware `PUBLIC_PATHS`.

#### Service-role decision matrix (Phase 2 expansions)

| Caller | Client to use | Reason |
|--------|---------------|--------|
| Apply-form server actions (anon caller, no `auth.uid()`) | service-role | RLS would reject inserts |
| Gmail OAuth callback route | server (recruiter is signed in) | Standard authenticated write |
| Pub/Sub push route | service-role | Public webhook; no session |
| All Inngest functions | service-role | No auth context |
| Recruiter actions (search, match-explain) | server | Authenticated; RLS works |

#### Audit log for anonymous actors (NEW)

The Phase 1 `record_audit` SQL function uses `auth.uid()` as the actor — fails when called from the apply path. Phase 2 extends it.

Two options (planner picks):
- **A** (simpler): Add a new function `record_audit_anonymous(p_action, p_entity_type, p_entity_id, p_metadata)` that takes `p_organization_id` explicitly (the apply form already has it from the slug lookup) and writes `actor_user_id := null`. Granted to `service_role` only.
- **B**: Add an `or replace` of `record_audit` with a nullable `p_actor_user_id` and a `p_organization_id` override; preserve the existing two-arg signature for back-compat by keeping the existing function signature unchanged and adding a new overload.

Recommendation: **A** — narrower attack surface and the public-write boundary is explicit in the function name.

---

## Plan 0 (Phase 2 Hardening)

### `src/types/database.ts` (regenerate, drop pre-regen casts)

- **Closest analog:** itself; Phase 1 `RESEARCH §5` + Phase 1 LEARNINGS entry on `db:types`.
- **Pattern to copy:** Run `pnpm db:types --linked` (preferred) or `--local` (fallback if Docker is running). After regen, hand-search for `// reason: pending regen` comments across the codebase and remove the surrounding `as unknown as ...` casts — Plan 0 should produce a working tree with zero `pending regen` casts.
- **Deviations:** Phase 1 found `--linked` flaky; if it fails, attempt `--local`. Document the working command in the plan's acceptance criteria.
- **Cross-reference:** `02-RESEARCH.md` §E.28.

### `src/lib/env.ts` (modify — add Phase 2 env vars)

- **Closest analog:** itself (Phase 1 Plan 0 created it; `RESEARCH §7`).
- **Pattern to copy:** Identical structure. Just add to the `server: { ... }` schema:
  - `VOYAGE_API_KEY: z.string().min(1)`
  - `GMAIL_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 32 random bytes hex-encoded')`
  - `GMAIL_OAUTH_CLIENT_ID: z.string().min(1)`
  - `GMAIL_OAUTH_CLIENT_SECRET: z.string().min(1)`
  - `GMAIL_OAUTH_REDIRECT_URI: z.string().url()`
  - `GMAIL_PUSH_AUDIENCE: z.string().url()` (the webhook URL — Pub/Sub JWT `aud` claim)
  - `GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: z.string().email()`
  - `TURNSTILE_SECRET_KEY: z.string().min(1)`
  - Client: `NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1)`
- **Deviations:** None. Mirror the existing pattern's `experimental__runtimeEnv` block — every NEXT_PUBLIC_* variable must be re-listed there per `@t3-oss/env-nextjs` quirk.

### `.env.example` (modify)

- **Closest analog:** itself.
- **Pattern to copy:** Add new keys in a `# --- Phase 2 ---` block matching the new entries in `env.ts`. Generate a fresh 32-byte hex key for `GMAIL_TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32` and show as a placeholder.

### `package.json` (modify)

- **Closest analog:** itself.
- **Pattern to copy:** Add deps (per RESEARCH § Package Audit + slopcheck):
  - `voyageai` — Voyage SDK
  - `googleapis` — Gmail API
  - `google-auth-library` — Pub/Sub JWT verification
  - `@marsidev/react-turnstile` (or `next-turnstile`) — planner picks one and runs slopcheck before install
- **Deviations:** No new dev deps; vitest/playwright already in place.

### `src/lib/supabase/middleware.ts` (modify)

- **Closest analog:** itself.
- **Pattern to copy:** Add `/apply`, `/api/gmail/callback`, `/api/gmail/push` to `PUBLIC_PATHS` array (line 8–15). One-line edits, do NOT refactor anything else.
- **Deviations:** Three array additions. Order doesn't matter; place alphabetically next to existing entries.

### `src/app/(public)/layout.tsx` (NEW)

- **Closest analog:** `src/app/(auth)/layout.tsx` (centered card wrapper) — closest in shape.
- **Pattern to copy:** Async function component (no auth needed). Renders a minimal `<main>` with `max-w-2xl mx-auto px-4 py-8 sm:px-6` and a "Powered by Altus" footer. NO TopNav, NO sign-out — anon user.
- **Deviations:** Lighter than the auth layout — no auth guard, no card frame.

### `supabase/migrations/<ts>_phase2_env_check.sql` — OPTIONAL

- Phase 2 doesn't strictly require an env-only migration. Skip unless planner finds a need.

---

## Core libs (Plan 1+)

### `src/lib/ai/voyage.ts` (NEW)

- **Closest analog:** `src/lib/ai/claude.ts` (canonical shape).
- **Pattern to copy:** **Mirror `claude.ts` exactly**:
  - `import 'server-only'` first line.
  - `ApprovedEmbeddingModel` type union (single member: `'voyage-3'`).
  - `PRICING_PENCE_PER_MTOK_INPUT` const map (Voyage 5p/MTok, verified 2026-05-18).
  - `calcEmbedCostPence()` private helper.
  - `voyageClient = new VoyageAIClient({...})` exported singleton.
  - `embed(args)` exported async function — equivalent to `parseCV()` in shape.
  - Inside `embed()`: `Date.now()` start → SDK call → fire-and-forget `record_ai_usage` via service-role with Sentry-on-failure.
- **Deviations:**
  - No retry loop here — the SDK's `maxRetries: 3` covers it (claude.ts does its own because it needs the 429/529 `retry-after` semantics; Voyage SDK's default backoff is fine).
  - `record_ai_usage` `p_purpose` enum: `'candidate_embed' | 'job_embed' | 'search_query_embed'` (CONTEXT D2-22).
  - `p_output_tokens: 0` — embeddings have no output tokens.
- **Cross-reference:** RESEARCH §A.1 (full skeleton on lines 113–200).

### `src/lib/ai/embed-text.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Pure functions; `import 'server-only'` optional (no side effects, but easier to test if it stays server-only because the `Tables<>` import is server-shaped).
  - `candidateEmbeddingText(c: Tables<'candidates'>, cvText: string | null): string` — concatenates structured summary block + truncated CV text per D2-01.
  - `jobEmbeddingText(j: Tables<'jobs'>): string` — structured summary + description per D2-01.
- **Deviations:** Truncate raw CV to 30,000 chars (well under Voyage's 32k token limit, ~7.5k tokens). Document the constant `MAX_CV_CHARS_FOR_EMBED = 30_000`.
- **Cross-reference:** RESEARCH §A.2.

### `src/lib/ai/match.ts` (NEW)

- **Closest analog:** `src/lib/ai/claude.ts` — specifically the `parseCV()` export shape (lines 199–228).
- **Pattern to copy:** Same shape — tool-use with `tool_choice: { type: 'tool', name: 'score_candidate_for_job' }`, response → `content.find(b => b.type === 'tool_use').input as MatchScore`. **MUST go through `runWithLogging`** in claude.ts — NEVER instantiate `Anthropic` here.
  - **Implementation note for planner:** `runWithLogging` is currently a private (non-exported) function in `claude.ts`. Plan must either (a) export `runWithLogging` from claude.ts and have `match.ts` import it, OR (b) co-locate `scoreCandidateForJob()` in `claude.ts` directly and have `match.ts` re-export. RESEARCH §B.7 suggests (b) — "Wrapper in `src/lib/ai/claude.ts` (extends existing file)". CONTEXT D2-09 says (a). **Recommendation:** export `runWithLogging` from `claude.ts` and keep `match.ts` as a thin caller — preserves the "one Anthropic instance" invariant while keeping the file boundary clean.
- **Deviations:**
  - `purpose: 'match_score'` for `record_ai_usage` (CONTEXT D2-22).
  - Model: `'claude-sonnet-4-6'` (matches CLAUDE.md default for matching/writing).
  - Input: structured candidate summary + structured job summary; cap CV/JD text per D2-08 to bound cost (~0.7p/call).
  - Tool schema from RESEARCH §B.7 (score 0–100, 2–3 strengths, 0–2 gaps, exactly 3 screening_questions, confidence enum).
- **Cross-reference:** RESEARCH §B.7 (full skeleton lines 462–547).

### `src/lib/encryption.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** See "Encryption helper shape" in cheat-sheet above. Mirror Node's standard `aes-256-gcm` pattern from RESEARCH §D.20.
- **Deviations:** Keep it tiny (≤ 60 lines). Two exports + one internal helper to parse the packed format.
- **Cross-reference:** RESEARCH §D.20.

### `src/lib/integrations/gmail.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Server-only module wrapping `googleapis`. Exports:
  - `createOAuth2Client()` — returns a `google.auth.OAuth2` configured with env vars
  - `exchangeCodeForTokens(code: string): Promise<{ refreshToken, accessToken, expiresAt, email, scopes }>` — called from callback route
  - `getValidAccessToken(userId: string): Promise<string>` — reads `gmail_credentials`, decrypts via `encryption.ts`, refreshes if expired, re-encrypts + saves new tokens
  - `startWatch(userId: string): Promise<{ historyId, expiration }>` — calls `gmail.users.watch`
  - `stopWatch(userId: string): Promise<void>` — `gmail.users.stop`
  - `listHistorySince(userId: string, startHistoryId: string): Promise<HistoryEntry[]>` — pagination handled internally
  - `getMessage(userId: string, messageId: string, format: 'metadata' | 'full'): Promise<gmail_v1.Schema$Message>`
- **Deviations:** None — `googleapis` SDK is the standard.
- **Cross-reference:** RESEARCH §D.18, §D.20, §D.22.

### `src/lib/integrations/turnstile.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Tiny module — single export `verifyTurnstileToken(token: string, remoteIp?: string): Promise<{ success: boolean; errorCodes?: string[] }>`.
  - POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with form data `secret=env.TURNSTILE_SECRET_KEY&response=<token>&remoteip=<ip>`.
  - Parse JSON, return `{ success, error-codes }`.
- **Deviations:** Use plain `fetch` not the SDK — keeps deps minimal and the function trivial to unit-test (mock fetch).
- **Cross-reference:** RESEARCH §C.13.

### `src/lib/db/ai-summaries.ts` (NEW)

- **Closest analog:** `src/lib/db/candidate-cvs.ts` (Phase 1 — single-table helpers with insert + select on a unique key).
- **Pattern to copy:** Exports (typed against the new `ai_summaries` row type):
  - `getMatchSummary(supabase, { candidateId, jobId, candidateEmbeddingVersion, jobEmbeddingVersion }): Promise<DbResult<MatchSummaryRow>>` — cache lookup
  - `upsertMatchSummary(supabase, input): Promise<DbResult<{ id: string }>>` — insert with `on conflict` on the version-keyed unique constraint
  - `listMatchSummariesForJob(supabase, { jobId, limit }): Promise<DbResult<MatchSummaryRow[]>>` — for the matches page
  - `deleteStaleMatchSummaries(supabase): Promise<DbResult<{ deleted: number }>>` — sweep used by the weekly cleanup function
- **Deviations:** Sentry tag set: `{ layer: 'db', helper: 'getMatchSummary' }` etc. (mirrors candidate-cvs.ts:34).
- **Cross-reference:** RESEARCH §B.10.

### `src/lib/db/gmail-credentials.ts` (NEW)

- **Closest analog:** `src/lib/db/profiles.ts` (single-row-per-user pattern).
- **Pattern to copy:** Exports:
  - `getGmailCredentials(supabase, userId): Promise<DbResult<GmailCredentialsRow | null>>` — null when not connected
  - `upsertGmailCredentials(supabase, input): Promise<DbResult<{ id: string }>>` — stores encrypted tokens (caller passes already-encrypted strings)
  - `updateGmailAccessToken(supabase, { userId, encryptedAccessToken, expiresAt }): Promise<DbResult<...>>` — token refresh path
  - `updateGmailWatchState(supabase, { userId, lastHistoryId, watchExpiresAt }): Promise<DbResult<...>>` — Pub/Sub watch maintenance
  - `revokeGmailCredentials(supabase, userId): Promise<DbResult<...>>` — set `revoked_at = now()` and null out tokens
- **Deviations:** **Never accept or return plaintext tokens** from these helpers. Encryption boundary is `src/lib/integrations/gmail.ts` — db helpers see only ciphertext.

### `src/lib/db/embeddings.ts` (NEW)

- **Closest analog:** `src/lib/db/candidates.ts` lines 70–135 (the `listCandidates` branch that calls `.rpc('search_candidates', ...)`).
- **Pattern to copy:** Exports:
  - `hybridSearchCandidates(supabase, { queryText, queryEmbedding, matchCount, minCosineSimilarity }): Promise<DbResult<HybridSearchRow[]>>` — calls the `match_candidates` RPC
  - `hybridSearchJobs(supabase, args): Promise<DbResult<...>>` — same for jobs
  - `getTopCandidatesByVector(supabase, { jobId, limit }): Promise<DbResult<CandidateIdRow[]>>` — vector-only path used by the precompute Inngest function (no query text)
- **Deviations:** All RPC calls. No `.from(...)` chains. The Phase 1 `listCandidates` already calls `.rpc('search_candidates', ...)` — extend that helper in candidates.ts to call `match_candidates` when a query embedding is available (per RESEARCH §A.6).
- **Cross-reference:** RESEARCH §A.4, §A.6.

### `src/lib/legal/consent.ts` (modify)

- **Closest analog:** itself.
- **Pattern to copy:** Bump `CURRENT_CONSENT_VERSION` from `'v1'` to `'v2'`. Add `CONSENT_TEXT_V2` constant with the apply-form-specific copy from RESEARCH §C.15 (lines 762–774).
- **Deviations:** Keep V1 constant in the file (don't delete) — historical candidates have `consent_text_version='v1'` and we may want to render the historical text for audit-trail purposes.

### `src/lib/legal/apply-form-blocklist.ts` (NEW)

- **Closest analog:** `src/lib/legal/decline-reasons.ts` (Phase 1 — simple typed constant module).
- **Pattern to copy:** Export `BLOCKED_EMAIL_DOMAINS: readonly string[]` plus a helper `isBlockedEmailDomain(email: string): boolean`.
- **Deviations:** None — short, deterministic, easy to unit-test.
- **Cross-reference:** RESEARCH §C.13 point 4.

---

## Inngest functions (Plan 2+)

### `src/inngest/functions/embed-candidate-on-cv-parse.ts` (NEW)

- **Closest analog:** `src/lib/inngest/functions/parse-cv.ts`.
- **Pattern to copy:** Full structure — id/triggers/concurrency/retries/onFailure + per-step body. Concurrency `{ limit: 5, key: 'event.data.organization_id' }`.
- **Deviations:**
  - **Path:** CONTEXT.md lists `src/inngest/functions/...` (NOTE: drop the `lib/` segment) — RESEARCH §E.26 shows `src/lib/inngest/functions/...`. **Existing code (`src/lib/inngest/functions/parse-cv.ts`) uses `src/lib/inngest/`.** Planner MUST follow existing convention `src/lib/inngest/functions/` — CONTEXT.md's path is a typo.
  - Trigger event: `candidate/embed` (RESEARCH §E.26 row 1).
  - Steps: (1) read candidate + latest CV row + extracted text, (2) build embedding input via `embed-text.ts`, (3) call `voyage.embed()`, (4) write `candidate_embedding` + `embedding_version + 1` + `embedded_at = now()`.
  - **OR (recommended by RESEARCH §A.5 last paragraph):** **add this as Step 5 of the existing `parse-cv.ts`** rather than a new function. Pro: no new event wiring; the CV-parse pipeline ends with an embed. Con: couples parse + embed into one retry envelope. Planner picks; if separate, this file is needed.
- **Cross-reference:** RESEARCH §A.5, §E.26.

### `src/inngest/functions/embed-job-on-jd-change.ts` (NEW)

- **Closest analog:** `parse-cv.ts` (structure) + `embed-candidate-on-cv-parse.ts` sibling (semantics).
- **Pattern to copy:** Mirror the candidate version. Trigger event: `job/embed`. Triggered from server actions on job CREATE and on description UPDATE.
- **Deviations:** Job has no equivalent of "latest CV text" — input is just the structured summary via `jobEmbeddingText(j)`.

### `src/inngest/functions/embed-candidates-batch.ts` (NEW — scheduled sweep)

- **Closest analog:** No Phase 1 scheduled function exists; structure mirrors `parse-cv.ts`.
- **Pattern to copy:** Use `inngest.createFunction({ ..., triggers: [{ cron: 'TZ=Europe/London */10 * * * *' }] }, ...)` — Inngest's scheduled trigger syntax.
- **Deviations:**
  - No `concurrency.key: 'event.data.organization_id'` because scheduled events have no per-org payload. Use a global cap `concurrency: { limit: 1 }` so two sweeps never overlap.
  - Batch query: `select id, organization_id from candidates where candidate_embedding is null limit 128 group by organization_id` — actually, group ALL nulls together up to 128 per Voyage batch limit, but BATCH BY ORG so each Voyage call has homogeneous org for cost logging. (Sweep loops: for each org with nulls, take up to 128 candidates, embed in one Voyage call, update.)
- **Cross-reference:** RESEARCH §A.5 Option B.

### `src/inngest/functions/precompute-matches-for-job.ts` (NEW)

- **Closest analog:** `parse-cv.ts` (structure).
- **Pattern to copy:** Trigger event `job/score-top-candidates`. Steps:
  1. Read job + its embedding.
  2. Call `getTopCandidatesByVector(supabase, { jobId, limit: 10 })` (db helper above).
  3. For each candidate, check `ai_summaries` cache; if miss, call `match.ts` `scoreCandidateForJob(...)`.
  4. Upsert each result into `ai_summaries`.
- **Deviations:**
  - Concurrency `{ limit: 2, key: 'event.data.organization_id' }` — tighter than embed because each step does ~10 Sonnet calls.
  - **Cost ceiling guard:** before scoring, check the org's `ai_usage` total for the current month; bail with a Sentry warning (not error) if over a configurable threshold. Planner sets threshold per RESEARCH §B.8 ("monthly is £20-50 at anchor scale").
- **Cross-reference:** RESEARCH §B.7, §B.8, §B.9.

### `src/inngest/functions/sync-gmail-history.ts` (NEW)

- **Closest analog:** `parse-cv.ts` (structure).
- **Pattern to copy:** Trigger event `gmail/history-changed`. Steps:
  1. Fetch + decrypt credentials via `gmail.ts` helpers.
  2. `listHistorySince(userId, last_history_id)`.
  3. For each `messageAdded`, `getMessage(userId, id, 'metadata')` — extracts from/to/subject/snippet.
  4. Match from + to + cc against `candidates.email` + `contacts.email` for the same org.
  5. For each match, insert `activities` row with `kind: 'email'`, `body: subject`, metadata per RESEARCH §D.23. Deduplicate by `(gmail_message_id, entity_id)` to avoid spam.
  6. Update `last_history_id` on `gmail_credentials`.
- **Deviations:**
  - Concurrency `{ limit: 1, key: 'event.data.user_id' }` — per-user serialization avoids racing history-list cursors.
  - **Retries: 5** (RESEARCH §E.26) — Google API transient errors are more common than Anthropic's.
- **Cross-reference:** RESEARCH §D.21, §D.22.

### `src/inngest/functions/refresh-gmail-watch.ts` (NEW)

- **Closest analog:** `embed-candidates-batch.ts` (scheduled cron sibling).
- **Pattern to copy:** Trigger `[{ cron: 'TZ=Europe/London 0 3 * * *' }]` (daily 3am).
- **Deviations:**
  - Body: select all `gmail_credentials where revoked_at is null and watch_expires_at < now() + interval '24h'`; for each, call `gmail.startWatch(userId)`; update `watch_expires_at` + `last_history_id`.
  - On error: Sentry warning per row (not a function-level failure) — one user's expired token shouldn't block other users' renewals.
- **Cross-reference:** RESEARCH §D.22 ("Gmail watch expires after 7 days").

### `src/inngest/functions/cleanup-stale-summaries.ts` (NEW — optional)

- **Closest analog:** Scheduled-cron pattern from `embed-candidates-batch.ts`.
- **Pattern to copy:** Weekly cron. Calls `deleteStaleMatchSummaries(supabase)` from `ai-summaries.ts`.
- **Deviations:** Trivial — single step.run, no retries needed (idempotent).
- **Cross-reference:** RESEARCH §B.10 last paragraph.

### `src/app/api/inngest/route.ts` (MODIFY)

- **Closest analog:** itself (Phase 1).
- **Pattern to copy:** Identical structure. Just expand the `functions: [...]` array with the new function imports.
- **Deviations:** None.

---

## App routes — recruiter-facing

### `src/app/(app)/search/page.tsx` (NEW)

- **Closest analog:** `src/app/(app)/candidates/page.tsx` (Phase 1 — RSC + `searchParams` + table). Plus the RESEARCH §A.6 note that this might just be `/candidates?q=...&mode=semantic` with no separate route.
- **Pattern to copy:**
  - **Decision needed:** standalone `/search` or query-param mode on `/candidates`? CONTEXT.md lists `/search` as a new route. RESEARCH §A.6 suggests just extending `listCandidates`. **Planner picks; recommend `/search` because the UX is genuinely different** (cross-entity unified results in v2; we lock to candidates-only for v1 but the URL gives us room).
  - If standalone: async RSC; `await searchParams`; if `q` present, embed via voyage then call `match_candidates`; render results in a list with score badges.
- **Deviations:** Placeholder text on the input (UI-SPEC verbatim): `"e.g. senior Python developer with offshore wind experience in Aberdeen"`. CONTEXT.md `<specifics>` mandates exact copy.
- **Cross-reference:** RESEARCH §A.6.

### `src/app/(app)/search/search-input.tsx` (NEW — Client Component)

- **Closest analog:** `src/app/(app)/candidates/search-input.tsx` (Phase 1).
- **Pattern to copy:** Same `useRouter` + `usePathname` + 300ms debounce + `router.replace`. Resets `page=1` on query change.
- **Deviations:** None.

### `src/app/(app)/search/search-results.tsx` (NEW — RSC)

- **Closest analog:** `src/app/(app)/candidates/candidate-table.tsx`.
- **Pattern to copy:** RSC presentation component. Renders shadcn `<Table>` or a list. Each row includes the standard candidate columns + a score badge (`text-xs font-semibold` with semantic colour by score bucket — green ≥80, amber 60–79, neutral <60).
- **Deviations:** When `rrf_score < threshold`, render the row in muted style (`text-muted-foreground`) and hide the score badge.

### `src/app/(app)/jobs/[id]/matches/page.tsx` (NEW)

- **Closest analog:** `src/app/(app)/jobs/[id]/page.tsx` (Phase 1 — async RSC for job detail).
- **Pattern to copy:** Same RSC shape. Reads job + calls `listMatchSummariesForJob(supabase, { jobId, limit: 10 })`. Renders a list of matches with score/strengths/gaps/screening questions inline.
- **Deviations:** When the cache is empty (precompute hasn't run yet), render skeletons and trigger an "Explain top 10" server action that streams scores in on demand (RESEARCH §B.8 hybrid pattern). Phase 2 v1 can defer streaming — show "Matches are being computed; refresh in a minute" and rely on the precompute function.

### `src/app/(app)/jobs/[id]/matches/match-card.tsx` (NEW — RSC)

- **Closest analog:** `src/components/app/pipeline-card.tsx` (Phase 1 — card-shaped presentation).
- **Pattern to copy:** shadcn `<Card>`; score header with badge; lists for strengths/gaps/screening_questions. Use `<Sparkles>` icon from lucide-react for "AI generated" indicator (matches activity-timeline.tsx pattern from Phase 1 PATTERNS).

### `src/app/(app)/settings/integrations/page.tsx` (NEW)

- **Closest analog:** `src/app/(app)/settings/page.tsx` (Phase 1 — Settings shell).
- **Pattern to copy:** Async RSC. Reads `getGmailCredentials(supabase, user.id)`; if connected, shows "Connected as <email>" + "Disconnect" button. If not connected, shows "Connect Gmail" button (links to `/api/gmail/start` route that builds the OAuth URL with a fresh state cookie).
- **Deviations:** Connect/Disconnect buttons are Client Components in `connect-gmail-button.tsx` / `disconnect-gmail-button.tsx`.

### `src/app/(app)/settings/integrations/connect-gmail-button.tsx` (NEW — Client)

- **Closest analog:** `src/app/(app)/candidates/[id]/cv-upload.tsx` (Client Component triggering a server action).
- **Pattern to copy:** `'use client'`. Button that calls a server action `startGmailOAuthAction()` which mints the OAuth URL + sets a `gmail_oauth_state` cookie and returns the URL; client does `window.location.href = url`.
- **Deviations:** None.

---

## App routes — public

### `src/app/(public)/apply/[orgSlug]/page.tsx` (NEW)

- **Closest analog:** `src/app/(auth)/sign-in/page.tsx` (page → form composition for a public-ish route).
- **Pattern to copy:** Async RSC. `await params`. Look up org by slug (use service-role client; `notFound()` if not found OR `apply_form_enabled = false` — same 404 to avoid enumeration). Render org name in header + `<ApplyForm orgId={org.id} orgName={org.name} />`.
- **Deviations:** No auth check (it's public). No TopNav (different layout group).
- **Cross-reference:** RESEARCH §C.12.

### `src/app/(public)/apply/[orgSlug]/apply-form.tsx` (NEW — Client)

- **Closest analog:** `src/app/(app)/candidates/new/candidate-form.tsx` (canonical RHF + zod + shadcn `<Form>`).
- **Pattern to copy:** Identical structure. `'use client'`, `useForm({ resolver: zodResolver(applyFormSchema) })`, `useTransition`, server-action call with typed object, `form.setError` for field errors, `toast.error` for submit errors.
- **Deviations:**
  - Hidden honeypot field `<input name="hp" tabIndex={-1} autoComplete="off" className="sr-only" />` (per RESEARCH §C.13 point 3).
  - Turnstile widget rendered above submit; token attached to form data.
  - GDPR consent checkbox required (renders `CONSENT_TEXT_V2`); use `z.literal(true)` pattern from Phase 1's `consent_confirmed` (`schema.ts:55`).
  - File input accepts only `.pdf,.docx`; client-side size check 10 MiB.
  - Submit flow is two-stage: action 1 (`submitApplyAction`) returns a signed upload URL; client uploads file directly; action 2 (`confirmApplyAction`) finalizes.

### `src/app/(public)/apply/[orgSlug]/schema.ts` (NEW)

- **Closest analog:** `src/app/(app)/candidates/new/schema.ts`.
- **Pattern to copy:** Identical structure. zod schema with `full_name`, `email`, `phone`, `location`, `current_role_title`, plus apply-specific: `availability` (immediate/2wk/1mo/other), `salary_expectation`, `source_detail`, `consent_confirmed: z.literal(true)`, `hp: z.string().max(0)` (honeypot — must be empty).
- **Deviations:** No `consent_basis` — apply form is always `consent` (D2-13).

### `src/app/(public)/apply/[orgSlug]/actions.ts` (NEW)

- **Closest analog:** `src/app/(app)/candidates/[id]/actions.ts` (lines 110–230 `uploadCVAction`) — but DIFFERENT in critical ways (anon, service-role).
- **Pattern to copy:** Two exports:
  - `submitApplyAction(formData, captchaToken, orgSlug)` —
    1. `verifyTurnstileToken()`
    2. `isBlockedEmailDomain()` check + honeypot check
    3. zod validation
    4. Rate limit check (per-IP+slug; insert/update `apply_form_rate_limits`)
    5. Look up org by slug (service-role); 404 if not found
    6. Check for existing candidate by email; if exists, append CV version; else create candidate + cv rows
    7. Mint signed upload URL via service-role
    8. Audit log via `record_audit_anonymous`
    9. Return `{ ok: true, signedUrl, candidateCvId, candidateId }`
  - `confirmApplyAction(candidateCvId)` — verify storage object exists, fire `inngest.send('cv/uploaded', { ..., user_id: null })`, return success.
- **Deviations:**
  - Uses **service-role client** throughout — RLS would reject anon inserts. The tenant boundary check is explicit: `org_id` derived from the slug lookup is the ONLY trusted source; never trust client input for it.
  - `consent_at = new Date().toISOString()` server-side (matches `candidates/new/actions.ts:42`).
  - Inngest send pattern matches `uploadCVAction:206-227` — wrap in try/catch, capture failure to Sentry with `error.name`-only.
- **Cross-reference:** RESEARCH §C.14, §C.15, §C.16.

### `src/app/(public)/apply/[orgSlug]/success/page.tsx` (NEW)

- **Closest analog:** `src/app/auth/auth-code-error/page.tsx` (Phase 1 — simple static page).
- **Pattern to copy:** Static RSC. Heading + body + link back to homepage. Sonner toast on landing ("Application received") triggered via a small Client wrapper.
- **Deviations:** None.

### `src/app/api/gmail/callback/route.ts` (NEW)

- **Closest analog:** `src/app/auth/callback/route.ts` (Phase 1 — OAuth-style callback handler).
- **Pattern to copy:** Same export shape (`export async function GET(request: NextRequest)`). Extract `code` + `state` from search params; verify `state` against the cookie set by `startGmailOAuthAction`; exchange code for tokens via `gmail.ts`; encrypt + upsert `gmail_credentials`; call `startWatch(userId)`; redirect to `/settings/integrations`.
- **Deviations:**
  - This route IS authenticated (recruiter is signed in during the OAuth dance) — use server client, NOT service-role.
  - On failure (state mismatch, code exchange error), redirect to `/settings/integrations?error=<code>`; do NOT redirect to `/auth/auth-code-error` (that's for magic-link only).
- **Cross-reference:** RESEARCH §D.18.

### `src/app/api/gmail/push/route.ts` (NEW)

- **Closest analog:** None for shape; `src/app/api/inngest/route.ts` is the only existing API route besides auth-callback. Closest for "verify-signature-then-dispatch" is the Phase 1 inngest route itself — but that uses `inngest/next`'s `serve()` adapter, not raw verify.
- **Pattern to copy:** See "Pub/Sub webhook route" in cheat-sheet above (full skeleton). Single `POST` export.
- **Deviations:** First action in handler MUST be JWT verification — before parsing body, before any DB read. Tenant boundary check: look up `gmail_credentials WHERE google_email = <payload.emailAddress>` AND verify the credential's `organization_id` matches the message's expected scope (which we can't fully verify until the Inngest function sees the message — the route just routes by user).
- **Cross-reference:** RESEARCH §D.22.

### `src/app/api/gmail/start/route.ts` (NEW — small helper route OR server action)

- **Closest analog:** `src/app/auth/callback/route.ts`.
- **Pattern to copy:** Could be either a route or a server action. **Recommendation:** server action inside `src/app/(app)/settings/integrations/actions.ts` (NOT a route) — it's authenticated-only and the action can set a cookie via `cookies()` from `next/headers`.
- **Deviations:** Action mints OAuth URL using `gmail.ts`'s `createOAuth2Client().generateAuthUrl({ scope: [...], state: randomNonce, access_type: 'offline', prompt: 'consent' })` and sets `gmail_oauth_state=<nonce>` cookie (HTTP-only, 10-minute TTL). Returns the URL; client redirects.

---

## Migrations (additive — per CONTEXT D2-20 + carry-forward triggers)

All migrations created via `supabase migration new <slug>` (auto-timestamps). All append-only.

### `<ts>_organizations_slug_check.sql` (NEW — D2-10)

- **Closest analog:** `supabase/migrations/20260518202000_organizations_logo_url.sql` (a simple `alter table ... add column ...` from Phase 1).
- **Pattern to copy:** Minimal `alter table public.organizations add column slug ...` — except CONTEXT.md notes `slug` already exists (Phase 1 `handle_new_user` trigger creates it). What's actually new: **the format check constraint**.
  ```sql
  alter table public.organizations
    add constraint organizations_slug_format check (slug ~ '^[a-z0-9-]{3,40}$') not valid;
  alter table public.organizations validate constraint organizations_slug_format;
  ```
- **Deviations:** Use `not valid` + `validate` to avoid a long lock if existing rows fail.
- **Cross-reference:** RESEARCH §C.12, §C.17.

### `<ts>_organizations_apply_form_enabled.sql` (NEW)

- **Closest analog:** Same as above.
- **Pattern to copy:** `alter table public.organizations add column apply_form_enabled boolean not null default true;`
- **Deviations:** None. Default true per Open Question 6 / RESEARCH recommendation.

### `<ts>_ai_summaries.sql` (NEW)

- **Closest analog:** `supabase/migrations/20260518211005_candidate_cvs_cross_tenant_fk_guard.sql` (full new-table + guard trigger pattern).
- **Pattern to copy:** Single migration containing:
  1. `create table public.ai_summaries (...)` per RESEARCH §B.10 lines 590–606.
  2. Indexes (`org_kind_idx`, `candidate_idx`, `job_idx`).
  3. `alter table ... enable row level security`.
  4. Tenant select + insert RLS policies (`using (organization_id = public.current_organization_id())`).
  5. `ai_summaries_set_org` BEFORE INSERT trigger calling `public.set_organization_id()`.
  6. `ai_summaries_same_org_guard()` function + `ai_summaries_verify_same_org_check` trigger — per RESEARCH §B.10 lines 626–642 and the cheat-sheet's FK guard rule.
- **Deviations:** **One migration containing both the table AND the guard trigger** (Phase 1 lesson — splitting these caused the trigger-order bug). RESEARCH §B.11 says exactly this: "Plan it as ONE migration ... Phase 1's bug taught us not to split related tables across migrations".
- **Cross-reference:** RESEARCH §B.10, §B.11, §E.27.

### `<ts>_gmail_credentials.sql` (NEW)

- **Closest analog:** `supabase/migrations/20260518211005_candidate_cvs_cross_tenant_fk_guard.sql`.
- **Pattern to copy:** Same shape as `ai_summaries.sql`:
  1. `create table public.gmail_credentials (...)` per RESEARCH §D.20 lines 886–901.
  2. `alter table ... enable row level security`.
  3. Four RLS policies (select/insert/update/delete; all gated on `user_id = auth.uid()` plus org match on insert).
  4. `gmail_credentials_set_org` + `gmail_credentials_set_updated_at` triggers.
- **Deviations:** NO `verify_same_org_check` trigger — the FK is to `users` only, which is auth-tied, and the `with check (user_id = auth.uid())` RLS already enforces it (per Phase 2 cheat-sheet table).

### `<ts>_apply_form_rate_limits.sql` (NEW)

- **Closest analog:** `supabase/migrations/20260518211005_candidate_cvs_cross_tenant_fk_guard.sql` for shape; no direct analog for content.
- **Pattern to copy:** Per RESEARCH §C.13 point 2:
  ```sql
  create table public.apply_form_rate_limits (
    ip_hash text not null,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    window_start timestamptz not null default now(),
    count integer not null default 1,
    primary key (ip_hash, organization_id, window_start)
  );
  create index apply_form_rate_limits_window_idx on public.apply_form_rate_limits (organization_id, window_start);
  ```
- **Deviations:**
  - No RLS — service-role-only writes (the apply action is the only writer). Add an explicit deny-all-other-roles policy or simply leave RLS disabled with a comment ("service-role only; never read from authenticated context").
  - Add an Inngest scheduled function `cleanup-rate-limits` (or just a Postgres cron via `pg_cron` extension) to purge windows older than 1 hour. **Skip the cron for v1 — the table will grow slowly enough that a manual sweep is fine for the first 6 months.**

### `<ts>_match_candidates_rpc.sql` (NEW)

- **Closest analog:** `supabase/migrations/20260517215939_search_candidates_rpc.sql` (Phase 1 trigram RPC).
- **Pattern to copy:** RESEARCH §A.4 full skeleton (lines 287–367). `security invoker`, `language sql stable`, `set search_path = public`, `grant execute on function ... to authenticated`.
- **Deviations:** Add an analogous `match_jobs` RPC in the same migration (or a sibling migration — planner picks). Both share the RRF k=60 constant.
- **Cross-reference:** RESEARCH §A.4.

### `<ts>_invalidate_embeddings_trigger.sql` (NEW)

- **Closest analog:** Functions defined in `supabase/migrations/20260513152244_phase1_domain_schema.sql` (e.g., `set_organization_id`).
- **Pattern to copy:** RESEARCH §A.5 lines 380–404 — `invalidate_candidate_embedding()` trigger function + `candidates_invalidate_embedding` trigger on candidates table. Sibling for jobs.
- **Deviations:** None.
- **Cross-reference:** RESEARCH §A.5.

### `<ts>_record_audit_anonymous.sql` (NEW)

- **Closest analog:** `record_audit` and `record_ai_usage` in `supabase/migrations/20260513152244_phase1_domain_schema.sql` lines ~100–130 (security-definer audit helpers).
- **Pattern to copy:** Same style — `language plpgsql security definer set search_path = public`. Inserts into `audit_log` with `actor_user_id := null`, takes `p_organization_id`, `p_action`, `p_entity_type`, `p_entity_id`, `p_metadata`.
- **Deviations:** `grant execute on function ... to service_role;` — NOT `authenticated`. The apply path runs under service-role; no recruiter-facing path should call this.

### `<ts>_hnsw_build_state.sql` (NEW — D2-05, optional v1)

- **Closest analog:** Phase 1 migrations have no near-equivalent.
- **Pattern to copy:** Per CONTEXT D2-05 — table tracking per-org HNSW build status:
  ```sql
  create table public.hnsw_build_state (
    table_name text primary key check (table_name in ('candidates', 'jobs')),
    built_at timestamptz,
    last_attempt_at timestamptz,
    last_error text
  );
  ```
- **Deviations:** **HNSW is built at the table level, not per-tenant** — pgvector index applies to the whole table. So this table tracks one row per indexed table (candidates, jobs), not per-org. CONTEXT D2-05's "per-org build status" wording is misleading; planner should adopt the table-level interpretation. The Inngest function `bootstrap-vector-index` reads this state and decides whether to `CREATE INDEX CONCURRENTLY`.
- **Cross-reference:** RESEARCH §A.3 ("Index timing"), CONTEXT D2-05.

---

## Files with no Phase 1 analog (planner consumes RESEARCH directly)

| New file | RESEARCH section | Notes |
|----------|-----------------|-------|
| `src/lib/ai/voyage.ts` | §A.1 | Full skeleton lines 113–200; mirror claude.ts shape |
| `src/lib/ai/embed-text.ts` | §A.2 | Pure functions, easy unit test |
| `src/lib/ai/match.ts` | §B.7 | Tool-use shape; export `runWithLogging` from claude.ts |
| `src/lib/encryption.ts` | §D.20 | Node crypto `aes-256-gcm` standard pattern |
| `src/lib/integrations/gmail.ts` | §D.18, §D.20, §D.22 | googleapis SDK wrapper |
| `src/lib/integrations/turnstile.ts` | §C.13 | Plain fetch to siteverify endpoint |
| `src/app/api/gmail/push/route.ts` | §D.22 | JWT verification before dispatch |
| `src/app/api/gmail/callback/route.ts` | §D.18 | Mirrors `auth/callback/route.ts` in shape |
| `src/app/(public)/apply/[orgSlug]/page.tsx` + form + actions | §C.12–§C.17 | First public route group in the app |
| `<ts>_match_candidates_rpc.sql` | §A.4 | RRF blending CTE |
| `<ts>_invalidate_embeddings_trigger.sql` | §A.5 | Standard plpgsql trigger |
| `<ts>_apply_form_rate_limits.sql` | §C.13 | New table, no FK guard needed |
| `<ts>_hnsw_build_state.sql` | §A.3 + CONTEXT D2-05 | One row per indexed table |
| Inngest scheduled functions (`embed-candidates-batch`, `refresh-gmail-watch`, `cleanup-stale-summaries`) | §E.26 | Cron triggers, no per-org concurrency key |

---

## Disagreements between sources and the resolution

| Source A | Source B | Conflict | Resolution |
|----------|----------|----------|-----------|
| CONTEXT.md `<code_context>` lists Inngest functions under `src/inngest/functions/...` | Existing Phase 1 code uses `src/lib/inngest/functions/...` | Path | **`src/lib/inngest/functions/`** wins — match existing. CONTEXT.md path is a typo. |
| CONTEXT D2-09 says `match.ts` is "new wrapper around claude.ts" | RESEARCH §B.7 puts `scoreCandidateForJob` directly in `claude.ts` | File ownership of the match function | **Export `runWithLogging` from `claude.ts`; place `scoreCandidateForJob` in `match.ts`** — preserves the "one Anthropic instance" invariant (grep test still passes) while honouring CONTEXT.md's file boundary. |
| CONTEXT D2-05 mentions "per-org build status" for HNSW | pgvector applies indexes at the table level | Per-org vs table-level state | Table-level (one row per indexed table). |
| RESEARCH §D.20 names the encryption module `src/lib/security/secret-cipher.ts` | CONTEXT.md `<code_context>` says `src/lib/encryption.ts` | Filepath | **CONTEXT.md wins** — `src/lib/encryption.ts`. |
| RESEARCH §A.5 recommends Option B (scheduled sweep) for embedding | CONTEXT D2-03 says reactive embedding via `embedCandidateOnCVParse` | Reactive vs scheduled | **Both** — reactive on CV parse complete (highest leverage); scheduled sweep covers all other mutation paths. Matches RESEARCH §A.5 final paragraph. |

---

## Highest-leverage patterns (TL;DR for planner)

1. **Mirror `claude.ts` for `voyage.ts`** — `import 'server-only'`, exported singleton client, single `embed()` function with mandatory `record_ai_usage` write via service-role + Sentry-on-log-failure. The grep invariant ("only one place instantiates Anthropic / VoyageAIClient") extends to Voyage.
2. **Every new Inngest function follows `parse-cv.ts`** — id/concurrency.key/retries/onFailure + tenant-boundary check BEFORE any `step.run` + `NonRetriableError` for cross-tenant payloads + Sentry tagged with `layer: 'inngest', function: '<id>'` + only `error.name + status` to Sentry (NEVER raw error).
3. **`<table>_verify_same_org_check` trigger naming** on every new tenant-scoped table with cross-table FKs — `ai_summaries` needs it; `gmail_credentials` doesn't (auth-tied). The trigger name MUST sort alphabetically AFTER `<table>_set_org` (v > s). Phase 1 paid for this lesson; don't re-pay.
4. **Apply form uses service-role + signed upload URLs**, not RLS + Vercel body. Tenant boundary is `organization_id` derived from `slug` lookup — never trust client input. `record_audit_anonymous` is the only audit path that may set `actor_user_id := null`.
5. **Gmail integration encryption boundary is `src/lib/encryption.ts` + `src/lib/integrations/gmail.ts`** — db helpers (`src/lib/db/gmail-credentials.ts`) see only ciphertext. Plaintext tokens never round-trip through Postgres or Sentry.
6. **Pub/Sub webhook returns 200 immediately** — JWT verify, decode payload, dispatch Inngest event, return. Long handlers cause duplicate deliveries from Google.
7. **`(public)` is a new route group** — middleware `PUBLIC_PATHS` must allow it; no `(app)/layout.tsx` shell; minimal own layout with "Powered by Altus" footer.
8. **RRF k=60** is the locked hybrid-search constant in the RPC; both pgvector cosine + pg_trgm trigram ranks blend via `1/(60 + rank)`.
9. **Migration consolidation rule (Phase 1 lesson):** one migration per logical change — table + RLS + set_org trigger + verify_same_org_check trigger all in the SAME file. Splitting them caused the Phase 1 trigger-order bug.

---

## Notable items with NO Phase 1 analog (planner designs from scratch)

These need fresh thinking — no existing precedent in the codebase:

1. **Public route group (`(public)/`)** — first time we ship an unauthenticated user-facing route. Middleware delta, layout delta, no auth context inside actions.
2. **Signed upload URL flow** — Phase 1 uploaded through Vercel; Phase 2 needs direct-to-Storage with service-role-minted signed URL. Two-stage server action (submit + confirm) is new.
3. **Encryption-at-rest helper** — `aes-256-gcm` for OAuth tokens. No prior crypto code in the repo.
4. **Pub/Sub webhook** — first webhook that needs JWT verification (Inngest is signing-key-based; Gmail Pub/Sub is OAuth2 ID-token-based). `google-auth-library` is new.
5. **Hybrid search RPC with RRF** — Phase 1 had pg_trgm `search_candidates`; the blended pgvector + trigram CTE with RRF is novel.
6. **Embedding invalidation trigger** — Phase 1 had no Postgres triggers that mutate the row's OWN columns. The `invalidate_candidate_embedding()` function NULLs `candidate_embedding` on relevant updates.
7. **Anonymous audit path** — `record_audit_anonymous` (or extended `record_audit` with nullable actor). Phase 1's audit was always recruiter-attributed.
8. **Scheduled Inngest functions** — Phase 1 only had event-driven functions; Phase 2 introduces cron triggers (`embed-candidates-batch`, `refresh-gmail-watch`, `cleanup-stale-summaries`).
9. **Cost-ceiling guard** in `precompute-matches-for-job.ts` — Phase 1 had no per-org cost guards; the threshold mechanism (read `ai_usage` aggregate per org per month, bail with Sentry warning if over) is new.
10. **Turnstile / honeypot / rate-limit composition** — Phase 1 had no public-facing abuse defence.

---

*Phase 2 patterns mapped: 2026-05-18. Total file rows: ~45. Conflicts resolved: 6. Items without Phase 1 analog: 10.*
