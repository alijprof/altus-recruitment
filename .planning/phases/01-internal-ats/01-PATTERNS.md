# Phase 1 Patterns Map

**Purpose.** Map every new/modified file in Phase 1 (Internal ATS) to its closest existing analog in the codebase plus the exact pattern to copy. Consumed by `gsd-planner` — the planner cites this file in each plan's "Pattern to copy" line so the implementer doesn't re-derive shape from first principles.

**Consumed by:** `gsd-planner`
**Date:** 2026-05-17
**Phase scope:** Plan 0 (Hardening) + Tasks 3–7 from `docs/phase-1-tasks.md`
**Files mapped:** ~70

---

## How to read this

Each row: **New file → Closest analog → Pattern to copy → Deviations**. When no analog exists in the codebase (e.g., Inngest, Sentry, shadcn `Form`), the row points at the relevant `01-RESEARCH.md` section number — that section already contains the copy-paste-ready skeleton. The planner does not need to research again; it just follows the citation.

**Citations to RESEARCH.md** use the form `RESEARCH §N` where N is the numbered section heading in `01-RESEARCH.md` (e.g., `RESEARCH §10` is the Claude wrapper section).

---

## Conventions cheat-sheet

The following are the **only** patterns the planner should propagate. Any deviation must be justified inline.

### Server Component (RSC) data-fetch shape

Source: `src/app/(app)/layout.tsx` (lines 1–42), `src/app/(auth)/sign-in/page.tsx`.

```ts
// No 'use client'. Default export is async.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
// import db helper(s) from '@/lib/db/*'

export default async function FooPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: 'asc' | 'desc'; page?: string }>
  params: Promise<{ id: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const result = await listFoos(supabase, { /* ... */ })
  if (!result.ok) {
    return <div className="text-destructive p-8">Couldn&apos;t load. Please refresh.</div>
  }
  return <FooTable rows={result.data.rows} /* ... */ />
}
```

- **Next.js 16 makes `params` and `searchParams` Promises — always `await`.**
- No data fetching inside Client Components when an RSC parent can pass props.
- Result discrimination via `DbResult<T>` from `src/lib/db/*`.

### Server Action shape

No existing example yet — pattern locked in `CLAUDE.md` ("Server Actions for mutations") and `RESEARCH §11`.

```ts
// src/app/(app)/<entity>/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import * as Sentry from '@sentry/nextjs'

import { createClient } from '@/lib/supabase/server'
import { setRequestScope } from '@/lib/observability/sentry'
import { someDbHelper } from '@/lib/db/<entity>'
import { mySchema } from './schema'

export async function someAction(rawInput: unknown) {
  const parsed = mySchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false as const, fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // setRequestScope is called from layout already; safe to leave for layout.
  const result = await someDbHelper(supabase, parsed.data)
  if (!result.ok) {
    return { ok: false as const, formError: 'Something went wrong. Please try again.' }
  }
  revalidatePath('/<entity>')
  return { ok: true as const, data: result.data }
}
```

- Validate input with zod (same schema as client form).
- Use `src/lib/db/*` helper, never inline `.from()`.
- Return discriminated union `{ ok: true, data } | { ok: false, fieldErrors | formError }`.
- `revalidatePath` after mutation; `redirect()` only when navigating away.

### Client Component form shape (react-hook-form + zod + shadcn `<Form>`)

No existing example (current forms use `useState` discriminated unions and will be upgraded in Plan 0). Full pattern in `RESEARCH §11`.

Key rules:

- `'use client'` at top.
- `useForm({ resolver: zodResolver(schema) })`.
- Wrap in shadcn `<Form {...form}>` then `<form onSubmit={form.handleSubmit(onSubmit)}>`.
- `useTransition` for pending UI.
- Server Action called with the typed object (NOT raw FormData).
- Field-level server errors are pushed back via `form.setError(field, { message })`.
- Submit-level errors go through `sonner.toast.error(...)`.

### db helper return type

Locked in `RESEARCH §9`. Single discriminated union shared across the whole `src/lib/db/` directory.

```ts
// Exported from src/lib/db/types.ts (NEW file)
export type DbResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'not_found' | 'conflict' | 'forbidden' | 'internal' }
```

- Every db helper starts with `import 'server-only'`.
- Every helper takes a `SupabaseClient<Database>` as first arg.
- Postgrest errors → `Sentry.captureException(err, { tags: { layer: 'db', helper: 'xxx' } })`, return `{ ok: false, code: 'internal' }`.
- Unique-violation (`23505`) → `{ ok: false, code: 'conflict' }`.
- Naming: `getX`, `listX`, `createX`, `updateX`, `deleteX`.

### Inngest function shape

No analog. Full pattern in `RESEARCH §8` (client) and `RESEARCH §17` (parse-cv function).

- `inngest.createFunction({ id, concurrency: { limit, key }, retries, onFailure })`.
- Body composed of `step.run('step-name', async () => ...)` blocks.
- Each step must be idempotent (UPDATE not INSERT where possible).
- `NonRetriableError` for tenant-boundary violations, corrupt input.
- Inside an Inngest function we have NO auth context — use `createServiceClient()` from `src/lib/supabase/service.ts` (new file in Plan 0).

### Migration file naming

Source: existing files `supabase/migrations/20260513151021_init_organizations_and_users.sql`, `20260513152244_phase1_domain_schema.sql`.

- Format: `YYYYMMDDHHMMSS_descriptive_snake_case_name.sql`.
- Timestamp uses local time at creation; use `supabase migration new <name>` (auto-generates timestamp).
- **APPEND-ONLY.** Never edit a committed migration. Add a new one to fix.
- Every new function: `set search_path = public` and explicit `security definer` or `security invoker`.

### Naming files

- Component file inside a route folder = kebab-case `.tsx` (e.g., `sign-in-form.tsx`, `candidate-form.tsx`). UI-SPEC names some as PascalCase (`CandidateTable.tsx`) — **follow the existing kebab-case convention** for consistency; treat UI-SPEC PascalCase names as the *component name*, kebab-case the *filename*. `CONVENTIONS.md` lines 7–9 are explicit: route-colocated component files are kebab-case (matching `sign-in-form.tsx`).
- Shared component file in `src/components/app/` = kebab-case `.tsx` (e.g., `top-nav.tsx`, `sign-out-button.tsx`).
- shadcn primitive file in `src/components/ui/` = kebab-case `.tsx` (`button.tsx`, `input.tsx`, `label.tsx`). Always installed via `pnpm dlx shadcn@latest add <name>`.
- Non-component TS files = kebab-case `.ts` (`server.ts`, `client.ts`, `middleware.ts`, `utils.ts`).

### Import order

Source: every existing file. Three blocks separated by blank lines:

1. External packages (`next/*`, `react`, `@anthropic-ai/sdk`, etc.)
2. `@/` internal imports — components, lib, types
3. Relative imports (`./schema`, `./actions`)

`import type { Database }` for type-only imports. Single quotes, no semicolons.

### Style + typography (UI-SPEC reminders the planner often forgets)

- Two weights only: `font-normal` (400) and `font-semibold` (600). **No `font-medium`, `font-bold`.** Note: `src/components/ui/label.tsx` line 10 currently uses `font-medium` — leave it (shadcn upstream) but do NOT propagate `font-medium` to new code.
- Table header cells: `text-xs text-muted-foreground font-normal`.
- Icon-only `Button`/`DropdownMenuTrigger` MUST have `aria-label="Actions for {entity name}"` or `"<Action> <context>"`. See UI-SPEC "Accessibility / Icon-only interactive elements".
- App shell wrapper: `max-w-6xl mx-auto px-4 py-8 sm:px-6` — already established in `(app)/layout.tsx:39`. Page content must not re-impose its own max-width.
- Status badges use the semantic colour map in UI-SPEC "Color → Semantic status colors" (e.g., `bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200` for `actively_looking`).

### Discriminated-union state for tiny client state

Pattern visible in `src/app/(auth)/sign-in/sign-in-form.tsx:10-14`. Use for the rare client states that don't go through react-hook-form (e.g., a "save note" textarea):

```ts
type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }
```

### Sentry scoping in server actions

No analog. Pattern in `RESEARCH §6`. After Plan 0:

```ts
import * as Sentry from '@sentry/nextjs'
import { setRequestScope } from '@/lib/observability/sentry'
```

- `setRequestScope(user.id, profile.organization_id)` is called from `(app)/layout.tsx` for every page render — covers all RSC + server actions invoked from the page.
- Inside Inngest functions (no auth context), call `Sentry.setTag('organization_id', event.data.organization_id)` at the top of each function body.

---

## Plan 0 — Hardening

### `src/middleware.ts` (rename from `src/proxy.ts`)

- **Closest analog:** `src/proxy.ts` (this is a literal rename).
- **Pattern to copy:** Identical body. Rename exported `proxy()` → `middleware()`. Keep `config.matcher` exactly as written.
- **Deviations:** Function name only. **Delete** `src/proxy.ts` in the same commit (do not keep both).
- **Cross-reference:** `RESEARCH §1`.

### `src/lib/supabase/middleware.ts` (modified)

- **Closest analog:** itself (`src/lib/supabase/middleware.ts`).
- **Pattern to copy:** Keep entire structure. Only change: add `'/api/inngest'` to the `PUBLIC_PATHS` array (line 6) so Inngest webhooks aren't redirected to `/sign-in`. Replace `next: pathname` (line 43) with `next: safeNext(pathname)` (defence in depth — pathname is server-derived so it's already safe, but symmetry with callback prevents drift).
- **Deviations:** Two surgical edits. Do NOT refactor anything else.
- **Cross-reference:** `RESEARCH §1`, `RESEARCH §2`, `RESEARCH §8`.

### `src/lib/auth/safe-next.ts` (NEW)

- **Closest analog:** None — utility module.
- **Pattern to copy:** `RESEARCH §2` (the `safeNext` predicate). Single named export, no `'server-only'` (used in both middleware-edge and server runtimes).
- **Deviations:** Plain utility module; no Supabase imports.
- **Cross-reference:** `RESEARCH §2`.

### `src/app/auth/callback/route.ts` (modified)

- **Closest analog:** itself (existing route).
- **Pattern to copy:** Keep import + handler structure. Replace `const next = searchParams.get('next') ?? '/'` (line 11) with `const next = safeNext(searchParams.get('next'))`. Add `import { safeNext } from '@/lib/auth/safe-next'`.
- **Deviations:** One-line predicate insert.
- **Cross-reference:** `RESEARCH §2`.

### `src/lib/env.ts` (NEW)

- **Closest analog:** None. Currently `process.env.X!` non-null assertions in `server.ts`, `client.ts`, `middleware.ts`.
- **Pattern to copy:** `RESEARCH §7` (the `createEnv({ server, client, experimental__runtimeEnv })` skeleton).
- **Deviations:** None. Use exactly the var list locked in CONTEXT D-03: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, optionally `SENTRY_DSN`/`SENTRY_AUTH_TOKEN`/`NEXT_PUBLIC_SENTRY_DSN`.
- **Follow-up:** Refactor `src/lib/supabase/server.ts`, `client.ts`, `middleware.ts` to import `env` and drop the `!` assertions.
- **Cross-reference:** `RESEARCH §7`.

### `src/lib/supabase/server.ts` (modified)

- **Closest analog:** itself.
- **Pattern to copy:** Keep entire structure (cookies adapter, try/catch around `setAll`). Replace `process.env.NEXT_PUBLIC_SUPABASE_URL!` and `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!` with `env.NEXT_PUBLIC_SUPABASE_URL` and `env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Add `import { env } from '@/lib/env'`.
- **Deviations:** Two value swaps.

### `src/lib/supabase/client.ts` (modified)

- **Closest analog:** itself.
- **Pattern to copy:** Identical to `server.ts` swap above. `env` import + drop `!`.

### `src/lib/supabase/service.ts` (NEW)

- **Closest analog:** `src/lib/supabase/server.ts`. Closest in shape (single `createClient` factory), but no cookies adapter.
- **Pattern to copy:** `RESEARCH §10` Service-role client skeleton. Uses `@supabase/supabase-js` `createClient` (not `@supabase/ssr`), `auth: { autoRefreshToken: false, persistSession: false }`.
- **Deviations:** Top-of-file `import 'server-only'`; NEVER import this from a Client Component or RSC. Reserved for Inngest functions + post-auth server actions that need to bypass RLS (rare).
- **Cross-reference:** `RESEARCH §10`.

### `src/lib/db/types.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Export the `DbResult<T>` discriminated union (definition above in the cheat-sheet). One file, one export.

### `src/lib/db/profiles.ts` (NEW)

- **Closest analog:** Inline query in `src/app/(app)/layout.tsx:18-22` (the `from('users').select(...)` block).
- **Pattern to copy:** `RESEARCH §9` `getProfile()` skeleton. `import 'server-only'`. Accept `SupabaseClient<Database>` + `userId`. Return `DbResult<Pick<Tables<'users'>, 'full_name' | 'email' | 'organization_id'>>`.
- **Deviations:** Sentry capture on Postgrest error (Sentry must be installed first or skip the import; the planner can sequence — recommend Sentry before db helpers).
- **Cross-reference:** `RESEARCH §9`.

### `src/lib/db/organizations.ts` (NEW)

- **Closest analog:** Inline query in `src/app/(app)/layout.tsx:25-30`.
- **Pattern to copy:** `RESEARCH §9` `getOrganization()` skeleton. Mirror of `getProfile` shape.
- **Deviations:** `Pick<Tables<'organizations'>, 'id' | 'name' | 'slug'>` return shape.

### `src/app/(app)/layout.tsx` (modified)

- **Closest analog:** itself.
- **Pattern to copy:** Keep structure (auth guard + TopNav + main wrapper at `max-w-6xl mx-auto px-4 py-8 sm:px-6`). Replace inline `from('users').select(...)` and `from('organizations').select(...)` with calls to `getProfile(supabase, user.id)` and `getOrganization(supabase, profile.data.organization_id)`. Add `setRequestScope(user.id, profile.data.organization_id)` after the lookups.
- **Deviations:** Use `DbResult` discrimination; redirect to `/sign-in` if `getProfile` returns `not_found` (covers a deleted user with a live session).
- **Cross-reference:** `RESEARCH §9`.

### `src/lib/ai/claude.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §10` full wrapper. Three concrete exports: `claudeClient`, `parseCV`, and the internal `runWithLogging`. The internal helper enforces (a) model is `ApprovedModel`, (b) calls `record_ai_usage` via `.rpc()` on the service-role client, (c) handles 429/529 retries with `retry-after` header.
- **Deviations:** Add a verification step ("confirm `PRICING_PENCE_PER_MTOK` matches Anthropic pricing page before merge") to the plan acceptance criteria.

### `src/lib/ai/cv-extract.ts` (NEW — used in Task 4, scaffolded in Plan 0 or Task 4)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §15` `extractCvText` function — unpdf for PDF, mammoth for DOCX, throws on unknown mime.
- **Deviations:** None. Pure module, `import 'server-only'`.

### `src/lib/observability/sentry.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §6` `setRequestScope(userId, organizationId)` helper. Single named export.
- **Deviations:** `setUser({ id })` only — never set `email` (CLAUDE.md PII prohibition).

### `sentry.server.config.ts` (NEW — project root)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §6` config body — `Sentry.init({ dsn, environment, tracesSampleRate: 0.1, sendDefaultPii: false, beforeSend: piiScrubber })`. Include the PII_KEYS list and recursive scrub.

### `sentry.edge.config.ts` (NEW — project root)

- **Closest analog:** `sentry.server.config.ts` (sibling).
- **Pattern to copy:** Same `Sentry.init` body but trimmed for edge runtime (no Node-only integrations). Wizard generates this; accept its output, then patch `beforeSend` to match server config.

### `sentry.client.config.ts` (NEW — project root)

- **Closest analog:** `sentry.server.config.ts`.
- **Pattern to copy:** Same shape; lower `tracesSampleRate` (e.g., 0.05) and ensure `sendDefaultPii: false`. The `beforeSend` PII scrubber is the same.

### `instrumentation.ts` (NEW — project root)

- **Closest analog:** None.
- **Pattern to copy:** Standard Sentry-for-Next.js wizard output:

```ts
import * as Sentry from '@sentry/nextjs'
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
export const onRequestError = Sentry.captureRequestError
```

- **Cross-reference:** `RESEARCH §6`.

### `next.config.ts` (modified — by Sentry wizard)

- **Closest analog:** itself (small file post-scaffold).
- **Pattern to copy:** Wrap default export in `withSentryConfig(nextConfig, { ... })`. Run the Sentry wizard; accept its diff verbatim and ensure `silent: !process.env.CI`.

### `src/lib/inngest/client.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §8` skeleton. Single export `inngest` instance with `id: 'altus-recruitment'` and `eventKey: env.INNGEST_EVENT_KEY`.

### `src/app/api/inngest/route.ts` (NEW)

- **Closest analog:** `src/app/auth/callback/route.ts` — the only existing route handler.
- **Pattern to copy:** The "route handler in `app/.../route.ts` exports named HTTP-method handlers" shape. Specifically, `RESEARCH §8`: `export const { GET, POST, PUT } = serve({ client: inngest, functions: [] })`.
- **Deviations:** No `request` parameter — `serve` consumes raw `NextRequest` internally. Functions array empty in Plan 0, populated in Task 4.

### shadcn primitives — bulk `pnpm dlx shadcn@latest add ...`

The following primitives must be added (from UI-SPEC "shadcn components required for Phase 1"). All go into `src/components/ui/<name>.tsx`.

- **Closest analog:** `src/components/ui/button.tsx`, `input.tsx`, `label.tsx` (already installed by shadcn CLI — same generation pattern).
- **Pattern to copy:** None — these are generator output. Do not hand-edit after install except to remove generated stuff we don't use.
- **Components to add:** `form`, `dialog`, `sheet`, `select`, `badge`, `skeleton`, `tabs`, `card`, `separator`, `dropdown-menu`, `avatar`, `textarea`, `checkbox`, `popover`, `progress`, `alert`, `table`, `accordion` (mobile kanban fallback), `alert-dialog` (archive job confirmation), `tooltip` (icon-only complements).
- **Install command:** `pnpm dlx shadcn@latest add form dialog sheet select badge skeleton tabs card separator dropdown-menu avatar textarea checkbox popover progress alert table accordion alert-dialog tooltip`.
- **Sonner toasts:** `pnpm add sonner`, then add `<Toaster />` to `src/app/layout.tsx` (or `(app)/layout.tsx` if we want toasts only in the authed shell — recommend the root `layout.tsx` so toast lives in both `(auth)` and `(app)`).

### New migration: `supabase/migrations/<ts>_cross_tenant_fk_guards.sql` (NEW)

- **Closest analog:** `supabase/migrations/20260513152244_phase1_domain_schema.sql` (existing functions e.g., `set_organization_id` line 86, `record_audit` line 104, `record_ai_usage` line 130 — those show the `set search_path = public` + `security definer` style).
- **Pattern to copy:** `RESEARCH §3` full skeleton — `assert_same_org()` helper + three trigger functions + three triggers (`contacts_same_org_check`, `jobs_same_org_check`, `applications_same_org_check`).
- **Deviations:** Match the existing migration's style: `language plpgsql`, `security definer` (for the `assert_same_org` helper that does cross-table `select`), `set search_path = public`, trailing semicolons-by-statement, lowercase keywords.
- **Naming:** filename `<timestamp>_cross_tenant_fk_guards.sql` (use `supabase migration new cross_tenant_fk_guards` to generate timestamp).

### New migration: `supabase/migrations/<ts>_storage_cvs_bucket.sql` (NEW)

- **Closest analog:** Same migration file (`20260513152244_phase1_domain_schema.sql`) for RLS policy style — lines 467–485 show the four-policy pattern (select/insert/update/delete with `to authenticated`).
- **Pattern to copy:** `RESEARCH §4` full skeleton — bucket insert + four storage.objects policies, all gated on `(storage.foldername(name))[1] = public.current_organization_id()::text`.
- **Deviations:** Tighten `file_size_limit` to 10 MiB (10485760) per `RESEARCH §15` pitfall, NOT the 50 MiB in the research skeleton.

### New migration: `supabase/migrations/<ts>_search_indexes.sql` (NEW)

- **Closest analog:** The trigram indexes already created in `20260513152244_phase1_domain_schema.sql` (search the file for `gin_trgm_ops` — exists for `candidates.full_name`, `companies.name`, `jobs.title`).
- **Pattern to copy:** Same `create index if not exists <name> on public.<table> using gin (<col> gin_trgm_ops);` shape. Per `RESEARCH §13`: add for `candidates.email`, `candidates.current_role_title`, `companies.industry`.

### New migration: `supabase/migrations/<ts>_search_candidates_rpc.sql` (NEW)

- **Closest analog:** `record_audit()` and `record_ai_usage()` in the domain migration (security-definer functions returning structured data).
- **Pattern to copy:** `RESEARCH §13` full `search_candidates` RPC body. Mirror naming and grant pattern for `search_clients`.
- **Deviations:** `security invoker` (NOT definer) — the function must enforce RLS naturally for tenant scoping. `grant execute on function ... to authenticated;` (matches the existing `grant execute` on the audit/usage funcs).

### New migration: `supabase/migrations/<ts>_handle_new_user_invite.sql` (NEW — Task 7 invite flow)

- **Closest analog:** `handle_new_user()` in `20260513151021_init_organizations_and_users.sql` lines 137–139 (the existing trigger that creates org+user on signup).
- **Pattern to copy:** Existing function shape (security definer, raw_user_meta_data parsing). Modify to handle the invite case: when `raw_user_meta_data->>'invitation_token'` is present, link the new auth user to an existing org via an `invitations` table (also a new table in this migration) instead of creating a new org.
- **Deviations:** **Append-only.** Do NOT edit the existing `handle_new_user` migration — write a new migration that `create or replace function public.handle_new_user()` with the updated body (Postgres re-binds the trigger).
- **Cross-reference:** CONTEXT.md `<specifics>` paragraph about settings invite flow.

### Test infrastructure (Plan 0 — locked per CONTEXT.md `<deferred>` recommendation)

#### `vitest.config.ts` (NEW — project root)

- **Closest analog:** None.
- **Pattern to copy:** Standard Vitest 4 Next.js config — `defineConfig({ test: { environment: 'node', globals: true, include: ['tests/unit/**/*.test.ts'] }, resolve: { alias: { '@': './src' } } })`. Use `@vitejs/plugin-react` if any unit tests render components.

#### `playwright.config.ts` (NEW — project root)

- **Closest analog:** None.
- **Pattern to copy:** Standard Playwright config — `defineConfig({ testDir: './tests/e2e', use: { baseURL: 'http://localhost:3000' }, webServer: { command: 'pnpm dev', port: 3000, reuseExistingServer: !process.env.CI } })`.

#### `tests/unit/lib/auth/safe-next.test.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Plain Vitest spec with `describe`/`it`/`expect`. Cover the predicate's known attack vectors: `null`, `'/'`, `'/dashboard'`, `'//evil.com'`, `'/\\evil.com'`, `'https://evil.com'`, `'%2F%2Fevil.com'` (decoded → handled).

#### `tests/e2e/auth-guard.spec.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §1` Playwright skeleton — unauthenticated `goto('/')` → expect URL contains `/sign-in?next=%2F`.

#### `tests/e2e/phase-1-happy-path.spec.ts` (NEW — Task 7 ships this)

- **Closest analog:** None.
- **Pattern to copy:** Multi-step Playwright spec covering: sign in → create candidate (with consent) → upload CV → wait for parse complete → create client → create job → drag candidate through pipeline → reject with reason. This is the explicit acceptance criterion from CONTEXT.md `<deferred>` "Task 7 must include at least one Playwright E2E covering the full Tasks 3–6 flow".

### `.env.example` (modified)

- **Closest analog:** itself.
- **Pattern to copy:** Add the new env keys: `ANTHROPIC_API_KEY=`, `INNGEST_EVENT_KEY=`, `INNGEST_SIGNING_KEY=`, `SENTRY_DSN=`, `SENTRY_AUTH_TOKEN=`, `NEXT_PUBLIC_SENTRY_DSN=`. Keep all existing keys.

### `package.json` (modified)

- **Closest analog:** itself.
- **Pattern to copy:** Add scripts per RESEARCH: `"db:types"` (RESEARCH §5), `"inngest:dev"` (RESEARCH §8), `"test"` (vitest), `"test:e2e"` (playwright). Add deps: `@anthropic-ai/sdk`, `inngest`, `@sentry/nextjs`, `@dnd-kit/core`, `@dnd-kit/sortable`, `unpdf`, `mammoth`, `zod`, `react-hook-form`, `@hookform/resolvers`, `@t3-oss/env-nextjs`, `sonner`. Dev deps: `vitest`, `@playwright/test`.

### `pnpm-workspace.yaml` (modified — already showing M in git status)

- **Closest analog:** itself.
- **Pattern to copy:** Fix the placeholder strings (`sharp`, `supabase`, `unrs-resolver`) per CONTEXT D-03. Replace with `true` booleans, or delete the `allowBuilds` block entirely if not needed.

### `src/types/database.ts` (modified — regenerate, drop `@ts-nocheck`)

- **Closest analog:** itself.
- **Pattern to copy:** `RESEARCH §5` regen procedure. Run `pnpm db:types` after migrations land. Hand-delete the `// @ts-nocheck` (line 1). Run `pnpm typecheck` and fix any breakages (most likely none, but possibly the inline queries in `(app)/layout.tsx` once they're refactored to use `getProfile`/`getOrganization`).
- **Deviations:** The git status already shows this file as modified — the planner should verify what's in the working copy vs HEAD before further edits.

---

## Task 3 — Candidates module

### `src/lib/db/candidates.ts` (NEW)

- **Closest analog:** Pattern from `src/lib/db/profiles.ts` (Plan 0).
- **Pattern to copy:** `RESEARCH §9` for getX/listX shape; `RESEARCH §13` for `listCandidates` with `q`/`sort`/`dir`/`offset`/`limit` and the `.rpc('search_candidates', ...)` branch when `q` is present.
- **Exports (anticipated):** `getCandidate`, `listCandidates`, `createCandidate`, `updateCandidate`, `logActivity` (or move that to `activities.ts`), `recordCandidateView` (calls `record_audit` rpc — see below).
- **Audit hook:** `getCandidate` must call `supabase.rpc('record_audit', { p_action: 'view', p_entity_type: 'candidate', p_entity_id: id })` per CONTEXT D-16 (detail-view writes only).
- **Cross-reference:** `RESEARCH §9`, `RESEARCH §13`.

### `src/app/(app)/candidates/page.tsx` (modified — currently a placeholder stub)

- **Closest analog:** Current placeholder (`src/app/(app)/candidates/page.tsx`) shows the styling shell (`<h1 className="text-2xl font-semibold tracking-tight">`). Augmented per RSC pattern from `(app)/layout.tsx`.
- **Pattern to copy:** `RESEARCH §14` full skeleton — `async function CandidatesPage({ searchParams })`. Defaults: `sort='last_contacted_at'`, `dir='desc'`, `page=1`, `limit=25` (per CONTEXT D-14, D-15).
- **Deviations:** Heading text "Candidates" + page-action button "Add candidate" right-aligned (UI-SPEC Copywriting Contract). When `rows.length === 0`, render the `<EmptyState>` shared component (see Task 7 components) with copy "No candidates yet" / "Add your first candidate to get started." (UI-SPEC Empty States table).

### `src/app/(app)/candidates/candidate-table.tsx` (NEW — RSC presentation component)

- **Closest analog:** None. UI-SPEC names this `CandidateTable.tsx`; **filename in kebab-case** per CONVENTIONS, component export name in PascalCase (`export function CandidateTable`).
- **Pattern to copy:** Plain RSC presentation component receiving `{rows, total, page, limit, sort, dir, q}`. Renders shadcn `<Table>` (sticky header) with columns Name, Role / Company, Location, Market Status, Last Contacted, Source per UI-SPEC §1. Header cells: `text-xs text-muted-foreground font-normal`. Row click navigates to `/candidates/[id]` via `<Link>` wrapping the row content.
- **Deviations:** Sort header cells contain a `<Link>` (RSC, swaps `sort`/`dir` URL params); the SearchInput and any debounced filter is a separate Client Component below.

### `src/app/(app)/candidates/search-input.tsx` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §14` Client Component skeleton — `'use client'`, `useRouter` + `usePathname` + `useSearchParams`, 300ms debounce, `router.replace`. **Resets `page=1` on every query change.**
- **Deviations:** Prefer a hand-rolled `useDebouncedCallback` (5 lines) to adding `use-debounce` dep — see RESEARCH §14 pitfalls.

### `src/app/(app)/candidates/[id]/page.tsx` (NEW)

- **Closest analog:** `(app)/layout.tsx` (auth-aware async server component pattern).
- **Pattern to copy:** Async RSC. Reads `params: Promise<{ id }>`, awaits, calls `getCandidate(supabase, id)` — which internally calls `record_audit` per CONTEXT D-16. Reads associated CV row(s) + activity timeline. Layout: `grid grid-cols-1 lg:grid-cols-3 gap-6` per UI-SPEC §2 (main 2/3 left, side panel 1/3 right).
- **Deviations:** 404 if `getCandidate` returns `{ok: false, code: 'not_found'}` — use `notFound()` from `next/navigation`.

### `src/app/(app)/candidates/[id]/candidate-detail-header.tsx` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Plain RSC presentation component. Renders name (`text-xl font-semibold`), current role + company (`text-sm font-normal text-muted-foreground`), `<MarketStatusBadge>` (Task 7 component, see below).

### `src/components/app/activity-timeline.tsx` (NEW — shared)

- **Closest analog:** `src/components/app/top-nav.tsx` (shared component shape: PascalCase export, lucide-react icons, props interface named `<Name>Props`).
- **Pattern to copy:** Polymorphic timeline per UI-SPEC §2. Props: `entries: ActivityEntry[]`. lucide icons: `MessageSquare` (note), `Phone` (call), `Users` (meeting), `ArrowRight` (stage change), `Sparkles` (system / AI events).
- **Deviations:** RSC by default; only the "Log activity" button at the top is a Client Component (opens a dialog).

### `src/app/(app)/candidates/new/page.tsx` (NEW)

- **Closest analog:** `src/app/(auth)/sign-in/page.tsx` (page → form composition pattern).
- **Pattern to copy:** Async RSC. Renders a heading + `<CandidateForm>` Client Component. No data fetch (form is for creating a new row).
- **Deviations:** Heading "Add candidate". `max-w-2xl` content width (per UI-SPEC layout patterns — single-column form).

### `src/app/(app)/candidates/new/schema.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §11` zod schema (`createCandidateSchema`) including `consent_basis` enum, `consent_confirmed: z.literal(true)`. Co-located with the form/page.

### `src/app/(app)/candidates/new/candidate-form.tsx` (NEW)

- **Closest analog:** `src/app/(auth)/sign-in/sign-in-form.tsx` (kebab-case filename for a colocated Client Component) AND `RESEARCH §11` (the actual react-hook-form + zod skeleton that replaces the existing `useState` form pattern).
- **Pattern to copy:** From `sign-in-form.tsx`: `'use client'` directive position, kebab-case filename, function name PascalCase, no semicolons. From `RESEARCH §11`: `useForm` + `zodResolver` + shadcn `<Form>` wrapper, `useTransition` for pending, `form.setError` for server field errors, `toast.error` for general errors. Consent section (UI-SPEC §7) uses `<Separator>` + heading "Data & Consent" + `<Checkbox>` + inline `text-xs text-muted-foreground` privacy paragraph.
- **Deviations:** This form IS the new pattern; existing `sign-in-form.tsx` will be retrofitted to match later (or left as is — it's outside Phase 1 scope; planner can decide whether to upgrade the auth forms in Plan 0). Recommend upgrading auth forms as part of Plan 0 task "shadcn `<Form>` migration" so we have a single form pattern across the codebase.

### `src/app/(app)/candidates/new/actions.ts` (NEW — server action)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §11` `createCandidateAction`. Validates with `createCandidateSchema.safeParse`, fills `consent_at` server-side, calls `createCandidate` db helper, `revalidatePath('/candidates')`, `redirect()` to detail page on success.

### `src/app/(app)/candidates/[id]/actions.ts` (NEW — server action)

- **Closest analog:** None.
- **Pattern to copy:** Server Action shape (cheat-sheet above). Exports: `updateCandidateAction`, `logCallAction`, `addNoteAction` (writes to `activities` via `src/lib/db/activities.ts`). `revalidatePath('/candidates/[id]', 'page')` after each.

### `src/lib/legal/consent.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Single export `CURRENT_CONSENT_VERSION = 'v1' as const` plus the privacy text constant. Imported by both the form and the server action so the captured version matches what the user actually saw. See `RESEARCH §12` pitfalls.

---

## Task 4 — CV upload + parse

### `src/lib/db/candidate-cvs.ts` (NEW)

- **Closest analog:** `src/lib/db/profiles.ts` (Plan 0).
- **Pattern to copy:** `RESEARCH §9` shape. Exports: `getCandidateCv`, `listCandidateCvs(byCandidateId)`, `createCandidateCv`, `updateCvParsingStatus`. Bumps `version` on create (matches the existing unique constraint on `(candidate_id, version)`).

### `src/app/(app)/candidates/[id]/cv-upload.tsx` (NEW — Client Component)

- **Closest analog:** None for upload, but `src/app/(auth)/sign-in/sign-in-form.tsx` for the discriminated `Status` union shape on a non-RHF client UI.
- **Pattern to copy:** `'use client'`. Use Supabase Storage browser client (`createClient()` from `@/lib/supabase/client`) to upload to `cvs` bucket with path `{org_id}/{candidate_id}/{uuid}-{slug}.{ext}` (RESEARCH §4 path format). After upload succeeds, call server action `enqueueCvParse(candidateCvId, storagePath)`.
- **Deviations:** Mime-type allowlist enforced client-side AND server-side per RESEARCH §15 pitfall. File size ≤ 10 MiB. shadcn `<Progress>` while uploading. `sonner.toast.success('CV uploaded')` on success.

### `src/app/(app)/candidates/[id]/cv-review-panel.tsx` (NEW — Client Component)

- **Closest analog:** None.
- **Pattern to copy:** `'use client'`. shadcn `<Sheet>` on desktop, bottom sheet on mobile. Lists fields from `extracted_data` JSON with `<ConfidenceBadge>` (component below) per row. Buttons: "Accept all", "Edit field" (per-row), "Retry" (when `parsing_status === 'failed'`).
- **Deviations:** Retry button calls `retryParseCv` server action — see `RESEARCH §17` end of section.

### `src/app/(app)/candidates/[id]/actions.ts` (extended)

- **Closest analog:** Existing actions file (Task 3 above).
- **Pattern to copy:** Add `enqueueCvParseAction(candidateCvId)` and `retryParseCv(candidateCvId)` per `RESEARCH §17`. `inngest.send({ name: 'cv/uploaded', data: { organization_id, candidate_id, candidate_cv_id, storage_path, mime_type, user_id } })`.

### `src/lib/inngest/functions/parse-cv.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `RESEARCH §17` full function body — 4 `step.run` checkpoints (download → extract → claude-parse → write-extracted). Concurrency `{ limit: 5, key: 'event.data.organization_id' }`. `retries: 3`. `onFailure` updates the CV row to `parsing_status: 'failed'`.
- **Deviations:** None.

### `src/app/api/inngest/route.ts` (modified)

- **Closest analog:** itself (Plan 0).
- **Pattern to copy:** Add `parseCVOnUpload` to the `functions` array.

---

## Task 5 — Clients & contacts

### `src/lib/db/clients.ts` (NEW)

- **Closest analog:** `src/lib/db/candidates.ts`.
- **Pattern to copy:** Same getX/listX/createX/updateX/deleteX pattern. `listClients` mirrors `listCandidates` with `q`/`sort`/`dir`/`offset`/`limit`; the `q` branch calls `.rpc('search_clients', ...)` (new RPC in Plan 0).
- **Deviations:** `dormant` flag computed in the helper (`last_contacted_at` > 60 days ago → `dormant: true`) per UI-SPEC §5. Don't store dormant; derive.

### `src/lib/db/contacts.ts` (NEW)

- **Closest analog:** `src/lib/db/clients.ts`.
- **Pattern to copy:** Same shape. `listContacts(byCompanyId)` accepts a `companyId` filter.

### `src/lib/db/activities.ts` (NEW)

- **Closest analog:** `src/lib/db/candidate-cvs.ts` (similar 1-table shape).
- **Pattern to copy:** Polymorphic helper. Exports: `listActivities({ entityType, entityId })`, `createActivity(input)`. Per CONTEXT.md the activities entity_type is polymorphic and untyped at the DB — enforce same-org at app layer here per `RESEARCH §3` activities pitfall.

### `src/app/(app)/clients/page.tsx` (modified)

- **Closest analog:** `src/app/(app)/candidates/page.tsx` (Task 3 above).
- **Pattern to copy:** Same RSC + searchParams pattern. Default sort `last_contacted_at DESC` (CONTEXT D-15). Empty state copy "No clients yet" / "Add a client to track jobs and contacts." (UI-SPEC).

### `src/app/(app)/clients/client-table.tsx` (NEW)

- **Closest analog:** `src/app/(app)/candidates/candidate-table.tsx`.
- **Pattern to copy:** Same `<Table>` shell. Columns: Name, Industry, Status, Last Contacted, Open Jobs. Dormant `<Badge>` (amber) when applicable.

### `src/app/(app)/clients/[id]/page.tsx` (NEW)

- **Closest analog:** `src/app/(app)/candidates/[id]/page.tsx`.
- **Pattern to copy:** Async RSC. Full-width header (name + industry + badges). Then `<ClientManagementTabs>` Client Component with Contacts / Jobs / Activity / Notes tabs (UI-SPEC §5).

### `src/app/(app)/clients/[id]/client-management-tabs.tsx` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `'use client'`. shadcn `<Tabs>` (UI-SPEC `tabs` primitive). Four `<TabsContent>` panels for Contacts (table), Jobs (table), Activity (`<ActivityTimeline>`), Notes (textarea + Save).
- **Deviations:** Stays Client because tab state is local. Each tab's data is passed in as props from the RSC parent.

### `src/app/(app)/clients/actions.ts` (NEW — server actions)

- **Closest analog:** `src/app/(app)/candidates/new/actions.ts`.
- **Pattern to copy:** Same shape. Exports: `createClientAction`, `updateClientAction`, `createContactAction`, `updateContactAction`, `deleteContactAction`, `addClientNoteAction`.

### `src/app/(app)/clients/new/page.tsx` + `client-form.tsx` + `schema.ts`

- **Closest analog:** `src/app/(app)/candidates/new/` trio.
- **Pattern to copy:** Identical structure. Schema is smaller (no GDPR consent — companies aren't natural persons).

---

## Task 6 — Jobs & pipeline

### `src/lib/db/jobs.ts` (NEW)

- **Closest analog:** `src/lib/db/clients.ts`.
- **Pattern to copy:** Same shape. Default list filter `status = 'open'` (CONTEXT D-15).

### `src/lib/db/applications.ts` (NEW)

- **Closest analog:** `src/lib/db/activities.ts` (similar shape — child rows of a parent entity).
- **Pattern to copy:** Exports: `listApplications({ jobId? })`, `moveApplicationStage(applicationId, newStage, actorUserId)`, `declineApplication(applicationId, reason, notes, actorUserId)`. Each writes to `activities` in the same transaction (or sequential — Phase 1 is fine without explicit txns since RLS prevents cross-tenant leakage).

### `src/app/(app)/jobs/page.tsx` (modified — currently a placeholder)

- **Closest analog:** `src/app/(app)/candidates/page.tsx`.
- **Pattern to copy:** Same RSC + table + searchParams pattern. Columns: Title, Client, Type, Status, Created, Open Applications.

### `src/app/(app)/jobs/[id]/page.tsx` (NEW)

- **Closest analog:** `src/app/(app)/candidates/[id]/page.tsx`.
- **Pattern to copy:** Async RSC. Header (title + client + type + status badges). Pipeline section: full-width below header, renders `<PipelineBoard>` Client Component.

### `src/components/app/pipeline-board.tsx` (NEW — shared)

- **Closest analog:** None. Shared because reused by `/jobs/[id]/pipeline` AND `/pipeline` (global) per CONTEXT D-12.
- **Pattern to copy:** `'use client'`. Receives `applications`, `stages`, `filters` (owner/job/client). Uses `@dnd-kit/core` + `@dnd-kit/sortable` for drag. Pending-state contract per UI-SPEC §4 / CONTEXT D-09: on drop, card receives `opacity-60` + `<Loader2>` spinner; server action call; on success clear, on failure revert + toast "Couldn't move [Name] — please try again."
- **Mobile fallback (CONTEXT D-11):** below `md` breakpoint, render `<Accordion>` (shadcn) with one section per stage instead of horizontal scroll columns. Tap "Move" opens bottom `<Sheet>` with stage picker buttons.

### `src/components/app/pipeline-card.tsx` (NEW)

- **Closest analog:** `src/components/app/top-nav.tsx` (PascalCase component, kebab-case file, props interface `<Name>Props`).
- **Pattern to copy:** shadcn `<Card>` `p-3`. Candidate name (`text-sm font-semibold`), current role (`text-xs text-muted-foreground font-normal`), days-in-stage chip (`text-xs font-normal`). Stale indicator (amber dot) when days > 14. `<DropdownMenuTrigger>` icon-only button with `aria-label="Actions for {candidate full name}"` per UI-SPEC Accessibility rule.

### `src/components/app/decline-modal.tsx` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** `'use client'`. shadcn `<Dialog>`. Title "Decline [Candidate Name]". Body: `<Select>` for `decline_reason` (enum mapping from UI-SPEC Copywriting Contract → Decline Reason Labels) + `<Textarea>` for optional notes. Footer: "Cancel" (`variant="outline"`) + "Decline candidate" (`variant="destructive"`); destructive button disabled until reason selected. On confirm: calls `declineApplicationAction` server action.

### `src/app/(app)/jobs/[id]/actions.ts` (NEW)

- **Closest analog:** None.
- **Pattern to copy:** Server Action shape (cheat-sheet). Exports: `moveStageAction(applicationId, newStage)`, `declineApplicationAction(applicationId, reason, notes)`. Each writes the stage change + activity entry; returns `{ ok: true | false }` for optimistic-revert logic in the kanban.

### `src/app/(app)/pipeline/page.tsx` (modified)

- **Closest analog:** `src/app/(app)/jobs/[id]/page.tsx`.
- **Pattern to copy:** Same `<PipelineBoard>` Client Component, but reads filters (`owner`, `job`, `client`) from `searchParams` per CONTEXT D-12. No job-specific header.

### `src/app/(app)/jobs/new/page.tsx` + `job-form.tsx` + `schema.ts`

- **Closest analog:** `src/app/(app)/candidates/new/` trio.
- **Pattern to copy:** Identical structure. Schema includes `client_id` (FK), `title`, `type` (`perm` | `contract`), `salary_band`, etc. Also accessible via `/clients/[id]/jobs/new` (UI-SPEC §5 Jobs tab) — same form, prefilled with `client_id`.

---

## Task 7 — Dashboard & settings

### `src/lib/db/dashboard.ts` (NEW)

- **Closest analog:** `src/lib/db/candidates.ts`.
- **Pattern to copy:** Aggregations only — exports e.g. `getDashboardMetrics(supabase)`, `listStaleApplications(supabase)`, `listFollowUpCandidates(supabase)`. Each returns `DbResult<...>`. The follow-up query sorts `market_status` priority `hot → actively_looking → passively_looking` via `case when`.

### `src/app/(app)/page.tsx` (modified — currently a placeholder)

- **Closest analog:** `src/app/(app)/layout.tsx` (async RSC + Supabase + db helpers).
- **Pattern to copy:** Async RSC. Layout: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` for metric cards row, then `grid grid-cols-1 lg:grid-cols-3 gap-6` for activity feed + widgets (UI-SPEC §6).
- **Deviations:** Heading "Dashboard". Metric value typography: `text-2xl font-semibold` (Display per UI-SPEC Typography).

### `src/components/app/metric-card.tsx` (NEW)

- **Closest analog:** `src/components/app/top-nav.tsx`.
- **Pattern to copy:** shadcn `<Card>`. Value (Display typography 28px, `font-semibold`). Label (Label typography 12px, `font-normal`, `text-muted-foreground`).

### `src/components/app/market-status-badge.tsx` (NEW)

- **Closest analog:** None. Use shadcn `<Badge>` primitive.
- **Pattern to copy:** Props `{ status: Enums<'market_status'> }`. Maps each enum value to the class string from UI-SPEC "Semantic status colors" table (e.g. `actively_looking` → `bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`). PascalCase export, kebab-case file.

### `src/components/app/confidence-badge.tsx` (NEW)

- **Closest analog:** `src/components/app/market-status-badge.tsx` (sibling).
- **Pattern to copy:** Props `{ level: 'high' | 'medium' | 'low' }`. Same colour-mapping shape as market status badge.

### `src/components/app/empty-state.tsx` (NEW)

- **Closest analog:** `src/components/app/top-nav.tsx`.
- **Pattern to copy:** Props `{ heading, body, ctaLabel?, ctaHref? }`. Plain RSC, no `'use client'`. Centered layout: heading (`text-xl font-semibold`), body (`text-sm text-muted-foreground font-normal`), optional CTA `<Link>` styled via `buttonVariants({...})` (already shown in `src/app/auth/auth-code-error/page.tsx:14`).

### `src/components/app/list-skeleton.tsx` (NEW)

- **Closest analog:** None. Uses shadcn `<Skeleton>` primitive.
- **Pattern to copy:** Plain RSC. Renders 5 rows × 6 cells of `<Skeleton>` blocks (UI-SPEC §1 loading state).

### `src/app/(app)/settings/page.tsx` (modified — currently a placeholder)

- **Closest analog:** `src/app/(auth)/sign-in/page.tsx` (page → form composition).
- **Pattern to copy:** Async RSC. Single-column `max-w-2xl` sections separated by `<Separator>`. Sections: Profile (read-only for Phase 1), Organisation, Team (`<InviteForm>` + invite list).

### `src/app/(app)/settings/invite-form.tsx` (NEW)

- **Closest analog:** `src/app/(app)/candidates/new/candidate-form.tsx`.
- **Pattern to copy:** Same react-hook-form + zod + shadcn `<Form>` shape. Single email field. Submit calls `inviteTeammateAction`.

### `src/app/(app)/settings/actions.ts` (NEW)

- **Closest analog:** `src/app/(app)/candidates/new/actions.ts`.
- **Pattern to copy:** Server Action shape. Exports: `inviteTeammateAction`, `revokeInviteAction`. The invite action inserts a row into `invitations` (table added in Plan 0 invite migration), sends the email via Resend (server-only — wrap in a `src/lib/email/resend.ts` if multiple email types arrive; Phase 1 only this one email, fine to inline for now).

---

## Files that have no analog (planner consumes RESEARCH.md directly)

| New file | RESEARCH section |
|----------|-----------------|
| `src/lib/env.ts` | `RESEARCH §7` |
| `src/lib/ai/claude.ts` | `RESEARCH §10` |
| `src/lib/ai/cv-extract.ts` | `RESEARCH §15` |
| `src/lib/inngest/client.ts` | `RESEARCH §8` |
| `src/lib/inngest/functions/parse-cv.ts` | `RESEARCH §17` |
| `src/lib/supabase/service.ts` | `RESEARCH §10` |
| `src/lib/observability/sentry.ts` | `RESEARCH §6` |
| `sentry.server.config.ts` / `sentry.edge.config.ts` / `sentry.client.config.ts` / `instrumentation.ts` | `RESEARCH §6` |
| `src/app/api/inngest/route.ts` | `RESEARCH §8` |
| `src/components/app/pipeline-board.tsx` | UI-SPEC §4 + `RESEARCH` (no direct section; dnd-kit usage is well-documented, planner consults dnd-kit docs) |
| `supabase/migrations/<ts>_cross_tenant_fk_guards.sql` | `RESEARCH §3` |
| `supabase/migrations/<ts>_storage_cvs_bucket.sql` | `RESEARCH §4` |
| `supabase/migrations/<ts>_search_indexes.sql` | `RESEARCH §13` |
| `supabase/migrations/<ts>_search_candidates_rpc.sql` | `RESEARCH §13` |
| `vitest.config.ts` / `playwright.config.ts` | Standard config (no project analog) |

---

## Disagreements between sources and the resolution

| Source A | Source B | Conflict | Resolution |
|----------|----------|----------|-----------|
| UI-SPEC names components `CandidateTable.tsx` (PascalCase file) | CONVENTIONS line 8 + every existing file uses kebab-case `.tsx` for route-colocated component files (e.g., `sign-in-form.tsx`) | filename casing | **Kebab-case filenames everywhere** (`candidate-table.tsx`). Component name (export identifier) stays PascalCase (`export function CandidateTable`). CONVENTIONS wins. |
| Existing `src/components/ui/label.tsx:10` uses `font-medium` | UI-SPEC Typography rule forbids `font-medium` | weight choice | Leave shadcn-generated `label.tsx` as is (don't hand-edit shadcn upstream output). Do NOT propagate `font-medium` to any new code. |
| RESEARCH §11 uses `'use client'` form with `useState` for status | Existing `sign-in-form.tsx` uses discriminated union `Status` | client state shape | New forms (Tasks 3+) use react-hook-form per CLAUDE.md mandate. The discriminated `Status` union remains valid for one-off client UI without form fields (e.g., a save-note button). |
| `src/proxy.ts` exists as middleware | CONCERNS.md "src/proxy.ts as Middleware Entry Point" warns Next.js doesn't load it | middleware path | Plan 0 task 1: rename to `src/middleware.ts` (RESEARCH §1). |
| `src/types/database.ts` has `// @ts-nocheck` | CONVENTIONS / CLAUDE.md require strict types | type safety | Plan 0: regenerate via `pnpm db:types`, hand-delete `@ts-nocheck` (RESEARCH §5). |

---

## Highest-leverage patterns (TL;DR for the planner)

1. **Every list page = async RSC + `await searchParams` + `listX(supabase, ...)` from `src/lib/db/*` + table component**. Same shape for `/candidates`, `/clients`, `/jobs`. Drop-in via `RESEARCH §14`.
2. **Every form = react-hook-form + zod schema + shadcn `<Form>` + Server Action that re-validates with the same schema and returns `{ok, fieldErrors | formError}`**. Schema co-located in `schema.ts`. `RESEARCH §11`.
3. **Every db helper returns `DbResult<T>` and starts with `import 'server-only'`. No inline `.from()` in route files ever.** `RESEARCH §9`.
4. **All Claude calls go through `src/lib/ai/claude.ts` which logs to `record_ai_usage` on every call**. Tool-use with `tool_choice` for structured output. `RESEARCH §10`.
5. **All long-running AI work runs in Inngest with 4-step shape (download → extract → claude → write); each step idempotent; service-role client because no auth context inside functions; storage path validated against tenant boundary as defence in depth**. `RESEARCH §17`.
6. **Filenames kebab-case, component names PascalCase, two font weights (400/600), aria-label on every icon-only interactive element, no `font-medium`/`font-bold`** — `CONVENTIONS.md` + UI-SPEC.

---

*Phase 1 patterns mapped: 2026-05-17. Total file rows: ~70. Conflicts resolved: 5.*
