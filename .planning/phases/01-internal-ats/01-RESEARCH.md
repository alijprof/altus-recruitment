# Phase 1 Research

**Purpose:** Implementation-ready research for Phase 1 (Internal ATS).
**Consumed by:** gsd-planner — produces PLAN.md files next.
**Researcher:** gsd-phase-researcher
**Date:** 2026-05-17

---

## How to read this file

Each topic is structured the same way:

- **Approach** — what to do (specific, actionable)
- **Why this approach** — rationale tied back to CONTEXT.md decisions or codebase constraints
- **Code skeleton** — real code at the versions in `package.json`; copy/paste-ready for tasks
- **Pitfalls** — gotchas the planner should turn into verification steps
- **Sources** — authoritative URLs (Next.js, Supabase, Anthropic, Inngest, etc.)

Confidence: HIGH unless flagged otherwise. Lower-confidence items are marked inline.

---

## Package versions (verified on npm registry 2026-05-17)

| Package | Version | Repo | Use |
|---------|---------|------|-----|
| `@anthropic-ai/sdk` | 0.96.0 | anthropics/anthropic-sdk-typescript | Claude wrapper (Task 4) |
| `inngest` | 4.4.0 | inngest/inngest-js | Background jobs (Plan 0 + Task 4) |
| `@sentry/nextjs` | 10.53.1 | getsentry/sentry-javascript | Error tracking (Plan 0) |
| `@dnd-kit/core` | 6.3.1 | clauderic/dnd-kit | Kanban drag (Task 6) |
| `@dnd-kit/sortable` | 10.0.0 | clauderic/dnd-kit | Sortable column (Task 6) |
| `unpdf` | 1.6.2 | unjs/unpdf | PDF text extraction (Task 4) |
| `mammoth` | 1.12.0 | mwilliamson/mammoth.js | DOCX text extraction (Task 4) |
| `zod` | 4.4.3 | colinhacks/zod | Schema validation (all forms + env) |
| `react-hook-form` | 7.76.0 | react-hook-form/react-hook-form | Forms (Tasks 3,5,6,7) |
| `@hookform/resolvers` | 5.2.2 | react-hook-form/resolvers | RHF zod bridge |
| `@t3-oss/env-nextjs` | 0.13.11 | t3-oss/t3-env | Env validation (Plan 0) |
| `sonner` | 2.0.7 | emilkowalski/sonner | Toasts (already in UI-SPEC) |
| `vitest` | 4.1.6 | vitest-dev/vitest | Unit tests (Plan 0) |
| `@playwright/test` | 1.60.0 | microsoft/playwright | E2E tests (Plan 0 / Task 7) |

All packages confirmed on the npm registry with first-party source repos. No slopcheck flag.

> Note on `@dnd-kit/core` 6.x: there is a separate `@dnd-kit/react` 0.4.x package on npm that is a new (in-progress) rewrite, NOT a drop-in. The stable, widely-used API for kanban use cases is the `@dnd-kit/core` + `@dnd-kit/sortable` pair — that is what UI-SPEC names and what we install.

---

## Plan 0 — Hardening & Infrastructure

### 1. Middleware rename (`src/proxy.ts` → `src/middleware.ts`)

**Approach.** Rename `src/proxy.ts` → `src/middleware.ts`. Rename the exported `proxy` function to `middleware`. Keep the existing `config.matcher`. Delete `src/proxy.ts` in the same commit. Add an integration check that asserts a request to `/` from an unauthenticated session redirects to `/sign-in`.

**Why this approach.** Next.js looks for `middleware.ts` (or `.js`) at the project root, OR at `src/middleware.ts` when the `src/` directory is used. It does NOT look for `src/proxy.ts` — that filename is meaningless to Next.js, and the only reason the current code might be running is by accident (or it isn't running at all and the layout-level `redirect()` in `(app)/layout.tsx:14-16` is the only guard). This is the exact concern raised in `.planning/codebase/CONCERNS.md` "`src/proxy.ts` as Middleware Entry Point". Note: Sentry has historically had a bug with `src/middleware.ts` not registering correctly when used with `@sentry/nextjs` — see [Sentry issue #8845](https://github.com/getsentry/sentry-javascript/issues/8845). If after installing Sentry (item 6 below) middleware stops firing, move it to `/middleware.ts` at the project root as the fallback.

**Code skeleton.**

```ts
// src/middleware.ts
import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // Match everything except static assets and image optimisation.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Integration check (planner: turn into a verification step).** Add a Playwright test (after Vitest/Playwright are installed in this same Plan 0) that:

```ts
// tests/e2e/auth-guard.spec.ts
import { test, expect } from '@playwright/test'
test('unauthenticated request to / redirects to /sign-in', async ({ page }) => {
  const response = await page.goto('/')
  expect(page.url()).toContain('/sign-in')
  expect(page.url()).toContain('next=%2F')
})
```

If Playwright is deferred, a curl smoke test in the verification checklist works: `curl -sI http://localhost:3000/ | grep -i location` should return `location: /sign-in?next=%2F`.

**Pitfalls.**
- Do NOT also keep `src/proxy.ts` — two files will not conflict (Next ignores `proxy.ts`) but it is dead code and confusing.
- The matcher must NOT exclude `/api/inngest` (item 8). The current matcher only excludes static assets and image optimisation, so `/api/inngest` is matched — and Inngest's `serve` handler does not require auth context. The handler itself uses Inngest signing keys for security. If the middleware redirects `/api/inngest` to `/sign-in` because the request is unauthenticated, Inngest webhooks will fail. Fix: add `/api/inngest` to the `PUBLIC_PATHS` array in `src/lib/supabase/middleware.ts`.
- Sentry installation (item 6) wraps Next config and runs an instrumentation step at build that injects code into middleware; verify middleware still fires after Sentry init.

**Sources.**
- [Next.js: File-system conventions — `src` directory](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder)
- [Next.js: Routing — Middleware](https://nextjs.org/docs/15/app/building-your-application/routing/middleware)
- [Sentry issue #8845: `src/middleware.ts` not picked up](https://github.com/getsentry/sentry-javascript/issues/8845)
- `.planning/codebase/CONCERNS.md` "`src/proxy.ts` as Middleware Entry Point"

---

### 2. Open-redirect mitigation on `?next=`

**Approach.** Inside `src/app/auth/callback/route.ts`, validate the `next` query parameter using a strict predicate before composing the redirect URL:

```ts
function safeNext(rawNext: string | null): string {
  if (!rawNext) return '/'
  // Must start with a single slash and must not be a protocol-relative URL.
  if (!rawNext.startsWith('/')) return '/'
  if (rawNext.startsWith('//')) return '/'
  // Reject backslash variants (`/\evil.com`) that some browsers normalise.
  if (rawNext.startsWith('/\\')) return '/'
  return rawNext
}
```

Apply identically in `src/lib/supabase/middleware.ts` when the middleware sets `next=` on the redirect (line 43 of the existing file) — it's already setting `next=pathname` from `request.nextUrl.pathname` which is server-derived and safe, but symmetrising the predicate prevents future drift. Use the SAME `safeNext` predicate in both files: hoist it to `src/lib/auth/safe-next.ts` (a new file) so they can't diverge.

**Why this approach.** This is exactly the predicate locked in CONTEXT.md D-02 ("validate `?next=` is a relative path (`startsWith('/') && !startsWith('//')`), otherwise fall back to `/`"). The extra `\\` check covers a documented browser quirk where `/\\evil.com` is treated as protocol-relative in some user agents.

**Code skeleton — full callback route.**

```ts
// src/app/auth/callback/route.ts
import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/auth/safe-next'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
```

**Pitfalls.**
- Do NOT URL-decode `next` before checking — `URLSearchParams.get()` returns the already-decoded value. Re-decoding can reintroduce `//`.
- Encoded slash variants (`%2F%2Fevil.com`) decode to `//evil.com` and are correctly rejected by the `startsWith('//')` check on the decoded value.
- Reject any value containing `://` as defence-in-depth: a value like `/example://attacker` is technically relative but is a weird shape and likely a bug or attack — log to Sentry if seen (don't redirect, fall back to `/`).

**Sources.**
- [Open Web Application Security Project — Unvalidated Redirects and Forwards](https://owasp.org/www-community/attacks/Unvalidated_Redirects_and_Forwards)
- `.planning/codebase/CONCERNS.md` "Open Redirect in Auth Callback"

---

### 3. Cross-tenant FK trigger guards (Postgres)

**Approach.** Add an additive migration (`supabase/migrations/<timestamp>_cross_tenant_fk_guards.sql`) with one trigger function per FK pair, each in the form: `BEFORE INSERT OR UPDATE` validating that the FK row's `organization_id` matches `NEW.organization_id`. The function raises an exception on mismatch.

**Why this approach.** Postgres `CHECK` constraints cannot reference other tables (verified [PostgreSQL 5.5 Constraints docs](https://www.postgresql.org/docs/current/ddl-constraints.html)). Composite FKs (`(organization_id, company_id) -> companies(organization_id, id)`) are technically the most robust pattern but require adding unique constraints on the parent tables and editing existing FKs — and our migrations are append-only, so editing isn't allowed. Triggers solve the integrity gap without any schema change. The trigger fires under the inserting user's session; because `current_organization_id()` is `STABLE security definer`, it's safe to use inside the trigger but we deliberately compare `NEW.organization_id` directly (which the `set_organization_id` trigger has already populated) — that means even a future code path that bypasses `set_organization_id` is still defended.

**Code skeleton.**

```sql
-- supabase/migrations/<timestamp>_cross_tenant_fk_guards.sql

-- Helper: validate that a child row's organization_id matches its referenced
-- parent. We accept (parent_table, parent_id, child_org_id) and look up the
-- parent's organization_id, raising on any mismatch.
create or replace function public.assert_same_org(
  p_parent_table regclass,
  p_parent_id uuid,
  p_child_org_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parent_org_id uuid;
begin
  execute format('select organization_id from %s where id = $1', p_parent_table)
    into v_parent_org_id
    using p_parent_id;
  if v_parent_org_id is null then
    raise exception 'cross-tenant FK guard: parent row % not found in %', p_parent_id, p_parent_table;
  end if;
  if v_parent_org_id is distinct from p_child_org_id then
    raise exception 'cross-tenant FK guard: % belongs to org %, expected %',
      p_parent_table, v_parent_org_id, p_child_org_id;
  end if;
end;
$$;

-- contacts.company_id -> companies
create or replace function public.contacts_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.companies'::regclass, new.company_id, new.organization_id);
  return new;
end;
$$;
create trigger contacts_same_org_check
  before insert or update of company_id, organization_id on public.contacts
  for each row execute function public.contacts_same_org_guard();

-- jobs.company_id -> companies
create or replace function public.jobs_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.companies'::regclass, new.company_id, new.organization_id);
  return new;
end;
$$;
create trigger jobs_same_org_check
  before insert or update of company_id, organization_id on public.jobs
  for each row execute function public.jobs_same_org_guard();

-- applications.candidate_id -> candidates AND applications.job_id -> jobs
create or replace function public.applications_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.candidates'::regclass, new.candidate_id, new.organization_id);
  perform public.assert_same_org('public.jobs'::regclass, new.job_id, new.organization_id);
  return new;
end;
$$;
create trigger applications_same_org_check
  before insert or update of candidate_id, job_id, organization_id on public.applications
  for each row execute function public.applications_same_org_guard();
```

**Triggers fire AFTER `set_organization_id`** because `set_organization_id` is `BEFORE INSERT` and Postgres fires triggers alphabetically within the same timing. Verify: `set_organization_id` triggers are named `<table>_set_org` (e.g. `contacts_set_org`); the new guards are named `<table>_same_org_check`. Alphabetically `set_org < same_org_check` → `set_org` fires first, populating `organization_id`, then the guard runs. Good.

**Pitfalls.**
- The trigger uses `select organization_id from <parent> where id = $1` — this query runs as `security definer` on a function declared `set search_path = public`. Without that, a malicious user could theoretically install a same-named table on a different schema and intercept the lookup. We include `set search_path = public`.
- Activities is intentionally NOT in this migration — `activities.entity_id` is polymorphic and untyped (correctly identified as a tradeoff in CONCERNS.md). For activities, enforce same-org at the application layer in `src/lib/db/activities.ts` helpers.
- `EXPLAIN ANALYZE` after this lands: the cost-per-insert should be one index scan on the parent (e.g., `companies_pkey`). On a Postgres 17 instance with low row counts that's microseconds.

**Verification check.** Add a SQL smoke test that the planner can include in `tests/sql/cross-tenant.sql`:
```sql
-- Should fail: contact org A referencing company org B
do $$
declare v_org_a uuid; v_org_b uuid; v_company_b uuid;
begin
  insert into organizations(name, slug) values ('A', 'a') returning id into v_org_a;
  insert into organizations(name, slug) values ('B', 'b') returning id into v_org_b;
  insert into companies(organization_id, name) values (v_org_b, 'B Co') returning id into v_company_b;
  begin
    insert into contacts(organization_id, company_id, full_name) values (v_org_a, v_company_b, 'X');
    raise exception 'trigger did not fire';
  exception when others then
    raise notice 'trigger fired correctly: %', sqlerrm;
  end;
end $$;
```

**Sources.**
- [PostgreSQL 18: 5.5 Constraints — CHECK constraints cannot reference other tables](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [Cybertec: Triggers to enforce constraints](https://www.cybertec-postgresql.com/en/triggers-to-enforce-constraints/)
- `.planning/codebase/CONCERNS.md` "Cross-Tenant FK Integrity Not Enforced for Contacts → Companies"

---

### 4. Supabase Storage path-prefixed RLS (`cvs` bucket)

**Approach.** Plan 0 lands a migration that creates the `cvs` bucket and four RLS policies — all four operations gated by `(storage.foldername(name))[1] = public.current_organization_id()::text`. The bucket is **private** (not public). Reads happen via signed URLs created server-side (in CV review panel) or via the Supabase JS client where RLS is enforced.

**Why this approach.** `storage.foldername(name)` returns the path as an array of folder names. `[1]` indexes the first folder (path arrays are 1-indexed in Postgres). The CONTEXT.md D-02 storage path convention is `{org_id}/{candidate_id}/...`, so the first folder is the org id. This is the documented Supabase pattern for org-scoped storage. The bucket must be private; Supabase Storage RLS does NOT apply to public buckets (they bypass RLS entirely).

**Code skeleton.**

```sql
-- supabase/migrations/<timestamp>_storage_cvs_bucket.sql

-- Create the bucket. We set 50 MiB file size limit to match config.toml.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvs',
  'cvs',
  false,
  52428800, -- 50 MiB
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
) on conflict (id) do nothing;

-- Path convention: {org_id}/{candidate_id}/{uuid}-{filename}
-- storage.foldername(name) returns ARRAY['org_id', 'candidate_id', ...]
-- [1] indexes the first element (Postgres arrays are 1-indexed).

create policy "Tenant select own org CVs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant insert into own org CVs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant update own org CVs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  )
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant delete own org CVs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
```

**Storage path format (D-04 discretion).** Recommend `{org_id}/{candidate_id}/{cv_uuid}-{slug_of_filename}.{ext}` where:
- `cv_uuid` is `gen_random_uuid()` generated app-side (collision-free, sortable enough by creation timestamp via UUID v7 — but v4 is fine here; collisions are negligible at this scale)
- `slug_of_filename` is the original filename run through a slug helper (`alex-smith-cv.pdf` not `Alex Smith's CV (final).pdf`) so the Supabase Studio file browser is browseable

**Pitfalls.**
- Inngest functions run as the `service_role` — they bypass RLS entirely. That means a buggy Inngest function COULD read any org's files. Mitigate by always passing `(org_id, candidate_id, storage_path)` into the Inngest event payload and validating the path starts with `${org_id}/${candidate_id}/` inside the function before downloading.
- Signed URLs (via `createSignedUrl(path, expiresIn)`) work without RLS, but the path must be valid. Generate signed URLs from a server action that first asserts the candidate is in the caller's org (RLS will do this via a `select` on candidates before we ask Storage for a URL).
- DO NOT enable Supabase Storage's "public read" toggle on this bucket from the dashboard.

**Sources.**
- [Supabase Storage: Helper Functions (`storage.foldername`)](https://supabase.com/docs/guides/storage/schema/helper-functions)
- [Supabase Storage: Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase discussion #31073: Restrict top-level folder to user UUID](https://github.com/orgs/supabase/discussions/31073)

---

### 5. Supabase type generation + removing `@ts-nocheck`

**Approach.** Locally:
1. Ensure Supabase is running (`pnpm exec supabase start`).
2. Regenerate: `pnpm exec supabase gen types typescript --local --schema public > src/types/database.ts`
3. Remove the `// @ts-nocheck` first line by hand (the generator does NOT include it; the existing file has it because someone hand-edited).
4. Run `pnpm typecheck` and fix any breakages. Most likely breakages: code that imports `Tables<'foo'>` for a table that doesn't exist, or that assumes a column shape from an outdated draft.

Also add a script to `package.json`:
```json
"db:types": "pnpm exec supabase gen types typescript --local --schema public > src/types/database.ts"
```

So future schema edits run `pnpm db:types` and review the diff.

**Why this approach.** The CLI generates a fully-typed `Database` interface that the existing `createServerClient<Database>(...)` and `createBrowserClient<Database>(...)` consume. `@ts-nocheck` defeats the entire purpose of having a typed schema — this is the single biggest correctness gap in the codebase (`CONCERNS.md` "`src/types/database.ts` Has `// @ts-nocheck` at Top").

**Code skeleton — what the head of a clean generated file looks like.**

```ts
// src/types/database.ts (NO @ts-nocheck)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      candidates: {
        Row: {
          id: string
          organization_id: string
          full_name: string
          email: string | null
          // ...
        }
        Insert: { /* ... */ }
        Update: { /* ... */ }
        Relationships: [ /* ... */ ]
      }
      // ... all other tables
    }
    Enums: {
      market_status: 'actively_looking' | 'passively_looking' | 'hot' | 'placed' | 'cold'
      // ...
    }
    // ...
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]
```

**Pitfalls.**
- If `pnpm exec supabase start` is not run first, the CLI will refuse with "no local instance" — start it first.
- The Storage migration in step 4 adds rows to the `storage` schema, but `--schema public` only emits public-schema types. That's correct — we don't need typed access to `storage.objects` from app code (we use the Supabase Storage SDK API, not raw queries).
- If `Database['public']['Functions']` is emitted, also keep it — the `record_audit` and `record_ai_usage` functions will be called via `.rpc()` and the type signature gives us type safety on the args.
- Re-run `pnpm db:types` after adding the cross-tenant guard migration (item 3) and storage policies (item 4) — they don't change public-schema TS shape, but it's a good habit to regenerate after every migration.

**Sources.**
- [Supabase: Generating TypeScript Types](https://supabase.com/docs/guides/api/rest/generating-types)

---

### 6. Sentry for Next.js 16

**Approach.** Install with the wizard: `pnpm dlx @sentry/wizard@latest -i nextjs --saas`. The wizard creates:
- `sentry.client.config.ts`
- `sentry.server.config.ts` (or `instrumentation.ts` for newer setups — Sentry 10+ prefers `instrumentation.ts`)
- `sentry.edge.config.ts`
- Wraps `next.config.ts` with `withSentryConfig(...)`

Override the wizard defaults with PII scrubbing via `beforeSend` (rejected globally) and `setUser` / scope tags set per-request from a helper called inside the auth-aware paths.

**Why this approach.** `@sentry/nextjs` 10.x integrates with Next.js 16 App Router via the `instrumentation.ts` hook (a Next.js feature for early server-side wiring — [Next.js Instrumentation docs](https://nextjs.org/docs/app/guides/instrumentation)). The wizard handles the boilerplate; we just override `beforeSend` and `sendDefaultPii=false` (which is the default but worth setting explicitly).

**Code skeleton — `sentry.server.config.ts` (or `instrumentation.ts` body).**

```ts
// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false, // Do not auto-capture IP, cookies, headers.

  beforeSend(event, hint) {
    // Belt-and-braces PII scrub. CLAUDE.md forbids logging CV text or candidate emails.
    if (event.request?.cookies) delete event.request.cookies
    if (event.user?.email) delete event.user.email // Keep id only.

    // Scrub known-PII keys recursively from extra / contexts.
    const PII_KEYS = ['email', 'phone', 'cv_text', 'extracted_data', 'candidate_email', 'full_name']
    function scrub(obj: unknown): unknown {
      if (!obj || typeof obj !== 'object') return obj
      if (Array.isArray(obj)) return obj.map(scrub)
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (PII_KEYS.includes(k)) {
          out[k] = '[REDACTED]'
        } else {
          out[k] = scrub(v)
        }
      }
      return out
    }
    if (event.extra) event.extra = scrub(event.extra) as typeof event.extra
    if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts
    return event
  },
})
```

**Helper for setting org/user scope on every server action.**

```ts
// src/lib/observability/sentry.ts
import * as Sentry from '@sentry/nextjs'

export function setRequestScope(userId: string | null, organizationId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null)
  Sentry.setTag('organization_id', organizationId ?? 'unknown')
}
```

Call `setRequestScope(user.id, profile.organization_id)` at the top of every server action and inside `(app)/layout.tsx` after the user/org lookup.

**Pitfalls.**
- `sendDefaultPii` defaults to `false`; setting it explicitly is documentation, not behaviour change.
- `beforeSend` runs AFTER event processors, so it's the last line of defence — put the scrub there even if you also add `Sentry.addEventProcessor(...)`.
- The wizard injects `SENTRY_AUTH_TOKEN` for source-map uploads at build. Add this to the env validation schema (item 7) but mark it as `optional` so local dev doesn't fail.
- Sentry installed BEFORE the middleware rename (item 1) can cause `src/middleware.ts` discovery issues (see Sentry [issue #8845](https://github.com/getsentry/sentry-javascript/issues/8845)). Order Plan 0 tasks: (a) middleware rename, (b) verify auth guard fires via curl/Playwright, (c) THEN install Sentry, (d) re-verify auth guard still fires.

**Sources.**
- [Sentry: Next.js Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/)
- [Sentry: Next.js (overview)](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Next.js: Instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation)

---

### 7. Env validation via `@t3-oss/env-nextjs`

**Approach.** Install `@t3-oss/env-nextjs` (it brings `zod` as a peer; we'd already need zod for forms). Create `src/lib/env.ts` exporting an `env` object whose construction validates server + client variables at module load. Import `env` from app code instead of `process.env.X!`.

**Why this approach.** The current code uses `process.env.NEXT_PUBLIC_SUPABASE_URL!` (non-null assertion) in three places. If the env var is missing, the assertion is a runtime lie — Supabase clients instantiate with `undefined` URL and throw cryptic fetch errors later. `@t3-oss/env-nextjs` fails the build (and `pnpm dev` boot) if any required var is missing. CLAUDE.md doesn't mandate this library but the principle ("validates required env vars at module load… fail loudly at boot if any are missing") is in CONTEXT.md D-03.

We choose `@t3-oss/env-nextjs` over a hand-rolled zod schema because: (a) it correctly handles the `NEXT_PUBLIC_` split (server vars never sent to client bundle, client vars only those prefixed `NEXT_PUBLIC_`); (b) it warns at build time when client schema references a non-public var; (c) it's tiny (no runtime dependency beyond zod which we already need).

**Code skeleton.**

```ts
// src/lib/env.ts
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  },
  // T3 env requires explicit binding because Next.js doesn't expose process.env
  // wholesale on the client — we have to enumerate the NEXT_PUBLIC_ vars.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
})
```

Then refactor the three Supabase client files:

```ts
// src/lib/supabase/server.ts (excerpt)
import { env } from '@/lib/env'
// ...
return createServerClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  // ...
)
```

Drop the `!` non-null assertions.

**Pitfalls.**
- The `experimental__runtimeEnv` block is required for Next.js because it does NOT expose all `NEXT_PUBLIC_*` env vars to the client bundle automatically — only those statically referenced. List every public var explicitly. (This name will stabilise; [T3 docs](https://env.t3.gg/docs/nextjs) note the prefix.)
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — by putting it in `server:` it is type-error if imported in a Client Component (the lib detects misuse at runtime via a Proxy).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase calls this the "publishable key" (sometimes also called "anon key" in older docs). The codebase consistently uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — preserve that name.
- Add `ANTHROPIC_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` to `.env.example`.

**Sources.**
- [T3 Env: Next.js](https://env.t3.gg/docs/nextjs)
- [T3 Env GitHub](https://github.com/t3-oss/t3-env)

---

### 8. Inngest on Next.js 16

**Approach.** Install `inngest` 4.x. Create:
1. `src/lib/inngest/client.ts` — the Inngest client instance, exported singleton.
2. `src/app/api/inngest/route.ts` — the route handler that exposes the Inngest serve endpoint (matches both `GET` and `POST` for function discovery and invocation).
3. Add `/api/inngest` to `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts` so the auth guard doesn't redirect it (Inngest uses its own signing-key auth).
4. Plan 0 lands these three with zero functions registered. Task 4 adds `parseCVOnUpload` (item 17 in this research).
5. Local dev: `pnpm dev` plus `pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest` in a second terminal. Add to README and `package.json scripts`: `"inngest:dev": "pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest"`.

**Why this approach.** `inngest/next` exports a `serve` adapter that wraps function handlers in a single route handler — this is the documented pattern in [Inngest Next.js Quick Start](https://www.inngest.com/docs/getting-started/nextjs-quick-start). It uses `GET` for function discovery (Inngest calls our endpoint to enumerate functions) and `POST` for function invocation. We use it as-is.

**Code skeleton — client.**

```ts
// src/lib/inngest/client.ts
import { Inngest } from 'inngest'

import { env } from '@/lib/env'

export const inngest = new Inngest({
  id: 'altus-recruitment',
  eventKey: env.INNGEST_EVENT_KEY,
  // Inngest signing key validates incoming webhooks. Set automatically via env.
})
```

**Code skeleton — route handler.**

```ts
// src/app/api/inngest/route.ts
import { serve } from 'inngest/next'

import { inngest } from '@/lib/inngest/client'
// import { parseCVOnUpload } from '@/lib/inngest/functions/parse-cv' // Added in Task 4

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // parseCVOnUpload,
  ],
})
```

**Concurrency + retry config for `parseCVOnUpload` (anticipated for Task 4).**

```ts
// src/lib/inngest/functions/parse-cv.ts (Task 4 adds this)
import { NonRetriableError } from 'inngest'

import { inngest } from '@/lib/inngest/client'

export const parseCVOnUpload = inngest.createFunction(
  {
    id: 'parse-cv-on-upload',
    // Cap concurrent CV parses to avoid hammering Claude rate limits.
    // Anthropic API tiers have per-minute caps; 5 concurrent is conservative.
    concurrency: { limit: 5, key: 'event.data.organization_id' },
    // Inngest's default retry is 4 attempts with exponential backoff.
    // For transient API errors that's right; we override to 3 because Anthropic
    // 529 errors usually clear within minutes.
    retries: 3,
  },
  { event: 'cv/uploaded' },
  async ({ event, step }) => {
    const { organization_id, candidate_id, storage_path } = event.data

    // Validate storage path stays in tenant boundary (defence in depth).
    if (!storage_path.startsWith(`${organization_id}/${candidate_id}/`)) {
      throw new NonRetriableError('storage_path outside tenant boundary')
    }

    const fileBuffer = await step.run('download-cv', async () => {
      // download via service-role Supabase client
    })

    const extractedText = await step.run('extract-text', async () => {
      // unpdf or mammoth
    })

    const parsed = await step.run('claude-parse', async () => {
      // calls src/lib/ai/claude.ts parseCV
    })

    await step.run('write-extracted', async () => {
      // update candidate_cvs.extracted_data + parsing_status='complete'
      // populate empty candidate fields only (D-08)
    })
  },
)
```

**Pitfalls.**
- The Inngest route is matched by the existing middleware matcher `'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'` because `/api/inngest` is none of the exclusions. WITHOUT adding it to `PUBLIC_PATHS`, Inngest webhook calls (which have no auth cookie) will redirect to `/sign-in`, which Inngest interprets as a function discovery failure. The fix: add `/api/inngest` to `PUBLIC_PATHS` in middleware OR exclude `/api/` from the matcher pattern. Recommend `PUBLIC_PATHS` because future API routes may need auth.
- Inngest functions run as the Inngest service hitting our public endpoint with a signing-key header. Inside the function, we have no Supabase auth context — use the SERVICE-ROLE Supabase client (not the SSR client). Plan 0 should add `src/lib/supabase/service.ts` that creates a `createClient(url, service_role_key)` without cookies for use ONLY by Inngest functions.
- Use `step.run('name', async () => ...)` to checkpoint between expensive operations. Each `step.run` is independently retried; if Claude succeeds but the write step fails, only the write retries. This is why the function shape uses 4 small steps, not one big block.
- `NonRetriableError` — for permanently bad inputs (corrupt file, tenant-boundary violation). Other errors retry up to `retries`.
- The `idempotency` key in `createFunction` options would deduplicate event triggers; we don't need it for `cv/uploaded` because each event has a unique `candidate_cv_id` and a retry intentionally re-runs against the same row.

**Sources.**
- [Inngest: Next.js Quick Start](https://www.inngest.com/docs/getting-started/nextjs-quick-start)
- [Inngest: Setting up your Inngest app](https://www.inngest.com/docs/learn/serving-inngest-functions)
- [Inngest: Errors and Retries — `NonRetriableError`](https://www.inngest.com/docs/features/inngest-functions/error-retries/inngest-errors)
- [Inngest: Handling idempotency](https://www.inngest.com/docs/guides/handling-idempotency)

---

### 9. `src/lib/db/` typed query helpers

**Approach.** Create `src/lib/db/` with one file per domain entity. Each helper takes a Supabase client (so it works in both server and Inngest contexts) and returns `{ data, error }` tuples that NEVER leak Postgres errors to the UI. Use `Tables<'foo'>` as the return type so the helper signature is purely the row shape; do not invent custom types unless the helper returns a join/aggregate.

**Why this approach.** CONTEXT.md D-04 mandates this layer be established in Plan 0 with `getProfile()` and `getOrganization()`. The refactor of `(app)/layout.tsx` to use them is the proof of pattern. After that, every feature task imports from `src/lib/db/*` and never inlines `.from('candidates')` in a route file.

The "no raw Postgres errors" rule means helpers log full error to Sentry + return a friendly error code. UI shows `Couldn't load — please refresh`, never `duplicate key value violates unique constraint "candidates_pkey"`.

**Code skeleton — pattern.**

```ts
// src/lib/db/profile.ts
import 'server-only'

import * as Sentry from '@sentry/nextjs'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/database'

export type DbResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'not_found' | 'internal' }

export async function getProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<DbResult<Pick<Tables<'users'>, 'full_name' | 'email' | 'organization_id'>>> {
  const { data, error } = await supabase
    .from('users')
    .select('full_name, email, organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getProfile' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}
```

```ts
// src/lib/db/organization.ts
import 'server-only'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/database'
import type { DbResult } from './profile'

export async function getOrganization(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<DbResult<Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'>>> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', organizationId)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { layer: 'db', helper: 'getOrganization' } })
    return { ok: false, code: 'internal' }
  }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, data }
}
```

**Refactored `(app)/layout.tsx`:**

```ts
import { redirect } from 'next/navigation'

import { TopNav } from '@/components/app/top-nav'
import { getProfile } from '@/lib/db/profile'
import { getOrganization } from '@/lib/db/organization'
import { createClient } from '@/lib/supabase/server'
import { setRequestScope } from '@/lib/observability/sentry'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) redirect('/sign-in')

  const organization = await getOrganization(supabase, profile.data.organization_id)
  setRequestScope(user.id, profile.data.organization_id)

  return (
    <div className="flex min-h-svh flex-col">
      <TopNav
        userEmail={profile.data.email ?? user.email ?? ''}
        userName={profile.data.full_name ?? null}
        organizationName={organization.ok ? organization.data.name : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
```

**Naming convention.** `getX` for read; `listX` for collection read; `createX`, `updateX`, `deleteX` for writes. Each helper accepts the Supabase client as its first arg so callers can choose SSR client vs service-role client without the helper caring.

**Pitfalls.**
- Always `import 'server-only'` at the top of `src/lib/db/*` so importing one from a Client Component is a compile error.
- Don't return raw `PostgrestError` from helpers — it leaks query shape and column names.
- For mutations (Task 3+), wrap inserts/updates in a helper that:
  1. Validates the input with a zod schema co-located with the helper.
  2. Calls `record_audit(...)` via `.rpc()` after success (for detail-view writes; D-16).
  3. Maps Postgres unique-violation errors (`23505`) to a `code: 'conflict'` discriminant.

**Sources.**
- `.planning/codebase/CONCERNS.md` "Typed DB Query Layer — No `src/lib/db/` Directory"

---

### 10. `src/lib/ai/claude.ts` typed wrapper

**Approach.** A single module exporting:
- `parseCV(args): Promise<ParseCVResult>` for Task 4
- `claudeClient` (an `Anthropic` instance) for future modules
- An internal `runWithLogging(...)` helper that wraps every `.messages.create(...)` call to (a) measure latency, (b) compute cost in pence, (c) call `record_ai_usage` via the service-role client.

The wrapper hard-codes the three approved model IDs from CLAUDE.md and refuses any other ID at the TS layer.

**Why this approach.** CLAUDE.md is unambiguous: "All Claude calls go through `src/lib/ai/claude.ts` — a typed wrapper that handles model selection, retries, error normalisation, token logging." and "Cost is logged per tenant per call to a `ai_usage` table… This is non-negotiable." The wrapper is the single point of enforcement for both rules.

The wrapper takes a single shape for tool-use structured output (D-05): pass `tools: [{name, description, input_schema}]` plus `tool_choice: { type: 'tool', name }` to force the model to produce a tool-call response. The response is parsed from `response.content[].input` (when `content[].type === 'tool_use'`).

**Code skeleton — full wrapper.**

```ts
// src/lib/ai/claude.ts
import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

export type ApprovedModel =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'

export const claudeClient = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  maxRetries: 0, // We do our own retry inside runWithLogging.
})

// Model pricing per million tokens, pence. Update when Anthropic adjusts.
// Verify against https://www.anthropic.com/pricing#api before launch.
const PRICING_PENCE_PER_MTOK: Record<ApprovedModel, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 80, output: 400 },
  'claude-sonnet-4-6': { input: 240, output: 1200 },
  'claude-opus-4-7': { input: 1200, output: 6000 },
}

function calcCostPence(model: ApprovedModel, inputTokens: number, outputTokens: number): number {
  const p = PRICING_PENCE_PER_MTOK[model]
  return Math.ceil((p.input * inputTokens + p.output * outputTokens) / 1_000_000)
}

type RunArgs = {
  model: ApprovedModel
  organizationId: string
  userId?: string | null
  purpose: string // e.g. 'cv_parse'
  request: Omit<Anthropic.MessageCreateParams, 'model' | 'stream'>
}

async function runWithLogging(args: RunArgs): Promise<Anthropic.Message> {
  const started = Date.now()
  let attempt = 0
  let lastError: unknown
  while (attempt <= 3) {
    try {
      const response = await claudeClient.messages.create({
        model: args.model,
        ...args.request,
      })
      const cost = calcCostPence(args.model, response.usage.input_tokens, response.usage.output_tokens)
      const supabase = createServiceClient()
      await supabase.rpc('record_ai_usage', {
        p_organization_id: args.organizationId,
        p_model: args.model,
        p_purpose: args.purpose,
        p_input_tokens: response.usage.input_tokens,
        p_output_tokens: response.usage.output_tokens,
        p_cost_pence: cost,
        p_latency_ms: Date.now() - started,
        p_user_id: args.userId ?? null,
      })
      return response
    } catch (err) {
      lastError = err
      if (err instanceof Anthropic.APIError) {
        // 429 = rate limit; 529 = overloaded; both retry with exponential backoff.
        if (err.status === 429 || err.status === 529) {
          const retryAfter = Number((err.headers as Record<string, string>)?.['retry-after'])
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30_000, 1000 * 2 ** attempt)
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          attempt++
          continue
        }
        // 4xx other than 429: non-retriable.
        if (err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err
        }
        // 5xx: retry with simple backoff.
        if (err.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
          attempt++
          continue
        }
      }
      // Unknown error: do not retry.
      throw err
    }
  }
  throw lastError
}

// CV PARSE TOOL — D-05 schema. Single tool call, all fields at once.
const cvParseTool: Anthropic.Tool = {
  name: 'extract_cv_fields',
  description:
    'Extract structured candidate data from a CV. Provide a confidence value per field (high/medium/low) so the recruiter knows what to verify.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      location: { type: 'string' },
      current_role: { type: 'string' },
      current_company: { type: 'string' },
      work_history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company: { type: 'string' },
            role: { type: 'string' },
            start_date: { type: 'string' },
            end_date: { type: 'string' },
            summary: { type: 'string' },
          },
        },
      },
      skills: { type: 'array', items: { type: 'string' } },
      education: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            institution: { type: 'string' },
            qualification: { type: 'string' },
            year: { type: 'string' },
          },
        },
      },
      salary_current_estimate: { type: 'integer', description: 'Annual GBP estimate.' },
      salary_expectation: { type: 'integer', description: 'Annual GBP estimate.' },
      seniority_level: {
        type: 'string',
        enum: ['junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'director'],
      },
      years_experience_total: { type: 'number' },
      sector_tags: { type: 'array', items: { type: 'string' } },
      confidence_per_field: {
        type: 'object',
        description: 'Map of field name to high|medium|low.',
        additionalProperties: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
    required: ['name', 'confidence_per_field'],
  },
}

export type ParsedCV = {
  name: string
  email?: string
  phone?: string
  location?: string
  current_role?: string
  current_company?: string
  work_history?: Array<{ company?: string; role?: string; start_date?: string; end_date?: string; summary?: string }>
  skills?: string[]
  education?: Array<{ institution?: string; qualification?: string; year?: string }>
  salary_current_estimate?: number
  salary_expectation?: number
  seniority_level?: string
  years_experience_total?: number
  sector_tags?: string[]
  confidence_per_field: Record<string, 'high' | 'medium' | 'low'>
}

export async function parseCV(args: {
  cvText: string
  organizationId: string
  userId?: string | null
}): Promise<ParsedCV> {
  const response = await runWithLogging({
    model: 'claude-haiku-4-5-20251001',
    organizationId: args.organizationId,
    userId: args.userId,
    purpose: 'cv_parse',
    request: {
      max_tokens: 2048,
      tools: [cvParseTool],
      tool_choice: { type: 'tool', name: 'extract_cv_fields' },
      messages: [
        {
          role: 'user',
          content:
            'Extract structured fields from the following CV. Be conservative — assign "low" confidence when uncertain. CV follows:\n\n' +
            args.cvText,
        },
      ],
    },
  })
  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return tool_use block')
  }
  return toolUse.input as ParsedCV
}
```

**Service-role Supabase client helper (also a Plan 0 file).**

```ts
// src/lib/supabase/service.ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import type { Database } from '@/types/database'

export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
```

**Pitfalls.**
- The SDK's built-in retry (`maxRetries: 2` by default) plus our outer retry would compound. Disable SDK retry via `maxRetries: 0` and own the retry logic.
- 429 vs 529: Anthropic returns 529 for capacity issues, 429 for per-key rate limits. Both retry; 429 should honour the `retry-after` header strictly. ([Anthropic 429 fix guide](https://www.aifreeapi.com/en/posts/claude-api-429-error-fix); [Anthropic 529 playbook](https://dev.to/kevinzy189/claude-status-why-your-claude-api-keeps-returning-529-overloadederror-a-production-debugging-61i)).
- `tool_choice` forces the model to produce a tool call — without it, Haiku may return a regular text response and the parser fails.
- `confidence_per_field` is `required` so the model always emits it (D-07 UX depends on it).
- Always call `record_ai_usage` BEFORE returning — if the parse succeeds but the logging fails, the cost is invisible. Wrap the logging in a try/catch that captures to Sentry but doesn't fail the parse.
- Pricing numbers in `PRICING_PENCE_PER_MTOK` should be sanity-checked against the live Anthropic pricing page before launch. The numbers above are placeholders sized in the right order of magnitude — the planner should add a "verify pricing matches https://www.anthropic.com/pricing" verification step.

**Sources.**
- [Anthropic: Define tools (`input_schema`, `tool_choice`)](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
- [Anthropic Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk)
- [Claude API 429 fix guide](https://www.aifreeapi.com/en/posts/claude-api-429-error-fix)
- [Claude 529 overloaded error playbook](https://dev.to/kevinzy189/claude-status-why-your-claude-api-keeps-returning-529-overloadederror-a-production-debugging-61i)

---

## Task 3 — Candidates module

### 11. react-hook-form + zod + shadcn `<Form>` with Server Actions

**Approach.** Use the shadcn `Form` wrapper composed with `useForm({resolver: zodResolver(...)})` from `react-hook-form` + `@hookform/resolvers/zod`. The submit handler calls a Server Action with the validated, typed object — NOT a raw `FormData`. The same zod schema is exported and re-validated server-side inside the action (belt and braces, also gives consistent error shapes).

**Why this approach.** The shadcn Form pattern is exactly this — see [shadcn/ui Next.js form docs](https://ui.shadcn.com/docs/forms/next). It gives consistent label/description/error rendering via `<FormField>` / `<FormItem>` / `<FormMessage>`. Server-side re-validation is the documented Next.js pattern ([How to create forms with Server Actions](https://nextjs.org/docs/app/guides/forms)).

**Code skeleton — full create-candidate form.**

```ts
// src/app/(app)/candidates/new/schema.ts
import { z } from 'zod'

export const createCandidateSchema = z.object({
  full_name: z.string().min(1, 'Name is required.'),
  email: z.string().email('Enter a valid email.').optional().or(z.literal('')),
  phone: z.string().optional(),
  location: z.string().optional(),
  current_role_title: z.string().optional(),
  current_company: z.string().optional(),
  market_status: z.enum(['actively_looking', 'passively_looking', 'hot', 'placed', 'cold']),
  source: z.enum(['apply_form', 'linkedin', 'referral', 'email_inbox', 'event', 'direct_add', 'other']),
  consent_basis: z.enum(['consent', 'legitimate_interest']),
  consent_confirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm consent before adding this candidate.' }),
  }),
})

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>
```

```ts
// src/app/(app)/candidates/new/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createCandidate } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'
import { createCandidateSchema } from './schema'

export async function createCandidateAction(rawInput: unknown) {
  const parsed = createCandidateSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false as const, fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createClient()
  const result = await createCandidate(supabase, {
    ...parsed.data,
    consent_at: new Date().toISOString(),
    consent_text_version: 'v1', // tracks privacy text revisions
  })
  if (!result.ok) return { ok: false as const, formError: 'Something went wrong. Please try again.' }
  revalidatePath('/candidates')
  redirect(`/candidates/${result.data.id}`)
}
```

```tsx
// src/app/(app)/candidates/new/candidate-form.tsx
'use client'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'

import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { createCandidateAction } from './actions'
import { createCandidateSchema, type CreateCandidateInput } from './schema'

export function CandidateForm() {
  const [isPending, startTransition] = useTransition()
  const form = useForm<CreateCandidateInput>({
    resolver: zodResolver(createCandidateSchema),
    defaultValues: {
      full_name: '',
      market_status: 'passively_looking',
      source: 'direct_add',
      consent_basis: 'consent',
      consent_confirmed: false as unknown as true, // checkbox starts unchecked
    },
  })

  const onSubmit = (data: CreateCandidateInput) => {
    startTransition(async () => {
      const result = await createCandidateAction(data)
      if (result && 'fieldErrors' in result && result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof CreateCandidateInput, { message: messages?.[0] })
        }
        return
      }
      if (result && 'formError' in result && result.formError) {
        toast.error(result.formError)
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField name="full_name" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Full name</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        {/* email, phone, location, current_role_title, current_company, market_status, source */}
        {/* ... */}
        <div className="border-t pt-6">
          <h3 className="text-sm font-semibold">Data & Consent</h3>
          <FormField name="consent_confirmed" control={form.control} render={({ field }) => (
            <FormItem className="flex items-start gap-3 mt-3">
              <FormControl>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(v) => field.onChange(v === true ? true : false)}
                />
              </FormControl>
              <div>
                <FormLabel className="text-sm font-normal">
                  I confirm we have appropriate consent or legitimate-interest basis to hold this candidate's data, in line with UK GDPR.
                </FormLabel>
                <p className="text-xs text-muted-foreground mt-1">
                  Captured at {new Date().toLocaleDateString('en-GB')}.
                </p>
                <FormMessage />
              </div>
            </FormItem>
          )} />
        </div>
        <Button type="submit" disabled={isPending || !form.watch('consent_confirmed')}>
          {isPending ? 'Adding…' : 'Add candidate'}
        </Button>
      </form>
    </Form>
  )
}
```

**Pitfalls.**
- The shadcn `Form` component requires shadcn `form` to be added (`pnpm dlx shadcn@latest add form`). UI-SPEC lists this.
- `react-hook-form` plays well with Server Actions when you submit the parsed JS object, NOT when you pass a raw `<form action={serverAction}>` — the latter gives FormData which loses zod type info. Use `form.handleSubmit(onSubmit)` and call the Server Action manually with the typed object inside.
- `consent_confirmed: z.literal(true)` is the idiomatic way to make a tickbox "required" — `false` fails parse with a clear message.
- The `consent_at` timestamp is set server-side in the action (not in client state) — using client time would be wrong if the user's clock is off.

**Sources.**
- [shadcn/ui: Forms — Next.js](https://ui.shadcn.com/docs/forms/next)
- [React Hook Form + Zod + Server Actions guide](https://nehalist.io/react-hook-form-with-nextjs-server-actions/)
- [Next.js: How to create forms with Server Actions](https://nextjs.org/docs/app/guides/forms)

---

### 12. GDPR consent capture UX

**Approach.** The candidate form has a separator-delimited "Data & Consent" section with three locked behaviours:
1. **Basis dropdown** — `consent` or `legitimate_interest` (the two enum values in `consent_basis`). Defaults to `consent`. The two bases imply different downstream behaviour around the "right to object" but at this phase we just record which.
2. **Required tickbox** — `consent_confirmed: z.literal(true)`. Submit button is disabled until checked (UI affordance) AND zod re-checks on submit (security).
3. **Inline privacy text** — `text-xs text-muted-foreground` paragraph below the tickbox, citing the consent text version recorded in `consent_text_version`. The version string (`v1`, `v2`, …) is bumped whenever the privacy text changes; the version captured at submit time is stored.

The server action writes `consent_basis`, `consent_at = now()`, and `consent_text_version` atomically inside the candidate insert. All three columns exist in the schema (`candidates` table lines 220-222 of the domain migration).

**Why this approach.** UK GDPR Art. 7 requires demonstrable consent — that requires capturing _what_ the user agreed to (version), _when_ (timestamp), and the _basis_ (consent vs legitimate interest). The schema already has these fields. The UI's job is to make capture lossless. Disabling the submit button until checked is a UX safety net; the zod literal check is the legal guarantee.

**Pitfalls.**
- `consent_text_version` is application-managed, not auto-generated. Maintain a constant `CURRENT_CONSENT_VERSION = 'v1'` in a single file (`src/lib/legal/consent.ts`) and import it from the form + the action. When the privacy copy changes, bump the constant.
- The dropdown for basis must NOT default to `legitimate_interest` — defaulting to `consent` is more conservative (Art. 6(1)(a) is the strongest basis and most easily defensible).
- The privacy text should be hard-coded in the form for now; in Phase 3 (deferred per CONTEXT.md) the right-to-erasure flow will move privacy copy into a versioned admin-managed table.

**Sources.**
- [ICO: Lawful basis for processing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/)
- (Schema source: `supabase/migrations/20260513152244_phase1_domain_schema.sql:220-222`)

---

### 13. `pg_trgm` ranked search

**Approach.** Plan 0 adds GIN trigram indexes on the searchable columns the schema doesn't already have (it has `companies.name`, `candidates.full_name`, `jobs.title`); add for `candidates.email`, `candidates.current_role_title`, `companies.industry`. Search queries combine the `%` operator (for the index filter) with `similarity()` (for the ORDER BY ranking) and a threshold parameter.

**Why this approach.** GIN trigram indexes accelerate `%` ("similar to") and `ILIKE %x%` operators. The standard ranking query is `SELECT *, similarity(col, $query) AS sml WHERE col % $query ORDER BY sml DESC, col ASC LIMIT 25` — the `%` filter is index-accelerated, the `similarity()` is computed on the filtered set, and the deterministic secondary sort prevents flaky orderings on equal scores ([pg_trgm docs](https://www.postgresql.org/docs/current/pgtrgm.html)).

The Postgres default `pg_trgm.similarity_threshold` is `0.3` which is too strict for fuzzy name search (`"smyth"` → `"Smith"` is around 0.25). Use `0.2` for candidate name/company search by setting it at query time: `SET LOCAL pg_trgm.similarity_threshold = 0.2;` inside the transaction OR (simpler for our use) use `similarity(col, $q) >= 0.2` directly in the WHERE clause and skip the threshold-dependent `%` operator. Using `similarity() >= 0.2` IS index-aware via the GIN trigram operator class.

**Code skeleton — index migration.**

```sql
-- supabase/migrations/<timestamp>_search_indexes.sql

-- Candidates: full_name index already exists. Add email + current_role_title.
create index if not exists candidates_email_trgm_idx
  on public.candidates using gin (email gin_trgm_ops);
create index if not exists candidates_current_role_trgm_idx
  on public.candidates using gin (current_role_title gin_trgm_ops);

-- Companies: industry (name already indexed).
create index if not exists companies_industry_trgm_idx
  on public.companies using gin (industry gin_trgm_ops);
```

**Code skeleton — query helper.**

```ts
// src/lib/db/candidates.ts (excerpt)
export async function listCandidates(
  supabase: SupabaseClient<Database>,
  args: { q?: string; sort: 'name' | 'last_contacted_at'; dir: 'asc' | 'desc'; offset: number; limit: number },
): Promise<DbResult<{ rows: Tables<'candidates'>[]; total: number }>> {
  // Use Supabase rpc to a SECURITY DEFINER function for ranked search,
  // OR use .rpc('search_candidates', {q, ...}) — easier than raw SQL via PostgREST
  // because PostgREST doesn't have a clean way to compose similarity() into ORDER BY.

  if (args.q && args.q.length > 0) {
    const { data, error } = await supabase.rpc('search_candidates', {
      p_query: args.q,
      p_threshold: 0.2,
      p_sort: args.sort,
      p_dir: args.dir,
      p_offset: args.offset,
      p_limit: args.limit,
    })
    // ... map and return
  }

  // No query → straight list with sort/pagination via .order/.range
  let query = supabase
    .from('candidates')
    .select('*, count:id', { count: 'exact' })
    .order(args.sort, { ascending: args.dir === 'asc', nullsFirst: false })
    .range(args.offset, args.offset + args.limit - 1)

  const { data, error, count } = await query
  // ... etc
}
```

**Code skeleton — the `search_candidates` RPC.**

```sql
-- supabase/migrations/<timestamp>_search_candidates_rpc.sql
create or replace function public.search_candidates(
  p_query text,
  p_threshold real default 0.2,
  p_sort text default 'similarity',
  p_dir text default 'desc',
  p_offset integer default 0,
  p_limit integer default 25
) returns table (
  id uuid,
  organization_id uuid,
  full_name text,
  email text,
  current_role_title text,
  current_company text,
  market_status public.market_status,
  last_contacted_at timestamptz,
  similarity real,
  total_count bigint
)
language sql
stable
security invoker  -- enforce RLS naturally
set search_path = public
as $$
  with ranked as (
    select
      c.*,
      greatest(
        similarity(c.full_name, p_query),
        coalesce(similarity(c.email, p_query), 0),
        coalesce(similarity(c.current_role_title, p_query), 0)
      ) as similarity
    from public.candidates c
    where
      c.full_name % p_query
      or c.email % p_query
      or c.current_role_title % p_query
  ),
  filtered as (
    select * from ranked where similarity >= p_threshold
  ),
  counted as (
    select count(*) as total from filtered
  )
  select
    f.id, f.organization_id, f.full_name, f.email, f.current_role_title,
    f.current_company, f.market_status, f.last_contacted_at, f.similarity,
    (select total from counted)
  from filtered f
  order by
    case when p_sort = 'similarity' and p_dir = 'desc' then f.similarity end desc nulls last,
    case when p_sort = 'similarity' and p_dir = 'asc' then f.similarity end asc nulls last,
    case when p_sort = 'name' and p_dir = 'asc' then f.full_name end asc nulls last,
    case when p_sort = 'name' and p_dir = 'desc' then f.full_name end desc nulls last,
    f.id  -- deterministic tiebreaker
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.search_candidates(text, real, text, integer, integer, integer) to authenticated;
```

Equivalent RPC for `search_clients` against `companies.name + companies.industry`.

**Pitfalls.**
- The `%` operator with GIN index does NOT order results by similarity — the ordering must be done explicitly via `ORDER BY similarity(...) DESC`. The GIN index accelerates the filter, NOT the sort. For Phase 1 this is fine; result sets are bounded by tenant size.
- `set_limit()` / `pg_trgm.similarity_threshold` is a session GUC, so setting it across requests is unsafe. Always compare similarity inline (`>= 0.2`) or pass the threshold to the RPC.
- Trigram search on short strings (< 3 chars) returns nothing — the index is on 3-letter sliding windows. For 1-2 char queries, fall back to `ILIKE` or simply hide the search until 3+ chars typed. Front-end debounce (300ms per UI-SPEC) helps.
- `security invoker` on the RPC is critical — `security definer` would bypass RLS and leak cross-org data.

**Sources.**
- [PostgreSQL: pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
- [Neon: pg_trgm extension](https://neon.com/docs/extensions/pg_trgm)

---

### 14. Server-side list pagination + sort + filter via URL searchParams

**Approach.** Use the Next.js App Router `searchParams` async prop on the route's `page.tsx`. The page is a Server Component that reads sort/dir/page/q from the URL, calls `listCandidates(...)` from `src/lib/db/`, and renders the table. The header sort icons are `<Link>`s that swap the URL params. Pagination is `<Link>` for prev/next pages.

**Why this approach.** This is the canonical App Router pattern (see [Next.js: App Router — Adding Search and Pagination](https://nextjs.org/learn/dashboard-app/adding-search-and-pagination)). Server-side keeps client bundles small, gives shareable URLs, and lets us avoid any client-state library for list views. In Next.js 16 `searchParams` is now a Promise — must be awaited.

**Code skeleton.**

```tsx
// src/app/(app)/candidates/page.tsx
import Link from 'next/link'
import { listCandidates } from '@/lib/db/candidates'
import { createClient } from '@/lib/supabase/server'
import { CandidateTable } from './CandidateTable'

type Search = {
  q?: string
  sort?: 'last_contacted_at' | 'full_name' | 'market_status'
  dir?: 'asc' | 'desc'
  page?: string
}

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams
  const supabase = await createClient()
  const sort = params.sort ?? 'last_contacted_at'
  const dir = params.dir ?? 'desc'
  const page = Math.max(1, Number(params.page) || 1)
  const limit = 25
  const offset = (page - 1) * limit

  const result = await listCandidates(supabase, {
    q: params.q,
    sort,
    dir,
    offset,
    limit,
  })
  if (!result.ok) {
    return <div className="p-8 text-destructive">Couldn't load candidates. Please refresh.</div>
  }
  return <CandidateTable rows={result.data.rows} total={result.data.total} page={page} limit={limit} sort={sort} dir={dir} q={params.q} />
}
```

The `<CandidateTable>` is a Server Component (renders rows server-side) but column headers and search input are small Client Components that update the URL via `useRouter().replace(...)` (search) or `<Link>` (sort).

**Search input pattern (Client Component, 300ms debounce per UI-SPEC).**

```tsx
'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { useDebouncedCallback } from 'use-debounce' // tiny dep (~1 KB)
import { Input } from '@/components/ui/input'

export function SearchInput({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const handle = useDebouncedCallback((value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value) params.set('q', value)
    else params.delete('q')
    params.set('page', '1') // reset paging on search change
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }, 300)

  return (
    <Input
      defaultValue={defaultValue}
      onChange={(e) => handle(e.target.value)}
      placeholder="Search candidates..."
      className="w-full sm:w-64"
    />
  )
}
```

Alternatively skip `use-debounce` and write a 5-line debounce hook. Adding a dependency for this is a judgment call — the planner can choose; recommend writing inline to keep deps minimal.

**Pitfalls.**
- In Next.js 16, both `searchParams` AND `params` are Promises — must `await`. Forgetting causes a build error.
- The search input is `defaultValue` not `value` so that URL-driven state doesn't fight user typing.
- Reset `page` to `1` whenever filter/search/sort changes — otherwise users land on an empty page 4 of a 1-page result.
- Use `router.replace`, not `router.push` — search-as-you-type shouldn't pollute back-stack with every keystroke.

**Sources.**
- [Next.js: App Router — Adding Search and Pagination](https://nextjs.org/learn/dashboard-app/adding-search-and-pagination)
- [Next.js: Managing Advanced Search Param Filtering](https://aurorascharff.no/posts/managing-advanced-search-param-filtering-next-app-router/)
- [Vercel Academy: params vs searchParams](https://vercel.com/academy/nextjs-foundations/params-vs-searchparams)

---

## Task 4 — CV upload + parsing

### 15. PDF + DOCX text extraction on Vercel Fluid Compute

**Approach.** Use `unpdf` 1.6.2 for PDF and `mammoth` 1.12.0 for DOCX. Both are pure-JS, no native bindings, and work on Vercel Fluid Compute (Node.js runtime). Extraction happens inside the Inngest function (Task 4 / item 17), NOT in the browser or in a route handler.

**Why this approach.**

| Lib | Pros | Cons |
|-----|------|------|
| `unpdf` | Pure JS, zero native deps, serverless-optimised (PDF.js stripped of browser refs and bundled), ~150 KB | Newer library (~2024+) |
| `pdf-parse` | Simple API | Depends on `canvas` module — needs native bindings, doesn't work cleanly on Vercel/Lambda |
| `pdfjs-dist` | Full Mozilla PDF.js — handles everything | ~2 MB gzipped slim build, slow cold start |
| `mammoth` | Mature, only does DOCX (not DOC), pure JS | Specific to `.docx` (Office Open XML) — old `.doc` files fail |

unpdf is the strongest recommendation for PDF on Vercel ([buildwithmatija: Process PDFs on Vercel](https://www.buildwithmatija.com/blog/process-pdfs-on-vercel-serverless-guide), [chudi.dev: serverless PDF](https://chudi.dev/blog/serverless-pdf-processing-unpdf-vs-pdfparse)). mammoth is the de-facto standard for DOCX text extraction in Node.

Both work in the standard Node runtime; do NOT attempt edge runtime — Vercel knowledge update locks us to Fluid Compute (Node.js) for this kind of work anyway.

**Code skeleton.**

```ts
// src/lib/ai/cv-extract.ts
import 'server-only'
import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'

export async function extractCvText(args: {
  buffer: ArrayBuffer
  mimeType: string
}): Promise<{ text: string; pageCount?: number }> {
  if (args.mimeType === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(args.buffer))
    const { text, totalPages } = await extractText(pdf, { mergePages: true })
    return { text, pageCount: totalPages }
  }
  if (args.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // mammoth wants a Node Buffer; Inngest functions run in Node so this is fine.
    const result = await mammoth.extractRawText({ buffer: Buffer.from(args.buffer) })
    return { text: result.value }
  }
  throw new Error(`Unsupported mime type: ${args.mimeType}`)
}
```

**Pitfalls.**
- The upload form must validate mime type client-side AND server-side. Accept only `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Reject `application/msword` (old .doc) explicitly with a clear UI message — mammoth does not handle .doc.
- File size cap: 10 MiB recommended for CVs (most are < 1 MiB). Enforce via the Supabase Storage `file_size_limit` on the bucket (50 MiB per item 4 — tighten to 10 MiB).
- unpdf's `extractText` returns a single string when `mergePages: true`. Some CVs have multi-column layouts where the text order is wrong — Claude handles this fine in practice, but if quality is poor for a particular CV we can extract per-page and reorder.
- mammoth converts to HTML by default — use `extractRawText` to get plain text directly.
- Run extraction inside an Inngest `step.run('extract-text', ...)` so retries are independent of the download step.

**Sources.**
- [unpdf on GitHub](https://github.com/unjs/unpdf)
- [chudi.dev: pdf-parse vs unpdf serverless](https://chudi.dev/blog/serverless-pdf-processing-unpdf-vs-pdfparse)
- [buildwithmatija: Process PDFs on Vercel serverless](https://www.buildwithmatija.com/blog/process-pdfs-on-vercel-serverless-guide)
- [mammoth.js on GitHub](https://github.com/mwilliamson/mammoth.js)

---

### 16. Claude Haiku tool-use schema for CV extraction

Already covered in item 10 — the `cvParseTool` definition. See the `parseCV` function and `cvParseTool` `input_schema` for the full structured schema (D-05 compliant).

---

### 17. Inngest `parseCVOnUpload` function

**Approach.** A 4-step Inngest function defined in `src/lib/inngest/functions/parse-cv.ts`. Each step is independently retried by Inngest's `step.run` checkpointing. Concurrency limited per-org so one tenant's bulk upload can't starve another.

**Event payload shape.**

```ts
type CVUploadedEvent = {
  name: 'cv/uploaded'
  data: {
    organization_id: string
    candidate_id: string
    candidate_cv_id: string
    storage_path: string // {org_id}/{candidate_id}/{uuid}-{filename}
    mime_type: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    user_id: string | null
  }
}
```

**Code skeleton — full function.**

```ts
// src/lib/inngest/functions/parse-cv.ts
import { NonRetriableError } from 'inngest'

import { inngest } from '@/lib/inngest/client'
import { createServiceClient } from '@/lib/supabase/service'
import { extractCvText } from '@/lib/ai/cv-extract'
import { parseCV } from '@/lib/ai/claude'

export const parseCVOnUpload = inngest.createFunction(
  {
    id: 'parse-cv-on-upload',
    concurrency: { limit: 5, key: 'event.data.organization_id' },
    retries: 3,
    onFailure: async ({ event, error }) => {
      // Final failure after retries: mark the row as failed so the UI shows the
      // Retry button. The function body should also catch and set 'failed' but
      // this is the belt-and-braces handler for completely unexpected errors.
      const supabase = createServiceClient()
      await supabase
        .from('candidate_cvs')
        .update({ parsing_status: 'failed', parse_error: error.message })
        .eq('id', event.data.candidate_cv_id)
    },
  },
  { event: 'cv/uploaded' },
  async ({ event, step }) => {
    const { organization_id, candidate_id, candidate_cv_id, storage_path, mime_type, user_id } = event.data
    const supabase = createServiceClient()

    // Defence: refuse to operate on a path outside the tenant boundary.
    if (!storage_path.startsWith(`${organization_id}/${candidate_id}/`)) {
      throw new NonRetriableError('storage_path outside tenant boundary')
    }

    const buffer = await step.run('download-cv', async () => {
      const { data, error } = await supabase.storage.from('cvs').download(storage_path)
      if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`)
      return await data.arrayBuffer()
    })

    const { text } = await step.run('extract-text', async () => {
      return extractCvText({ buffer, mimeType: mime_type })
    })

    if (!text || text.trim().length < 50) {
      // Almost certainly a scanned image PDF — Haiku will produce noise.
      await supabase
        .from('candidate_cvs')
        .update({ parsing_status: 'failed', parse_error: 'CV appears to contain no extractable text (scanned image?)' })
        .eq('id', candidate_cv_id)
      throw new NonRetriableError('cv contains no extractable text')
    }

    const parsed = await step.run('claude-parse', async () => {
      return parseCV({ cvText: text, organizationId: organization_id, userId: user_id })
    })

    await step.run('write-extracted', async () => {
      // Update the CV row.
      await supabase
        .from('candidate_cvs')
        .update({
          parsing_status: 'complete',
          extracted_data: parsed,
        })
        .eq('id', candidate_cv_id)

      // Populate empty candidate fields ONLY (D-08).
      const { data: candidate } = await supabase
        .from('candidates')
        .select('full_name, email, phone, location, current_role_title, current_company, skills, sector_tags, seniority_level, years_experience, salary_current_estimate, salary_expectation')
        .eq('id', candidate_id)
        .maybeSingle()
      if (!candidate) return
      const updates: Record<string, unknown> = {}
      if (!candidate.email && parsed.email) updates.email = parsed.email
      if (!candidate.phone && parsed.phone) updates.phone = parsed.phone
      if (!candidate.location && parsed.location) updates.location = parsed.location
      if (!candidate.current_role_title && parsed.current_role) updates.current_role_title = parsed.current_role
      if (!candidate.current_company && parsed.current_company) updates.current_company = parsed.current_company
      if ((!candidate.skills || candidate.skills.length === 0) && parsed.skills) updates.skills = parsed.skills
      if ((!candidate.sector_tags || candidate.sector_tags.length === 0) && parsed.sector_tags) updates.sector_tags = parsed.sector_tags
      if (!candidate.seniority_level && parsed.seniority_level) updates.seniority_level = parsed.seniority_level
      if (!candidate.years_experience && parsed.years_experience_total) updates.years_experience = parsed.years_experience_total
      if (!candidate.salary_current_estimate && parsed.salary_current_estimate) updates.salary_current_estimate = parsed.salary_current_estimate
      if (!candidate.salary_expectation && parsed.salary_expectation) updates.salary_expectation = parsed.salary_expectation
      if (Object.keys(updates).length > 0) {
        await supabase.from('candidates').update(updates).eq('id', candidate_id)
      }

      // Activity log: 'CV extracted by AI'
      await supabase.from('activities').insert({
        organization_id,
        kind: 'system',
        entity_type: 'candidate',
        entity_id: candidate_id,
        body: 'CV extracted by AI',
        actor_user_id: user_id,
        metadata: { candidate_cv_id, fields_populated: Object.keys(updates) },
      })
    })
  },
)
```

**Retry button (D-06).** The UI Retry button calls a Server Action that emits the same `cv/uploaded` event again with the same `candidate_cv_id`. Before emitting, the action sets `parsing_status = 'pending'` on the row so the UI immediately shows the in-progress state.

```ts
// src/app/(app)/candidates/[id]/actions.ts (excerpt)
'use server'
import { inngest } from '@/lib/inngest/client'
import { createClient } from '@/lib/supabase/server'

export async function retryParseCv(candidateCvId: string) {
  const supabase = await createClient()
  const { data: cv } = await supabase
    .from('candidate_cvs')
    .select('id, organization_id, candidate_id, storage_path, mime_type')
    .eq('id', candidateCvId)
    .maybeSingle()
  if (!cv) return { ok: false }
  await supabase
    .from('candidate_cvs')
    .update({ parsing_status: 'pending', parse_error: null })
    .eq('id', candidateCvId)
  await inngest.send({
    name: 'cv/uploaded',
    data: {
      organization_id: cv.organization_id,
      candidate_id: cv.candidate_id,
      candidate_cv_id: cv.id,
      storage_path: cv.storage_path,
      mime_type: cv.mime_type as 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      user_id: null, // Could be set from current user; not critical.
    },
  })
  return { ok: true }
}
```

**Pitfalls.**
- Each `step.run` MUST be idempotent — Inngest retries the whole step on failure. The "write-extracted" step does an UPDATE so it's idempotent.
- The candidate UPDATE inside `write-extracted` reads the latest row state inside the step, so on retry it won't blindly overwrite values that the recruiter manually entered between the failed attempt and the retry.
- The activity log INSERT inside the same step is technically NOT idempotent on retry (creates duplicate rows). For Phase 1 acceptable — a duplicate "CV extracted by AI" activity is harmless. Production-grade fix: insert with `on conflict` against a deterministic key, or move the activity insert to a separate step keyed by `candidate_cv_id`.
- `step.run('claude-parse', ...)` will call `parseCV`, which already logs to `ai_usage`. If the step is retried, we get multiple `ai_usage` rows — that's correct, each attempt cost money.
- One CV per candidate per `version` per the unique constraint — Task 4 inserts a new `candidate_cvs` row on every upload, bumping `version`.

**Sources.**
- [Inngest: Errors and Retries](https://www.inngest.com/docs/guides/error-handling)
- [Inngest: NonRetriableError](https://www.inngest.com/docs/features/inngest-functions/error-retries/inngest-errors)

---

### 18. Supabase Storage upload from a Server Action

**Approach.** The candidate form's upload field captures a `File` client-side. On submit, the Client Component reads the file as an `ArrayBuffer`, then calls a Server Action that:
1. Validates mime + size.
2. Generates `cv_uuid = crypto.randomUUID()` and assembles `storage_path = {org_id}/{candidate_id}/{cv_uuid}-{slug}.{ext}`.
3. Uploads via the server-side Supabase client (which authenticates the user, so RLS validates `(storage.foldername(name))[1] = current_organization_id()::text` on upload).
4. Inserts `candidate_cvs` row with `parsing_status='pending'`.
5. Emits `cv/uploaded` Inngest event.

Server Actions in Next.js 16 accept `File` and `FormData` natively — pass the file directly without manual base64 dance.

**Why this approach.** Doing the upload server-side keeps the publishable key from being used for storage writes (RLS still enforces but server actions get full auth context cleanly). Reading the file as ArrayBuffer client-side and posting it through the action gives us a single multipart roundtrip.

**Code skeleton.**

```tsx
// src/app/(app)/candidates/[id]/upload-cv-form.tsx
'use client'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadCvAction } from './actions'

export function UploadCvForm({ candidateId }: { candidateId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    startTransition(async () => {
      const formData = new FormData()
      formData.append('candidate_id', candidateId)
      formData.append('file', file)
      const result = await uploadCvAction(formData)
      if (!result.ok) toast.error(result.error ?? 'Upload failed.')
      else toast.success('CV uploaded — parsing now.')
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-3">
      <input type="file" accept=".pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <Button type="submit" disabled={!file || isPending}>{isPending ? 'Uploading…' : 'Upload CV'}</Button>
    </form>
  )
}
```

```ts
// src/app/(app)/candidates/[id]/actions.ts (excerpt)
'use server'
import { revalidatePath } from 'next/cache'
import { inngest } from '@/lib/inngest/client'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/db/profile'

const MAX_SIZE = 10 * 1024 * 1024 // 10 MiB
const ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

export async function uploadCvAction(formData: FormData) {
  const candidateId = String(formData.get('candidate_id') ?? '')
  const file = formData.get('file') as File | null

  if (!candidateId || !file) return { ok: false as const, error: 'Missing fields.' }
  if (file.size > MAX_SIZE) return { ok: false as const, error: 'File too large (max 10 MiB).' }
  if (!ACCEPTED_MIME.has(file.type)) return { ok: false as const, error: 'Only PDF and DOCX are supported.' }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return { ok: false as const, error: 'Not signed in.' }
  const profile = await getProfile(supabase, user.id)
  if (!profile.ok) return { ok: false as const, error: 'Profile not found.' }

  // Determine next version for this candidate.
  const { data: latestCv } = await supabase
    .from('candidate_cvs')
    .select('version')
    .eq('candidate_id', candidateId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (latestCv?.version ?? 0) + 1

  const cvUuid = crypto.randomUUID()
  const ext = file.type === 'application/pdf' ? 'pdf' : 'docx'
  const safeName = slugify(file.name.replace(/\.(pdf|docx)$/i, ''))
  const storagePath = `${profile.data.organization_id}/${candidateId}/${cvUuid}-${safeName}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('cvs')
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    return { ok: false as const, error: 'Storage upload failed.' }
  }

  const { data: cv, error: insertError } = await supabase
    .from('candidate_cvs')
    .insert({
      candidate_id: candidateId,
      storage_path: storagePath,
      mime_type: file.type,
      file_size_bytes: file.size,
      version,
      parsing_status: 'pending',
      uploaded_by: user.id,
    })
    .select('id, organization_id, candidate_id, storage_path, mime_type')
    .single()

  if (insertError || !cv) {
    // Roll back the storage upload.
    await supabase.storage.from('cvs').remove([storagePath])
    return { ok: false as const, error: 'Failed to record CV.' }
  }

  await inngest.send({
    name: 'cv/uploaded',
    data: {
      organization_id: cv.organization_id,
      candidate_id: cv.candidate_id,
      candidate_cv_id: cv.id,
      storage_path: cv.storage_path,
      mime_type: cv.mime_type as 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      user_id: user.id,
    },
  })

  // Activity: CV uploaded
  await supabase.from('activities').insert({
    kind: 'system',
    entity_type: 'candidate',
    entity_id: candidateId,
    body: 'CV uploaded',
    actor_user_id: user.id,
    metadata: { candidate_cv_id: cv.id, version },
  })

  revalidatePath(`/candidates/${candidateId}`)
  return { ok: true as const, candidateCvId: cv.id }
}
```

**Pitfalls.**
- Server Action body size limit is 1 MiB by default in Next.js. CVs are typically < 1 MiB but a 5 MiB PDF will hit the limit. Configure in `next.config.ts`: `serverActions: { bodySizeLimit: '10mb' }`. Verify on Vercel — Fluid Compute has its own body-size considerations.
- Always handle the partial-failure case: if storage upload succeeds but the row insert fails, the file is orphaned in Storage. Roll back by removing the uploaded file (shown above).
- Generating the slug from `file.name` is defence against path-traversal characters. `slugify` strips anything non-alphanumeric.
- Re-uploads (version 2, 3, …) follow the same flow — the unique constraint `unique (candidate_id, version)` on `candidate_cvs` prevents two concurrent uploads from racing to the same version. If two server actions race, one will fail with constraint error — that's correct, retry.

**Sources.**
- [Supabase Storage: Upload Files](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Next.js: Server Actions body size](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)

---

## Task 5 — Clients & contacts

### 19. Nested resources in App Router — flat vs nested?

**Approach.** Use FLAT routes: `/clients/[id]`, `/clients/[id]/contacts/new`, `/clients/[id]/jobs/new`. Do NOT use deeply nested `/clients/[id]/contacts/[contact_id]` — contact edit is rare enough that a modal or a `/contacts/[id]` flat route is simpler.

Recommended structure:
```
src/app/(app)/clients/
  page.tsx                            -- list
  [id]/
    page.tsx                          -- detail (Tabs: Contacts | Jobs | Activity | Notes)
    edit/page.tsx                     -- edit client
    contacts/new/page.tsx             -- add contact (could be a Sheet instead)
    jobs/new/page.tsx                 -- create job against this client
  new/page.tsx                        -- create client
```

For "edit contact" — use a shadcn `<Dialog>` opened from the contacts tab row action menu. No dedicated route needed; the dialog calls a server action that revalidates the client detail path.

**Why this approach.** Phase 1 doesn't need deep linking to a contact's edit form. A dialog modal is faster to build, gives instant feedback, and keeps the URL contract simple. If anchor customer feedback in post-Phase-1 demos calls for a dedicated contact detail page, we can add it then.

The Client Detail Tabs (Contacts | Jobs | Activity | Notes from UI-SPEC #5) live in a single page; URL state for active tab uses `?tab=contacts` etc. with default `contacts`. shadcn `<Tabs>` works with controlled state pointing at a `useSearchParams` value.

**Pitfalls.**
- Don't put `tab` in the route segment (e.g. `[id]/contacts/page.tsx`) — that gives each tab a full page navigation. Use search-param-driven tabs so switching feels instant.

**Sources.** (No external — pure architecture decision.)

---

### 20. Client activity timeline query

**Approach.** Add a Postgres view `client_activity_timeline` that UNIONs activities for the client + its contacts + its jobs, all scoped by org. Then a single SELECT returns the chronological list. RLS naturally applies because the view inherits the underlying table policies (must be defined with `security_invoker = true`, a Postgres 15+ feature).

**Why this approach.** The alternative — joining at app level by issuing 3 queries — works but: (a) needs in-memory merge-sort by `occurred_at`, (b) pagination is gnarly, (c) duplicates code in multiple `src/lib/db/` helpers. A SQL view centralises the union once and gives a clean PostgREST-callable surface.

**Code skeleton — migration.**

```sql
-- supabase/migrations/<timestamp>_client_activity_view.sql

create or replace view public.client_activity_timeline
with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.kind,
  a.body,
  a.actor_user_id,
  a.occurred_at,
  a.metadata,
  a.entity_type,
  a.entity_id,
  c.id as client_id,
  case a.entity_type
    when 'company' then c.name
    when 'contact' then (select full_name from public.contacts where id = a.entity_id)
    when 'job' then (select title from public.jobs where id = a.entity_id)
    else null
  end as entity_label
from public.activities a
join public.companies c on (
  (a.entity_type = 'company' and a.entity_id = c.id) or
  (a.entity_type = 'contact' and a.entity_id in (select id from public.contacts where company_id = c.id)) or
  (a.entity_type = 'job'     and a.entity_id in (select id from public.jobs where company_id = c.id))
);

-- security_invoker=true is the Postgres 15+ default behaviour where views
-- evaluate RLS as the caller, not the view owner. Our schema is Postgres 17.
```

**Helper.**

```ts
// src/lib/db/clients.ts (excerpt)
export async function getClientTimeline(
  supabase: SupabaseClient<Database>,
  clientId: string,
  limit = 50,
) {
  const { data, error } = await supabase
    .from('client_activity_timeline')
    .select('*')
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) return { ok: false as const, code: 'internal' }
  return { ok: true as const, data: data ?? [] }
}
```

**Pitfalls.**
- `security_invoker = true` is required for the view to respect RLS on the underlying tables. Without it, Postgres applies the view owner's policies — which in Supabase is `postgres`, bypassing RLS entirely. Critical for multi-tenancy.
- The view does a correlated subquery per row for `entity_label`. For ≤ 50 rows that's negligible. If timelines grow large, materialise the label by including activity bodies that already store the name in `metadata.entity_label`.
- Update `last_contacted_at` on the company and on the contact (if `entity_type = 'contact'`) via a separate trigger on activity inserts:

```sql
-- supabase/migrations/<timestamp>_activity_last_contacted.sql
create or replace function public.bump_last_contacted_at()
returns trigger language plpgsql as $$
begin
  if new.kind in ('call', 'email', 'meeting', 'note') then
    if new.entity_type = 'company' then
      update public.companies set last_contacted_at = new.occurred_at where id = new.entity_id;
    elsif new.entity_type = 'contact' then
      update public.contacts set last_contacted_at = new.occurred_at where id = new.entity_id;
      update public.companies set last_contacted_at = new.occurred_at
        where id = (select company_id from public.contacts where id = new.entity_id);
    end if;
  end if;
  return new;
end;
$$;
create trigger activity_bump_last_contacted after insert on public.activities
  for each row execute function public.bump_last_contacted_at();
```

This satisfies Task 5 verification: "Update `last_contacted_at` on client/contact whenever an activity is logged."

**Sources.**
- [PostgreSQL views with security_invoker](https://www.postgresql.org/docs/current/sql-createview.html)
- [Supabase Docs — security_invoker on views](https://supabase.com/docs/guides/database/postgres/row-level-security#use-security-invoker-on-views)

---

## Task 6 — Pipeline kanban

### 21. Drag-and-drop library for React 19 + Next.js 16

**Recommendation: `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0.**

| Library | Verdict | Why |
|---------|---------|-----|
| `@dnd-kit/core` + `@dnd-kit/sortable` | **Use this.** | Active, framework-agnostic, accessible (keyboard nav), works with React 19; library most documented for kanban. |
| `@dnd-kit/react` 0.4.x | Skip for now. | A newer rewrite (different API) — not yet at 1.0, and `@dnd-kit/core` covers everything we need. |
| `react-beautiful-dnd` | **Do not use.** | Deprecated by Atlassian; React 19 compatibility uncertain. |
| `@hello-pangea/dnd` | Skip. | A fork of react-beautiful-dnd that some folks use, but no advantage over dnd-kit for new code. |
| Pragmatic DnD (Atlassian) | Skip. | Newer Atlassian replacement; smaller community for kanban patterns. |

UI-SPEC #4 already names `@dnd-kit/core` + `@dnd-kit/sortable` — confirm and install.

**Code skeleton — minimal kanban shape.**

```tsx
// src/components/app/pipeline-board.tsx
'use client'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, useTransition } from 'react'

import { moveApplicationAction } from './actions'

const STAGES = ['applied', 'screening', 'cv_submitted', 'first_interview', 'second_interview', 'offer', 'placed'] as const
type Stage = (typeof STAGES)[number]
type Card = { id: string; candidateId: string; candidateName: string; currentRole: string | null; daysInStage: number }

export function PipelineBoard({ initial }: { initial: Record<Stage, Card[]> }) {
  const [columns, setColumns] = useState(initial)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function findContainer(id: string): Stage | null {
    for (const s of STAGES) if (columns[s].some((c) => c.id === id)) return s
    return null
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    if (!overId) return
    const sourceStage = findContainer(activeId)
    const targetStage = STAGES.includes(overId as Stage) ? (overId as Stage) : findContainer(overId)
    if (!sourceStage || !targetStage || sourceStage === targetStage) return

    // Optimistically move + mark pending.
    setColumns((prev) => {
      const card = prev[sourceStage].find((c) => c.id === activeId)
      if (!card) return prev
      return {
        ...prev,
        [sourceStage]: prev[sourceStage].filter((c) => c.id !== activeId),
        [targetStage]: [...prev[targetStage], card],
      }
    })
    setPendingIds((prev) => new Set(prev).add(activeId))

    const result = await moveApplicationAction({ applicationId: activeId, toStage: targetStage })
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(activeId)
      return next
    })
    if (!result.ok) {
      // Snap back.
      setColumns((prev) => {
        const card = prev[targetStage].find((c) => c.id === activeId)
        if (!card) return prev
        return {
          ...prev,
          [targetStage]: prev[targetStage].filter((c) => c.id !== activeId),
          [sourceStage]: [...prev[sourceStage], card],
        }
      })
      // toast handled by parent
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <Column key={stage} stage={stage} cards={columns[stage]} pendingIds={pendingIds} />
        ))}
      </div>
    </DndContext>
  )
}

function Column({ stage, cards, pendingIds }: { stage: Stage; cards: Card[]; pendingIds: Set<string> }) {
  // SortableContext with column id as the droppable target
  return (
    <SortableContext id={stage} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
      <div className="min-w-[240px] max-w-[280px] flex-shrink-0 rounded-md border bg-card p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold capitalize">{stage.replace('_', ' ')}</h3>
          <span className="text-xs font-normal rounded-full bg-muted px-2">{cards.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {cards.map((c) => <SortableCard key={c.id} card={c} isPending={pendingIds.has(c.id)} />)}
        </div>
      </div>
    </SortableContext>
  )
}

function SortableCard({ card, isPending }: { card: Card; isPending: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: card.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`rounded-md border bg-background p-3 ${isPending ? 'opacity-60' : ''}`}
    >
      <div className="text-sm font-semibold">{card.candidateName}</div>
      {card.currentRole && <div className="text-xs text-muted-foreground font-normal">{card.currentRole}</div>}
      {isPending && <div className="mt-2 text-xs font-normal text-muted-foreground">Saving…</div>}
      {/* days-in-stage chip, stale indicator (>14 days = amber), DropdownMenu trigger with aria-label */}
    </div>
  )
}
```

**Pitfalls.**
- dnd-kit needs `attributes` + `listeners` on the draggable element. Combining them with the DropdownMenu trigger inside the card is fiddly — the trigger button needs to `stopPropagation` so clicking it doesn't initiate a drag.
- `activationConstraint: { distance: 4 }` prevents click-to-drag confusion (4px movement required before drag starts).
- For mobile (UI-SPEC #4 D-11), don't use `DndContext` at all on narrow viewports — render the accordion list instead. Detect breakpoint via Tailwind responsive utilities and conditionally swap components (`<div className="md:hidden"><AccordionList .../></div><div className="hidden md:block"><PipelineBoard .../></div>`).
- Keyboard accessibility: dnd-kit supports keyboard drag with `KeyboardSensor`. Add it: `useSensors(useSensor(PointerSensor, ...), useSensor(KeyboardSensor))`.

**Sources.**
- [dnd-kit docs](https://dndkit.com/)
- [PkgPulse: dnd-kit vs react-beautiful-dnd vs Pragmatic DnD 2026](https://www.pkgpulse.com/blog/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026)
- [@dnd-kit/core releases](https://github.com/clauderic/dnd-kit/releases)

---

### 22. D-09 pending-state pattern

Covered in item 21's code skeleton — the `pendingIds: Set<string>` state, the visual `opacity-60` + "Saving…" indicator while in flight, and the snap-back on server failure. This is exactly the contract in CONTEXT.md D-09 and UI-SPEC #4.

**Additional considerations.**
- React 19's `useOptimistic` hook is tempting here, but the requirement is for an _explicit_ pending indicator that the user can see — `useOptimistic` is about transparently optimistic UI where the user shouldn't notice latency. Stick with the manual `pendingIds` Set pattern; it gives us full control over the "Saving…" rendering.
- The snap-back should also fire a `toast.error("Couldn't move {Name} — please try again.")` per UI-SPEC Copywriting Contract error states.

---

### 23. Activity log auto-write on stage change

**Approach.** A single server action `moveApplicationAction` performs both writes inside a Postgres function (atomic) — OR does them sequentially in app code with the second write inside a try/catch that fires Sentry but doesn't roll back the first. Recommend the Postgres function for atomicity.

**Why this approach.** A stage change without an activity log entry breaks the audit story. App-code-with-rollback can be done via Supabase transactional RPC, but the cleanest pattern is a `SECURITY INVOKER` Postgres function that does both writes in one transaction:

**Code skeleton — function + helper.**

```sql
-- supabase/migrations/<timestamp>_move_application_function.sql
create or replace function public.move_application(
  p_application_id uuid,
  p_to_stage public.application_stage,
  p_decline_reason public.decline_reason default null,
  p_decline_notes text default null,
  p_actor_user_id uuid default null
) returns void
language plpgsql
security invoker  -- RLS applies, the user must own this org's data
set search_path = public
as $$
declare
  v_old_stage public.application_stage;
  v_candidate_id uuid;
  v_org_id uuid;
begin
  select stage, candidate_id, organization_id
    into v_old_stage, v_candidate_id, v_org_id
    from public.applications
    where id = p_application_id;
  if not found then
    raise exception 'application not found';
  end if;
  if v_old_stage = p_to_stage then
    return; -- no-op
  end if;

  update public.applications
  set
    stage = p_to_stage,
    stage_changed_at = now(),
    decline_reason = case when p_to_stage in ('rejected', 'withdrawn') then p_decline_reason else decline_reason end,
    decline_notes  = case when p_to_stage in ('rejected', 'withdrawn') then p_decline_notes  else decline_notes  end,
    declined_at    = case when p_to_stage in ('rejected', 'withdrawn') then now() else declined_at end
  where id = p_application_id;

  insert into public.activities (kind, body, actor_user_id, entity_type, entity_id, metadata)
  values (
    'stage_change',
    case
      when p_to_stage in ('rejected', 'withdrawn') then 'Declined — ' || coalesce(p_decline_reason::text, 'unspecified')
      else 'Moved to ' || replace(p_to_stage::text, '_', ' ')
    end,
    p_actor_user_id,
    'application',
    p_application_id,
    jsonb_build_object(
      'from_stage', v_old_stage,
      'to_stage', p_to_stage,
      'decline_reason', p_decline_reason,
      'decline_notes', p_decline_notes
    )
  );
end;
$$;

grant execute on function public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid) to authenticated;
```

**Server action.**

```ts
// src/app/(app)/jobs/[id]/pipeline/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function moveApplicationAction(args: {
  applicationId: string
  toStage: 'applied'|'screening'|'cv_submitted'|'first_interview'|'second_interview'|'offer'|'placed'|'rejected'|'withdrawn'
  declineReason?: string
  declineNotes?: string
}) {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  // CHECK CONSTRAINT 'decline_reason_present_when_terminal' will reject the move
  // if to_stage is rejected/withdrawn without a reason. Validate up front for nicer UX.
  if ((args.toStage === 'rejected' || args.toStage === 'withdrawn') && !args.declineReason) {
    return { ok: false as const, error: 'Please select a decline reason.' }
  }

  const { error } = await supabase.rpc('move_application', {
    p_application_id: args.applicationId,
    p_to_stage: args.toStage,
    p_decline_reason: args.declineReason ?? null,
    p_decline_notes: args.declineNotes ?? null,
    p_actor_user_id: userId,
  })

  if (error) return { ok: false as const, error: 'Move failed. Please try again.' }
  revalidatePath('/pipeline')
  return { ok: true as const }
}
```

**Pitfalls.**
- The function is `SECURITY INVOKER` — RLS still applies to both the UPDATE and the INSERT. This is the safety we want.
- The schema's `decline_reason_present_when_terminal` CHECK constraint already enforces that rejected/withdrawn must have a reason — duplicate the check in the action for UX, but the DB has the final say.
- `revalidatePath` invalidates the page cache. For client-driven optimistic UI we may not need to revalidate (the local state is the source of truth), but if the user navigates away and back, we want the server to re-fetch.

**Sources.**
- (Schema: `supabase/migrations/20260513152244_phase1_domain_schema.sql:316-321` for the CHECK constraint)

---

### 24. Mobile fallback list-by-stage

**Approach.** At `< md` breakpoint (768px), render an `<Accordion>` with one section per stage (cards listed vertically inside). Tapping a card row opens a bottom `<Sheet>` with "Move to..." buttons for each stage and a "Reject" option. No drag-and-drop on mobile.

**Code skeleton.**

```tsx
// src/components/app/pipeline-mobile-list.tsx
'use client'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
// ... same Card / Stage types as kanban

const STAGES: Stage[] = ['applied', 'screening', 'cv_submitted', 'first_interview', 'second_interview', 'offer', 'placed']

export function PipelineMobileList({ initial }: { initial: Record<Stage, Card[]> }) {
  return (
    <Accordion type="multiple" defaultValue={STAGES} className="md:hidden">
      {STAGES.map((stage) => (
        <AccordionItem key={stage} value={stage}>
          <AccordionTrigger>
            <span className="capitalize">{stage.replace('_', ' ')}</span>
            <span className="ml-2 text-xs text-muted-foreground">({initial[stage].length})</span>
          </AccordionTrigger>
          <AccordionContent>
            {initial[stage].map((c) => <MobileCardRow key={c.id} card={c} />)}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

function MobileCardRow({ card }: { card: Card }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="block w-full text-left rounded-md border p-3 h-11 mt-2">
          <div className="text-sm font-semibold">{card.candidateName}</div>
          {card.currentRole && <div className="text-xs text-muted-foreground font-normal">{card.currentRole}</div>}
        </button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader><SheetTitle>Move {card.candidateName}</SheetTitle></SheetHeader>
        <div className="mt-4 grid grid-cols-1 gap-2">
          {STAGES.map((s) => (
            <Button key={s} variant="outline" className="h-11 justify-start" onClick={/* move action */}>
              {s.replace('_', ' ')}
            </Button>
          ))}
          <Button variant="destructive" className="h-11 mt-4" onClick={/* open decline dialog */}>Reject…</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

Pair with the desktop kanban: render both, hide the desktop one below `md` and the mobile one at `md+`:
```tsx
<div className="md:hidden"><PipelineMobileList .../></div>
<div className="hidden md:block"><PipelineBoard .../></div>
```

**Pitfalls.**
- Every interactive element on mobile is `h-11` (44px) per UI-SPEC mobile rule.
- The bottom Sheet's content does not need to fit on screen — it scrolls. Don't accidentally constrain its height.
- The mobile flow does not need optimistic-with-confirm — server-action-then-revalidate is fine since drag latency isn't a UX concern. (D-09's pending state is for the drag interaction specifically.)

**Sources.**
- [shadcn/ui Accordion](https://ui.shadcn.com/docs/components/accordion)
- [shadcn/ui Sheet](https://ui.shadcn.com/docs/components/sheet)

---

## Task 7 — Dashboard, settings, mobile polish

### 25. Real metrics queries

**Approach.** Four small queries — direct `SELECT COUNT(*) FROM ...` against indexed columns. Do NOT materialise; at anchor-customer scale (1-3 users, hundreds of candidates), `count(*)` over an indexed table with RLS predicates is < 5 ms.

**Code skeleton — single function returning all four metrics in parallel.**

```ts
// src/lib/db/dashboard.ts
export async function getDashboardMetrics(supabase: SupabaseClient<Database>) {
  const [candidates, openJobs, openApplications] = await Promise.all([
    supabase.from('candidates').select('id', { count: 'exact', head: true }),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('applications').select('id', { count: 'exact', head: true })
      .not('stage', 'in', '(rejected,withdrawn,placed)'),
  ])

  // Placements this month — placeholder, returns 0 because Phase 4 lands placements.
  // Keep the call site stable so dashboard layout doesn't shift in Phase 4.
  const placementsThisMonth = 0

  return {
    candidates: candidates.count ?? 0,
    openJobs: openJobs.count ?? 0,
    openApplications: openApplications.count ?? 0,
    placementsThisMonth,
  }
}
```

**Pitfalls.**
- `{ count: 'exact', head: true }` tells PostgREST to return count without the row data — efficient.
- The RLS WHERE clause is added by Supabase automatically — the count is per-tenant.
- If at scale (10K+ candidates per tenant) `count` becomes slow, switch to `count: 'estimated'` (uses pg_class.reltuples) or maintain a `org_metrics` materialised view.

**Sources.**
- [Supabase: Count rows](https://supabase.com/docs/reference/javascript/count)

---

### 26. Recent activity feed query

**Approach.** Single query joining activity rows to their entity name + actor name via Postgres view or via the `client_activity_timeline` view we built in item 20 — but generalised across all entities. Simpler for the dashboard: just `SELECT FROM activities ORDER BY occurred_at DESC LIMIT 20` and resolve entity names in the helper by entity_type.

```ts
// src/lib/db/dashboard.ts (excerpt)
export async function getRecentActivity(supabase: SupabaseClient<Database>, limit = 20) {
  const { data: activities, error } = await supabase
    .from('activities')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) return { ok: false as const, code: 'internal' }

  // Resolve entity labels in batch by type.
  const candidateIds = activities.filter((a) => a.entity_type === 'candidate').map((a) => a.entity_id)
  const jobIds = activities.filter((a) => a.entity_type === 'job').map((a) => a.entity_id)
  const companyIds = activities.filter((a) => a.entity_type === 'company').map((a) => a.entity_id)
  const contactIds = activities.filter((a) => a.entity_type === 'contact').map((a) => a.entity_id)
  const appIds = activities.filter((a) => a.entity_type === 'application').map((a) => a.entity_id)

  const [candidates, jobs, companies, contacts, apps] = await Promise.all([
    candidateIds.length ? supabase.from('candidates').select('id, full_name').in('id', candidateIds) : { data: [] },
    jobIds.length ? supabase.from('jobs').select('id, title').in('id', jobIds) : { data: [] },
    companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : { data: [] },
    contactIds.length ? supabase.from('contacts').select('id, full_name, company_id').in('id', contactIds) : { data: [] },
    appIds.length ? supabase.from('applications').select('id, candidate_id, job_id').in('id', appIds) : { data: [] },
  ])

  const labelByEntity: Record<string, string> = {}
  candidates.data?.forEach((c) => (labelByEntity[`candidate:${c.id}`] = c.full_name))
  jobs.data?.forEach((j) => (labelByEntity[`job:${j.id}`] = j.title))
  companies.data?.forEach((c) => (labelByEntity[`company:${c.id}`] = c.name))
  contacts.data?.forEach((c) => (labelByEntity[`contact:${c.id}`] = c.full_name))
  // applications resolve to "candidate at job" — load the candidate's name and job title
  // ... (left as exercise; same pattern)

  return {
    ok: true as const,
    data: activities.map((a) => ({
      ...a,
      entity_label: labelByEntity[`${a.entity_type}:${a.entity_id}`] ?? null,
    })),
  }
}
```

**Pitfalls.**
- N+1 queries are avoided here by batching `IN` queries by type.
- For the activity body display, the polymorphic `kind` enum drives the icon (`MessageSquare` for note, `Phone` for call, etc. per UI-SPEC).

---

### 27. Stale-application alert query

**Approach.** Plain WHERE clause, no generated column needed. The `applications.stage_changed_at` field is updated by `move_application` (item 23) and defaults to `now()` on insert.

```ts
// src/lib/db/dashboard.ts (excerpt)
export async function getStaleApplications(supabase: SupabaseClient<Database>) {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('applications')
    .select('id, candidate_id, job_id, stage, stage_changed_at, candidates(full_name), jobs(title)')
    .lt('stage_changed_at', cutoff)
    .not('stage', 'in', '(rejected,withdrawn,placed)')
    .order('stage_changed_at', { ascending: true })
    .limit(20)
  if (error) return { ok: false as const, code: 'internal' }
  return { ok: true as const, data: data ?? [] }
}
```

**Pitfalls.**
- A generated column for "is_stale" was considered — overkill at this scale. The `stage_changed_at` index doesn't exist yet — add to Plan 0 search-index migration: `CREATE INDEX applications_stage_changed_at_idx ON applications (organization_id, stage_changed_at)` for fast dashboard load.
- `not('stage', 'in', '(...)')` is the PostgREST syntax for negated IN.

---

### 28. Invite teammate flow

**Approach.** Use `supabase.auth.admin.inviteUserByEmail()` from a Server Action invoked by the org owner. The user clicks the link in the email, lands on `/auth/callback` (existing route), and `handle_new_user()` trigger fires for the new `auth.users` row. Because the trigger's early-return guard checks `exists (select 1 from public.users where id = new.id)`, the action MUST pre-insert a `public.users` row pointing the invited user at the inviting org BEFORE calling `inviteUserByEmail()`.

**Why this approach.** The trigger at `supabase/migrations/20260513151021_init_organizations_and_users.sql:137-139` exists specifically to support invitation flows — quoting the migration: "If this auth.users row was created as part of an invitation flow, the app will have already inserted into public.users; do nothing." We follow that explicit contract.

`inviteUserByEmail` is an admin method — must be called with the service-role client, not the SSR client. The Server Action validates the caller is the org owner (role check) before using service-role.

**Code skeleton.**

```ts
// src/app/(app)/settings/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).optional(),
})

export async function inviteTeammate(input: unknown) {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Invalid email.' }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return { ok: false as const, error: 'Not signed in.' }
  const { data: me } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle()
  if (!me || me.role !== 'owner') return { ok: false as const, error: 'Only owners can invite.' }

  // Step 1: invite via admin API (creates auth.users row).
  const admin = createServiceClient()
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email)
  if (inviteError || !invited.user) return { ok: false as const, error: inviteError?.message ?? 'Invite failed.' }

  // Step 2: pre-insert public.users row so handle_new_user() trigger hits its
  // early-return guard. The trigger then doesn't create a NEW org for this user.
  // NOTE: handle_new_user() fires when auth.users is INSERTED. The admin API
  // creates the auth.users row before this insert can run, but the trigger
  // fired during the admin call already saw NO existing public.users row, and
  // so it WILL create a new org. To avoid that, the trigger needs to detect
  // an "invitation" state via raw_user_meta_data.
  //
  // The cleaner approach: extend handle_new_user() to detect a metadata key
  // like 'invited_to_org' and use that org instead of creating one.
  //
  // For Phase 1, the simplest correct shape is: use the admin API with
  // `data: { invited_to_org: me.organization_id, full_name }` and update
  // handle_new_user() in a NEW migration to honour it.

  return { ok: true as const }
}
```

The invitation flow requires a complementary trigger update. Add a Plan-0-or-Task-7 migration:

```sql
-- supabase/migrations/<timestamp>_handle_new_user_invitation_aware.sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invited_org uuid;
  v_org_id uuid;
  v_org_name text;
  v_slug_base text;
  v_full_name text;
begin
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  v_invited_org := nullif(new.raw_user_meta_data->>'invited_to_org', '')::uuid;

  if v_invited_org is not null then
    -- Invitation flow: attach to the inviting org as recruiter (not owner).
    v_full_name := nullif(new.raw_user_meta_data->>'full_name', '');
    insert into public.users (id, organization_id, email, full_name, role)
    values (new.id, v_invited_org, new.email, v_full_name, 'recruiter');
    return new;
  end if;

  -- Normal sign-up flow: create new org.
  v_org_name := coalesce(nullif(new.raw_user_meta_data->>'organization_name', ''), new.email);
  v_full_name := nullif(new.raw_user_meta_data->>'full_name', '');
  v_slug_base := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(both '-' from v_slug_base);
  if v_slug_base = '' then v_slug_base := 'org'; end if;

  insert into public.organizations (name, slug)
  values (v_org_name, v_slug_base || '-' || substr(replace(new.id::text, '-', ''), 1, 8))
  returning id into v_org_id;

  insert into public.users (id, organization_id, email, full_name, role)
  values (new.id, v_org_id, new.email, v_full_name, 'owner');

  return new;
end;
$$;
```

Then the invite action passes the metadata:

```ts
const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
  data: {
    invited_to_org: me.organization_id,
    full_name: parsed.data.full_name,
  },
})
```

**Pitfalls.**
- The `data` param to `inviteUserByEmail` populates `raw_user_meta_data`, which the trigger reads. This is the documented bridge. ([Supabase admin.inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).)
- Casting `'' as uuid` throws; the `nullif(..., '')::uuid` pattern returns NULL for empty strings.
- The invited user receives a magic link from Supabase Auth; clicking it lands on `/auth/callback`. Our existing callback works for them too.
- Owner role check prevents non-owners inviting people. Phase 1 has no admin role distinct from owner; Phase 5 may add multi-tier.
- The default Supabase invitation email template is bare-bones — for production, override the template in Supabase project settings. Phase 1 acceptable as-is.

**Sources.**
- [Supabase: `auth.admin.inviteUserByEmail`](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Supabase Discussion #6055: Invite team member implementation](https://github.com/orgs/supabase/discussions/6055)
- [Mansueli: Allowing users to invite others](https://blog.mansueli.com/allowing-users-to-invite-others-with-supabase-edge-functions)
- (Schema: `supabase/migrations/20260513151021_init_organizations_and_users.sql:137-139`)

---

### 29. Mobile responsive baseline

**Approach.** Tailwind responsive utilities are sufficient. The `(app)` layout's existing `max-w-6xl mx-auto px-4 sm:px-6` is already mobile-aware. The TopNav at `< sm` should collapse its labels to icons OR show a hamburger Sheet.

For Phase 1, the simpler choice: the existing top nav already wraps OK on narrow viewports. Add:
- The page-content `<main>` already has `px-4 py-8 sm:px-6` — keep as-is.
- Tables become horizontally scrollable on mobile (already the case with shadcn `Table`).
- The kanban swaps for the accordion list at `< md` (item 24).
- All primary CTAs use `h-11` on mobile (44px touch target). shadcn `Button` defaults are smaller — override per UI-SPEC: `<Button className="h-11 md:h-10">…</Button>`.

**Sources.** UI-SPEC #5 layout patterns, established `(app)/layout.tsx`.

---

## Testing

### 30. Vitest + Playwright install on Next.js 16

**Approach.** Install both in Plan 0 (CONTEXT.md leans this way). Configure path alias resolution and a baseline Playwright auth state.

**Install.**
```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event vite-tsconfig-paths
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps
```

**`vitest.config.ts`.**
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
```

**`tests/setup.ts`.**
```ts
import '@testing-library/jest-dom/vitest'
```

**`playwright.config.ts`.**
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Phase 1 has a tiny suite; avoid DB collisions.
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    storageState: 'tests/e2e/.auth/recruiter.json', // see auth setup below
  },
  projects: [
    { name: 'setup', testMatch: /global-setup\.ts/ },
    { name: 'chromium', dependencies: ['setup'] },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

**Auth setup (reusable across tests).**
```ts
// tests/e2e/global-setup.ts
import { test as setup } from '@playwright/test'
const AUTH_FILE = 'tests/e2e/.auth/recruiter.json'

setup('authenticate', async ({ page }) => {
  // Sign in via magic link is awkward in E2E. Instead, use the Supabase admin
  // API to mint a session for a seed user, OR sign in via email+password if
  // the test user is set up via seed.
  // Simplest approach: in the seed file, create a user with a known password,
  // then call supabase.auth.signInWithPassword from the page.
  await page.goto('/sign-in')
  // ... (Phase 1 might keep the test flow magic-link only and use playwright's
  // request interception to capture the OTP link from a mailbox webhook.)
  await page.context().storageState({ path: AUTH_FILE })
})
```

**Package scripts.**
```json
{
  "scripts": {
    "test": "vitest",
    "test:e2e": "playwright test"
  }
}
```

**Pitfalls.**
- React Server Components cannot be rendered by jsdom — Vitest tests focus on `lib/`, hooks, and small Client Components. RSC tests live in Playwright.
- The seed file must include a deterministic test user/org to make E2E reproducible. Update the existing seed to include `test-recruiter@altus.test` with a known password.
- Playwright `storageState` reuse means the auth happens once per test run, not per test. Critical for keeping the suite fast.

**Sources.**
- [Next.js: Testing — Vitest](https://nextjs.org/docs/app/guides/testing/vitest)
- [shsxnk.com: Vitest + Next.js 16 zero to 27 passing tests](https://www.shsxnk.com/blog/vitest-nextjs-testing-infrastructure)
- [Playwright: Configuration](https://playwright.dev/docs/test-configuration)

---

### 31. At least one E2E test design — Tasks 3–6 golden path

**Approach.** A single Playwright spec covering the full happy path. Each step is a checkpoint — failure stops the run and surfaces what broke. This is the test required by CONTEXT.md deferred section #6 ("Task 7 must include at least one Playwright E2E covering the full Tasks 3–6 flow").

**Outline (`tests/e2e/golden-path.spec.ts`).**

```ts
import { test, expect } from '@playwright/test'

test.describe('Phase 1 golden path', () => {
  test('sign up → create candidate → upload CV → review → create job → pipeline → drag', async ({ page }) => {
    // Assumes storageState from setup OR sign up in this test.

    // 1. Land on dashboard
    await page.goto('/')
    await expect(page.getByText(/Welcome to Altus|Candidates/i)).toBeVisible()

    // 2. Create candidate
    await page.goto('/candidates/new')
    await page.getByLabel('Full name').fill('E2E Test Candidate')
    await page.getByLabel(/email/i).fill('e2e+test@example.com')
    await page.getByRole('combobox', { name: /market status/i }).click()
    await page.getByRole('option', { name: /actively looking/i }).click()
    await page.getByRole('checkbox', { name: /confirm.*consent/i }).check()
    await page.getByRole('button', { name: /add candidate/i }).click()
    await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]+$/)

    // 3. Upload a CV (use a fixture file)
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /upload cv/i }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles('tests/fixtures/sample-cv.pdf')
    await page.getByRole('button', { name: /upload/i }).click()
    // Wait for parsing complete — Inngest is running locally, ~30s budget
    await expect(page.getByText(/Review extracted data/i)).toBeVisible({ timeout: 60_000 })

    // 4. Create client + job
    await page.goto('/clients/new')
    await page.getByLabel(/name/i).fill('Acme Co')
    await page.getByRole('button', { name: /add client/i }).click()
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
    await page.getByRole('link', { name: /create job/i }).click()
    await page.getByLabel(/title/i).fill('Senior Engineer')
    await page.getByRole('button', { name: /save|create/i }).click()
    await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/)

    // 5. Add candidate to job (as application)
    await page.getByRole('button', { name: /add candidate to job/i }).click()
    await page.getByPlaceholder(/search candidates/i).fill('E2E Test')
    await page.getByRole('option', { name: /E2E Test Candidate/i }).click()
    await page.getByRole('button', { name: /add to pipeline/i }).click()

    // 6. Pipeline — confirm card lands in "applied" column
    await page.getByRole('link', { name: /pipeline/i }).click()
    await expect(page.getByText('E2E Test Candidate')).toBeVisible()

    // 7. Drag from applied to screening (dnd-kit drag in Playwright)
    const card = page.locator('[data-card-id]', { hasText: 'E2E Test Candidate' })
    const screeningColumn = page.locator('[data-column="screening"]')
    await card.dragTo(screeningColumn)
    await expect(card.locator('css=[aria-label*=Saving]')).toBeHidden({ timeout: 5000 })
    // Confirm activity log entry
    await page.getByRole('link', { name: /E2E Test Candidate/ }).click()
    await expect(page.getByText(/Moved to screening/i)).toBeVisible()
  })
})
```

**Pitfalls.**
- Inngest in local dev runs as a separate process — the test webServer must orchestrate both. Either run `inngest-cli dev` in a separate process started by the Playwright global setup, OR mock Inngest with `inngest test-engine` (the SDK has a test helper) and bypass the dev server.
- A sample-cv.pdf fixture file is needed in `tests/fixtures/`. Use a real, freely-licensed CV PDF (~3 pages of text). NEVER use a real candidate's CV.
- Playwright's `dragTo` works for dnd-kit if the target has a stable `data-column` attribute on the column. Add `data-column={stage}` to columns and `data-card-id={id}` to cards in the components.
- Test data leaks across runs unless the seed script truncates and re-seeds before each Playwright run. Recommend a `pnpm test:e2e:reset` script that calls `supabase db reset` and seeds the test data.

**Sources.**
- [Playwright: `dragTo` and drag-and-drop testing](https://playwright.dev/docs/input)
- [Inngest: Local development with `inngest-cli`](https://www.inngest.com/docs/dev-server)

---

## Cross-cutting reminders for the planner

1. **Plan 0 order matters.**
   - Step A: middleware rename (item 1) — independent.
   - Step B: env validation + service-role client (item 7 + service client from item 10) — required by everything that follows.
   - Step C: regenerate types + remove `@ts-nocheck` (item 5) — required because TS errors here will block all subsequent steps.
   - Step D: open-redirect fix (item 2) — depends on env helper being present.
   - Step E: cross-tenant FK guards migration (item 3) + storage bucket migration (item 4) + search indexes migration (item 13) + `client_activity_timeline` view (item 20) + `move_application` function (item 23) + invitation-aware trigger (item 28) — these are all additive migrations and can be in one combined migration or split. Recommend split: one migration per concern for clean rollback narrative.
   - Step F: `src/lib/db/` skeleton (item 9) + refactor `(app)/layout.tsx` — depends on types regeneration.
   - Step G: Inngest client + route (item 8) — depends on env validation.
   - Step H: `src/lib/ai/claude.ts` skeleton (item 10) — depends on env + service-role helper.
   - Step I: Sentry install (item 6) — verify middleware still fires post-install.
   - Step J: Vitest + Playwright config (item 30) — final Plan 0 deliverable.

2. **Don't forget `pnpm-workspace.yaml`** — fix per CONTEXT.md D-03. Recommend just deleting the `allowBuilds` block since `ignoredBuiltDependencies` already lists `sharp` + `unrs-resolver`. The `supabase` CLI build needs to be allowed; `pnpm` will prompt on install. Set:
   ```yaml
   onlyBuiltDependencies:
     - supabase
   ignoredBuiltDependencies:
     - sharp
     - unrs-resolver
   ```
   (Modern pnpm uses `onlyBuiltDependencies` for the allowlist; `allowBuilds` is the older name. Verify with `pnpm --version` — for pnpm 9+ use the new name.)

3. **Every feature task MUST add to its verification checklist.**
   - Task 3: candidate detail view writes a row to `audit_log` (manual check + ideally a unit test).
   - Task 4: an `ai_usage` row with non-zero token counts after a successful parse.
   - Task 5: `last_contacted_at` updates after activity log entry.
   - Task 6: activity row written on stage change with `kind = 'stage_change'` and `metadata.from_stage` / `to_stage` set.
   - Task 7: dashboard metrics match seeded data; invited user lands in inviter's org with `role = 'recruiter'`.

4. **CLAUDE.md non-negotiables to spot in the plan.**
   - No raw Claude calls outside `src/lib/ai/claude.ts`.
   - No `any` in TypeScript without an explanatory `// reason:` comment.
   - All AI calls log to `ai_usage`.
   - Never log CV text, candidate names, or emails to Sentry — `beforeSend` scrub in item 6 enforces this, but reviewers should also visually scan log call sites.
   - Server actions for mutations, route handlers only for webhooks (Inngest, future Stripe/Resend).

---

## Open questions for the planner

1. **Inngest in local dev.** Running `inngest-cli dev` in parallel with `pnpm dev` is a two-terminal workflow. Should Plan 0 add a `concurrently` (or `npm-run-all`) dependency to run both with a single `pnpm dev:all` command? Recommendation: add `concurrently` (small, popular dep) and the `dev:all` script — improves DX without bloating deps.

2. **Anthropic pricing constants.** The pricing-per-MTok numbers in item 10 are educated estimates. Before launch, verify against `https://www.anthropic.com/pricing#api`. Suggest a Task-7 verification step: open the pricing page and confirm the constants in `src/lib/ai/claude.ts` match. (Flagged as MEDIUM confidence — Anthropic price changes happen.)

3. **Audit log volume.** D-16 says detail-view-only writes to `audit_log`. The schema indexes `audit_log` by (org, entity, at) which serves the detail-view-history query well. If anchor customer has very heavy detail-view behaviour (e.g. 500+ candidate detail views/day) the table grows fast. Suggest a Phase 3 retention policy decision (e.g. archive > 12 months). Not blocking Phase 1.

4. **Seed-data PII for E2E tests.** The Phase 1 golden-path E2E (item 31) needs a sample CV. Recommend committing a fully-fictional, AI-generated CV PDF in `tests/fixtures/` to avoid any real candidate's data in the repo. Flag if the planner has a preferred origin.

---

*End of Phase 1 research.*
