# Phase 1: Internal ATS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 1-internal-ats
**Areas discussed:** Pre-work sequencing, CV parsing reliability, Pipeline kanban UX, Search/sort/list UX

---

## Pre-work sequencing

### Q1 — Overall strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Hardening plan first | Plan 0 dedicated to fixes + infrastructure. Tasks 3–7 build on a clean base. | ✓ |
| Interleave per task | Each task pulls in only the infrastructure it needs. Faster feature delivery; risk of skipped fixes. | |
| Minimum viable hardening | Critical-only pre-work; defer the rest to Task 7 polish. | |

**User's choice:** Hardening plan first.
**Notes:** Confirms the planner should produce a Plan 0 before Tasks 3–7 plans.

### Q2 — Security fixes that must land in Plan 0

| Option | Selected |
|--------|----------|
| `proxy.ts` → `middleware.ts` rename + verify auth guard | ✓ |
| Open-redirect fix in `/auth/callback` (?next= validation) | ✓ |
| Cross-tenant FK trigger guards (contacts/jobs/applications) | ✓ |
| Supabase Storage bucket + path-prefixed RLS for CVs | ✓ |

**User's choice:** All four.
**Notes:** All four are gating items for Plan 0 — none can slip to Phase 2.

### Q3 — Tech-debt items in Plan 0 vs Task 7 polish

| Option | Selected |
|--------|----------|
| Remove `@ts-nocheck` from `database.ts` (regenerate types) | ✓ |
| Fix `pnpm-workspace.yaml` placeholder booleans | ✓ |
| Sentry installation + org_id/user_id context | ✓ |
| Env-var validation module (`src/lib/env.ts`) | ✓ |

**User's choice:** All four.
**Notes:** Maximalist hardening — Plan 0 covers all known tech-debt items plus security fixes plus skeleton infrastructure (`src/lib/ai`, `src/lib/db`, Inngest).

---

## CV parsing reliability

### Q1 — Haiku schema scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full schema, single pass | One Haiku call returns everything including confidence per field. | ✓ |
| Minimal core + enrichment | First pass returns name/contact/role/salary/location; second pass (Sonnet) for skills/sector/seniority. | |
| Full schema, skills as free-text | Skills come back as raw strings, tagging deferred to Phase 2 embeddings. | |

**User's choice:** Full schema, single pass.
**Notes:** Matches the cost model in `docs/plan.md` (~£0.005 per CV) and the schema spec in `docs/phase-1-tasks.md` Task 4.

### Q2 — File types and failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| PDF + DOCX from v1, retry button on failure | Both formats; failed parses surface error + manual retry. | ✓ |
| PDF only for v1 | DOCX deferred to Phase 2. | |
| PDF + DOCX, no retry UI (auto-requeue once) | Inngest auto-retries silently; user sees only final state. | |

**User's choice:** PDF + DOCX from day one, manual retry button on failure.
**Notes:** Preserves user agency on failure. Original file is stored in Supabase Storage regardless of parse outcome so re-parsing is always possible later.

---

## Pipeline kanban UX

### Q1 — Drag interaction model

| Option | Description | Selected |
|--------|-------------|----------|
| Optimistic update with rollback | Card moves instantly, server confirms async, snap back on failure. | |
| Pending state during server confirm | Card moves with pending indicator until server confirms or rejects. | ✓ (Claude's call) |
| Server-rendered with form submission | Drag triggers a server action that revalidates the page. | |

**User's choice:** "I am unsure, do what is best." → Claude selected **Pending state during server confirm**.
**Notes:** Rationale captured in CONTEXT.md D-09: drag-with-pending strikes the best balance for a kanban that mutates server state with side effects (auto-logged activity entries). Pure optimistic hides whether the activity-log row actually wrote; full server-rendered is unnecessarily heavy.

### Q2 — Decline-reason capture flow

| Option | Description | Selected |
|--------|-------------|----------|
| Modal dialog with required enum + free-text | Reject opens modal with enum dropdown + optional notes. | ✓ |
| Inline dropdown on card | Reject button flips card to inline dropdown. | |
| Modal with stage-specific reason options | Enum options narrow based on current stage. | |

**User's choice:** Modal dialog with required enum + free-text.
**Notes:** Matches `docs/phase-1-tasks.md` Task 6 spec exactly.

### Q3 — Mobile fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Stacked list grouped by stage | Vertical list with stage headers + tap-to-move stage picker. | ✓ |
| Horizontal scroll with snap | Kanban stays; viewport scrolls one column at a time. | |
| Defer mobile-optimised pipeline | Read-only on mobile; editing requires desktop. | |

**User's choice:** Stacked list grouped by stage.
**Notes:** Preserves "look up a candidate while walking" use case from `CLAUDE.md`.

---

## Search, sort & list UX

### Q1 — Keyword search strategy

| Option | Description | Selected |
|--------|-------------|----------|
| `pg_trgm` with ranked similarity | Fuzzy matching on name/email/role; handles typos. | ✓ |
| Simple `ILIKE '%query%'` | Substring match only; no fuzzy. | |
| Postgres FTS (tsvector) with rank | Word stems and boundaries; no typo tolerance. | |

**User's choice:** `pg_trgm` with ranked similarity.
**Notes:** `pg_trgm` extension is already enabled in `supabase/migrations/20260513152244_phase1_domain_schema.sql`. Plan 0 adds GIN trigram indexes on searchable columns.

### Q2 — Server vs client list interactions

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side with URL params (RSC-native) | Sort/filter/page state in URL; RSC re-renders on change. | ✓ |
| Client-side TanStack Table on RSC-fetched page | Per-page client interactivity; pagination still server-side. | |
| Hybrid (server data, client cosmetic interactions) | Server handles data; client handles only column visibility/resize. | |

**User's choice:** Server-side with URL params.
**Notes:** Aligns with App Router patterns. Shareable URLs. Smaller client bundles.

### Q3 — Audit-log scope on data access

| Option | Description | Selected |
|--------|-------------|----------|
| Detail views only (per `docs/phase-1-tasks.md`) | Audit row written when viewing `/candidates/[id]`. Lists not logged. | ✓ |
| Detail + search queries | Every search query also logged (with query string). | |
| Detail + bulk views (10+ candidates) | Aggregate row for list pages instead of per-row. | |

**User's choice:** Detail views only.
**Notes:** Matches `docs/phase-1-tasks.md` Task 3 exactly. Revisit in Phase 2 when GDPR self-service lands.

---

## Claude's Discretion

- Drag interaction model (Q1 in Pipeline kanban UX) — user deferred; Claude selected pending-state.
- Form composition within shadcn primitives (Form, Sheet, Dialog, Table) — pick the most idiomatic shadcn pattern.
- Inngest function granularity (one function per task type vs grouped) — researcher/planner decides.
- Sentry breadcrumb/scope strategy — pick defaults that surface `org_id` + `user_id` without leaking PII.
- Storage path encoding format — pick what minimises collision risk while staying recognisable in the Supabase dashboard.

## Deferred Ideas

- GDPR right-to-erasure flow — Phase 3 task before live external data
- Audit on list/search query events — revisit in Phase 2 with self-service GDPR
- HNSW vector index — Phase 2 when embeddings populate
- `ai_summaries` table — Phase 2 caching for match explanations
- `shortlists` (Phase 3) and `placements` (Phase 4) tables
- CV email-inbox intake (`apply@…` webhook) — Phase 2
- Re-parse CV on demand — Phase 2
- Vitest + Playwright install timing — planner decides; default recommendation is Plan 0
