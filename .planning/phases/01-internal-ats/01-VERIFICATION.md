# Phase 1 Plan Verification

**Date:** 2026-05-17
**Plans verified:** Plan 0–5 (`01-plan-0-hardening.md` through `01-plan-5-dashboard.md`)
**Verdict:** PASS WITH REVISIONS

## Verdict summary

The six plans collectively cover every Phase 1 success criterion and every REQ-ID (CAND-*, CV-*, CLIENT-*, PIPE-*, DASH-*). Sequencing is correct: Plan 0 lands the infrastructure that Plans 1–5 consume, and feature dependencies (Plan 2 on 1, Plan 3 on 0, Plan 4 on 1/3, Plan 5 on all) are stated and consistent. However the planner left **eight open issues unresolved**, and direct inspection of `supabase/migrations/20260513152244_phase1_domain_schema.sql` settles them: most are non-blocking with one-line patches, but **two are BLOCKERS** — the `decline_reason` enum on disk does NOT match the UI-SPEC label table (different value names and only 9 values vs 11), and `organizations.logo_url` does not exist. Apply the inline patches in "Required revisions" and execution can begin.

## A. Goal coverage

### Success criteria mapping

| # | Criterion (abbreviated) | Plan | Tasks | Covered? |
|---|---|---|---|---|
| 1 | Create candidate w/ consent, view/edit, log calls/notes, blocked w/o consent | Plan 1 | 1.1–1.3 | Yes |
| 2 | Upload CV, background AI parsing, review/accept extracted data | Plan 2 | 2.1–2.3 | Yes |
| 3 | Create client, nested contacts, combined activity timeline | Plan 3 | 3.1–3.3 | Yes |
| 4 | Job + applications + drag kanban + structured decline + activity log | Plan 4 | 4.1–4.3 | Yes (with decline-reason patch — see Required Revisions) |
| 5 | Dashboard metrics + activity feed + stale + follow-up | Plan 5 | 5.1 | Yes |
| 6 | Invite teammate by email, joins same org | Plan 5 | 5.2 | Yes (depends on Plan 0 trigger update — wired) |

### REQ-ID coverage

| REQ-ID | Plan | Notes |
|--------|------|-------|
| CAND-01..07 | Plan 1 | All seven mapped to tasks 1.1–1.3 |
| CV-01..05 | Plan 2 | CV-04/05 satisfied by Plan 0's `claude.ts` + `record_ai_usage()` wiring |
| CLIENT-01..05 | Plan 3 | CLIENT-05 satisfied by the `bump_last_contacted_at` trigger in Plan 3 Task 3.1 |
| PIPE-01..06 | Plan 4 | PIPE-05 satisfied by `move_application` RPC + DB CHECK |
| PIPE-06 (global) | Plan 4 Task 4.3 | URL-param filter version (D-12) |
| DASH-01..06 | Plan 5 | DASH-06 mobile polish split across Plan 5 Task 5.3 |
| FOUND-01..06 | Already merged | Tasks 1–2 pre-existing |

No requirement uncovered.

## B. Decision honouring (D-01..D-16)

| Decision | Status | Plan / Task |
|----------|--------|-------------|
| D-01 (Plan 0 first) | Honoured | Plan 0 stated `Depends on: none`; Plan 1 explicitly depends on Plan 0 |
| D-02 (mandatory security fixes) | Honoured | Plan 0 Task 0.1 (middleware rename + open-redirect), Task 0.6 (FK guards + storage bucket) |
| D-03 (mandatory tech-debt) | Honoured | Plan 0 Task 0.2 (env + types regen + pnpm-workspace), Task 0.5 (Sentry) |
| D-04 (skeleton infra) | Honoured | Plan 0 Task 0.3 (db/), 0.4 (Inngest + claude wrapper) |
| D-05 (Haiku single tool-use) | Honoured | Plan 2 Task 2.2 calls `parseCV()` (skeleton landed in Plan 0 Task 0.4) |
| D-06 (PDF + DOCX, retry button) | Honoured | Plan 2 Task 2.1 mime allowlist, Task 2.3 amber alert + retry |
| D-07 (confidence-per-field badges) | Honoured | Plan 2 Task 2.3 — `ConfidenceBadge` component |
| D-08 (no overwrite of manual fields) | Honoured | Plan 2 Task 2.1 `markCandidateFieldsFromCV` empty-only patch + Plan 2 verification step |
| D-09 (pending-state pattern) | Honoured | Plan 4 Task 4.3 PipelineBoard skeleton + pending UI |
| D-10 (decline modal with required reason) | Partially — see Blocker B1 | Plan 4 Task 4.3 builds the modal but the enum-vs-label divergence is unresolved |
| D-11 (mobile stacked list) | Honoured | Plan 4 Task 4.3 PipelineMobileList |
| D-12 (global `/pipeline` reuses component) | Honoured | Plan 4 Task 4.3 step 10 |
| D-13 (pg_trgm keyword search) | Honoured | Plan 0 Task 0.6 indexes, Plan 1 Task 1.1 `search_candidates`, Plan 3 Task 3.1 `search_clients` |
| D-14 (URL-search-param pagination) | Honoured | Plan 1 Task 1.2 + Plan 3 Task 3.2 |
| D-15 (default list sort orders) | Honoured | Each list page states the default sort |
| D-16 (audit only on detail views) | Honoured | Plan 1 Task 1.1 explicit `MUST NOT call record_audit` in `listCandidates`; `MUST call` in `getCandidate` |

All locked decisions traced to plan + task. No silent contradictions.

## C. Sequencing

### Inter-plan dependency claims (all verified consistent)

- Plan 1 `Depends on: Plan 0` — correct (uses `src/lib/db/`, env, claude wrapper, middleware, trigram indexes)
- Plan 2 `Depends on: Plan 0 + Plan 1` — correct (CV upload extends candidate detail page from Plan 1; consumes `cvs` bucket + Inngest + claude wrapper from Plan 0)
- Plan 3 `Depends on: Plan 0` only — correct (does not require Plan 1 except for the shared `<ActivityTimeline>` component, with documented fallback)
- Plan 4 `Depends on: Plan 0 + 1 + 3` — correct (needs candidates from Plan 1, clients from Plan 3, FK guards from Plan 0)
- Plan 5 `Depends on: Plans 0–4` — correct (dashboard surfaces all four feature areas; invite flow depends on Plan 0's `handle_new_user_invite.sql` migration; golden-path E2E covers Plans 1–4)

### CONCERNS.md Critical + High closure

Walked every Critical / High item:

| Concern | Plan 0 task | Closed? |
|---------|-------------|---------|
| Missing `src/lib/ai/` | Task 0.4 | Yes |
| Missing `src/lib/db/` | Task 0.3 | Yes |
| Missing Inngest | Task 0.4 | Yes |
| Missing Sentry | Task 0.5 | Yes |
| `// @ts-nocheck` in database.ts | Task 0.2 | Yes |
| `pnpm-workspace.yaml` placeholders | Task 0.2 | Yes |
| `src/proxy.ts` middleware risk | Task 0.1 | Yes |
| Inline DB queries in layout | Task 0.3 | Yes |
| Open-redirect in `?next=` | Task 0.1 | Yes |
| Env-var `!` non-null assertions | Task 0.2 | Yes |
| Storage bucket RLS for CVs | Task 0.6 | Yes |
| Cross-tenant FK guards (contacts, jobs, applications) | Task 0.6 | Yes |
| Zero tests / no Vitest+Playwright | Task 0.7 | Yes |
| `handle_new_user()` invitation fragility | Task 0.6 (invite migration) | Yes |

**Missing from Plan 0** (CONCERNS.md mid-tier items not addressed):
- `set_organization_id()` lacking `security definer` / `search_path` guard — CONCERNS marks as security risk but Plan 0 does not include a migration that adds `set search_path = public` to this trigger function. NON-BLOCKING but should be added — small inline patch (see Required Revisions §R3).
- Resend / PostHog wiring — explicitly Phase 5 per CONCERNS "Deferred from Phase 1"; OK to skip.
- HNSW vector index — explicitly Phase 2; OK to skip.

## D. Planner-flagged open issues

| # | Issue | Truth (from inspecting migrations) | Classification | One-line patch |
|---|-------|-----------------------------------|---------------|----------------|
| 1 | `application_stage` enum: `cv_submitted` vs `submitted` | Schema line 42–52 confirms enum **uses `'cv_submitted'`** — matches RESEARCH §21 | **NON-BLOCKING** | Plan 4 Task 4.3 step 3 — change "verify against the actual enum values; if `'submitted'` is in the enum instead" to a flat statement: "STAGES = `['applied','screening','cv_submitted','first_interview','second_interview','offer','placed']` — verified against `application_stage` enum (migration line 42)" |
| 2 | `decline_reason` enum-label parity | Schema line 56–66 has **9 values, totally different names** from UI-SPEC's 11: schema = `not_qualified, salary_mismatch, location_mismatch, candidate_withdrew, client_rejected_skills, client_rejected_culture, client_filled_internally, client_filled_other, other`; UI-SPEC = `overqualified, underqualified, salary_mismatch, location_mismatch, skills_gap, culture_fit, withdrew, position_filled_internally, no_response, client_rejected, other` | **BLOCKER** | See Required Revisions §R1 — must reconcile UI-SPEC labels to actual enum OR add an additive migration that expands the enum |
| 3 | Decline activity body string (raw enum vs human label) | Schema is `not_qualified`-style snake_case; activity body would render `'Declined — not_qualified'` | **NON-BLOCKING** (once #2 reconciled) | Plan 4 Task 4.3 — frontend `<ActivityTimeline>` already plans to label-map; lock that mapping into a single helper `formatDeclineReason()` in `src/lib/legal/decline-reasons.ts` (or similar) referenced by BOTH the modal Select and the timeline. Patch in §R1. |
| 4 | `organizations.logo_url` may not exist | Confirmed via grep on both migrations: column does NOT exist | **BLOCKER** for Plan 5's stated UI; **NON-BLOCKING** if scope is reduced | See Required Revisions §R2 — either add an additive migration `<ts>_organizations_logo_url.sql` adding the column, or drop the org-logo field from Plan 5 Task 5.2 entirely. Recommend: add the migration (1 line) since Plan 5 already lists logo as an explicit field. |
| 5 | `auth.users.last_sign_in_at` not accessible to `authenticated` | True — `auth` schema is not exposed | **NON-BLOCKING** | Plan 5 Task 5.2 step 6 already says "OK to defer to Plan 5 polish if it ramps complexity. At minimum, the list should be visible." Lock in: "Phase 1 InvitationsList lists all users in the org with no pending/accepted distinction — `last_sign_in_at` check deferred to Phase 2." |
| 6 | E2E Inngest orchestration | Playwright config in Plan 0 Task 0.7 does not start Inngest | **NON-BLOCKING** | Plan 5 Task 5.3 step 5 — pick option (c) of the three the planner proposes: skip the CV-upload assertion in the golden-path E2E and verify CV parsing manually + via Plan 2's plan-level verification list. Add `test.skip('CV parsing — verified manually + Plan 2 plan-level checks', ...)` placeholder. Keeps CI deterministic without changing the E2E shape. |
| 7 | Anthropic pricing constants are estimates | True — RESEARCH open question #2 already deferred this to Plan 5 Task 5.3 step 7 | **NON-BLOCKING** | No change — Plan 5 already addresses with a manual verification step. |
| 8 | `src/components/app/activity-timeline.tsx` ownership across plans | Plan 1 creates it (Task 1.3); Plan 3 extends it (Task 3.3); Plan 5 reuses it (Task 5.1 RecentActivityFeed re-uses the icon mapping but not the component itself) | **NON-BLOCKING** | Plan 3 Task 3.3 already states "extend polymorphic branch". Add to Plan 3 Required reading: "src/components/app/activity-timeline.tsx (created by Plan 1 Task 1.3 — Plan 3 extends; if Plan 1 hasn't merged, create the file from the Plan 1 spec)". |

## E. Task quality findings

Spot-checked tasks across plans; flagging items that need tightening:

- **Plan 0 Task 0.5 — Sentry**: step 1 runs `pnpm dlx @sentry/wizard@latest -i nextjs --saas` interactively. CI / future re-runs may not have that wizard. **WARNING:** add a fallback "if the wizard prompts for unrelated configuration, accept all defaults and overwrite the generated files in step 2 with the RESEARCH §6 skeletons." Documented enough but a re-runner could trip up.
- **Plan 1 Task 1.2 — list page**: Next.js 16 makes `searchParams` a Promise per the plan's note; ensure the page signature is actually `async function Page({ searchParams }: { searchParams: Promise<{...}> })`. The plan says this once in plain text — could be clearer in the file template. **NON-BLOCKING**.
- **Plan 2 Task 2.2 — Inngest function PII risk**: the `try/catch` in step 3 says "no PII — pass `{ tags: { layer: 'inngest', function: 'parse-cv-on-upload', candidate_cv_id } }`". The Sentry `beforeSend` from Plan 0 is the actual scrub, but the catch must NOT pass the original error message verbatim if it could contain CV text (some Claude SDK errors echo prompt fragments). **WARNING:** Plan 2 should explicitly state "the catch passes only `error.name` + `error.status` to Sentry — never `error.message` (may contain prompt fragments)". See §R4.
- **Plan 2 Task 2.1 step 2 (`markCandidateFieldsFromCV`)**: the helper schema fields `seniority_level`, `salary_current_estimate`, `salary_expectation`, `years_experience`, `sector_tags`, `skills` ARE on the `candidates` table (confirmed migration lines 199–231). The plan says "skills/work_history/education/sector_tags belong in `extracted_data` JSONB on the CV row, not on the candidate (the candidate table doesn't have those columns — verify against the schema before mapping)". **NON-BLOCKING but inaccurate:** `skills` and `sector_tags` ARE columns on candidates. Patch in §R5 — `markCandidateFieldsFromCV` should populate them (empty-array check, not null check, per D-08).
- **Plan 3 Task 3.3** — the contact-edit route ambiguity ("inline Sheet OR a separate route — pick the simpler shape"). Ambiguous tasks invite scope drift. **WARNING:** lock to one — recommend separate route mirroring Plan 1's candidate edit pattern. See §R6.
- **Plan 4 Task 4.3 step 7 (`PipelineShell`)**: plan offers two implementation paths (`matchMedia` hook vs Tailwind `hidden`/`block`). The second renders BOTH trees client-side which doubles the rendered DOM and ships both component bundles. Lock to the `useMediaQuery` approach for clarity. **NON-BLOCKING / preference**. See §R7.
- **Plan 5 Task 5.2 step 5**: the `inviteTeammateAction` uses `createServiceClient().auth.admin.inviteUserByEmail(...)`. Plan 0 must ensure `createServiceClient()` is server-only and that `inviteTeammateAction` runs inside a server action context that has first verified the caller's role via the user-scoped client (RLS). The plan does say "Reject if role is not 'owner'" but it should explicitly do the role check using the **user-scoped** Supabase client (not the service-role client) BEFORE invoking the admin call. **WARNING:** see §R8.
- **Plan 5 Task 5.3 — mobile audit**: "audit every primary CTA" is a sprawling task (≈10 surfaces). Sizing-wise, this is fine but the executor will benefit from a concrete checklist; the plan has one inline. OK.

## F. Risks the planner missed

1. **`set_organization_id()` `search_path` hardening** — CONCERNS.md flags this; Plan 0 doesn't include a migration to fix it. **WARNING**. Add 4-line migration. See §R3.
2. **`unpdf` + `mammoth` PDF/DOCX size limit** — Plan 2 caps text at 60k chars but doesn't cap the raw file size at extraction time. The 50 MiB Storage bucket limit is the only guard. A 50 MiB PDF runs `unpdf` synchronously inside Inngest; could blow memory on small Inngest runners. **NON-BLOCKING** (50 MiB is unlikely in practice; Inngest retries are bounded), but add a sanity check: reject files > 10 MiB at the upload action level. See §R9 (optional).
3. **Plan 2 cost-log invariant**: `parseCV()` wraps the `record_ai_usage` RPC in try/catch (plan says so). If the RPC call fails (network blip, RLS bug), the CV parse still succeeds but no cost row is written, violating CLAUDE.md "non-negotiable" cost tracking. **WARNING:** the try/catch should at minimum capture to Sentry with a high-severity tag so missed cost rows are visible. Plan 0 Task 0.4 already says "captures to Sentry" — confirm the exact tag/severity is set in the wrapper template. NON-BLOCKING but lock the contract.
4. **Plan 4 — `decline_reason` in the modal Select must match what `move_application` accepts.** Once §R1 is applied, the Select option values must be the actual enum values (`not_qualified`, etc.), with the human label mapped from `formatDeclineReason()`. The plan currently lists the UI-SPEC names. Tied to Blocker B1.
5. **Plan 1 Task 1.2 — `sonner` install timing**: the plan installs `sonner` and injects `<Toaster />` in `(app)/layout.tsx` inside Plan 1. Plan 0 already modifies that layout. **NON-BLOCKING:** trivial merge; just document. Could optionally move sonner install to Plan 0 alongside the other shared deps for tidier diff history. NON-BLOCKING / preference.
6. **Plan 5 Task 5.1 — placements query**: `placementsThisMonth` is hardcoded 0. The migration has no `placements` table (CONCERNS confirms it's Phase 4). DASH-01 reads "placements this month" — accepting hardcoded 0 satisfies the schema-of-truth but the dashboard label should say "Placements (coming Phase 4)" or similar to avoid an executor leaving "0" with no caveat. **NON-BLOCKING / UX nit**.
7. **Cross-plan migration timestamp ordering** — Plan 0 generates 4 migrations; Plan 1 generates 1; Plan 3 generates 3; Plan 4 generates 2. As long as each plan runs its `date -u +%Y%m%d%H%M%S` at execution time, ordering is monotonic. The plans say "increment by one second between files so they sort deterministically". **NON-BLOCKING**, but Plan 3's `client_activity_timeline` view references `activities` which exists from the base schema — no inter-plan ordering bombshell.
8. **No verification that `record_audit` is wired in the candidates list action OUT of bounds**: Plan 1's verification step `grep -n "record_audit" src/lib/db/candidates.ts` confirms it's IN `getCandidate` but doesn't assert it's ABSENT from `listCandidates`. The current Plan 1 verification line says "and NOT inside `listCandidates`" — good. No revision needed; noted as a positive.

## Required revisions

Apply these inline before execution begins. Total: **10 small patches** (within the PASS WITH REVISIONS budget).

### R1 (BLOCKER) — Plan 4 Task 4.3 step 5: reconcile `decline_reason` enum to the real schema

The real `decline_reason` enum (migration line 56–66) has 9 values: `not_qualified, salary_mismatch, location_mismatch, candidate_withdrew, client_rejected_skills, client_rejected_culture, client_filled_internally, client_filled_other, other`.

Apply:
1. Update Plan 4 Task 4.3 step 5 (`DeclineModal`) — list Select options as the **actual enum values**, mapped to human labels via a new shared helper:
   - Create `src/lib/legal/decline-reasons.ts` exporting `DECLINE_REASONS: Array<{ value: Enums<'decline_reason'>; label: string }>` and `formatDeclineReason(value)`. Mapping:
     - `not_qualified` → "Not qualified"
     - `salary_mismatch` → "Salary mismatch"
     - `location_mismatch` → "Location / relocation"
     - `candidate_withdrew` → "Candidate withdrew"
     - `client_rejected_skills` → "Client rejected — skills"
     - `client_rejected_culture` → "Client rejected — culture"
     - `client_filled_internally` → "Filled internally"
     - `client_filled_other` → "Filled (other source)"
     - `other` → "Other"
   - `<DeclineModal>` Select renders from `DECLINE_REASONS`.
   - `<ActivityTimeline>` rendering for `kind='stage_change'` with `metadata.decline_reason` calls `formatDeclineReason(metadata.decline_reason)` to produce the human label.
2. Update Plan 4 Task 4.1 step 1 (the `move_application` migration) — leave the activity body as raw enum (`'Declined — not_qualified'`); the frontend mapping handles presentation. This is the planner's option (b) — explicitly choose it.
3. Update UI-SPEC §Decline Reason Labels (`01-UI-SPEC.md` line 278+) to use the 9 real enum values + the labels above. Do NOT add `overqualified`, `underqualified`, `skills_gap`, `culture_fit`, `withdrew`, `position_filled_internally`, `no_response`, `client_rejected` — they don't exist in the schema and adding them would require a non-trivial enum migration (additive only — Postgres allows `alter type ... add value`; would also need to drop the obsolete UI-SPEC values from the table).

(Alternative: add an additive migration that grows the enum to match the UI-SPEC. This is a bigger change with more downstream impact and we recommend AGAINST for Phase 1 — schema names are the source of truth.)

### R2 (BLOCKER) — Plan 5 Task 5.2 step 3: `organizations.logo_url`

Column does not exist. Two options:

- **Option A (recommended, smaller change):** Plan 5 Task 5.1 — add a new migration step: create `supabase/migrations/<ts>_organizations_logo_url.sql` containing `alter table public.organizations add column if not exists logo_url text;`. Lift the logo-url field requirement from Plan 5 Task 5.2 step 3 from "verify the schema first" to "this migration in step X adds the column; OrganizationForm renders a plain text field for `logo_url` (full upload UI deferred to Phase 2)".
- **Option B:** drop the logo field from Plan 5 entirely; Settings shows only org `name`. Defer logo to Phase 5 SaaS shell.

Pick Option A — it's a 1-line migration and DASH-04 says "edit profile (name, email) and organisation (name, logo)".

### R3 (WARNING) — Plan 0 Task 0.6: harden `set_organization_id()` `search_path`

Add a 5th migration to Task 0.6: `<ts>_harden_set_organization_id.sql` containing:
```sql
create or replace function public.set_organization_id()
returns trigger
language plpgsql
set search_path = public
as $$ ... existing body ... $$;
```
(Copy body from `20260513152244_phase1_domain_schema.sql:86-99`; only adds `set search_path = public`.) Closes the CONCERNS.md "Security Considerations / `set_organization_id()` lacks `search_path` guard" item.

### R4 (WARNING) — Plan 2 Task 2.2 step 3: scrub error.message at Sentry call

Update the catch block spec:
- Replace "no PII — pass `{ tags: { layer, function, candidate_cv_id } }`" with "Pass `Sentry.captureException(new Error(error.name + ': ' + (error.status ?? 'unknown')), { tags: { ... } })`. Do NOT pass the original `error` object — some Claude/Anthropic SDK errors embed prompt fragments in `error.message` and would bypass the global `beforeSend` scrub which only redacts known PII keys."

### R5 (WARNING / accuracy fix) — Plan 2 Task 2.1 step 2: `markCandidateFieldsFromCV` field list

Replace the misleading "the candidate table doesn't have those columns" comment with the actual mapping. `candidates` columns AVAILABLE to populate (migration line 199–231):
- Scalars: `email`, `phone`, `location`, `current_role_title`, `current_company`, `seniority_level`, `salary_current_estimate`, `salary_expectation`, `currency`, `years_experience`
- Arrays: `skills`, `sector_tags` (treat empty `{}` as "empty", not as "set")
NOT on candidates: `work_history`, `education` — those live ONLY in `extracted_data` JSONB on the CV row.

The empty-field check for arrays is `Array.isArray(currentRow[k]) && currentRow[k].length === 0`.

### R6 (WARNING) — Plan 3 Task 3.3: lock contact-edit pattern

Replace the "inline edit Sheet OR a separate route — pick the simpler shape" line with: "Use a separate route `/clients/[id]/contacts/[contactId]/edit` mirroring Plan 1's `/candidates/[id]/edit`. RHF + zod; same schema as create form; reuses `updateContactAction` from `[id]/actions.ts`."

### R7 (NON-BLOCKING / preference) — Plan 4 Task 4.3 step 7: lock `PipelineShell` to media-query approach

Replace the dual-option text with: "Use `window.matchMedia('(min-width: 768px)')` inside `useEffect` to pick a single child to render. Render desktop on SSR (no `window`) and let the effect swap to mobile on first client paint; acceptable hydration shift for Phase 1. Do NOT render both trees with Tailwind `hidden`/`block` — that doubles client bundle weight (`dnd-kit` + `accordion` both load)."

### R8 (WARNING) — Plan 5 Task 5.2 step 5: role check uses user-scoped client

Update step 5 first bullet to read explicitly: "Use the **user-scoped** Supabase server client (`createClient()` from `@/lib/supabase/server`) to fetch the caller's role from `public.users`. RLS scopes this to their own row. Only AFTER verifying `role === 'owner'`, switch to `createServiceClient()` for the admin invite call. Never call `.auth.admin.*` from a context that hasn't passed the role check."

### R9 (OPTIONAL / preference) — Plan 2 Task 2.1 step 3: cap upload at 10 MiB

In `uploadCVAction`, reject files > 10 MiB (`10 * 1024 * 1024`) at the action level even though the bucket allows 50 MiB. Rationale: `unpdf` runs in-memory inside Inngest; a 50 MiB PDF could exceed default Inngest runner memory.

### R10 (NON-BLOCKING) — Plan 5 Task 5.3 step 5: skip CV step in E2E

In the golden-path Playwright spec, replace the "wait up to 60s for 'Review extracted data'" step with `test.step('CV parsing — verified manually + Plan 2 plan-level checks', () => test.skip(true, 'Inngest orchestration in Playwright deferred to Phase 5'))` and instead manually upload a CV in the Plan 5 demo. Keeps CI deterministic per planner option (c).

## Sign-off notes for the executor

- **Plan 0 is the longest** (7 tasks, ~25 files, ~12 migrations / configs). Expect ~3 hours wall-clock. Run `pnpm exec supabase db reset` after Task 0.6 to verify all migrations apply before moving to Task 0.7.
- **Plan 0 Task 0.1**: after the rename, immediately run `curl -sI http://localhost:3000/ | grep -i location` — if no `location: /sign-in?...`, middleware is not firing and the rest of the plan will fail silently.
- **Plan 0 Task 0.2 type regen**: after `pnpm db:types`, expect at least one TS error in `(app)/layout.tsx` once `@ts-nocheck` is removed — that's the point. Fix by narrowing the `getProfile()` / `getOrganization()` return types.
- **Plan 1 → Plan 2 hand-off**: Plan 1 reserves the right column in `/candidates/[id]/page.tsx` with a "CV history" placeholder. Plan 2 replaces it. Don't add upload UI in Plan 1.
- **Plan 2 Task 2.2 is the highest-risk task in the phase** — Inngest + Claude + Storage + DB updates in one function. Budget ~90 min. Test with the real public CV linked in verification step 2 BEFORE moving on.
- **Plan 3 Task 3.3 is ALSO high surface area** — 4 tabs + contact CRUD + activity timeline extension. Budget ~90 min.
- **Plan 4 Task 4.3 is the LARGEST single task in the phase** (10 implementation steps, dnd-kit + decline modal + mobile fallback + global pipeline). Budget ~2 hours. Add `data-card-id` and `data-column` attributes to `<PipelineCard>` and `<Column>` from the START — Plan 5's E2E will need them.
- **Apply R1 BEFORE Plan 4 Task 4.1** — the `move_application` migration's activity body string is fine as-is (raw enum) but the `<DeclineModal>` Select option `value`s must use the real enum names from day one. Don't write "skills_gap" into a Select that submits to `move_application` — it'll fail the enum cast.
- **Apply R2 BEFORE Plan 5 Task 5.2** — without the migration, `OrganizationForm` cannot save a `logo_url`.
- **Plan 5 E2E (Task 5.3)** requires `pnpm dev:all` running in a separate terminal. CI integration is out of scope for Phase 1; this is a local pre-merge smoke test.

