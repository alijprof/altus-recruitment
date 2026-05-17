# Codebase Structure

**Analysis Date:** 2026-05-17

## Directory Layout

```
altus-recruitment/
├── src/
│   ├── app/                            # Next.js App Router
│   │   ├── layout.tsx                  # Root layout (HTML shell, fonts)
│   │   ├── globals.css                 # Global Tailwind CSS
│   │   ├── favicon.ico
│   │   ├── (auth)/                     # Route group: unauthenticated pages
│   │   │   ├── layout.tsx              # Centered card layout for auth pages
│   │   │   ├── sign-in/
│   │   │   │   ├── page.tsx            # Sign-in RSC shell
│   │   │   │   └── sign-in-form.tsx    # Client Component: OTP form
│   │   │   └── sign-up/
│   │   │       ├── page.tsx            # Sign-up RSC shell
│   │   │       └── sign-up-form.tsx    # Client Component: OTP + org creation form
│   │   ├── (app)/                      # Route group: authenticated CRM app
│   │   │   ├── layout.tsx              # Auth guard + TopNav + page wrapper
│   │   │   ├── page.tsx                # Dashboard (stub — Task 7)
│   │   │   ├── candidates/
│   │   │   │   └── page.tsx            # Candidates list (stub — Task 3)
│   │   │   ├── clients/
│   │   │   │   └── page.tsx            # Clients list (stub — Task 5)
│   │   │   ├── jobs/
│   │   │   │   └── page.tsx            # Jobs list (stub — Task 6)
│   │   │   ├── pipeline/
│   │   │   │   └── page.tsx            # Pipeline board (stub)
│   │   │   └── settings/
│   │   │       └── page.tsx            # Settings (stub)
│   │   └── auth/                       # Auth utility routes (no route group)
│   │       ├── callback/
│   │       │   └── route.ts            # PKCE code exchange route handler
│   │       └── auth-code-error/
│   │           └── page.tsx            # Auth error page
│   ├── components/
│   │   ├── app/                        # Shared app-specific components
│   │   │   ├── top-nav.tsx             # Global navigation bar (RSC)
│   │   │   └── sign-out-button.tsx     # Sign-out Client Component
│   │   └── ui/                         # shadcn/ui primitive components
│   │       ├── button.tsx
│   │       ├── input.tsx
│   │       └── label.tsx
│   ├── lib/
│   │   ├── supabase/                   # Supabase client factories
│   │   │   ├── server.ts               # Server-side (RSC + route handlers)
│   │   │   ├── client.ts               # Browser-side (Client Components)
│   │   │   └── middleware.ts           # Session refresh for middleware
│   │   ├── ai/                         # AI wrappers (planned, not yet created)
│   │   │   └── (claude.ts, voyage.ts, whisper.ts — to be added in Phase 2)
│   │   ├── db/                         # Typed query helpers (planned, not yet created)
│   │   └── utils.ts                    # Shared utilities (cn() for Tailwind merging)
│   ├── types/
│   │   └── database.ts                 # Generated Supabase types (regenerate from CLI)
│   └── proxy.ts                        # Next.js middleware entry point
├── supabase/
│   ├── migrations/
│   │   ├── 20260513151021_init_organizations_and_users.sql  # Orgs, users, RLS, handle_new_user trigger
│   │   └── 20260513152244_phase1_domain_schema.sql          # Full domain schema + RLS
│   ├── config.toml                     # Supabase CLI config
│   └── seed.sql                        # Seed data (if present)
├── docs/
│   ├── plan.md                         # Strategic plan + full spec
│   ├── phase-1-tasks.md                # Phase 1 task breakdown
│   ├── ai-integration.md               # AI patterns + model selection guide
│   └── recruitment-glossary.md         # Domain term definitions
├── public/                             # Static assets
├── .planning/
│   └── codebase/                       # GSD codebase map documents
├── CLAUDE.md                           # Project context + conventions (read every session)
├── AGENTS.md                           # Agent configuration
├── components.json                     # shadcn/ui configuration
├── next.config.ts                      # Next.js config
├── tsconfig.json                       # TypeScript strict config, `@/*` alias
├── eslint.config.mjs                   # ESLint config
├── postcss.config.mjs                  # PostCSS (Tailwind v4)
├── package.json                        # Dependencies + scripts
├── pnpm-lock.yaml                      # Lockfile
└── pnpm-workspace.yaml                 # pnpm workspace config
```

## Directory Purposes

**`src/app/(auth)/`:**
- Purpose: Unauthenticated pages (sign-in, sign-up). Route group bracket means `(auth)` does not appear in the URL.
- Contains: Centered layout, sign-in page + form, sign-up page + form
- Key files: `src/app/(auth)/layout.tsx`, `src/app/(auth)/sign-in/sign-in-form.tsx`

**`src/app/(app)/`:**
- Purpose: All authenticated CRM pages. Route group bracket means `(app)` does not appear in the URL.
- Contains: Auth-guarded layout with TopNav, all CRM route pages
- Key files: `src/app/(app)/layout.tsx` (auth guard + org context fetch)

**`src/app/auth/`:**
- Purpose: Auth utility routes that are neither part of the user-facing auth flow nor the CRM. Not in a route group because the `/auth/` URL prefix is intentional.
- Contains: PKCE callback route handler, auth error page
- Key files: `src/app/auth/callback/route.ts`

**`src/components/app/`:**
- Purpose: Shared CRM application components used across multiple routes. Lifted here when they don't belong to a single route.
- Contains: `TopNav`, `SignOutButton`
- Rule: Route-specific components live co-located with their route page, not here.

**`src/components/ui/`:**
- Purpose: shadcn/ui primitive components. Generated/copied from shadcn CLI. Treat as vendor code — minimal modification.
- Contains: `button.tsx`, `input.tsx`, `label.tsx` (more added as needed)
- Key file: `components.json` at repo root configures shadcn

**`src/lib/supabase/`:**
- Purpose: The only place Supabase clients are instantiated. All other code imports from here.
- Contains: `server.ts` (async, cookie-aware, for RSC), `client.ts` (sync, browser), `middleware.ts` (session refresh)
- Rule: Never instantiate `createBrowserClient` or `createServerClient` outside this directory.

**`src/lib/ai/` (planned):**
- Purpose: Typed wrappers for all external AI APIs. All Claude calls must go through `claude.ts`.
- Planned files: `claude.ts` (model selection, retries, token logging), `voyage.ts` (embedding), `whisper.ts` (transcription)
- Rule: Never import `@anthropic-ai/sdk` directly outside this directory.

**`src/lib/db/` (planned):**
- Purpose: Typed query helper functions for domain entities. Avoid scattering raw Supabase queries across page components.
- Planned pattern: `getCandidates(supabase, filters)`, `getJob(supabase, id)`, etc.

**`src/types/`:**
- Purpose: Shared TypeScript types. `database.ts` is auto-generated by Supabase CLI — do not hand-edit.
- Key file: `src/types/database.ts` — source of truth for all DB row types via `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>`, `Enums<T>`

**`supabase/migrations/`:**
- Purpose: Append-only SQL migrations. Each file is timestamped and applied in order.
- Generated: No (hand-written)
- Committed: Yes
- Rule: Never edit a committed migration. Add a new numbered file for any schema fix.

## Key File Locations

**Entry Points:**
- `src/proxy.ts`: Next.js middleware — runs on every matched request
- `src/app/layout.tsx`: Root HTML layout
- `src/app/(app)/layout.tsx`: Authenticated app shell (auth guard lives here)
- `src/app/auth/callback/route.ts`: Magic-link PKCE exchange

**Configuration:**
- `tsconfig.json`: TypeScript strict mode, `@/*` path alias mapping to `./src/*`
- `components.json`: shadcn/ui component configuration
- `eslint.config.mjs`: ESLint rules (extends Next.js + Prettier)
- `supabase/config.toml`: Supabase CLI project configuration

**Core Library:**
- `src/lib/supabase/server.ts`: Server Supabase client (use in RSC, layouts, route handlers, Server Actions)
- `src/lib/supabase/client.ts`: Browser Supabase client (use in `"use client"` components)
- `src/lib/supabase/middleware.ts`: Session refresh logic
- `src/lib/utils.ts`: `cn()` Tailwind class merge helper

**Types:**
- `src/types/database.ts`: Full DB type tree — regenerated via `supabase gen types`

**Database:**
- `supabase/migrations/20260513151021_init_organizations_and_users.sql`: Foundation — orgs, users, `current_organization_id()`, `handle_new_user()` trigger
- `supabase/migrations/20260513152244_phase1_domain_schema.sql`: Full domain schema — companies, contacts, candidates, CVs, jobs, applications, activities, audit_log, ai_usage + all RLS

**Documentation:**
- `CLAUDE.md`: Primary context file for AI coding sessions — read every session
- `docs/plan.md`: Strategic product plan and full feature spec
- `docs/phase-1-tasks.md`: Current phase task breakdown with implementation details

## Naming Conventions

**Files:**
- Route pages: `page.tsx` (Next.js convention)
- Route layouts: `layout.tsx` (Next.js convention)
- Route handlers (API): `route.ts` (Next.js convention)
- Component files: PascalCase matching the exported component name, e.g. `TopNav` → `top-nav.tsx` (kebab-case file, PascalCase export)
- Library/utility files: kebab-case, e.g. `server.ts`, `middleware.ts`, `utils.ts`
- Co-located Client Component forms: kebab-case alongside their page, e.g. `sign-in-form.tsx`

**Directories:**
- Route groups: `(group-name)` — lowercase with hyphens
- Feature routes: lowercase, e.g. `candidates/`, `sign-in/`
- Library subdirectories: lowercase, e.g. `supabase/`, `ai/`, `db/`
- Component categories: lowercase, e.g. `ui/`, `app/`

**Components (exports):**
- PascalCase: `TopNav`, `SignInForm`, `SignOutButton`, `Button`

**Functions:**
- camelCase verbs: `createClient`, `updateSession`, `handleNewUser`
- DB query helpers (planned): `createCandidate`, `getJob`, `listCandidates`

**Database:**
- Tables and columns: snake_case — `organization_id`, `full_name`, `created_at`
- Enums: lowercase snake_case — `market_status`, `job_type`, `user_role`
- Enum values: lowercase snake_case — `actively_looking`, `cv_submitted`

**TypeScript path alias:**
- `@/*` maps to `src/*` — use for all imports, e.g. `@/lib/supabase/server`, `@/types/database`

## Where to Add New Code

**New CRM page (authenticated):**
- Route page: `src/app/(app)/{feature}/page.tsx`
- Route-specific sub-components: `src/app/(app)/{feature}/{ComponentName}.tsx`
- If component is shared across multiple routes: `src/components/app/{component-name}.tsx`

**New feature with data fetching:**
- Query logic: `src/lib/db/{feature}.ts` (create this directory when adding first query helpers)
- Types: Derived from `Tables<'table_name'>` in `src/types/database.ts` — no separate type file needed for DB row shapes

**New Server Action:**
- Co-locate with the feature route: `src/app/(app)/{feature}/actions.ts`
- Import server Supabase client from `@/lib/supabase/server`

**New route handler (webhook or public API):**
- Location: `src/app/api/{endpoint}/route.ts`

**New shadcn/ui component:**
- Run: `pnpm dlx shadcn@latest add {component}`
- Output: `src/components/ui/{component}.tsx` (auto-generated, do not hand-edit)

**New AI wrapper function:**
- Location: `src/lib/ai/claude.ts` (or `voyage.ts`, `whisper.ts`)
- Must: log usage to `ai_usage` via `record_ai_usage()` DB function
- Must: use typed tool use for structured Claude outputs, not free-text parsing

**New Inngest background job:**
- Location: `src/inngest/{job-name}.ts` (create directory when first job is added)
- Triggered from: Server Actions or route handlers via `inngest.send()`

**New SQL migration:**
- Location: `supabase/migrations/{timestamp}_{description}.sql`
- Generate timestamp with: `date +%Y%m%d%H%M%S`
- After writing: regenerate types with `supabase gen types typescript --local > src/types/database.ts`

**Shared utility:**
- Location: `src/lib/utils.ts` for generic utilities
- Or create `src/lib/{domain}.ts` for domain-specific helpers (e.g. `src/lib/currency.ts`)

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Generated: By `/gsd:map-codebase` command
- Committed: Yes

**`supabase/.temp/`:**
- Purpose: Supabase CLI temporary files
- Generated: Yes
- Committed: No (gitignored)

**`.next/`:**
- Purpose: Next.js build output and cache
- Generated: Yes
- Committed: No (gitignored)

**`node_modules/`:**
- Purpose: pnpm package dependencies
- Generated: Yes (via `pnpm install`)
- Committed: No (gitignored)

---

*Structure analysis: 2026-05-17*
