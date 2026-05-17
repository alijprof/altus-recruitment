# Phase 1: Internal ATS - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 finishes the **Internal ATS** that the anchor customer will use day-to-day. The Next.js + Supabase scaffold (Task 1) and the full Phase 1 domain schema + RLS (Task 2) are already merged. This phase delivers Tasks 3–7 from `docs/phase-1-tasks.md`:

- Candidates module with GDPR consent capture and detail-view audit logging
- CV upload with Claude Haiku structured parsing via Inngest background jobs
- Clients & contacts with a per-client management view and activity timeline
- Jobs and applications with a kanban pipeline and structured decline reasons
- Org dashboard and settings with mobile-responsive polish

It also includes a dedicated hardening plan (Plan 0) that lands missing infrastructure (`src/lib/ai/`, `src/lib/db/`, Inngest, Sentry, env validation) and resolves the security/tech-debt items in `.planning/codebase/CONCERNS.md` before any feature work begins.

**Out of scope for this phase:** semantic search, AI match scoring, public apply form, Gmail OAuth, LinkedIn capture (all Phase 2+). Embedding columns exist but no embeddings are populated.

</domain>

<decisions>
## Implementation Decisions

### Pre-work sequencing
- **D-01:** Plan 0 — **"Hardening & Infrastructure"** runs first, before any feature work in Tasks 3–7. Goal: feature tasks build on a clean, secure, properly-instrumented base.
- **D-02:** Plan 0 mandatory security fixes (must all land before Task 3 starts):
  - Rename `src/proxy.ts` → `src/middleware.ts` and verify the auth guard fires on every protected route via an integration check.
  - Fix the open-redirect in `src/app/auth/callback/route.ts` — validate `?next=` is a relative path (`startsWith('/') && !startsWith('//')`), otherwise fall back to `/`.
  - Add cross-tenant FK trigger guards for `contacts → companies`, `jobs → companies`, `applications → candidates`, `applications → jobs` to prevent inserts that reference another org's rows even when RLS doesn't block the insert.
  - Create Supabase Storage bucket for CVs with path-prefixed RLS policies (`{org_id}/{candidate_id}/...`) so Task 4 has somewhere safe to write.
- **D-03:** Plan 0 mandatory tech-debt cleanup (all land before features):
  - Regenerate `src/types/database.ts` from the live local Supabase instance and remove the `// @ts-nocheck` header. Fix any code that breaks as a result.
  - Fix `pnpm-workspace.yaml` placeholder string values (`sharp`, `supabase`, `unrs-resolver`) to real booleans or remove the `allowBuilds` block.
  - Install and configure `@sentry/nextjs` with `org_id` + `user_id` context on every captured event. Explicitly scrub PII (CV text, candidate emails) per `CLAUDE.md`.
  - Create `src/lib/env.ts` that validates required env vars at module load (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `INNGEST_*`) — fail loudly at boot if any are missing.
- **D-04:** Plan 0 also lands skeleton infrastructure that feature tasks will fill in:
  - `src/lib/db/` with at least `getProfile()` and `getOrganization()` helpers; refactor `src/app/(app)/layout.tsx` to use them. Establishes the pattern before Task 3 spreads inline queries.
  - `src/lib/ai/claude.ts` typed wrapper skeleton — model selection helper, retry/backoff, `record_ai_usage()` logging on every call. Used by Task 4.
  - Install `inngest` + create `src/lib/inngest/client.ts` and `src/app/api/inngest/route.ts`. No functions defined yet; Task 4 adds `parseCVOnUpload`.

### CV parsing (Task 4)
- **D-05:** Full Haiku schema in **a single tool-use call** — name, contact, location, current_role, current_company, work_history[], skills[], education[], salary estimates, seniority_level, years_experience_total, sector_tags[], confidence_per_field. Cheapest pipeline, simplest pattern; ~£0.005 per CV per `docs/plan.md`.
- **D-06:** Both **PDF and DOCX supported from day one**. Task 4 stores the raw file in Supabase Storage regardless of parse outcome, then attempts parsing in Inngest. On failure (parse error, rate limit after backoff, validation), the review panel surfaces a clear error message with a **manual Retry button** that requeues the Inngest job — preserves user agency, doesn't paper over failures.
- **D-07:** Confidence-per-field is captured in the structured output (Haiku returns a confidence value per extracted field). UX: display as inline badges in the review panel (e.g., `Skills · medium confidence`) so the recruiter knows what to verify before accepting.
- **D-08:** Parsed extraction never overwrites manually-entered candidate fields (per `docs/phase-1-tasks.md` Task 4). Only populates empty fields.

### Pipeline kanban (Task 6)
- **D-09:** Drag interaction uses **pending state during server confirm** — the card moves to the target column with a subtle pending indicator (opacity + small spinner); the server action writes the stage change + activity log entry; on success the indicator clears, on failure the card snaps back with a toast. Avoids the ambiguity of pure optimistic updates (where the user can't tell whether the activity log row actually wrote) and avoids the heavy feel of a full server-rendered drag.
- **D-10:** Reject flow uses a **modal dialog with required decline_reason enum + optional free-text notes**. Mirrors `docs/phase-1-tasks.md` Task 6 exactly. Free-text notes are written to the activity log as part of the same stage-change entry.
- **D-11:** Mobile fallback is a **stacked list grouped by stage**. On narrow viewports the kanban becomes a vertical list with stage headers; moving a candidate happens via tap → stage picker. Preserves the "look up a candidate while walking" use case from `CLAUDE.md`.
- **D-12:** Global pipeline at `/pipeline` reuses the same kanban component with filters (owner, job, client) in URL search params. No separate component tree.

### Search, sort & list UX (Tasks 3, 5)
- **D-13:** Keyword search uses **pg_trgm with ranked similarity** on candidate name/email/current_role and client name/industry. The `pg_trgm` extension is already enabled by `supabase/migrations/20260513152244_phase1_domain_schema.sql`. Plan 0 adds the GIN trigram indexes (`CREATE INDEX ... USING gin (... gin_trgm_ops)`) on the searchable columns.
- **D-14:** List interactions (sort, filter, pagination) are **server-side with URL search params** — sort key, sort direction, current page, and any active filters live in the URL. RSC re-renders on change. Pagination is offset/limit with sensible defaults (25/page). Aligns with App Router patterns, gives shareable URLs, keeps client bundles small.
- **D-15:** Default list sort orders:
  - Candidates: `last_contacted_at DESC NULLS LAST` (most recently engaged first)
  - Clients: `last_contacted_at DESC NULLS LAST`
  - Jobs: `created_at DESC` (newest first) with status filter defaulting to `open`
- **D-16:** Audit-log writes only on **candidate detail views** (`/candidates/[id]`). List views do NOT write to `audit_log` — matches `docs/phase-1-tasks.md` Task 3 and keeps write volume manageable. May be revisited in Phase 2 when GDPR self-service is added.

### Claude's Discretion
- Component composition within shadcn primitives (Table, Sheet, Dialog, Form, etc.) — pick the most idiomatic shadcn pattern.
- Form library: react-hook-form + zod per `CLAUDE.md` conventions. Use shadcn `<Form>` wrapper for consistent error styling.
- Specific Inngest function granularity (one function per task type vs grouped) — researcher/planner can decide.
- Specific Sentry breadcrumb/scope strategy — pick defaults that surface `org_id` + `user_id` on every captured event without leaking PII.
- Storage path encoding (raw filename vs uuid-prefixed) — pick what minimises collision risk while keeping the file recognisable in the Supabase dashboard.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project specs and conventions
- `CLAUDE.md` — Core principles, conventions, tech-stack lock, "what to never do", verification checklist
- `docs/plan.md` — Strategic plan, full data model, AI integration patterns, cost model, phase rationale
- `docs/phase-1-tasks.md` — Original Task 3–7 spec; this CONTEXT.md sequences and decides ambiguities, but the task specs remain the implementation guide
- `docs/ai-integration.md` — AI patterns and model selection (Haiku for CV parsing)
- `docs/recruitment-glossary.md` — Domain term definitions (RTR, market_status, etc.)

### Planning artifacts
- `.planning/PROJECT.md` — Project context, Validated/Active/Out-of-Scope requirements, Key Decisions
- `.planning/REQUIREMENTS.md` — v1 REQ-IDs with traceability table; Phase 1 maps FOUND-* (Complete), CAND-*, CV-*, CLIENT-*, PIPE-*, DASH-*
- `.planning/ROADMAP.md` — 5-phase MVP-mode roadmap with success criteria per phase
- `.planning/STATE.md` — Current position, completed work (Tasks 1–2 merged), pending work

### Codebase map
- `.planning/codebase/STACK.md` — Languages, runtime, dependency versions
- `.planning/codebase/ARCHITECTURE.md` — Pattern, layers, data flow, multi-tenancy enforcement
- `.planning/codebase/STRUCTURE.md` — Directory layout, naming, "where to add new code"
- `.planning/codebase/CONVENTIONS.md` — Code style, patterns, error handling (verified from configs)
- `.planning/codebase/INTEGRATIONS.md` — External services current state vs planned
- `.planning/codebase/CONCERNS.md` — **Critical** — tech debt, security risks, missing infrastructure that Plan 0 must address
- `.planning/codebase/TESTING.md` — Test framework state (none installed yet; Vitest + Playwright planned)

### Migrations (read-only — never edit)
- `supabase/migrations/20260513151021_init_organizations_and_users.sql` — Orgs, users, `current_organization_id()`, `handle_new_user()` trigger
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` — Full domain schema, RLS policies, `record_audit()`, `record_ai_usage()` functions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/supabase/server.ts` / `client.ts` / `middleware.ts` — typed Supabase clients; never instantiate outside this directory
- `src/components/ui/button.tsx`, `input.tsx`, `label.tsx` — shadcn primitives already installed; add more via `pnpm dlx shadcn@latest add ...`
- `src/components/app/top-nav.tsx`, `sign-out-button.tsx` — pattern for cross-route shared components
- `src/app/(app)/layout.tsx` — auth-guarded layout pattern; will refactor in Plan 0 to use `src/lib/db/` helpers
- `src/types/database.ts` — generated types; use `Tables<'candidates'>`, `TablesInsert<'jobs'>`, `Enums<'market_status'>` etc.
- DB functions: `current_organization_id()`, `record_audit(action, entity_type, entity_id)`, `record_ai_usage(model, input_tokens, output_tokens, purpose, cost_pence)` — call these from server actions, never duplicate the logic in app code

### Established Patterns
- **Route groups:** `(auth)` for unauth pages, `(app)` for auth-guarded CRM, `auth/` (no group) for callback/error utility routes — keep `/auth/...` URL prefix
- **Server actions for mutations:** co-located `actions.ts` next to the route page; import server Supabase client; call `record_audit()` / `record_ai_usage()` as required
- **Route handlers only for webhooks + public APIs:** `src/app/api/{name}/route.ts` — used for Inngest webhook in Plan 0
- **RLS-first multi-tenancy:** every domain table has `organization_id` with RLS policies referencing `current_organization_id()`. `set_organization_id()` triggers default the column on insert. Do not pass `organization_id` from client code — let RLS + triggers handle it.
- **Form pattern:** react-hook-form + zod (per `CLAUDE.md`); will use shadcn `<Form>` wrapper for consistency

### Integration Points
- `src/lib/db/` — to be created in Plan 0; all feature tasks consume from here, never inline `.from('candidates')`
- `src/lib/ai/claude.ts` — to be created in Plan 0; Task 4 calls `parseCV(...)` from here in an Inngest function
- `src/lib/inngest/client.ts` + `src/app/api/inngest/route.ts` — to be created in Plan 0; Task 4 registers `parseCVOnUpload`
- Supabase Storage bucket `cvs` (created in Plan 0) — Task 4 uploads here; RLS scopes reads to `{org_id}/` prefix
- `record_audit()` server action wrapper — establish in Plan 0; Task 3 calls it on every `/candidates/[id]` view

</code_context>

<specifics>
## Specific Ideas

- The pipeline kanban references the Trello/Firefish mental model but with a **structured decline reason gate** (modal, required enum) — this is a deliberate departure from generic kanbans where reject is a soft action.
- Search UX should feel forgiving: `pg_trgm` was chosen specifically so `"smyth"` finds `"Smith"`. The trigram index is on name/email/role for candidates and name/industry for clients.
- Dashboard "Candidates to follow up" widget should sort `hot → actively_looking → passively_looking` (market_status priority) per `docs/phase-1-tasks.md` Task 7.
- Settings page invite flow: invitee gets emailed an invitation token, signs up with that email, and is auto-linked to the inviting org. The `handle_new_user()` trigger's early-return guard (`supabase/migrations/20260513151021_init_organizations_and_users.sql:137-139`) was put there specifically to support this — see CONCERNS.md "fragile areas".

</specifics>

<deferred>
## Deferred Ideas

- **GDPR right-to-erasure flow** — `consent_basis`, `consent_at`, `consent_text_version` are captured but no consent-withdrawal or 30-day erasure flow exists. Add `consent_withdrawn_at` + anonymisation pattern as a Phase 3 task before any live external data.
- **Audit on view events for list/search queries** — Currently detail-view only. Revisit in Phase 2 when GDPR self-service lands and external data accumulates.
- **HNSW vector index** — Deferred to Phase 2 when embeddings are populated (HNSW build cost is meaningful and pointless on empty tables).
- **`ai_summaries` table** — Phase 2 caching for match explanations and conversation summaries. Not needed in Phase 1.
- **`shortlists` and `placements` tables** — Phase 3 for shortlists, Phase 4 for placements (revenue events).
- **CV email-inbox intake** — Phase 2 (`apply@…` webhook). Phase 1 is upload-only.
- **Re-parse CV on demand** — Phase 2. Phase 1 parses once on upload; failed parses use Retry button.
- **Tests** — Vitest + Playwright are not yet installed. CLAUDE.md says "Unit tests for `lib/` utilities… E2E for critical flows (sign up, create candidate from CV, search, create job, move through pipeline)". Planner should decide whether to install in Plan 0 (recommended) or after Task 4 lands the AI wrapper. Either way Task 7 must include at least one Playwright E2E covering the full Tasks 3–6 flow.

</deferred>

---

*Phase: 1-internal-ats*
*Context gathered: 2026-05-17*
