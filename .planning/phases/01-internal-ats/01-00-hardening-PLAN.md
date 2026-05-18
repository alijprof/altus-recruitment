# Plan 0: Hardening & Infrastructure

**Phase:** 1 — Internal ATS
**Plan:** 0 of 5 (hardening)
**Depends on:** none — runs first
**Requirements covered:** none directly (this plan UNBLOCKS every feature requirement by landing the missing infrastructure and closing the CRITICAL items in `.planning/codebase/CONCERNS.md`)
**Success criterion satisfied:** none — gate plan for Plans 1–5
**Mode:** mvp — vertical-slice gate (this plan ends with a runnable app whose middleware, env, types, db layer, AI wrapper, Inngest webhook, Sentry, and tests are all wired and green — nothing more, nothing less)

## Goal

After this plan, the repo is on a clean, secure, properly-instrumented base ready for feature work: the auth-guard middleware actually fires (renamed to `src/middleware.ts`), env vars validate at boot, `src/types/database.ts` is strict (no `@ts-nocheck`), `src/lib/db/` + `src/lib/ai/claude.ts` skeletons exist with the contract every later plan consumes, Inngest webhook is reachable + whitelisted, Sentry captures errors with org/user scope and PII scrub, every cross-tenant FK has a trigger guard, Storage `cvs` bucket has path-prefixed RLS, GIN trigram indexes back keyword search, the `handle_new_user()` trigger honours invitations, and `pnpm test` + `pnpm test:e2e` run a smoke check. No user-facing features change.

## Required reading for executor

- `.planning/phases/01-internal-ats/01-CONTEXT.md` (D-01 through D-04 in full — this plan implements them)
- `.planning/phases/01-internal-ats/01-RESEARCH.md` — sections **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13 (indexes only — the RPC + view land in Plans 1/3), 28 (trigger migration only), 30**, plus the **Cross-cutting reminders for the planner** Plan 0 order block
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — all "Plan 0 — Hardening" file rows + Conventions cheat-sheet
- `.planning/codebase/CONCERNS.md` — every Critical and High item; this plan closes them
- `CLAUDE.md` — verification checklist, "what to never do", convention list
- `supabase/migrations/20260513151021_init_organizations_and_users.sql` lines 130–170 (the `handle_new_user()` trigger we're updating)
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` (read-only — gives the table list for trigger guards + searchable column inventory)
- `src/proxy.ts`, `src/lib/supabase/middleware.ts`, `src/app/auth/callback/route.ts`, `src/app/(app)/layout.tsx` (the files this plan modifies)
- `pnpm-workspace.yaml` (currently has placeholder strings; this plan fixes)

## Tasks

### Task 0.1: Middleware rename + open-redirect predicate

**Files:**
- create `src/middleware.ts`
- delete `src/proxy.ts`
- create `src/lib/auth/safe-next.ts`
- modify `src/lib/supabase/middleware.ts` (add `/api/inngest` to `PUBLIC_PATHS`, call `safeNext()` where it composes the `?next=` redirect param)
- modify `src/app/auth/callback/route.ts` (use `safeNext()` to validate `?next=`)

**Pattern to copy:** PATTERNS.md Plan 0 rows `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `src/lib/auth/safe-next.ts`, `src/app/auth/callback/route.ts`. Code skeletons in RESEARCH §1 and §2 are copy-paste-ready.

**Implementation:**
1. Create `src/middleware.ts` with the exact body in RESEARCH §1 code skeleton — `export async function middleware(...)` plus the same matcher config that excludes static assets/image optimisation.
2. `git rm src/proxy.ts` in the same change set.
3. Create `src/lib/auth/safe-next.ts` exporting a single `safeNext(rawNext: string | null): string` function with the predicate from RESEARCH §2: rejects null, anything not starting with `/`, anything starting with `//`, anything starting with `/\`, and any string containing `://`. Returns `'/'` on any reject; otherwise returns `rawNext`.
4. In `src/lib/supabase/middleware.ts`: add `/api/inngest` to the `PUBLIC_PATHS` array (or equivalent allowlist) so Inngest webhooks aren't redirected to `/sign-in`. Replace any inline composition of the `?next=...` redirect destination with a call into `safeNext()` (defensive symmetry — even though `request.nextUrl.pathname` is server-derived).
5. In `src/app/auth/callback/route.ts`: replace the existing `?next=` handling with `const next = safeNext(searchParams.get('next'))` — full route file body matches the skeleton in RESEARCH §2.

**Verification:**
- `pnpm lint` passes
- `pnpm typecheck` passes
- Start `pnpm dev`; run `curl -sI http://localhost:3000/ | grep -i location` and confirm it returns `location: /sign-in?next=%2F` (proves the middleware is firing).
- Manually paste `http://localhost:3000/auth/callback?code=anything&next=//evil.com` into a browser; expect a redirect to `/auth/auth-code-error` (the bad `code` fails) but with the origin path being `/` not `//evil.com` if the code path succeeded.

### Task 0.2: Env validation + service-role Supabase client + regen types

**Files:**
- create `src/lib/env.ts`
- create `src/lib/supabase/service.ts`
- modify `src/lib/supabase/server.ts` (drop `!` non-null assertions; import `env`)
- modify `src/lib/supabase/client.ts` (drop `!`; import `env`)
- modify `src/types/database.ts` (regenerate, remove `// @ts-nocheck`)
- modify `.env.example` (add `ANTHROPIC_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`)
- modify `package.json` (add `"db:types": "pnpm exec supabase gen types typescript --local --schema public > src/types/database.ts"`)
- modify `pnpm-workspace.yaml` (fix placeholder strings per RESEARCH cross-cutting reminder #2)

**Pattern to copy:** RESEARCH §7 (env), RESEARCH §10 "service-role helper" block, RESEARCH §5 (type regen), PATTERNS.md rows `src/lib/env.ts`, `src/lib/supabase/service.ts`, `src/types/database.ts`. Cross-cutting reminders #2 for the workspace file.

**Implementation:**
1. `pnpm add @t3-oss/env-nextjs zod` (zod is already needed for forms — still add explicitly).
2. Create `src/lib/env.ts` matching the skeleton in RESEARCH §7 verbatim. Sentry-related keys (`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`) are `.optional()` because Sentry comes online in Task 0.5.
3. Refactor `src/lib/supabase/server.ts` and `src/lib/supabase/client.ts`: replace `process.env.NEXT_PUBLIC_SUPABASE_URL!` (and the publishable-key equivalent) with `env.NEXT_PUBLIC_SUPABASE_URL` / `env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` imported from `@/lib/env`. Remove the non-null `!` everywhere in these two files.
4. Create `src/lib/supabase/service.ts` exporting `createServiceClient()` using the service-role key, with `auth: { autoRefreshToken: false, persistSession: false }` and `import 'server-only'` at the top. Matches RESEARCH §10 block.
5. Ensure local Supabase is up (`pnpm exec supabase start`). Run `pnpm db:types` (the new script) to regenerate `src/types/database.ts`. Then by hand delete the `// @ts-nocheck` first line. Add `// reason: generated file; regenerate via pnpm db:types` as a leading comment instead.
6. Run `pnpm typecheck` and resolve any new errors (most likely candidates: type narrowing in `(app)/layout.tsx` where `data` was previously inferred as `any`).
7. Update `.env.example` to enumerate every key declared in `src/lib/env.ts` — match names exactly.
8. Fix `pnpm-workspace.yaml` per RESEARCH cross-cutting reminder #2: switch from the malformed `allowBuilds` block to `onlyBuiltDependencies: [supabase]` plus `ignoredBuiltDependencies: [sharp, unrs-resolver]` (or remove the block entirely if pnpm version forces the legacy spelling — check `pnpm --version` and pick the right key).

**Verification:**
- `pnpm install` succeeds with no warnings about placeholder builds
- `pnpm typecheck` passes (no `@ts-nocheck` remaining anywhere — grep `grep -rn '@ts-nocheck' src/ --include='*.ts*'` returns nothing)
- Manually rename `.env.local` -> `.env.local.bak` and run `pnpm dev`. Expect a clear, loud error naming the missing var (proves env validation runs at boot). Rename back.
- `pnpm dev` boots, `/` redirects to `/sign-in`, sign-in still works (no regression).

### Task 0.3: db query layer skeleton + layout refactor

**Files:**
- create `src/lib/db/types.ts` (the `DbResult<T>` discriminant)
- create `src/lib/db/profiles.ts`
- create `src/lib/db/organizations.ts`
- modify `src/app/(app)/layout.tsx` (replace inline `.from('users')` / `.from('organizations')` queries with the new helpers)

**Pattern to copy:** RESEARCH §9 code skeletons + the refactored `(app)/layout.tsx` skeleton in RESEARCH §9. PATTERNS.md rows under "Plan 0 — Hardening".

**Implementation:**
1. Create `src/lib/db/types.ts` exporting `export type DbResult<T> = { ok: true; data: T } | { ok: false; code: 'not_found' | 'internal' }` and nothing else.
2. Create `src/lib/db/profiles.ts` with `import 'server-only'` at the top, exporting `getProfile(supabase, userId)` exactly as RESEARCH §9 specifies. Use `Tables<'users'>` for the row type and `Pick<>` to limit the select.
3. Create `src/lib/db/organizations.ts` with `getOrganization(supabase, organizationId)` matching the §9 skeleton (`Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'>` return shape).
4. Refactor `src/app/(app)/layout.tsx` to use `getProfile()` and `getOrganization()` from the new helpers. Drop inline `.from()` calls. Keep the auth guard semantics identical (redirect to `/sign-in` on missing user or profile). Match the layout body in RESEARCH §9.
5. Helpers must NOT call `Sentry.captureException()` yet — Sentry hasn't been installed (Task 0.5). Add a TODO comment `// TODO: Sentry.captureException(error) — added in Task 0.5` where the skeleton shows it. Task 0.5 will edit these helpers to add the Sentry call.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Sign in to the app manually; top nav shows user email + org name (proves the helper refactor preserves behaviour)
- `grep -rn "from('users')\|from('organizations')" src/app/` returns nothing inside `src/app/(app)/layout.tsx` (no inline domain queries left in routes)

### Task 0.4: Inngest client + webhook route + AI claude wrapper skeleton

**Files:**
- create `src/lib/inngest/client.ts`
- create `src/app/api/inngest/route.ts`
- create `src/lib/ai/claude.ts`
- modify `package.json` (add `"inngest:dev"` script and the `concurrently`-based `"dev:all"` script per RESEARCH open question #1)

**Pattern to copy:** RESEARCH §8 (Inngest client + route skeleton, including the empty `functions: []` array), RESEARCH §10 (full `src/lib/ai/claude.ts` skeleton — keep the file complete including `parseCV` even though Plan 2 is what consumes it; this establishes the contract). PATTERNS.md rows `src/lib/inngest/client.ts`, `src/app/api/inngest/route.ts`, `src/lib/ai/claude.ts`.

**Implementation:**
1. `pnpm add inngest@4 @anthropic-ai/sdk@0.96 concurrently`.
2. Create `src/lib/inngest/client.ts` matching RESEARCH §8 — exports a singleton `inngest` configured with `id: 'altus-recruitment'` and `eventKey: env.INNGEST_EVENT_KEY`.
3. Create `src/app/api/inngest/route.ts` with `serve({ client: inngest, functions: [] })`. Empty `functions` array is intentional — Plan 2 adds `parseCVOnUpload`.
4. Create `src/lib/ai/claude.ts` matching RESEARCH §10 in full: `ApprovedModel` union of the three CLAUDE.md-locked model IDs, `PRICING_PENCE_PER_MTOK`, `runWithLogging()` with retry on 429/529 honouring `retry-after`, `parseCV(args)` using the `cvParseTool` schema with `tool_choice` forcing the tool call. Wrap `record_ai_usage` RPC call in try/catch that captures to Sentry (Task 0.5 will land Sentry — for now `// TODO: Sentry.captureException` then `console.error` as the temporary fallback). Use `import 'server-only'` at the top.
5. Add to `package.json` scripts: `"inngest:dev": "pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest"` and `"dev:all": "concurrently -n next,inngest 'pnpm dev' 'pnpm inngest:dev'"`. Document `dev:all` in the README in Task 0.7.

**Verification:**
- `pnpm typecheck` passes (the wrapper is strict — `Anthropic.Tool`, `Anthropic.MessageCreateParams` correctly typed)
- Start the app with `pnpm dev`. In another terminal: `pnpm inngest:dev`. The Inngest dev UI at `http://localhost:8288` shows app "altus-recruitment" connected with zero functions registered (proves discovery works and `/api/inngest` is whitelisted in middleware).
- `curl -X GET http://localhost:3000/api/inngest` returns Inngest's introspection JSON (not a `/sign-in` redirect).

### Task 0.5: Sentry install + observability helper

**Files:**
- create `sentry.server.config.ts` (project root)
- create `sentry.client.config.ts` (project root)
- create `sentry.edge.config.ts` (project root)
- create `instrumentation.ts` (project root)
- create `src/lib/observability/sentry.ts`
- modify `next.config.ts` (wrapped with `withSentryConfig`)
- modify `src/lib/db/profiles.ts`, `src/lib/db/organizations.ts` (replace the TODO with `Sentry.captureException`)
- modify `src/lib/ai/claude.ts` (replace the TODO with `Sentry.captureException`)
- modify `src/app/(app)/layout.tsx` (call `setRequestScope()` after profile/org load)

**Pattern to copy:** RESEARCH §6 in full. PATTERNS.md rows for the four Sentry config files + `instrumentation.ts` + `src/lib/observability/sentry.ts`. Critical: Task 0.5 runs AFTER Task 0.1 — middleware rename comes first because of Sentry [issue #8845](https://github.com/getsentry/sentry-javascript/issues/8845).

**Implementation:**
1. Run `pnpm dlx @sentry/wizard@latest -i nextjs --saas` and follow the prompts. Accept the wizard's `next.config.ts` wrap.
2. Replace the wizard's generated `sentry.server.config.ts` body with the RESEARCH §6 skeleton (the PII scrubbing `beforeSend`, `sendDefaultPii: false`, `tracesSampleRate: 0.1`). Same `beforeSend` scrub applies in `sentry.edge.config.ts`.
3. Create `src/lib/observability/sentry.ts` exporting `setRequestScope(userId, organizationId)` exactly as RESEARCH §6 specifies (sets user ID only — no email — and tags `organization_id`).
4. Wire `setRequestScope(user.id, profile.data.organization_id)` into `src/app/(app)/layout.tsx` right after the org lookup.
5. Replace the `// TODO: Sentry.captureException` markers in `src/lib/db/profiles.ts`, `src/lib/db/organizations.ts`, and `src/lib/ai/claude.ts` with `Sentry.captureException(error, { tags: { layer: 'db', helper: 'getProfile' } })` (mirror the right helper name in each).
6. Re-verify the middleware: `curl -sI http://localhost:3000/ | grep -i location` — expect the `/sign-in` redirect. If middleware silently stops firing after Sentry init, RESEARCH §6 pitfalls notes the workaround: move `src/middleware.ts` to `/middleware.ts` at project root.
7. Update `.env.example` with `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm build` pass
- `pnpm dev`; in a browser DevTools console, run a deliberately failing fetch or throw an error from a Server Action; confirm event appears in Sentry with `organization_id` tag and no `email` field anywhere in the payload. (If no Sentry project provisioned yet, set `SENTRY_DSN=https://invalid@invalid.ingest.sentry.io/0` and confirm the network request goes out — body inspection via DevTools network tab — without `email` keys.)
- `curl -sI http://localhost:3000/` still redirects to `/sign-in` (auth-guard regression check)

### Task 0.6: Migrations — cross-tenant FK guards, storage bucket, search indexes, invitation-aware trigger, `set_organization_id()` search_path hardening

**Files:**
- create `supabase/migrations/<ts>_cross_tenant_fk_guards.sql`
- create `supabase/migrations/<ts>_storage_cvs_bucket.sql`
- create `supabase/migrations/<ts>_search_indexes.sql`
- create `supabase/migrations/<ts>_handle_new_user_invite.sql`
- create `supabase/migrations/<ts>_harden_set_organization_id.sql` (per VERIFICATION R3 — closes the CONCERNS.md "`set_organization_id()` lacks `search_path` guard" security item)

**Pattern to copy:** RESEARCH §3 (FK guards) verbatim — `assert_same_org()` helper + per-table trigger function and trigger. RESEARCH §4 (storage bucket + 4 RLS policies). RESEARCH §13 (GIN trigram indexes — Plan 0 adds only the indexes; the `search_candidates` RPC lands in Plan 1 alongside the candidates list). RESEARCH §28 second code block (the rewritten `handle_new_user()` that honours `raw_user_meta_data.invited_to_org`).

**Implementation:**
1. Generate fresh timestamps for each migration via `date -u +%Y%m%d%H%M%S` (and increment by one second between files so they sort deterministically). Migrations are append-only — do not edit existing ones.
2. **`<ts>_cross_tenant_fk_guards.sql`**: Paste RESEARCH §3 code skeleton verbatim — `assert_same_org()` security-definer function + `contacts_same_org_guard()` trigger + `jobs_same_org_guard()` trigger + `applications_same_org_guard()` trigger. Keep `set search_path = public` on the helper.
3. **`<ts>_storage_cvs_bucket.sql`**: Paste RESEARCH §4 verbatim — `insert into storage.buckets ... on conflict do nothing` plus the 4 RLS policies for select/insert/update/delete keyed by `(storage.foldername(name))[1] = public.current_organization_id()::text`. Bucket is private. Allowed MIME types: PDF + DOCX.
4. **`<ts>_search_indexes.sql`**: Three GIN trigram indexes on columns the existing schema doesn't already cover — `create index if not exists ... on public.candidates using gin (lower(email) gin_trgm_ops);` + same for `candidates.current_role_title` + `companies.industry`. RESEARCH §13 confirms the existing migration covers `companies.name`, `candidates.full_name`, `jobs.title` already.
5. **`<ts>_handle_new_user_invite.sql`**: Paste the RESEARCH §28 second code block verbatim — `create or replace function public.handle_new_user()` with the `v_invited_org := nullif(new.raw_user_meta_data->>'invited_to_org', '')::uuid` branch that inserts the user with `role = 'recruiter'` into the inviting org. Otherwise falls through to the normal org-creation branch.
6. **`<ts>_harden_set_organization_id.sql`** (per VERIFICATION R3): re-declare `public.set_organization_id()` with `set search_path = public` to close the CONCERNS.md security item. Copy the existing body from `supabase/migrations/20260513152244_phase1_domain_schema.sql:86-99` unchanged; only add the `set search_path = public` clause:
   ```sql
   create or replace function public.set_organization_id()
   returns trigger
   language plpgsql
   security definer
   set search_path = public
   as $$
   begin
     if new.organization_id is null then
       new.organization_id := public.current_organization_id();
     end if;
     return new;
   end;
   $$;
   ```
   (Verify the existing `security definer` qualifier and any other modifiers from the source migration are preserved — only `set search_path = public` is new.)
7. Run `pnpm exec supabase db reset` to apply all migrations to a fresh local DB. Confirm no errors.

**Verification:**
- `pnpm exec supabase db reset` completes with zero errors
- Open `psql` against local DB and run the SQL smoke test from RESEARCH §3 verification block (insert into a contact in org A referencing a company in org B; expect the trigger to raise an exception with `cross-tenant FK guard:` in the message).
- `select * from storage.buckets where id = 'cvs'` returns 1 row with `public = false`, `file_size_limit = 52428800`.
- `select indexname from pg_indexes where schemaname = 'public' and indexdef like '%gin_trgm_ops%'` returns at least the three new indexes (plus the three that already existed = 6+ rows).
- `\df public.handle_new_user` shows the function exists; running `select prosrc from pg_proc where proname = 'handle_new_user'` body contains the string `invited_to_org`.

### Task 0.7: Vitest + Playwright + auth-guard smoke E2E + README setup notes

**Files:**
- create `vitest.config.ts`
- create `tests/setup.ts`
- create `playwright.config.ts`
- create `tests/e2e/global-setup.ts`
- create `tests/e2e/auth-guard.spec.ts`
- modify `package.json` (add `"test"`, `"test:e2e"`, `"test:e2e:reset"` scripts)
- modify `README.md` (local setup instructions — Supabase + Inngest + Sentry env requirements + `pnpm dev:all` workflow)

**Pattern to copy:** RESEARCH §30 in full (Vitest + Playwright configs, install commands, `tests/setup.ts`). For the auth-guard E2E, RESEARCH §1 "Integration check" code block.

**Implementation:**
1. `pnpm add -D vitest@4 @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event vite-tsconfig-paths @playwright/test@1.60`.
2. `pnpm exec playwright install --with-deps` (downloads browsers).
3. Create `vitest.config.ts` per RESEARCH §30 (tsconfigPaths + react plugin, jsdom env, globals true, setupFiles `./tests/setup.ts`).
4. Create `tests/setup.ts` with the single line `import '@testing-library/jest-dom/vitest'`.
5. Create `playwright.config.ts` per RESEARCH §30 (testDir `./tests/e2e`, `fullyParallel: false`, baseURL `http://localhost:3000`, webServer reuses existing).
6. Create `tests/e2e/global-setup.ts` as a minimal stub (Phase 1 magic-link sign-in is awkward in E2E — for Plan 0 just leave it empty; the auth-guard test below doesn't need an authenticated state).
7. Create `tests/e2e/auth-guard.spec.ts` with the RESEARCH §1 test body: `test('unauthenticated request to / redirects to /sign-in', ...)`.
8. Add scripts to `package.json`:
   - `"test": "vitest"`
   - `"test:e2e": "playwright test"`
   - `"test:e2e:reset": "pnpm exec supabase db reset && pnpm exec supabase db seed"`
9. Update `README.md`: prerequisites (Node + pnpm + Docker), `pnpm install`, `pnpm exec supabase start`, env keys to populate from `.env.example`, `pnpm dev:all` to run Next + Inngest, `pnpm test` for unit, `pnpm test:e2e` for E2E. Keep README short (~30 lines).

**Verification:**
- `pnpm test -- --run` exits 0 (empty Vitest suite or a single placeholder test; either is fine for now)
- `pnpm exec supabase start && pnpm dev` (in one terminal) + `pnpm test:e2e` (in another) — the `auth-guard.spec.ts` test passes
- `pnpm lint && pnpm typecheck` green
- README renders correctly in GitHub preview

## Plan-level verification

Run before declaring the plan done — every box below must be checked:

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] `pnpm exec supabase db reset` runs all migrations cleanly on a fresh DB
- [ ] `grep -rn '@ts-nocheck' src/ --include='*.ts*'` returns nothing
- [ ] `grep -rn "from('users')\|from('organizations')\|from('candidates')\|from('companies')\|from('jobs')\|from('applications')\|from('activities')" src/app/` returns no matches (no inline domain queries in route files — only `src/lib/db/*` may issue them)
- [ ] `grep -rn 'process\.env\.NEXT_PUBLIC_\|process\.env\.SUPABASE_\|process\.env\.ANTHROPIC_\|process\.env\.INNGEST_' src/` returns no matches outside `src/lib/env.ts` (env access goes via the `env` helper only)
- [ ] `curl -sI http://localhost:3000/ | grep -i location` returns `location: /sign-in?next=%2F` (middleware fires)
- [ ] `curl -X GET http://localhost:3000/api/inngest` returns Inngest's JSON (not a redirect) — proves the `/api/inngest` allowlist works
- [ ] Inngest dev UI at `localhost:8288` shows the app connected with zero functions registered
- [ ] The cross-tenant FK guard SQL smoke test from RESEARCH §3 raises an exception with `cross-tenant FK guard:` in the message
- [ ] `select * from storage.buckets where id = 'cvs'` returns a row with `public = false`
- [ ] `tests/e2e/auth-guard.spec.ts` passes
- [ ] A deliberate `throw new Error('test')` from a Server Action surfaces in Sentry with `organization_id` tag and no `email` field anywhere in the captured payload
- [ ] CONCERNS.md walk-through — every Critical and High item resolved or explicitly deferred with a written justification in this plan's commit message

## Out of scope for this plan (deferred or other plans)

- The `search_candidates`/`search_clients` RPC functions — they land in Plans 1 and 3 alongside the routes that call them. Plan 0 lands ONLY the GIN indexes that back the trgm operators.
- The `client_activity_timeline` view + `bump_last_contacted_at()` trigger — land in Plan 3 (RESEARCH §20) alongside the clients route that consumes the view.
- The `move_application()` Postgres function for atomic stage-change + activity write — lands in Plan 4 (RESEARCH §23).
- Inngest function `parseCVOnUpload` — lands in Plan 2 (RESEARCH §17). Plan 0 registers no functions.
- Feature db helpers (`candidates.ts`, `clients.ts`, `jobs.ts`, `applications.ts`, `activities.ts`, `dashboard.ts`) — each feature plan creates its own.
- shadcn primitive installs (`table`, `dialog`, `sheet`, `form`, `select`, `badge`, etc.) — each feature plan adds the components it needs. Plan 0 keeps shadcn surface unchanged.
- Anthropic pricing constant verification against `https://www.anthropic.com/pricing#api` — RESEARCH open question #2 puts this in Plan 5 polish.
- Resend, PostHog, Stripe — Phase 1 deferred entirely per CONCERNS.md "Deferred from Phase 1".
