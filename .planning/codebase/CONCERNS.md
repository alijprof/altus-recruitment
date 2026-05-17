# Codebase Concerns

**Analysis Date:** 2026-05-17

---

## Missing Critical Infrastructure

### AI Layer — No `src/lib/ai/` Directory

- Issue: `src/lib/ai/` does not exist. CLAUDE.md mandates all Claude calls go through `src/lib/ai/claude.ts`. No Anthropic, Voyage, or Whisper SDK is installed.
- Files: Missing `src/lib/ai/claude.ts`, `src/lib/ai/voyage.ts`, `src/lib/ai/whisper.ts`
- Impact: Any code added in Phase 2 that calls Claude directly (bypassing the wrapper) will violate the cost-logging invariant and make per-tenant AI spend invisible. This is described as "non-negotiable" in CLAUDE.md.
- Fix approach: Create `src/lib/ai/claude.ts` as a typed wrapper before any feature work that calls the Claude API. Wrapper must call `record_ai_usage()` on every response. Install `@anthropic-ai/sdk`.

### Typed DB Query Layer — No `src/lib/db/` Directory

- Issue: `src/lib/db/` does not exist. The app currently has raw Supabase queries inline in `src/app/(app)/layout.tsx`. No typed query helpers exist.
- Files: Missing `src/lib/db/` directory; inline queries at `src/app/(app)/layout.tsx:19-29`
- Impact: As feature pages are added, queries will proliferate in route files without a shared layer — making it harder to enforce tenant scoping, reuse queries, or add consistent error handling.
- Fix approach: Create `src/lib/db/` with typed query functions before Task 3 adds candidate/job data access.

### Background Jobs — No Inngest Setup

- Issue: No Inngest package (`inngest`) is installed. No Inngest client or function definitions exist. CLAUDE.md prohibits synchronous Claude calls that take >2s.
- Files: Missing `src/lib/inngest/`, no `inngest.json` or Inngest app route handler
- Impact: CV parsing, embedding generation, and match scoring (all Phase 2 features) cannot be implemented without a background job runner. Attempting synchronous Claude calls for these would be a CLAUDE.md violation.
- Fix approach: Install `inngest`, create an Inngest client at `src/lib/inngest/client.ts`, and add a route handler at `src/app/api/inngest/route.ts` before any long-running AI task work begins.

### Observability — No Sentry or PostHog

- Issue: Neither `@sentry/nextjs` nor `posthog-js` is installed. No error boundary or analytics setup exists.
- Files: Missing instrumentation entirely
- Impact: Server errors in production will be silent. CLAUDE.md requires Sentry with org_id + user_id context. Without this, debugging production issues is blocked.
- Fix approach: Install and configure Sentry via `@sentry/nextjs` wizard before production deployment. PostHog can follow but is lower urgency.

### Email — No Resend Setup

- Issue: `resend` package is not installed. No email sending capability exists.
- Impact: Magic-link auth currently relies entirely on Supabase's built-in transactional email (acceptable for dev). Phase 3+ features (candidate outreach, placement confirmations) have no email infrastructure.
- Fix approach: Install `resend` and create `src/lib/email/` before any feature that needs to send application emails.

---

## Tech Debt

### `src/types/database.ts` Has `// @ts-nocheck` at Top

- Issue: The generated Supabase types file begins with `// @ts-nocheck` (line 1). This suppresses all TypeScript checking across a 1,028-line file.
- Files: `src/types/database.ts:1`
- Impact: Type errors in the generated types file — and any code that imports from it — will silently pass typecheck. The project's strict TypeScript posture is compromised at the data layer boundary.
- Fix approach: Regenerate types via `pnpm exec supabase gen types typescript --local > src/types/database.ts` against the live local Supabase instance, verify the output compiles cleanly without `@ts-nocheck`, then remove the suppression. The `@ts-nocheck` was likely added to silence a mismatch between the hand-written placeholder and the generated shape.

### `pnpm-workspace.yaml` Contains Placeholder Values

- Issue: `pnpm-workspace.yaml` has placeholder text in `allowBuilds` entries: `sharp: set this to true or false` and `supabase: set this to true or false`. These are string literals, not booleans — pnpm treats them as truthy strings.
- Files: `pnpm-workspace.yaml:1-4`
- Impact: `allowBuilds` is parsed by pnpm to decide whether native builds are permitted. A string value `"set this to true or false"` is not a valid pnpm config value. This may cause build warnings or unexpected behaviour during `pnpm install`.
- Fix approach: Set concrete boolean values (`sharp: true`, `supabase: true`, `unrs-resolver: true`) or remove the `allowBuilds` block entirely since `ignoredBuiltDependencies` already handles the suppression.

### `src/proxy.ts` as Middleware Entry Point

- Issue: Next.js expects middleware at `middleware.ts` (project root). The current code uses `src/proxy.ts` as the entry point. There is no `middleware.ts` at the project root.
- Files: `src/proxy.ts`
- Impact: It is unclear how Next.js discovers `src/proxy.ts` as the middleware module. Standard Next.js 15 requires `middleware.ts` at root or `src/middleware.ts`. If this is not being picked up, the auth redirect guard in `src/lib/supabase/middleware.ts` may not be running on any routes, leaving the app unprotected without the layout-level redirect at `src/app/(app)/layout.tsx:14-16`.
- Fix approach: Rename `src/proxy.ts` to `src/middleware.ts` (Next.js recognises `src/middleware.ts` when `src/` is the root) or move to the project root as `middleware.ts`. Verify the middleware is active by testing that `/` redirects to `/sign-in` for unauthenticated requests.

### Inline DB Queries in Layout — No Query Layer Pattern Yet

- Issue: `src/app/(app)/layout.tsx` contains two raw Supabase queries (`.from('users')` and `.from('organizations')`) directly in the layout component. These are the only app-layer queries in the codebase and they set a pattern.
- Files: `src/app/(app)/layout.tsx:19-29`
- Impact: If this pattern is replicated in feature pages without a `src/lib/db/` layer, tenant scoping will need to be verified query-by-query across the codebase. The layout queries rely on RLS for isolation, which is correct — but without a shared query layer, adding org_id to WHERE clauses as a redundant safety net (defence in depth) becomes inconsistent.
- Fix approach: Establish `src/lib/db/` with `getProfile()` and `getOrganization()` helpers before Task 3. The layout should import from there rather than query inline.

---

## Security Considerations

### Open Redirect in Auth Callback

- Risk: `src/app/auth/callback/route.ts:12` uses `const next = searchParams.get('next') ?? '/'` and then redirects to `${origin}${next}` without validating that `next` is a relative path (starts with `/`). An attacker could craft a magic link with `?next=https://evil.com` to redirect users after auth.
- Files: `src/app/auth/callback/route.ts:11-18`
- Current mitigation: None — `next` is used directly.
- Recommendations: Validate that `next` starts with `/` and does not start with `//`. Example: `const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/'`

### No Rate Limiting on Sign-Up / Sign-In

- Risk: `src/app/(auth)/sign-up/sign-up-form.tsx` and `src/app/(auth)/sign-in/sign-in-form.tsx` call Supabase `signInWithOtp` directly from the browser with no client-side rate limiting or CAPTCHA.
- Files: `src/app/(auth)/sign-up/sign-up-form.tsx:27`, `src/app/(auth)/sign-in/sign-in-form.tsx:25`
- Current mitigation: Supabase has built-in rate limiting on OTP sends, but the threshold is configurable and defaults are permissive in development.
- Recommendations: Add Supabase project-level rate limiting configuration for OTP. Consider hCaptcha or Turnstile integration for production sign-up to prevent org-creation spam.

### Env Var Non-Null Assertions — Silent Failure if Missing

- Risk: All three Supabase client files assert env vars with `!` (`process.env.NEXT_PUBLIC_SUPABASE_URL!`). If the env var is absent (misconfigured deployment), the app will instantiate a Supabase client with `undefined` as the URL and throw cryptic fetch errors rather than a clear startup failure.
- Files: `src/lib/supabase/client.ts:7-8`, `src/lib/supabase/middleware.ts:12-13`, `src/lib/supabase/server.ts:10-11`
- Current mitigation: `.env.example` documents required vars, but no runtime validation exists.
- Recommendations: Add an `src/lib/env.ts` module that validates and exports required env vars at startup, throwing a clear error if any are missing. Next.js will surface this at build time.

### `set_organization_id()` Trigger Lacks `security definer` or `search_path` Guard

- Risk: `public.set_organization_id()` is a trigger function without `security definer` or `set search_path`. It calls `public.current_organization_id()` which is `security definer`. The trigger itself runs with the invoker's privileges. In most scenarios this is fine, but if the search_path is manipulated by a malicious session it could potentially resolve `current_organization_id` to a different function.
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:86-99`
- Current mitigation: `current_organization_id()` has `set search_path = public` which limits its surface.
- Recommendations: Add `set search_path = public` to `set_organization_id()` to match the pattern used in `record_audit` and `record_ai_usage`.

### No Supabase Storage RLS Bucket Policies Defined

- Risk: The schema defines `storage_path` on `candidate_cvs` but no Supabase Storage bucket or bucket RLS policies are created in the migrations. CVs stored in Supabase Storage will be unprotected if a bucket is created without RLS.
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:247` (storage_path column), no storage bucket migration exists
- Current mitigation: Storage is not yet used (CV upload is a Phase 2 feature).
- Recommendations: When implementing CV upload (Phase 2), create a migration that defines the storage bucket and RLS policies scoped by `organization_id` path prefix (e.g., `{org_id}/{candidate_id}/`).

---

## Multi-Tenancy Risks

### Cross-Tenant FK Integrity Not Enforced for Contacts → Companies

- Risk: A contact's `company_id` references `public.companies(id)` but there is no database-level constraint ensuring the contact and company share the same `organization_id`. RLS policies prevent reading cross-tenant data, but a malicious or buggy insert passing a `company_id` from another org would not be blocked by a CHECK constraint or foreign key.
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:178-193`
- Impact: Data integrity violation — contacts could be silently linked to another tenant's company. This is currently only prevented by app-level logic (which doesn't exist yet) and RLS select-blocking (which doesn't prevent the insert).
- Fix approach: Add a trigger or check constraint that validates `contact.organization_id = company.organization_id` on insert/update of contacts. Same pattern applies to jobs → companies and applications → candidates/jobs.

### Same Cross-Tenant FK Risk: Jobs → Companies and Applications → Candidates/Jobs

- Risk: `jobs.company_id` and `applications.candidate_id` / `applications.job_id` have the same gap — no constraint verifies the FKs resolve within the same tenant.
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:268-290` (jobs), `303-321` (applications)
- Fix approach: Either add cross-column CHECK constraints or use trigger-based validation. Alternatively, use composite foreign keys (e.g., `(organization_id, company_id)` → `companies(organization_id, id)` with a unique constraint on the target) — this is the most robust approach but requires schema changes.

### `activities.entity_id` Is Untyped UUID — No FK Verification

- Risk: `activities.entity_id` is a plain UUID with no foreign key. The `entity_type` CHECK constraint only validates the string is one of the valid types. No database constraint enforces that the referenced entity exists, belongs to the same org, or is not deleted.
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:332-348`
- Impact: Activities can be orphaned (entity deleted without cascade) or point to cross-tenant entities if app code contains a bug.
- Fix approach: This is an intentional trade-off for polymorphic tables (adding typed FKs would require separate tables or PostgreSQL polymorphic FK patterns). Mitigate by always setting `entity_id` server-side in `src/lib/db/` helpers that scope inserts within `current_organization_id()`. Document this pattern explicitly.

---

## Test Coverage Gaps

### Zero Tests — No Test Framework Installed

- Issue: No Vitest, Jest, or Playwright is installed. No test files exist. `tests/` directory is empty. No test scripts in `package.json`.
- Files: `package.json` (no test dependencies), `tests/` (empty)
- Risk: The most critical logic — RLS policy correctness, multi-tenant isolation, auth trigger behaviour, fee calculations — has zero automated coverage. A regression in `current_organization_id()` or `handle_new_user()` would only be caught manually.
- Priority: High — install Vitest for unit tests before Phase 2 logic is added. Priority test targets: `src/lib/ai/claude.ts` (when created), fee calculation utilities, and RLS policy integration tests using the Supabase test helper.

### No E2E Test Setup for Critical Auth Flow

- Issue: Sign-up → magic link → callback → org creation flow is entirely untested. The `handle_new_user()` trigger is the most complex piece of Phase 1 logic.
- Files: No `playwright.config.ts` exists
- Risk: Regressions in the trigger (e.g., when invitation flow is added) could silently break the sign-up path.
- Priority: High — configure Playwright and add a single E2E test for the sign-up happy path before Phase 2.

---

## Fragile Areas

### `handle_new_user()` Trigger — Invitation Flow Stub Is Incomplete

- Issue: The trigger at `supabase/migrations/20260513151021_init_organizations_and_users.sql:137-139` checks `if exists (select 1 from public.users where id = new.id) then return new; end if;` as a placeholder for the future invitation flow. The invitation flow itself does not exist yet, and the trigger's early-return behaviour for invited users means there is no code path that creates a `public.users` row for invited users.
- Files: `supabase/migrations/20260513151021_init_organizations_and_users.sql:136-139`
- Why fragile: Adding a team invite feature requires carefully coordinating the trigger, a new invitation table, and the sign-up flow. The current early-return guard prevents double-creation but leaves invited users with no public.users row unless the invitation flow explicitly creates it.
- Safe modification: When implementing invitations, add a migration that creates an `invitations` table, pre-inserts the `public.users` row for the invited user (before the auth.users row is created), and verifies the trigger's early-return path is hit correctly.

### `pnpm-workspace.yaml` Malformed Config

- Issue: As noted above, `allowBuilds` values are literal strings rather than booleans. This could cause `pnpm install` to behave unexpectedly on CI or on a fresh clone.
- Files: `pnpm-workspace.yaml:2-4`
- Safe modification: Fix the boolean values and run `pnpm install` to verify no regressions.

---

## Performance Considerations

### No HNSW Vector Index on `candidates.candidate_embedding` or `jobs.job_embedding`

- Issue: The migration explicitly defers HNSW index creation: "Vector index is added once data is populated in Phase 2 (HNSW build cost is meaningful and pointless on an empty table)."
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:237-239` (comment)
- Impact: Semantic search will perform sequential scans until the index migration is added. Acceptable now; becomes a hard requirement before semantic search goes live.
- Fix approach: Add a Phase 2 migration that creates HNSW indexes: `CREATE INDEX ON candidates USING hnsw (candidate_embedding halfvec_ip_ops)` and equivalent for jobs, once the embedding population task is complete.

### `current_organization_id()` Called Per-Row in RLS Policies

- Issue: Every RLS policy calls `public.current_organization_id()`, which executes `SELECT organization_id FROM public.users WHERE id = auth.uid()`. For a query returning N rows, PostgreSQL may call this function once (if it recognises it as stable) or N times depending on query planning. The function is marked `STABLE` which should allow caching per statement — but this is only guaranteed at the planner level.
- Files: `supabase/migrations/20260513151021_init_organizations_and_users.sql:61-69`
- Impact: For large result sets (e.g., full candidate list), if the `STABLE` caching does not kick in, this could add significant per-row overhead.
- Fix approach: Monitor query plans in production using `EXPLAIN ANALYZE`. If the function shows per-row calls, consider using a PostgreSQL session variable set at connection time instead (more complex but eliminates the per-row lookup entirely).

---

## Deferred from Phase 1

### Missing Schema Tables (Planned but Not Yet Created)

The following tables are referenced in CLAUDE.md or `docs/` but do not exist in any migration:
- `ai_summaries` — cache store for AI-generated text (match explanations, CV summaries). Required for the "cache AI outputs aggressively" principle.
- `placements` — the revenue event table. Required for Phase 3 fee tracking.
- `shortlists` — recruiter working lists pre-submission. Domain entity referenced in glossary.
- Storage bucket policies — Supabase Storage bucket for CVs has no migration.

### GDPR Right-to-Erasure Flow Not Designed

- Issue: `candidates` has `consent_basis`, `consent_at`, `consent_text_version` fields but no process for consent withdrawal, data deletion, or the 30-day erasure obligation under UK GDPR.
- Files: `supabase/migrations/20260513152244_phase1_domain_schema.sql:219-221`
- Risk: As soon as real candidate data is added (Phase 2+), the absence of a deletion/suppression flow creates legal exposure.
- Fix approach: Before live use, add a `consent_withdrawn_at` column and a soft-delete/anonymisation pattern. A separate migration and server action for "erase candidate data" should be scoped as a Phase 3 task.

### No Audit on `view` Actions Yet

- Issue: The `audit_action` enum includes `'view'` and `record_audit()` exists, but no app code calls `record_audit('view', ...)` on any data access. CLAUDE.md states "every access to candidate data is logged."
- Files: `src/app/(app)/layout.tsx` (first real data access), no call to `record_audit`
- Risk: From the moment candidate records are displayed in Phase 2, there will be unlogged data accesses — violating the audit-ready principle and potentially GDPR audit trail requirements.
- Fix approach: Establish the pattern in the first candidate-viewing server action/route (Task 3) and document it in CONVENTIONS.md.

---

*Concerns audit: 2026-05-17*
