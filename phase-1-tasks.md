# Phase 1 — Task Breakdown

Goal of Phase 1: anchor customer can use the app internally to manage candidates, clients, jobs, and a basic pipeline. CV uploads parse via AI. GDPR consent captured. Multi-tenant from day one.

Estimated effort: ~3 weeks part-time.

Each task is a discrete unit of work intended for one Claude Code session. Tasks are ordered — do not skip ahead. After each task, run verification before moving on.

---

## Task 1 — Project scaffold + auth shell

**Outcome**: A running Next.js app with Supabase wired up, a sign-up flow that creates an organisation, and a basic authenticated layout.

**Scope:**
- Initialise Next.js 15 with TypeScript strict mode, App Router, Tailwind, pnpm
- Install and configure shadcn/ui with sensible defaults (`pnpm dlx shadcn@latest init`)
- Set up Supabase locally with `supabase init`; configure `.env.local` and `.env.example`
- Implement `src/lib/supabase/server.ts` and `src/lib/supabase/client.ts` per Supabase SSR patterns
- Set up middleware for auth session refresh
- Create migration for `organizations` + `users` tables (just these two for now) with RLS enabled
- Sign-up flow: user signs up → row created in `auth.users` → trigger creates `organizations` row + `users` row linking them with role='owner'
- Sign-in flow: email + magic link via Supabase Auth
- Authenticated layout: top nav, sign-out, placeholder pages for Candidates / Clients / Jobs / Pipeline / Settings
- Sentry installed and configured

**Out of scope:**
- Any domain CRUD (candidates, clients, jobs) — that's later tasks
- AI integration — Task 3+
- Styling polish beyond shadcn defaults

**Verification:**
- `pnpm dev` runs without error
- Sign up creates auth user + organisation + user row, visible in Supabase Studio
- Sign in works, signed-in user can reach the placeholder pages
- Sign out works
- TypeScript and lint pass

---

## Task 2 — Database schema + RLS policies

**Outcome**: Full Phase 1 schema applied, RLS policies enforcing tenant isolation, types generated.

**Scope:**
- Migration for full Phase 1 schema (see `docs/plan.md` data model section). Tables required:
  - `companies` (with `last_contacted_at` field for dormant view later)
  - `contacts`
  - `candidates` (include `market_status` enum, `source` enum, GDPR fields: `consent_basis`, `consent_at`, `consent_text_version`)
  - `candidate_cvs` (file metadata + extracted JSON + version)
  - `jobs` (include `job_type` enum, `hiring_context` enum, `status` enum)
  - `applications` (junction with `stage` enum, `application_type` enum for standard/spec/float, `decline_reason` enum)
  - `activities` (polymorphic via `entity_type` + `entity_id` + check constraint listing valid types)
  - `audit_log`
  - `ai_usage` (org_id, model, input_tokens, output_tokens, purpose, cost_pence, created_at)
- Enable `pgvector` and `pg_trgm` extensions
- Reserve placeholder columns: `candidate_embedding halfvec(1024)`, `job_embedding halfvec(1024)` — actual population comes in Phase 2
- Helper function `current_organization_id()` returning the current user's org from auth context
- RLS policies on every table: select/insert/update/delete all gated by `organization_id = current_organization_id()`
- Insert trigger on candidates/companies/jobs/applications to default `organization_id` from the auth context
- Generate TypeScript types: `supabase gen types typescript --local > src/types/database.ts`
- Seed file with one demo org + user + a handful of companies, contacts, candidates, jobs for development

**Out of scope:**
- UI for any of these tables — Task 3 onwards
- Temp/contract tables (assignments, timesheets) — Phase 6
- Embeddings actually generated — Phase 2

**Verification:**
- Migration applies cleanly to a fresh DB
- Seed runs without error
- Manual RLS test: two seeded orgs, sign in as one, can only see own org's data via Supabase JS client
- Generated types compile

---

## Task 3 — Candidates module + GDPR + audit log

**Outcome**: Full candidate CRUD with list view, detail view, manual creation form, GDPR consent capture on create, audit log writes on every read of candidate detail.

**Scope:**
- List view at `/candidates` — table with name, current role/company, location, market_status, last contacted, source. Sortable. Searchable by name/email (keyword for now, semantic search in Phase 2). Pagination.
- Detail view at `/candidates/[id]` — all fields, activity timeline (from `activities` table), CV history (from `candidate_cvs`).
- Create form at `/candidates/new` — manual entry. GDPR consent section: source dropdown, basis (consent / legitimate_interest), required tickbox + privacy text. On submit, store `consent_basis`, `consent_at`, `consent_text_version`.
- Edit form at `/candidates/[id]/edit`.
- Activity creation from the detail view: "Add note", "Log call", "Log meeting" — writes to `activities`.
- Audit log: every read of `/candidates/[id]` writes a row to `audit_log` (`actor_id`, `entity_type='candidate'`, `entity_id`, `action='view'`, `at`). Implement via server action.
- Server actions for all mutations, using Supabase server client. Types from `database.ts`.
- Forms use react-hook-form + zod validation.

**Out of scope:**
- CV upload + AI parsing (Task 4)
- Semantic search (Phase 2)
- Bulk import (Phase 5 onboarding)
- Self-service candidate page (Phase 2)

**Verification:**
- Create candidate manually, see in list, open detail, edit, see updates
- Create another candidate, log a note, see activity in timeline
- Check `audit_log` table after viewing a detail page — row written
- Try creating without GDPR consent → blocked with clear error
- RLS test: candidate created in org A invisible to user in org B

---

## Task 4 — CV upload + AI parsing

**Outcome**: Upload a CV (PDF or docx), it stores to Supabase Storage, gets parsed by Claude Haiku into structured fields, populates a candidate record. Cost logged.

**Scope:**
- Install `@anthropic-ai/sdk`
- Create `src/lib/ai/claude.ts` typed wrapper:
  - `parseCV(fileBuffer, mimeType, organizationId): Promise<ParsedCV>` using Haiku with tool-use schema
  - Schema captures: name, email, phone, location, current_role, current_company, work_history[], skills[], education[], salary_current_estimate, salary_expectation_estimate, seniority_level, years_experience_total, sector_tags[], confidence_per_field
  - On every call: log to `ai_usage` (model, tokens in/out, purpose='cv_parse', org_id, cost_pence calculated from token counts)
  - Handle errors: rate limit (retry with backoff), validation (return clear error), timeout (fail gracefully)
- Set up Inngest for background processing — install, configure dev server, create a function `parseCVOnUpload`
- CV upload form on candidate create + candidate detail (versioned):
  - Upload to Supabase Storage `cvs/{org_id}/{candidate_id}/{uuid}-{filename}`
  - Insert row in `candidate_cvs` with `parsing_status='pending'`
  - Trigger Inngest function with the storage path + candidate_id
  - Inngest function: downloads file, calls `parseCV`, writes structured output back to `candidate_cvs.extracted_data` (JSONB), sets `parsing_status='complete'`, updates candidate row fields where they're currently empty (don't overwrite manually-entered data)
- Candidate detail shows parsing status. When complete, show a "Review extracted data" panel — recruiter can accept or edit fields.
- CV preview in detail view (PDF.js for PDFs, server-side conversion for docx not needed yet — show download button)

**Out of scope:**
- Embeddings (Phase 2)
- Re-parsing on demand (Phase 2)
- CV parsing from email forwards (Phase 2)

**Verification:**
- Upload a real CV, see parsing status transition pending → complete in <30s
- Extracted data shows in review panel
- `ai_usage` row exists with non-zero token counts and cost
- Upload a corrupt file → parsing_status='failed', error message visible, app doesn't crash
- Cost per CV should be approximately £0.01 or less

---

## Task 5 — Clients & contacts module

**Outcome**: Full client/contact CRUD with list view, per-client management view, contact management nested under clients.

**Scope:**
- List view at `/clients` — table with name, industry, last contacted, active jobs count, total placements, dormant flag (>60 days no contact). Sortable.
- Detail view at `/clients/[id]` — the "management page" required by anchor customer:
  - Header: name, industry, key dates
  - Contacts tab: list of contacts with role, email, phone, last contacted
  - Jobs tab: active jobs + historical jobs (with placement outcomes when those exist later)
  - Activity tab: combined timeline of all activities against client + contacts + jobs
  - Notes section for client-level notes
- Create/edit forms for client
- Nested create/edit/delete for contacts under a client
- Activity logging (same pattern as candidate)
- Update `last_contacted_at` on client/contact whenever an activity is logged

**Out of scope:**
- Dormant view dashboard widget (Phase 3)
- Revenue + LTV calculations (Phase 4 when placements are formalised)
- Fee agreement management UI (Phase 3)

**Verification:**
- Create client, add 2 contacts, log notes against each
- Activity timeline shows entries from both contacts + client
- Client detail page loads in <1s with seeded data

---

## Task 6 — Jobs + applications + pipeline kanban

**Outcome**: Create jobs against clients, link candidates as applications, move them through stages on a kanban view.

**Scope:**
- Create job form at `/clients/[id]/jobs/new` — title, type (perm/temp/contract), hiring_context (new/backfill), location, salary range, description, owner. Default fee% from client agreement if present (skip for now, just use a placeholder field).
- Job detail at `/jobs/[id]` — fields, applications list, pipeline view tab.
- "Add candidate to job" — search/select existing candidate, creates `application` with stage='applied' and application_type='standard'.
- Pipeline kanban view at `/jobs/[id]/pipeline`:
  - Columns: applied / screening / submitted / 1st interview / 2nd interview / offer / placed
  - Cards: candidate name, current role, days in stage
  - Drag to move (use `dnd-kit`)
  - Reject button on each card opens dialog with required `decline_reason` enum selector
  - Stage changes write to `activities` automatically with `entity_type='application'`
- Global pipeline view at `/pipeline` — same kanban but aggregated across all open jobs, filterable by owner/job/client

**Out of scope:**
- Submission tracking (Phase 2 — when "submitted to client" gets richer)
- Float/spec applications (Phase 3)
- Pipeline value calculations (Phase 4)
- Email notifications on stage change (Phase 4)

**Verification:**
- Create a job, add 3 candidates as applications
- Drag a card between stages, see activity log entry
- Reject a candidate with required reason
- Global pipeline view shows all applications across jobs

---

## Task 7 — Basic dashboard + Phase 1 polish

**Outcome**: A landing dashboard showing org-level activity. Phase 1 ready for anchor customer to start using internally.

**Scope:**
- Dashboard at `/` (when authenticated) — replace placeholder home with:
  - Cards: total candidates / active jobs / open applications / placements this month (placements = 0 for now, hook for Phase 4)
  - Recent activity feed (last 20 entries from `activities`, with links)
  - Stale applications widget: applications in same stage >14 days
  - "Candidates to follow up": candidates with no activity in 30+ days, sorted by market_status priority (hot first)
- Settings page at `/settings`:
  - Profile: name, email
  - Organisation: name, optional logo upload
  - Users: invite teammate by email (creates invitation; teammate signs up with that email → joins org)
- Empty states for every list view (helpful CTAs, not blank screens)
- Loading states (skeletons via shadcn)
- 404 and error pages
- Mobile-responsive check on all main views — usable on a phone for "look up a candidate while walking"
- Brief README in repo root with local setup instructions

**Out of scope:**
- Reporting dashboards (Phase 4)
- Per-org branding beyond logo (Phase 5)
- Onboarding tour (Phase 5)

**Verification:**
- Fresh sign-up → see useful empty dashboard with clear CTAs
- Existing user with data → dashboard shows real numbers and recent activity
- Invite a colleague, they receive email, sign up, join the same org
- Open on a phone, all critical flows work
- All Phase 1 tasks marked complete; anchor customer can be onboarded

---

## After Phase 1

Demo to anchor customer. Get 2 weeks of real usage. Take a list of papercuts. Fix the worst ones. Then proceed to Phase 2 (semantic search + apply form + Gmail).
