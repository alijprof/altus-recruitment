# CLAUDE.md

This file is the context you (Claude Code) read before any work. Read it fully every session. Also read `docs/plan.md` and `docs/phase-1-tasks.md` if they exist.

## What this project is

An AI-first recruitment CRM built as a multi-tenant SaaS. Anchor customer is a 2–3 person UK recruitment agency replacing Firefish. Strategic intent: anchor customer becomes the proof-of-concept for selling the product to other agencies.

The build is part-time, solo, and competes with established incumbents (Firefish, Bullhorn, Vincere). Velocity matters. So does code quality — the product needs to be robust enough that the anchor customer's eventual sale isn't penalised by buyer perception of bespoke risk.

## Core principles

1. **AI-first, not bolted-on.** Every feature should consider where AI changes the workflow. CV parsing, semantic search, match scoring with explanations, voice-to-data, conversation summarisation are core, not optional.
2. **Multi-tenant from day 1.** Every domain table has `organization_id`. Row-Level Security enforces isolation. Never write a query that bypasses tenant scoping.
3. **Standard Postgres.** No exotic extensions beyond pgvector. Schema must export cleanly. This protects both the anchor's exit and SaaS customers' data portability.
4. **Cache AI outputs aggressively.** Regenerate only on material change. Track cost per tenant.
5. **Audit-ready by default.** Every access to candidate data is logged. Every consent has a timestamp + basis. Compliance is foundational, not retrofitted.

## Tech stack — these are decided, don't re-litigate

- **Frontend**: Next.js 15 (App Router), TypeScript strict mode, React Server Components by default
- **UI**: shadcn/ui components, Tailwind CSS, lucide-react icons
- **Backend**: Next.js route handlers + server actions, Supabase client
- **Database**: Supabase (managed Postgres) with extensions: `pgvector`, `pg_trgm`
- **Auth**: Supabase Auth (email + magic link, Google OAuth later)
- **File storage**: Supabase Storage (CVs, documents)
- **AI**: Anthropic Claude API
  - `claude-haiku-4-5-20251001` for high-volume parsing/classification
  - `claude-sonnet-4-6` for matching, writing, summarisation (default)
  - `claude-opus-4-7` only for complex multi-step reasoning — must be justified
- **Embeddings**: Voyage AI (`voyage-3`) via REST API, stored in pgvector
- **Voice transcription**: OpenAI Whisper API
- **Background jobs**: Inngest (preferred — better DX) or Trigger.dev
- **Billing** (Phase 5): Stripe
- **Email**: Resend
- **Hosting**: Vercel (frontend) + Supabase (everything else)
- **Observability**: Sentry + PostHog
- **Package manager**: pnpm
- **Tests**: Vitest for unit, Playwright for E2E

## Repository structure

```
/
├── CLAUDE.md                    # This file
├── README.md                    # Human-facing project intro
├── docs/
│   ├── plan.md                  # Strategic plan, full spec
│   ├── phase-1-tasks.md         # Current phase task breakdown
│   ├── ai-integration.md        # AI patterns + model selection
│   └── recruitment-glossary.md  # Domain terms
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── (auth)/              # Sign-in, sign-up
│   │   ├── (app)/               # Authenticated app
│   │   │   ├── candidates/
│   │   │   ├── clients/
│   │   │   ├── jobs/
│   │   │   ├── pipeline/
│   │   │   └── settings/
│   │   ├── (public)/            # Apply form, candidate self-service
│   │   └── api/                 # Route handlers, webhooks
│   ├── components/              # Shared components (ui/ for shadcn, app/ for ours)
│   ├── lib/
│   │   ├── supabase/            # Server + client + middleware
│   │   ├── ai/                  # Claude, Voyage, Whisper wrappers
│   │   ├── db/                  # Typed queries
│   │   └── auth/                # Auth helpers
│   ├── types/                   # Shared TS types (also generated from Supabase)
│   └── styles/
├── supabase/
│   ├── migrations/              # SQL migrations
│   ├── seed.sql
│   └── config.toml
├── tests/
├── .env.example
├── package.json
└── tsconfig.json
```

## Conventions

### Code style
- TypeScript strict mode, no `any` without a `// reason: ...` comment
- ESLint + Prettier (defaults except: single quotes, no semicolons, 2-space indent)
- Server Components default; Client Components (`"use client"`) only when interactivity required
- Server Actions for mutations, route handlers only for webhooks/public APIs
- Co-locate components with routes when they're route-specific; lift to `/components/app/` when shared

### Database
- Snake_case for tables and columns
- Every table: `id` (uuid, default gen_random_uuid()), `created_at`, `updated_at`
- Every tenant-scoped table: `organization_id uuid not null references organizations(id)`
- RLS enabled on every domain table; policies use `auth.uid()` and a helper `current_organization_id()`
- Migrations are append-only — never edit a committed migration; add a new one to fix issues
- Use `pgvector` `halfvec(1024)` for Voyage embeddings (halfvec halves storage cost, negligible quality loss)

### Naming
- Components: PascalCase
- Files: kebab-case except component files (PascalCase.tsx)
- Functions: camelCase, verbs (`createCandidate`, not `candidateCreator`)
- Types: PascalCase, no `I` prefix
- DB enums in lowercase snake_case

### AI integration patterns
- All Claude calls go through `src/lib/ai/claude.ts` — a typed wrapper that handles model selection, retries, error normalisation, token logging
- Cost is logged per tenant per call to a `ai_usage` table (org_id, model, input_tokens, output_tokens, purpose, created_at). This is non-negotiable — we need per-tenant cost visibility for SaaS pricing decisions.
- Long-running AI tasks (CV parsing, embedding, batch matching) run in Inngest, not synchronously
- Always cache AI outputs in `ai_summaries` or feature-specific tables. Regenerate only when source data has materially changed.
- For structured outputs from Claude, use tool use with a JSON schema. Don't parse free text.
- Voyage embeddings: only re-embed when CV is updated or job description materially changes. Track `embedding_version` and `embedded_at` on the row.

### Error handling
- User-facing errors via Next.js error boundaries + toast (sonner)
- Server errors logged to Sentry with org_id + user_id context (NEVER log PII like CV text or candidate emails to Sentry)
- AI errors degrade gracefully — if Claude is down, the feature shows "AI temporarily unavailable" but the rest of the app works

### Tests
- Unit tests for `lib/` utilities (especially AI parsing logic, RLS policy logic, fee calculations)
- E2E tests with Playwright for critical flows: sign up, create candidate from CV, search, create job, move through pipeline
- Don't write tests for trivial CRUD — focus on logic that's easy to get wrong

## What "AI-integrated" means here — and what it doesn't

**It does mean:**
- CV uploads automatically extract structured data via Haiku and embed via Voyage. No human re-typing.
- Candidate search is semantic by default with a keyword fallback. "Senior Python dev with offshore wind experience" works.
- Every match between candidate and job has a Sonnet-generated explanation cached.
- Spec calls can be recorded → transcribed → structured into a job record.
- Voice notes after meetings turn into structured candidate updates + activity log entries.
- Email outreach is per-candidate personalised, not template-fill.

**It does NOT mean:**
- Chatbot UI for everything. Most AI is invisible — it just happens.
- "Ask the CRM anything" as the primary interface. That's a gimmick. Specific AI features at specific moments are better.
- Replacing recruiter judgment. AI scores and suggests; recruiter decides.
- Auto-sending anything without human approval. Recruiters' professional relationships are on the line.

## Recruitment domain glossary

You will encounter these terms. Use them correctly.

- **Candidate**: a person who could be placed in a role
- **Client**: a company that pays for placements
- **Contact**: a person at a client (often the hiring manager)
- **Job / Role / Vacancy**: a position the client wants filled
- **Spec / Spec call**: when a client briefs a job, often verbally
- **Application**: a candidate's progress against a specific job
- **Submission**: the act of sending a candidate's CV to a client for a job
- **Float / Spec CV**: speculative candidate submission without a specific job ("you should meet this person")
- **Shortlist / Hot list**: recruiter's internal working set of candidates for a job, pre-submission
- **Placement**: a candidate successfully starting a role — the revenue event
- **Backfill**: replacement for someone who left (different urgency profile than a new role)
- **RTR (Right to Represent)**: agreement that the agency represents the candidate for a specific role
- **Source**: where the candidate came from (apply form, LinkedIn, referral, etc.)
- **Market status**: actively looking / passively looking / hot (recently made redundant) / placed / cold
- **Perm**: permanent placement, fee = % of first-year salary (typically 15–25%)
- **Temp / Contract**: time-limited placement, agency takes margin between pay rate and charge rate
- **IR35**: UK tax legislation determining contractor status (in/outside IR35)
- **Day rate**: contractor daily charge rate
- **Pay rate**: what the contractor receives
- **Charge rate**: what the client pays
- **Margin**: charge rate − pay rate (the agency's revenue per hour)

## What to do when uncertain

- **Database schema changes**: ask before adding a migration. Schema choices compound.
- **New dependencies**: ask before adding anything not already in `package.json`.
- **Multi-tenancy**: if you're not certain a query is tenant-safe, ask. Cross-tenant data leakage is the worst possible bug.
- **AI model choice**: default to Sonnet. Justify Opus. Justify going below Haiku.
- **UX decisions**: if there's a reasonable default from shadcn or the existing app pattern, use it. Otherwise ask.
- **Domain semantics**: if a recruitment term isn't in the glossary and you're guessing, ask.

## What to never do

- Never disable RLS to "make it work for now". Fix the policy.
- Never log CV text, candidate names, or any PII to Sentry or PostHog.
- Never call Claude in a synchronous request handler when it could take >2s. Move to Inngest.
- Never edit a committed migration. Add a new one.
- Never use `any` in TypeScript without an explanatory comment.
- Never auto-send emails to candidates without an approval step.
- Never bypass the typed `src/lib/ai/claude.ts` wrapper for Claude calls.

## Verification before declaring work done

For every task:
1. `pnpm lint` passes
2. `pnpm typecheck` passes
3. Relevant tests pass (`pnpm test`)
4. Manual check: open the feature in the app and verify it works end-to-end
5. If schema changed: migration applies cleanly to a fresh DB
6. If AI-touching: cost logged to `ai_usage`

## Working style

- Plan before coding for non-trivial work. Write a short plan as a comment or in the chat before generating code.
- Small commits with descriptive messages.
- When a task's scope creeps, stop and surface it rather than ballooning.
- If you're 70% sure of an architectural decision and 30% unsure, ask.
- Match the existing codebase's patterns rather than introducing new ones unless the existing pattern is genuinely wrong (and say why).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Altus — AI-First Recruitment CRM**

A multi-tenant SaaS recruitment CRM for UK recruitment agencies, replacing tools like Firefish. AI is the spine: CV parsing, semantic search, match-scoring with explanations, voice-to-data, and conversation summarisation are core, not bolted on. Anchor customer is a 2–3 person agency; the product is built so that the same codebase grows into a SaaS offering for other agencies.

**Core Value:** A recruiter can find the right candidate for a job in seconds using natural language — backed by AI parsing of every CV, semantic search across the database, and Sonnet-generated match explanations — instead of digging through static keyword lists and tribal knowledge.

### Constraints

- **Tech stack**: Next.js 15 App Router + TypeScript strict + Supabase (Postgres + Auth + Storage + pgvector + pg_trgm) + shadcn/ui + Tailwind — Decided in plan; do not re-litigate
- **AI provider**: Anthropic Claude (Haiku for parsing, Sonnet default, Opus only when justified). Voyage AI for embeddings. OpenAI Whisper for transcription — Cost-optimised model selection per task
- **Multi-tenancy**: Every domain table has `organization_id` with RLS — Cross-tenant leakage is the worst possible bug
- **Standard Postgres**: No exotic extensions beyond `pgvector` and `pg_trgm` — Schema must export cleanly for anchor's exit and SaaS customers' portability
- **Audit-ready**: Every read of candidate detail logs to `audit_log`; every consent has timestamp + basis — Compliance is foundational, not retrofitted
- **AI cost visibility**: Every Claude call logs tokens + cost to `ai_usage` per tenant — Required for SaaS pricing decisions
- **Hosting**: Vercel (frontend) + Supabase (everything else); Inngest for background jobs — Long-running AI calls (>2s) must not block HTTP handlers
- **Package manager**: pnpm
- **Build velocity**: Solo, part-time; total runway to "ready for customer #2" ~12–14 weeks PT — Phase scope must be sized to fit
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.x (strict mode) - All application code in `src/`
- SQL - Database migrations in `supabase/migrations/`
- JavaScript - Config files (`eslint.config.mjs`, `postcss.config.mjs`)
## Runtime
- Node.js - Managed by pnpm; no `.nvmrc` or `.node-version` present (uses system Node)
- pnpm (workspace-aware)
- Config: `pnpm-workspace.yaml`
- Lockfile: present (`pnpm-lock.yaml`)
## Frameworks
- Next.js 16.2.6 - Full-stack React framework with App Router (`src/app/`)
- React 19.2.4 - UI library
- React DOM 19.2.4 - DOM renderer
- Tailwind CSS 4.x - Utility-first CSS framework
- shadcn/ui - Component library pattern (components in `src/components/ui/`)
- lucide-react 1.14.0 - Icon library
- class-variance-authority 0.7.1 - Variant-based component styling
- clsx 2.1.1 - Conditional class name utility
- tailwind-merge 3.6.0 - Tailwind class conflict resolution
- tw-animate-css 1.4.0 - Animation utilities
- Vitest - Planned for unit tests (not yet installed; referenced in CLAUDE.md)
- Playwright - Planned for E2E tests (not yet installed; referenced in CLAUDE.md)
- `@tailwindcss/postcss` 4.x - PostCSS integration for Tailwind
- Prettier 3.3.3 - Code formatter with `prettier-plugin-tailwindcss` 0.6.8
- ESLint 9.x - Linter
## Key Dependencies
- `@supabase/supabase-js` 2.105.4 - Supabase JS client (database, auth, storage queries)
- `@supabase/ssr` 0.10.3 - Supabase SSR helpers for Next.js (cookie-based auth session management)
- `next` 16.2.6 - Application framework; App Router is the architectural backbone
- `supabase` 2.98.2 (devDependency) - Supabase CLI for local dev, migrations, type generation
- `eslint-config-next` 16.2.6 - Next.js ESLint rules
- `eslint-config-prettier` 9.1.0 - Disables ESLint rules that conflict with Prettier
- Anthropic Claude SDK - AI calls through `src/lib/ai/claude.ts` (wrapper defined in CLAUDE.md, not yet present)
- Voyage AI REST API - Embeddings via REST (no SDK)
- OpenAI SDK (Whisper) - Voice transcription
- Inngest SDK - Background job processing
- Stripe SDK - Billing (Phase 5)
- Resend SDK - Transactional email
- Sentry SDK - Error tracking
- PostHog SDK - Product analytics
- Sonner - Toast notifications
## Configuration
- `strict: true` - Full strict mode enabled
- `noUncheckedIndexedAccess: true` - Extra array/object access safety
- `target: ES2022`
- `moduleResolution: bundler`
- Path alias: `@/*` maps to `./src/*`
- Next.js plugin integrated
- `semi: false` - No semicolons
- `singleQuote: true` - Single quotes
- `tabWidth: 2`
- `trailingComma: "all"`
- `printWidth: 100`
- Plugin: `prettier-plugin-tailwindcss` (auto-sorts Tailwind classes)
- Extends `eslint-config-next/core-web-vitals`
- Extends `eslint-config-next/typescript`
- `eslint-config-prettier` applied last to disable formatting conflicts
- Ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `supabase/**`
- Minimal config; no custom settings currently applied
- `@tailwindcss/postcss` integration for Tailwind v4
- Project ID: `altus-recruitment`
- Postgres major version: 17
- Local API port: 54321, DB port: 54322, Studio port: 54323
- Auth: email/password + magic link; signup enabled; confirmations required
- Storage: enabled, 50 MiB file size limit
- Analytics: disabled
- Connection pooler: disabled (direct connections)
- `pgcrypto` - UUID generation helpers
- `vector` (pgvector) - `halfvec(1024)` columns on `candidates` and `jobs` for Voyage AI embeddings
- `pg_trgm` - GIN trigram indexes for keyword search on `name`, `full_name`, `title` columns
## Platform Requirements
- pnpm (workspace)
- Docker (for `pnpm exec supabase start` local Supabase stack)
- Supabase CLI (`supabase` devDependency)
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Phase 3 Whisper transcription)
- Vercel (Next.js hosting)
- Supabase Cloud (Postgres, Auth, Storage, Realtime)
- Additional services planned: Inngest, Resend, Sentry, PostHog, Stripe
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- React component files: PascalCase with `.tsx` extension — e.g., `SignInForm.tsx`, `TopNav.tsx`, `SignOutButton.tsx`
- Non-component TypeScript files: kebab-case — e.g., `sign-in-form.tsx` for route-colocated components that ARE components, `middleware.ts`, `server.ts`, `client.ts`, `utils.ts`
- Route files follow Next.js conventions: `page.tsx`, `layout.tsx`, `route.ts`
- Database type file: `database.ts` (auto-generated by Supabase CLI, `@ts-nocheck` at top)
- camelCase, verb-first: `createClient`, `updateSession`, `onSubmit`, `onClick`
- Async server component default exports: `async function AppLayout(...)`, `async function CandidatesPage()`
- No `I` prefix on interfaces or types
- camelCase throughout — `cookieStore`, `supabaseResponse`, `organizationName`, `fullName`
- Constants: SCREAMING_SNAKE_CASE for module-level arrays — `NAV_ITEMS`, `PUBLIC_PATHS`
- PascalCase, no `I` prefix: `Database`, `Status`, `TopNavProps`
- Discriminated unions preferred for state machines:
- Props interfaces named `[ComponentName]Props` — e.g., `TopNavProps`
- Snake_case columns and table names
- DB enums in lowercase snake_case — e.g., `activity_kind`
- Every table has `id` (uuid), `created_at`, `updated_at`
- Every tenant-scoped table has `organization_id uuid not null references organizations(id)`
## Code Style
- No semicolons: `"semi": false`
- Single quotes: `"singleQuote": true`
- 2-space indent: `"tabWidth": 2`
- Trailing commas everywhere: `"trailingComma": "all"`
- Print width: 100 characters
- Tailwind class sorting via `prettier-plugin-tailwindcss`
- `"strict": true` — all strict checks enabled
- `"noUncheckedIndexedAccess": true` — array index access returns `T | undefined`
- `"noEmit": true` — TypeScript is type-checker only, not emitter
- Target: `ES2022`
- Module resolution: `bundler`
- `any` is prohibited without an explanatory `// reason: ...` comment (no examples of `any` found in codebase)
- ESLint 9 flat config format
- Rules: `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`
- `eslint-config-prettier` applied last to disable formatting rules
- Ignored: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `supabase/**`
- Run with: `pnpm lint`
## Import Organization
- `@/*` maps to `./src/*` — used throughout: `@/components/ui/button`, `@/lib/supabase/client`, `@/types/database`
- `import type { Database }` used for type-only imports — e.g., `src/lib/supabase/middleware.ts`
## React / Next.js Patterns
- No `'use client'` directive = Server Component
- Async function components fetch data directly — `src/app/(app)/layout.tsx` queries Supabase directly in the async layout function
- Server Components are the default; Client Components added only when interactivity is required
- `'use client'` directive at the very top of file, before imports
- Used for: forms with state (`sign-in-form.tsx`, `sign-up-form.tsx`), interactive buttons (`sign-out-button.tsx`)
- Client Components use `useState` for local state, `useRouter` for navigation
- Mutations via Server Actions (not route handlers) — planned convention, not yet in codebase
- Route handlers used for webhooks/public APIs only: `src/app/auth/callback/route.ts`
- Route-specific components co-located with route — `sign-in-form.tsx` lives next to `sign-in/page.tsx`
- Shared components in `src/components/app/` — `TopNav`, `SignOutButton`
- shadcn/ui components in `src/components/ui/` — `Button`, `Input`, `Label`
## Error Handling
- Discriminated union state machines for async operations — `Status` type with `kind` discriminant
- Inline error display with `role="alert"` and `text-destructive` class for screen reader accessibility
- No toast library (sonner) installed yet — planned for future phases
- Sentry planned for server error logging — not yet installed
- Errors must include `org_id` + `user_id` context; never log PII (CV text, candidate emails)
- AI errors must degrade gracefully: show "AI temporarily unavailable" without breaking the rest of the app
- Auth code errors redirect to `/auth/auth-code-error` page — `src/app/auth/auth-code-error/page.tsx`
- Defence-in-depth redirect in layout: `src/app/(app)/layout.tsx` redirects to `/sign-in` if no user
- `setAll` in Server Components wrapped in try/catch with comment explaining why the error is safe to ignore — `src/lib/supabase/server.ts`
## Logging
- Log to Sentry with `org_id` + `user_id` context on every server error
- Never log: CV text, candidate names, or any PII
- AI cost logging to `ai_usage` table (non-negotiable for SaaS pricing)
## Comments
- Explain non-obvious decisions inline — e.g., `// Existing users only — do not auto-create on sign-in.`
- Explain safe-to-ignore errors: `// setAll was called from a Server Component. Safe to ignore when...`
- Critical warnings in ALL CAPS: `// IMPORTANT: do not put any logic between createServerClient and getUser.`
- Task placeholders: `// List + detail views land in Task 3.`
- Not used — inline comments preferred for explanations
## Module Design
- Named exports throughout — `export function SignInForm()`, `export function createClient()`
- Default exports only for Next.js page/layout/route conventions: `export default function CandidatesPage()`
- No barrel files (`index.ts`) observed — direct imports to specific files
- Three distinct clients, never interchanged:
## Commit Style
- Imperative present tense: `Task 1: project scaffold + auth shell`, `Task 2: full Phase 1 domain schema, RLS, seed`
- Short, descriptive, no period at end
- Reference task/phase when applicable: `Task N: description`
## Verification Checklist (before declaring work done)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
```text
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
- Server Components (RSC) are the default; `"use client"` is added only when browser APIs or React state are needed
- Mutations will use Server Actions; only webhooks/public APIs use route handlers
- Every database query is tenant-scoped automatically by RLS — the app never manually appends `organization_id` filters
- Auth guard runs in two places: middleware (fast redirect) and `(app)` layout (defence in depth)
- TypeScript strict mode throughout; `Database` type from `src/types/database.ts` is threaded into both Supabase clients for end-to-end type safety
## Layers
- Purpose: Render pages, handle user interactions
- Location: `src/app/`, `src/components/`
- Contains: Route pages (`page.tsx`), layouts (`layout.tsx`), shared components
- Depends on: Supabase client abstraction, shared types
- Used by: Browser / Next.js renderer
- Purpose: Intercept every request to refresh the Supabase session and redirect unauthenticated users
- Location: `src/proxy.ts`, `src/lib/supabase/middleware.ts`
- Contains: `updateSession()` function, public path allowlist
- Depends on: `@supabase/ssr` createServerClient
- Used by: Next.js edge runtime on every matched request
- Purpose: Provide a single, typed, cookie-aware Supabase client for each execution context
- Location: `src/lib/supabase/server.ts` (RSC/route handlers), `src/lib/supabase/client.ts` (browser)
- Contains: `createClient()` factory in each file — same name, different import path
- Depends on: `@supabase/ssr`, `src/types/database.ts`
- Used by: All components and route handlers that query Supabase
- Purpose: Store all application data, enforce multi-tenancy, provide auth
- Location: `supabase/migrations/`
- Contains: Schema, RLS policies, triggers, security-definer functions
- Depends on: pgvector, pg_trgm extensions
- Used by: Supabase client abstraction
- Purpose: Wrap Claude API calls with typed interface, model selection, cost logging
- Planned location: `src/lib/ai/` (not yet created)
- Will contain: `claude.ts` wrapper, `voyage.ts` embedding client, `whisper.ts` transcription
- Must log all calls to `ai_usage` via `record_ai_usage()` DB function
- Purpose: Handle long-running AI tasks (CV parsing, embedding, batch matching) outside HTTP request cycle
- Planned location: `src/inngest/` or similar (not yet created)
- Will contain: Inngest function definitions
## Data Flow
### Authentication — Sign Up
### Authentication — Sign In (Existing User)
### Authenticated Page Request
- No global client state store. Server state is fetched fresh on each RSC render.
- Client-side local state (forms) uses `useState` in Client Components only.
- Session state is held in HTTP-only cookies, managed by Supabase + middleware.
## Key Abstractions
- Purpose: Provide a typed `SupabaseClient<Database>` appropriate for the execution context
- Server: `src/lib/supabase/server.ts` — async, reads/writes cookies via `next/headers`
- Client: `src/lib/supabase/client.ts` — sync, uses `createBrowserClient`
- Pattern: Import from the correct path; both export `createClient` with the same signature
- The `Database` type from `src/types/database.ts` provides full type inference on all queries
- Purpose: Auto-generated TypeScript representation of the full Postgres schema
- Location: `src/types/database.ts`
- Contains: `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>`, `Enums<T>` helper types
- Pattern: Use `Tables<'candidates'>` not raw object types when typing DB row results
- Purpose: Resolve the current user's `organization_id` from `auth.uid()` — the single RLS primitive
- Location: `supabase/migrations/20260513151021_init_organizations_and_users.sql`
- Declared `SECURITY DEFINER` to read `public.users` without recursive RLS
- All tenant RLS policies are of the form: `using (organization_id = public.current_organization_id())`
- Purpose: Controlled write paths for audit_log and ai_usage that prevent client forgery
- Location: `supabase/migrations/20260513152244_phase1_domain_schema.sql`
- `record_audit()`: callable by `authenticated` role; auto-reads org from session context
- `record_ai_usage()`: callable by `service_role` only (background jobs via Inngest)
## Entry Points
- Location: `src/proxy.ts` (Next.js looks for `middleware.ts` at root; this file re-exports from `src/`)
- Triggers: Every request matching the path pattern (excludes static assets)
- Responsibilities: Session refresh, auth redirect
- Location: `src/app/layout.tsx`
- Triggers: All page renders
- Responsibilities: HTML shell, fonts, `<body>` wrapper
- Location: `src/app/(app)/layout.tsx`
- Triggers: All routes under `(app)` route group
- Responsibilities: Secondary auth check, profile/org fetch, TopNav injection
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
### Manually appending `organization_id` to every query as a security control
### Making synchronous AI calls from route handlers or Server Actions
## Error Handling
- User-facing errors: Next.js error boundaries + sonner toast (to be implemented)
- Server errors: Sentry with `org_id` + `user_id` context — never log PII (CV text, candidate email)
- Auth errors: Redirect to `/auth/auth-code-error` for PKCE failures (`src/app/auth/auth-code-error/page.tsx`)
- AI errors: Display "AI temporarily unavailable" message; underlying data remains accessible
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
