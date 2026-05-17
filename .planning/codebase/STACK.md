# Technology Stack

**Analysis Date:** 2026-05-17

## Languages

**Primary:**
- TypeScript 5.x (strict mode) - All application code in `src/`
- SQL - Database migrations in `supabase/migrations/`

**Secondary:**
- JavaScript - Config files (`eslint.config.mjs`, `postcss.config.mjs`)

## Runtime

**Environment:**
- Node.js - Managed by pnpm; no `.nvmrc` or `.node-version` present (uses system Node)

**Package Manager:**
- pnpm (workspace-aware)
- Config: `pnpm-workspace.yaml`
- Lockfile: present (`pnpm-lock.yaml`)

## Frameworks

**Core:**
- Next.js 16.2.6 - Full-stack React framework with App Router (`src/app/`)
- React 19.2.4 - UI library
- React DOM 19.2.4 - DOM renderer

**UI:**
- Tailwind CSS 4.x - Utility-first CSS framework
- shadcn/ui - Component library pattern (components in `src/components/ui/`)
- lucide-react 1.14.0 - Icon library
- class-variance-authority 0.7.1 - Variant-based component styling
- clsx 2.1.1 - Conditional class name utility
- tailwind-merge 3.6.0 - Tailwind class conflict resolution
- tw-animate-css 1.4.0 - Animation utilities

**Testing:**
- Vitest - Planned for unit tests (not yet installed; referenced in CLAUDE.md)
- Playwright - Planned for E2E tests (not yet installed; referenced in CLAUDE.md)

**Build/Dev:**
- `@tailwindcss/postcss` 4.x - PostCSS integration for Tailwind
- Prettier 3.3.3 - Code formatter with `prettier-plugin-tailwindcss` 0.6.8
- ESLint 9.x - Linter

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.105.4 - Supabase JS client (database, auth, storage queries)
- `@supabase/ssr` 0.10.3 - Supabase SSR helpers for Next.js (cookie-based auth session management)
- `next` 16.2.6 - Application framework; App Router is the architectural backbone

**Infrastructure:**
- `supabase` 2.98.2 (devDependency) - Supabase CLI for local dev, migrations, type generation
- `eslint-config-next` 16.2.6 - Next.js ESLint rules
- `eslint-config-prettier` 9.1.0 - Disables ESLint rules that conflict with Prettier

**Planned (not yet installed):**
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

**TypeScript (`tsconfig.json`):**
- `strict: true` - Full strict mode enabled
- `noUncheckedIndexedAccess: true` - Extra array/object access safety
- `target: ES2022`
- `moduleResolution: bundler`
- Path alias: `@/*` maps to `./src/*`
- Next.js plugin integrated

**Prettier (`.prettierrc.json`):**
- `semi: false` - No semicolons
- `singleQuote: true` - Single quotes
- `tabWidth: 2`
- `trailingComma: "all"`
- `printWidth: 100`
- Plugin: `prettier-plugin-tailwindcss` (auto-sorts Tailwind classes)

**ESLint (`eslint.config.mjs`):**
- Extends `eslint-config-next/core-web-vitals`
- Extends `eslint-config-next/typescript`
- `eslint-config-prettier` applied last to disable formatting conflicts
- Ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`, `supabase/**`

**Next.js (`next.config.ts`):**
- Minimal config; no custom settings currently applied

**PostCSS (`postcss.config.mjs`):**
- `@tailwindcss/postcss` integration for Tailwind v4

**Supabase (`supabase/config.toml`):**
- Project ID: `altus-recruitment`
- Postgres major version: 17
- Local API port: 54321, DB port: 54322, Studio port: 54323
- Auth: email/password + magic link; signup enabled; confirmations required
- Storage: enabled, 50 MiB file size limit
- Analytics: disabled
- Connection pooler: disabled (direct connections)

**Database Extensions (`supabase/migrations/`):**
- `pgcrypto` - UUID generation helpers
- `vector` (pgvector) - `halfvec(1024)` columns on `candidates` and `jobs` for Voyage AI embeddings
- `pg_trgm` - GIN trigram indexes for keyword search on `name`, `full_name`, `title` columns

## Platform Requirements

**Development:**
- pnpm (workspace)
- Docker (for `pnpm exec supabase start` local Supabase stack)
- Supabase CLI (`supabase` devDependency)
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**Production:**
- Vercel (Next.js hosting)
- Supabase Cloud (Postgres, Auth, Storage, Realtime)
- Additional services planned: Inngest, Resend, Sentry, PostHog, Stripe

---

*Stack analysis: 2026-05-17*
