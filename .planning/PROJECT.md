# Altus — AI-First Recruitment CRM

## What This Is

A multi-tenant SaaS recruitment CRM for UK recruitment agencies, replacing tools like Firefish. AI is the spine: CV parsing, semantic search, match-scoring with explanations, voice-to-data, and conversation summarisation are core, not bolted on. Anchor customer is a 2–3 person agency; the product is built so that the same codebase grows into a SaaS offering for other agencies.

## Current State (v1.0 shipped 2026-06-12)

All 5 v1.0 phases are live on production (altusrecruit.com): full internal ATS, semantic search + AI match scoring, LinkedIn/spec-call capture workflows, voice notes + email marketing + NL reporting, and the SaaS shell (self-serve signup, Stripe card-first billing with paywall, per-org branding, super-admin console, marketing/docs/status site). Existing orgs are grandfathered; new orgs hit the card-first access gate. PECR one-click unsubscribe shipped ahead of real campaigns. ~65,500 LOC TypeScript + SQL, 432 commits in 30 days.

## Core Value

A recruiter can find the right candidate for a job in seconds using natural language — backed by AI parsing of every CV, semantic search across the database, and Sonnet-generated match explanations — instead of digging through static keyword lists and tribal knowledge.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ **Foundation** (FOUND-01–06): Next.js + Supabase scaffold, multi-tenant schema with RLS, pgvector/pg_trgm — v1.0
- ✓ **Internal ATS** (CAND-01–07, CV-01–05, CLIENT-01–05, PIPE-01–06, DASH-01–06): candidates with GDPR consent + audit log, AI CV parsing, clients/contacts, kanban pipeline, dashboards — v1.0
- ✓ **Search & matching** (SEARCH-01–04, MATCH-01–03, APPLY-01–02, EMAIL-01): RRF hybrid semantic search, Sonnet match explanations, public apply form, Outlook capture (adjusted from Gmail) — v1.0
- ✓ **Capture & spec workflow** (LINKEDIN-01 adjusted to top-card + PDF pivot, SPEC-01–02, AD-01, SHORT-01–02, REPEAT-01–02) — v1.0
- ✓ **Voice, marketing, reporting** (VOICE-01–02, MARKET-01–03, REMIND-01, REPORT-01–02): voice notes (low founder value at desk — investment frozen), approval-gated personalised campaigns + PECR unsubscribe, NL→SQL reporting, buyer dashboards — v1.0
- ✓ **SaaS shell** (SAAS-01, BILL-01, BRAND-01, ADMIN-01 lean version, MARKETING-01): self-serve signup + onboarding + CSV import, Stripe card-first billing + paywall, per-org branding, super-admin console, marketing site — v1.0

### Active

<!-- Candidates for the next milestone — confirm via /gsd-new-milestone. -->

**Launch operations (pre-customer-#2 hygiene):**
- [ ] Rotate Stripe & Supabase secret keys (flagged at Phase 5 smoke; revoke only after replacements confirmed working)
- [ ] Custom SMTP via Resend for Supabase auth emails (free-tier built-in SMTP throttles ~4/hour — onboarding blocker)
- [ ] Comp→paid self-serve path for grandfathered orgs (deferred at paywall ship)
- [ ] First real email campaigns with anchor customer (PECR unsubscribe now live)

**Phase 6 candidates — Temp / contract:**
- [ ] **TEMP-01**: Assignments with pay/charge rate and IR35 status
- [ ] **TEMP-02**: Weekly timesheets with approval workflow
- [ ] **TEMP-03**: Margin reporting and umbrella/PAYE handling
- [ ] **TEMP-04**: Renewal flows and offshore compliance tickets (BOSIET, MIST, OPITO) if sector wedge chosen

**Other v2 candidates:** ADMIN impersonation + audit layer (descoped from v1), candidate self-service page, referral tracking, RTR records, CV re-parse on demand, CV parsing from forwarded email

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

**Codebase state (2026-06-12, v1.0 shipped).** ~65,500 LOC TypeScript + SQL across 394 source files; 432 commits in 30 days. All 5 phases live on altusrecruit.com. Stack as planned: Next.js App Router + Supabase (RLS multi-tenancy, pgvector halfvec, pg_trgm) + Inngest + Stripe + Resend + Claude (Haiku/Sonnet) + Voyage + Whisper. See `.planning/codebase/` for map.

**Founder feedback themes (v1.0):** voice notes "cool but not needed" at the desk (freeze further investment unless phone usage proves out); buyer-value dashboards and semantic search are the demo anchors; iterative selector-tweaking on brittle scraping should pivot early (LinkedIn lesson).

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
| Multi-tenant from day one via RLS | Anchor + SaaS share one codebase; cross-tenant leakage is unrecoverable | ✓ Good — held through 5 phases; pre-launch audit found no cross-tenant leaks |
| Supabase over self-hosted Postgres | Free tier + auth + storage + pgvector in one platform; £20/mo Pro covers early SaaS | ✓ Good — auth/storage/RLS/vector all delivered; watch built-in SMTP rate limit |
| pgvector over dedicated vector DB | Standard Postgres exports cleanly; no extra service to operate | ✓ Good — RRF hybrid search performs well at current scale |
| Voyage embeddings over OpenAI | Voyage `voyage-3` outperforms OpenAI for retrieval | ✓ Good — semantic search is a demo anchor |
| Halfvec(1024) over vector(1024) | Halves storage cost with negligible quality loss | ✓ Good |
| Inngest for background jobs | Long AI calls (>2s) must not block HTTP handlers | ✓ Good — CV parsing, matching, transcription, campaign fan-out all on Inngest |
| Typed Claude wrapper at `src/lib/ai/claude.ts` | Centralises model selection, retries, error normalisation, token logging | ✓ Good |
| `ai_usage` per tenant per call | Non-negotiable for SaaS pricing decisions and cost visibility | ✓ Good — feeds AI caps + super-admin cost dashboard; anon-inject hole fixed 2026-06-05 |
| No LinkedIn outbound automation | Account ban risk; substitute is excellent email marketing | ✓ Good — inbound capture pivoted to top-card + PDF after DOM scraping proved fragile |
| Perm first, temp/contract Phase 6 | Anchor is perm-heavy; temp adds significant complexity (timesheets, IR35) | ✓ Good — v1.0 shipped without temp; Phase 6 is next-milestone candidate |
| Card-first paywall, grandfather existing orgs | Stop free-forever usage without disrupting anchor | ✓ Good — live 2026-06-06; comp→paid self-serve deferred |
| Voice notes shipped behind approval gate | Recruiter must approve all field changes | ⚠️ Revisit — works, but founder rates desk value low; freeze investment |

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
*Last updated: 2026-06-12 after v1.0 milestone — shipped and archived; next milestone not yet defined*
