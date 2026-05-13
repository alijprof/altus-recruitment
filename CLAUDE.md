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
