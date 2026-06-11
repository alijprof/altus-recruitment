# Altus — AI-First Recruitment CRM

## What This Is

A multi-tenant SaaS recruitment CRM for UK recruitment agencies, replacing tools like Firefish. AI is the spine: CV parsing, semantic search, match-scoring with explanations, voice-to-data, and conversation summarisation are core, not bolted on. Anchor customer is a 2–3 person agency; the product is built so that the same codebase grows into a SaaS offering for other agencies.

## Core Value

A recruiter can find the right candidate for a job in seconds using natural language — backed by AI parsing of every CV, semantic search across the database, and Sonnet-generated match explanations — instead of digging through static keyword lists and tribal knowledge.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from merged code in this repo. -->

- ✓ **FOUND-01**: Next.js 15 App Router scaffold with TypeScript strict mode — Phase 1, Task 1 (merged in `00f09e2`)
- ✓ **FOUND-02**: Supabase auth shell with org-on-signup trigger and signed-in layout — Phase 1, Task 1 (merged in `00f09e2`)
- ✓ **FOUND-03**: Phase 1 domain schema (organizations, users, companies, contacts, candidates, candidate_cvs, jobs, applications, activities, audit_log, ai_usage) — Phase 1, Task 2 (merged in `5ec1d01`)
- ✓ **FOUND-04**: RLS policies enforcing tenant isolation via `current_organization_id()` — Phase 1, Task 2
- ✓ **FOUND-05**: pgvector + pg_trgm extensions enabled; halfvec(1024) reserved on candidate/job — Phase 1, Task 2
- ✓ **FOUND-06**: Generated TypeScript types from Supabase and seed data for development — Phase 1, Task 2

### Active

<!-- Current scope. Building toward these. -->

**Phase 1 — Foundation (remaining work):**
- [ ] **CAND-01**: Candidate list, detail, create, edit with GDPR consent capture and audit log
- [ ] **CAND-02**: CV upload → Claude Haiku structured parsing → Inngest background job → review panel
- [ ] **CLIENT-01**: Clients & contacts CRUD with per-client management view and activity timeline
- [ ] **PIPE-01**: Jobs with kanban pipeline (drag between stages, structured decline reasons)
- [ ] **DASH-01**: Org dashboard with activity feed, stale applications, follow-up candidates
- [ ] **POLISH-01**: Settings (profile, org, invite teammates), empty/loading/error states, mobile-responsive

**Phase 2 — Semantic search & apply form:**
- [ ] **SEARCH-01**: Voyage embeddings on candidates and jobs (regenerate only on material change)
- [ ] **SEARCH-02**: Natural-language semantic search across candidates and jobs
- [ ] **MATCH-01**: Sonnet match-scoring with explanations, cached per candidate-job pair
- [ ] **APPLY-01**: Public apply form (CV upload, GDPR consent, source attribution)
- [ ] **EMAIL-01**: Gmail OAuth for inbound email logging against candidate/contact

**Phase 3 — LinkedIn capture & spec workflow:**
- [ ] **LINKEDIN-01**: Chrome extension for one-click LinkedIn inbound profile capture
- [ ] **SPEC-01**: Spec call recording → Whisper → Sonnet structured JD with recruiter approval
- [ ] **JD-01**: AI job ad generation + inclusivity scoring
- [ ] **SHORTLIST-01**: Per-job shortlists / hot lists separate from formal applications
- [ ] **REPEAT-01**: Repeat-client view with dormant-client alerts and source-attribution reporting

**Phase 4 — Marketing, voice, reporting:**
- [ ] **MARKET-01**: Segmented email marketing campaigns with Sonnet personalisation via Resend
- [ ] **REMIND-01**: Automated reminders (stale candidates, dormant clients, follow-ups)
- [ ] **VOICE-01**: Voice notes → structured data (stage updates, action items, field changes)
- [ ] **REPORT-01**: Natural-language reporting (schema-aware SQL allowlist) + full buyer dashboards

**Phase 5 — SaaS shell:**
- [ ] **SAAS-01**: Self-service signup with org creation and onboarding flow
- [ ] **BILL-01**: Stripe subscription, billing portal, tiered plans
- [ ] **BRAND-01**: Per-org branding (logo, colours, careers site)
- [ ] **ADMIN-01**: Super-admin support tooling and CSV import
- [ ] **MARKETING-01**: Documentation site + marketing site + status page

**Phase 6 — Temp / contract:**
- [ ] **TEMP-01**: Assignments with pay/charge rate and IR35 status
- [ ] **TEMP-02**: Weekly timesheets with approval workflow
- [ ] **TEMP-03**: Margin reporting and umbrella/PAYE handling
- [ ] **TEMP-04**: Renewal flows and offshore compliance tickets (BOSIET, MIST, OPITO) if sector wedge chosen

### Out of Scope

- **LinkedIn outbound automation** — LinkedIn aggressively detects automation and bans accounts; substitute with excellent email marketing
- **Chatbot "ask the CRM anything" UI** — gimmick that doesn't beat specific AI features at specific moments
- **Auto-sending emails to candidates without approval** — recruiters' professional relationships are on the line
- **Generic CRM features (deals, opportunities, custom pipelines)** — recruitment-specific workflows are the wedge
- **Invoicing/accounting** — Xero/QuickBooks handles this; CRM tracks placements but not invoicing
- **Mobile native app** — mobile-responsive web is sufficient for v1 ("look up a candidate while walking")
- **In-app voice/video calls** — recording dictation only; calls happen on existing channels

## Context

**Strategic positioning.** Two drivers shape every architectural choice:
1. *Anchor customer's driver*: the owner wants the option to sell the agency one day. Currently commercial knowledge sits in recruiters' heads — useless to a buyer. The CRM turns tacit value into a documented, queryable, exportable asset.
2. *Builder's driver*: launch as SaaS to other agencies, with anchor as proof and reference customer.

**Competitive landscape.** Firefish, Bullhorn, Vincere have a decade+ of iteration. Wedges: AI-first (Firefish G2 reviews call out their CRM core as dated), sector specialist (energy/offshore wind), micro-agency price tier (£20–30/user vs Firefish's £80). These compose — "AI-first CRM for offshore wind recruiters at micro-agency prices" is defensible.

**Domain specifics treated as first-class:** Right to Represent (RTR), source attribution, shortlists, float/spec CVs, commission tracking, referrals, backfill vs new role, per-client fee agreements, right-to-work compliance, IR35 for contractors.

**Codebase state (2026-05-17).** Phase 1 Tasks 1–2 merged: Next.js 15 + Supabase scaffold, full Phase 1 domain schema with RLS, types generated, seed data present. Tasks 3–7 of Phase 1 still pending. See `.planning/codebase/` for full map.

**Risks named up front:**
- Solo SaaS competing with funded products as a part-timer — slower velocity, no support team
- Recruitment software has high switching costs — 3–6 month sales cycles
- Key-person risk in due diligence for anchor's exit — mitigate via documentation and code quality

**Build/run economics:** ~£40–80/month at single-customer stage; ~£200–400/month at ~20 customers. AI ~£20–50/month per agency at normal usage.

## Constraints

- **Tech stack**: Next.js 15 App Router + TypeScript strict + Supabase (Postgres + Auth + Storage + pgvector + pg_trgm) + shadcn/ui + Tailwind — Decided in plan; do not re-litigate
- **AI provider**: Anthropic Claude (Haiku for parsing, Sonnet default, Opus only when justified). Voyage AI for embeddings. OpenAI Whisper for transcription — Cost-optimised model selection per task
- **Multi-tenancy**: Every domain table has `organization_id` with RLS — Cross-tenant leakage is the worst possible bug
- **Standard Postgres**: No exotic extensions beyond `pgvector` and `pg_trgm` — Schema must export cleanly for anchor's exit and SaaS customers' portability
- **Audit-ready**: Every read of candidate detail logs to `audit_log`; every consent has timestamp + basis — Compliance is foundational, not retrofitted
- **AI cost visibility**: Every Claude call logs tokens + cost to `ai_usage` per tenant — Required for SaaS pricing decisions
- **Hosting**: Vercel (frontend) + Supabase (everything else); Inngest for background jobs — Long-running AI calls (>2s) must not block HTTP handlers
- **Package manager**: pnpm
- **Build velocity**: Solo, part-time; total runway to "ready for customer #2" ~12–14 weeks PT — Phase scope must be sized to fit

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Multi-tenant from day one via RLS | Anchor + SaaS share one codebase; cross-tenant leakage is unrecoverable | ✓ Good — schema landed clean in Task 2 |
| Supabase over self-hosted Postgres | Free tier + auth + storage + pgvector in one platform; £20/mo Pro covers early SaaS | — Pending |
| pgvector over dedicated vector DB | Standard Postgres exports cleanly; no extra service to operate | — Pending |
| Voyage embeddings over OpenAI | Voyage `voyage-3` outperforms OpenAI for retrieval | — Pending |
| Halfvec(1024) over vector(1024) | Halves storage cost with negligible quality loss | — Pending |
| Inngest for background jobs | Long AI calls (>2s) must not block HTTP handlers | — Pending |
| Typed Claude wrapper at `src/lib/ai/claude.ts` | Centralises model selection, retries, error normalisation, token logging | — Pending |
| `ai_usage` per tenant per call | Non-negotiable for SaaS pricing decisions and cost visibility | ✓ Good — table landed in Task 2 |
| No LinkedIn outbound automation | Account ban risk; substitute is excellent email marketing | — Pending |
| Perm first, temp/contract Phase 6 | Anchor is perm-heavy; temp adds significant complexity (timesheets, IR35) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-11 after Phase 4 completion — all 5 v1.0 phases built and live on production (altusrecruit.com)*
