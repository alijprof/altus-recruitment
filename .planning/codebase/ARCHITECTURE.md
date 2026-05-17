<!-- refreshed: 2026-05-17 -->
# Architecture

**Analysis Date:** 2026-05-17

## System Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│                    Browser / Client Layer                         │
│  Client Components ("use client") — auth forms, sign-out button  │
│  `src/app/(auth)/sign-in/sign-in-form.tsx`                       │
│  `src/app/(auth)/sign-up/sign-up-form.tsx`                       │
│  `src/components/app/sign-out-button.tsx`                        │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP / RSC streaming
┌────────────────────────▼─────────────────────────────────────────┐
│               Next.js App Router — Server Layer                   │
├──────────────────┬───────────────────┬───────────────────────────┤
│  Route Group     │  Route Group      │  Route Handler             │
│  (auth)          │  (app)            │  /auth/callback            │
│  sign-in/up pages│  dashboard, CRM   │  `src/app/auth/callback/   │
│  `src/app/(auth)`│  `src/app/(app)`  │   route.ts`               │
└──────────────────┴─────────┬─────────┴───────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                    Middleware Layer                                │
│  Session refresh + auth guard on every request                    │
│  `src/proxy.ts` → `src/lib/supabase/middleware.ts`               │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                 Supabase Client Abstraction                        │
│  Server (RSC / route handlers): `src/lib/supabase/server.ts`     │
│  Client (browser components): `src/lib/supabase/client.ts`       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│              Supabase / Postgres (managed)                        │
│  RLS on every domain table via current_organization_id()          │
│  pgvector halfvec(1024) for embeddings                            │
│  pg_trgm for keyword search indexes                               │
│  Security-definer functions: record_audit(), record_ai_usage()   │
└──────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root layout | HTML shell, fonts, global styles | `src/app/layout.tsx` |
| Auth layout | Centered card wrapper for sign-in/up | `src/app/(auth)/layout.tsx` |
| App layout | Auth guard, profile/org fetch, TopNav | `src/app/(app)/layout.tsx` |
| Middleware (proxy) | Session refresh, redirect unauthenticated requests | `src/proxy.ts` |
| Supabase server client | Typed SSR client for RSC and route handlers | `src/lib/supabase/server.ts` |
| Supabase browser client | Typed browser client for Client Components | `src/lib/supabase/client.ts` |
| Auth callback route | PKCE code exchange after magic-link click | `src/app/auth/callback/route.ts` |
| Database types | Generated `Database` type + helper generics | `src/types/database.ts` |
| TopNav | Navigation and org/user display | `src/components/app/top-nav.tsx` |
| SignOutButton | Client-side sign-out + redirect | `src/components/app/sign-out-button.tsx` |
| SignInForm | Magic-link OTP form (existing users only) | `src/app/(auth)/sign-in/sign-in-form.tsx` |
| SignUpForm | Magic-link OTP + org creation trigger | `src/app/(auth)/sign-up/sign-up-form.tsx` |
| `cn` utility | Tailwind class merging helper | `src/lib/utils.ts` |

## Pattern Overview

**Overall:** Next.js App Router with React Server Components as the default. Supabase handles auth, database, and file storage. Multi-tenancy is enforced at the database layer via PostgreSQL Row-Level Security rather than at the application layer.

**Key Characteristics:**
- Server Components (RSC) are the default; `"use client"` is added only when browser APIs or React state are needed
- Mutations will use Server Actions; only webhooks/public APIs use route handlers
- Every database query is tenant-scoped automatically by RLS — the app never manually appends `organization_id` filters
- Auth guard runs in two places: middleware (fast redirect) and `(app)` layout (defence in depth)
- TypeScript strict mode throughout; `Database` type from `src/types/database.ts` is threaded into both Supabase clients for end-to-end type safety

## Layers

**UI Layer (React Server Components + Client Components):**
- Purpose: Render pages, handle user interactions
- Location: `src/app/`, `src/components/`
- Contains: Route pages (`page.tsx`), layouts (`layout.tsx`), shared components
- Depends on: Supabase client abstraction, shared types
- Used by: Browser / Next.js renderer

**Middleware Layer:**
- Purpose: Intercept every request to refresh the Supabase session and redirect unauthenticated users
- Location: `src/proxy.ts`, `src/lib/supabase/middleware.ts`
- Contains: `updateSession()` function, public path allowlist
- Depends on: `@supabase/ssr` createServerClient
- Used by: Next.js edge runtime on every matched request

**Supabase Client Abstraction:**
- Purpose: Provide a single, typed, cookie-aware Supabase client for each execution context
- Location: `src/lib/supabase/server.ts` (RSC/route handlers), `src/lib/supabase/client.ts` (browser)
- Contains: `createClient()` factory in each file — same name, different import path
- Depends on: `@supabase/ssr`, `src/types/database.ts`
- Used by: All components and route handlers that query Supabase

**Database Layer (Supabase/Postgres):**
- Purpose: Store all application data, enforce multi-tenancy, provide auth
- Location: `supabase/migrations/`
- Contains: Schema, RLS policies, triggers, security-definer functions
- Depends on: pgvector, pg_trgm extensions
- Used by: Supabase client abstraction

**AI Layer (planned, not yet implemented):**
- Purpose: Wrap Claude API calls with typed interface, model selection, cost logging
- Planned location: `src/lib/ai/` (not yet created)
- Will contain: `claude.ts` wrapper, `voyage.ts` embedding client, `whisper.ts` transcription
- Must log all calls to `ai_usage` via `record_ai_usage()` DB function

**Background Jobs Layer (planned, not yet implemented):**
- Purpose: Handle long-running AI tasks (CV parsing, embedding, batch matching) outside HTTP request cycle
- Planned location: `src/inngest/` or similar (not yet created)
- Will contain: Inngest function definitions

## Data Flow

### Authentication — Sign Up

1. User submits `SignUpForm` (`src/app/(auth)/sign-up/sign-up-form.tsx`) with email, name, org name
2. Browser Supabase client (`src/lib/supabase/client.ts`) calls `signInWithOtp` with `shouldCreateUser: true` and `data: { full_name, organization_name }`
3. Supabase emails a magic link; user clicks it → redirected to `/auth/callback?code=...`
4. Route handler (`src/app/auth/callback/route.ts`) calls `exchangeCodeForSession(code)`
5. Supabase triggers `handle_new_user()` DB function which creates `organizations` + `users` rows
6. User is redirected to `/?next=/` (authenticated)

### Authentication — Sign In (Existing User)

1. User submits `SignInForm` (`src/app/(auth)/sign-in/sign-in-form.tsx`) with email
2. Browser client calls `signInWithOtp` with `shouldCreateUser: false`
3. Magic link email sent; user clicks → `/auth/callback?code=...`
4. Route handler exchanges code for session, redirects to app

### Authenticated Page Request

1. Request hits middleware (`src/proxy.ts` → `src/lib/supabase/middleware.ts`)
2. `updateSession()` refreshes the Supabase session token in cookies
3. If no authenticated user and path is not in `PUBLIC_PATHS`, redirect to `/sign-in`
4. Request reaches `(app)` layout (`src/app/(app)/layout.tsx`)
5. Server Supabase client (`src/lib/supabase/server.ts`) fetches user profile + org name
6. Layout renders `TopNav` with user/org context, then `{children}` (the page RSC)
7. Each page RSC may call `createClient()` directly to query domain data — all queries are automatically scoped to the user's org by RLS

**State Management:**
- No global client state store. Server state is fetched fresh on each RSC render.
- Client-side local state (forms) uses `useState` in Client Components only.
- Session state is held in HTTP-only cookies, managed by Supabase + middleware.

## Key Abstractions

**`createClient()` — Dual-Context Supabase Factory:**
- Purpose: Provide a typed `SupabaseClient<Database>` appropriate for the execution context
- Server: `src/lib/supabase/server.ts` — async, reads/writes cookies via `next/headers`
- Client: `src/lib/supabase/client.ts` — sync, uses `createBrowserClient`
- Pattern: Import from the correct path; both export `createClient` with the same signature
- The `Database` type from `src/types/database.ts` provides full type inference on all queries

**`Database` Type:**
- Purpose: Auto-generated TypeScript representation of the full Postgres schema
- Location: `src/types/database.ts`
- Contains: `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>`, `Enums<T>` helper types
- Pattern: Use `Tables<'candidates'>` not raw object types when typing DB row results

**`current_organization_id()` DB Function:**
- Purpose: Resolve the current user's `organization_id` from `auth.uid()` — the single RLS primitive
- Location: `supabase/migrations/20260513151021_init_organizations_and_users.sql`
- Declared `SECURITY DEFINER` to read `public.users` without recursive RLS
- All tenant RLS policies are of the form: `using (organization_id = public.current_organization_id())`

**`record_audit()` / `record_ai_usage()` Security-Definer Functions:**
- Purpose: Controlled write paths for audit_log and ai_usage that prevent client forgery
- Location: `supabase/migrations/20260513152244_phase1_domain_schema.sql`
- `record_audit()`: callable by `authenticated` role; auto-reads org from session context
- `record_ai_usage()`: callable by `service_role` only (background jobs via Inngest)

## Entry Points

**Next.js Middleware:**
- Location: `src/proxy.ts` (Next.js looks for `middleware.ts` at root; this file re-exports from `src/`)
- Triggers: Every request matching the path pattern (excludes static assets)
- Responsibilities: Session refresh, auth redirect

**Root Layout:**
- Location: `src/app/layout.tsx`
- Triggers: All page renders
- Responsibilities: HTML shell, fonts, `<body>` wrapper

**App Layout (authenticated shell):**
- Location: `src/app/(app)/layout.tsx`
- Triggers: All routes under `(app)` route group
- Responsibilities: Secondary auth check, profile/org fetch, TopNav injection

**Auth Callback Route Handler:**
- Location: `src/app/auth/callback/route.ts`
- Triggers: GET request after magic-link click
- Responsibilities: PKCE code exchange, session creation, redirect

## Architectural Constraints

- **Rendering model:** Server Components by default. Client Components only when browser APIs, event handlers, or `useState`/`useEffect` are needed. Never fetch data in a Client Component when a Server Component parent can pass it as props.
- **Mutations:** Use Next.js Server Actions for all data mutations. Route handlers are reserved for webhooks and public/external APIs.
- **AI calls:** Never call Claude/Voyage/Whisper synchronously inside an HTTP request handler if latency could exceed ~2 seconds. Use Inngest background jobs.
- **RLS is the authority on tenancy:** Never manually filter by `organization_id` in application code as a primary security control. Trust RLS. Application-level org filters are for performance (index hints), not security.
- **No RLS bypass:** Never use service role key in client-side code. Service role is only for Inngest background jobs.
- **Global state:** No module-level singletons. `createClient()` is called fresh per request.
- **Circular imports:** None detected in current codebase.
- **Migrations append-only:** Never edit a committed migration file. Add a new migration to fix schema issues.
- **`@ts-nocheck` in `database.ts`:** The generated types file has `// @ts-nocheck` at the top. This is intentional — do not remove it or add `// reason:` comments inside it. Regenerate this file from Supabase CLI when schema changes.

## Anti-Patterns

### Calling `createClient()` from `src/lib/supabase/server.ts` in a Client Component

**What happens:** Importing the server client into a `"use client"` file causes a build error because `next/headers` is not available in the browser bundle.
**Why it's wrong:** The two clients are context-specific. Using the wrong one causes runtime or build failures.
**Do this instead:** Import from `@/lib/supabase/client` in any file with `"use client"`. Import from `@/lib/supabase/server` in Server Components, layouts, and route handlers.

### Manually appending `organization_id` to every query as a security control

**What happens:** Developer adds `.eq('organization_id', orgId)` to every Supabase query as an explicit tenant filter.
**Why it's wrong:** It's redundant with RLS (double-work), and creates a security gap if any query is missed. It also leaks tenant resolution logic throughout the codebase.
**Do this instead:** Trust RLS. The `current_organization_id()` function handles scoping at the DB layer. Add `.eq('organization_id', ...)` only when needed as a performance hint for index coverage.

### Making synchronous AI calls from route handlers or Server Actions

**What happens:** A route handler awaits a Claude API call that takes 3–15 seconds, holding the HTTP connection open.
**Why it's wrong:** Vercel serverless functions have execution limits; long-held connections degrade UX and waste compute budget.
**Do this instead:** Dispatch an Inngest event from the Server Action, return immediately, and update the UI via optimistic state or polling/webhooks.

## Error Handling

**Strategy:** Graceful degradation — AI failures must not break core CRM functionality.

**Patterns:**
- User-facing errors: Next.js error boundaries + sonner toast (to be implemented)
- Server errors: Sentry with `org_id` + `user_id` context — never log PII (CV text, candidate email)
- Auth errors: Redirect to `/auth/auth-code-error` for PKCE failures (`src/app/auth/auth-code-error/page.tsx`)
- AI errors: Display "AI temporarily unavailable" message; underlying data remains accessible

## Cross-Cutting Concerns

**Logging:** Sentry for errors (with org/user context). PostHog for product analytics. Never log PII.
**Audit:** All candidate data access must call `record_audit()` DB function. This is non-negotiable for GDPR compliance.
**AI cost tracking:** Every Claude/Voyage call must log to `ai_usage` via `record_ai_usage()` for per-tenant cost visibility.
**Validation:** Input validation at the Server Action / route handler layer before DB writes. Zod is the planned validator (not yet added).
**Authentication:** Supabase Auth with magic-link OTP. Session managed via HTTP-only cookies. Auth guard in middleware + `(app)` layout.

---

*Architecture analysis: 2026-05-17*
