# External Integrations

**Analysis Date:** 2026-05-17

## Status Key

- **ACTIVE** - Installed, configured, and in use
- **SCHEMA READY** - Database schema / infrastructure in place, SDK not yet installed
- **PLANNED** - Referenced in CLAUDE.md / docs; not yet implemented

---

## APIs & External Services

**AI - Language Models [SCHEMA READY]:**
- Anthropic Claude API - CV parsing, candidate-job matching, match score explanations, email generation, voice note structuring
  - SDK/Client: Not yet installed; wrapper stub planned at `src/lib/ai/claude.ts`
  - Models: `claude-haiku-4-5-20251001` (high-volume parsing), `claude-sonnet-4-6` (matching/writing/summarisation, default), `claude-opus-4-7` (complex multi-step reasoning, justified use only)
  - Auth: `ANTHROPIC_API_KEY` (not yet in `.env.example`)
  - Cost tracking: `ai_usage` table exists in DB (`supabase/migrations/20260513152244_phase1_domain_schema.sql`); written via security-definer function `record_ai_usage()`
  - All calls must go through the typed wrapper — never bypass

**AI - Embeddings [SCHEMA READY]:**
- Voyage AI (`voyage-3` model) - Candidate and job semantic search embeddings via REST API (no official SDK)
  - Auth: `VOYAGE_API_KEY` (not yet in `.env.example`)
  - Storage: `halfvec(1024)` columns on `candidates.candidate_embedding` and `jobs.job_embedding`
  - Tracking: `embedding_version` + `embedded_at` on both tables
  - Re-embed only on material data change; HNSW vector index added in Phase 2 (not yet present)

**AI - Voice Transcription [PLANNED]:**
- OpenAI Whisper API - Spec call and voice note transcription
  - Auth: `OPENAI_API_KEY` (not yet in `.env.example`)

**Background Jobs [PLANNED]:**
- Inngest - Long-running AI tasks (CV parsing, embedding, batch matching) — preferred over Trigger.dev per CLAUDE.md
  - Auth: Inngest signing key (env var name TBD)
  - Pattern: CV parse + embed runs in Inngest, not synchronously in route handler

**Email [PLANNED]:**
- Resend - Transactional email (outreach, candidate notifications)
  - Auth: `RESEND_API_KEY`
  - Constraint: auto-send to candidates requires human approval step; never fire without approval

**Billing [PLANNED - Phase 5]:**
- Stripe - SaaS subscription billing
  - Auth: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

---

## Data Storage

**Databases:**
- Supabase (managed Postgres 17) [ACTIVE]
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` (public), `SUPABASE_SERVICE_ROLE_KEY` (server-only)
  - Client: `@supabase/supabase-js` 2.105.4 with `@supabase/ssr` 0.10.3
  - Browser client: `src/lib/supabase/client.ts` — `createBrowserClient<Database>(...)`
  - Server client: `src/lib/supabase/server.ts` — `createServerClient<Database>(...)` with cookie store
  - Middleware: `src/lib/supabase/middleware.ts` — session refresh + auth guard on every request
  - Local dev: `pnpm exec supabase start` (Docker-based)
  - Type safety: generated types at `src/types/database.ts` (Database interface)
  - Migrations: append-only in `supabase/migrations/`; CLI command `supabase db push` or `supabase migration up`

**File Storage:**
- Supabase Storage [ACTIVE - infrastructure ready; buckets not yet created]
  - Used for: CV uploads, candidate documents
  - Storage path referenced in `candidate_cvs.storage_path` column
  - File size limit: 50 MiB (configured in `supabase/config.toml`)
  - Access via same Supabase JS client

**Caching:**
- None — no Redis or in-memory cache layer
- AI output caching: stored in `ai_summaries` table (planned) and feature-specific DB tables

---

## Authentication & Identity

**Auth Provider: Supabase Auth [ACTIVE]**
- Implementation: `@supabase/ssr` cookie-based sessions
- Methods enabled: email + password, magic link (email OTP); Google OAuth planned for later
- Email confirmations: required (`double_confirm_changes: true`)
- Session refresh: middleware in `src/lib/supabase/middleware.ts` runs on every request via `supabase.auth.getUser()`
- New user provisioning: PostgreSQL trigger `on_auth_user_created` on `auth.users` automatically creates `public.organizations` + `public.users` rows; reads `organization_name` and `full_name` from `raw_user_meta_data`
- Tenant resolution: `public.current_organization_id()` security-definer function used in all RLS policies
- Auth routes: `src/app/(auth)/sign-in/`, `src/app/(auth)/sign-up/`, `src/app/auth/callback/`
- Auth guard: middleware redirects unauthenticated users to `/sign-in` with `?next=` param; authenticated users redirected away from auth pages

---

## Monitoring & Observability

**Error Tracking [PLANNED]:**
- Sentry - Server errors logged with `org_id` + `user_id` context
  - Auth: `SENTRY_DSN`
  - Constraint: NEVER log PII (CV text, candidate emails, names) to Sentry

**Product Analytics [PLANNED]:**
- PostHog - Usage analytics
  - Auth: `POSTHOG_API_KEY`
  - Constraint: NEVER log PII to PostHog

**Logs:**
- Currently: Next.js default server logging
- Planned: structured logging with org_id context via Sentry integration

---

## CI/CD & Deployment

**Hosting:**
- Vercel - Next.js frontend hosting
- Supabase Cloud - Database, Auth, Storage, Realtime

**CI Pipeline:**
- Not detected — no `.github/workflows/` or CI config files found

---

## Environment Configuration

**Currently defined (`.env.example`):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (browser-safe)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Supabase anon key (browser-safe; RLS is the real boundary)
- `SUPABASE_SERVICE_ROLE_KEY` - Server-only; bypasses RLS; for background jobs and admin actions (Phase 4+)

**Planned additional env vars (not yet in `.env.example`):**
- `ANTHROPIC_API_KEY`
- `VOYAGE_API_KEY`
- `OPENAI_API_KEY`
- `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SENTRY_DSN`
- `POSTHOG_API_KEY`

**Secrets location:**
- `.env.local` (local dev, gitignored)
- Vercel environment variables (production/preview)

---

## Webhooks & Callbacks

**Incoming [PLANNED]:**
- `/api/webhooks/stripe` - Stripe billing events (Phase 5)
- `/api/webhooks/inngest` - Inngest job callbacks

**Outgoing:**
- None currently defined

---

## Database Integration Patterns

**Type Safety:**
- All DB operations typed via generated `Database` interface in `src/types/database.ts`
- Clients instantiated as `createClient<Database>(...)` in both browser and server contexts

**Multi-tenancy:**
- Every domain table has `organization_id uuid not null`
- RLS enabled on all domain tables; policies use `public.current_organization_id()`
- `set_organization_id()` trigger auto-fills `organization_id` from auth context on INSERT

**Audit Trail:**
- `audit_log` table written exclusively via `record_audit()` security-definer function
- `ai_usage` table written exclusively via `record_ai_usage()` security-definer function
- Both functions enforce org-scoping server-side

---

*Integration audit: 2026-05-17*
