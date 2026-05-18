---
phase: 1
phase_name: "internal-ats"
project: "Altus — AI-First Recruitment CRM"
generated: "2026-05-18"
counts:
  decisions: 11
  lessons: 9
  patterns: 9
  surprises: 6
missing_artifacts:
  - "01-UAT.md (not yet generated — UAT pending)"
  - "Per-plan SUMMARY.md for Plans 0, 1, 2, 4, 5 (only Plan 3 produced a SUMMARY)"
---

# Phase 1 Learnings: Internal ATS

## Decisions

### D-01: Plan 0 hardening before any feature work
A dedicated infrastructure plan (middleware rename, env validation, Sentry, Inngest skeleton, db helper layer, FK guards, storage RLS, search indexes, invite-aware trigger, search_path locks) runs before Plans 1–5.

**Rationale:** Feature plans assume `src/lib/db/`, `src/lib/ai/claude.ts`, the `cvs` Storage bucket, and security primitives exist. Building features on a half-secure base would have needed retrofits later. The plan-checker (VERIFICATION.md) confirmed every Critical/High CONCERNS.md item closed by Plan 0.
**Source:** 01-CONTEXT.md (D-01..D-04), 01-00-hardening-PLAN.md

### D-05: Single Haiku tool-use call for full CV extraction
All CV fields (name, contact, location, current_role, current_company, work_history[], skills[], education[], salary estimates, seniority_level, years_experience_total, sector_tags[], confidence_per_field) in one structured tool call, not multiple chained calls.

**Rationale:** Cheapest pipeline (~£0.005/CV), simplest pattern, `tool_choice: { type: 'tool', name: 'extract_cv_fields' }` forces structured output. Confidence-per-field requirement ensures D-07 badges always have data.
**Source:** 01-CONTEXT.md D-05, 01-RESEARCH.md §10, §16

### D-08: "Accept all" only populates empty candidate fields
Parsed CV data NEVER overwrites manually-entered candidate fields — only fills empty ones. Scalars use null/empty-string check; arrays use `length === 0` check.

**Rationale:** Recruiter trust. A recruiter who's typed in a known fact must not have it silently replaced by AI extraction. Enforced at `markCandidateFieldsFromCV()` with 7 unit tests as the regression gate.
**Source:** 01-CONTEXT.md D-08, 01-PATTERNS.md, tests/unit/mark-candidate-fields-from-cv.test.ts

### D-09: Pending-state pattern for kanban drag (not optimistic, not pure SSR)
Card moves to target column on drop with visible `opacity-60` + "Saving…" indicator; server confirms via `move_application` RPC; indicator clears on success; card snaps back with toast on failure.

**Rationale:** Pure optimistic hides activity-log write failures (ambiguous "did it save?"). Pure SSR feels heavy. Pending-state strikes balance and gives recruiters a clear signal that the activity-log row actually wrote. Forbids React 19's `useOptimistic` because it lacks a natively visible pending indicator.
**Source:** 01-CONTEXT.md D-09, 01-UI-SPEC.md §4, 01-RESEARCH.md §21

### D-10: Decline modal requires structured reason at three layers
The decline modal disables submit until reason picked; server action returns error if missing; Postgres CHECK constraint (`decline_reason_present_when_terminal`) is the ultimate gate. Required `decline_reason` enum, optional free-text notes written to the activity log.

**Rationale:** Decline is a high-consequence action (kills the candidate's path for that role). Three-layer enforcement means a forgotten check at any one layer doesn't let a bad row through. Decline reasons drive Phase 4 source-ROI reporting.
**Source:** 01-CONTEXT.md D-10, 01-04-pipeline-PLAN.md task 4.3

### D-13/D-14: Forgiving keyword search + URL-driven list state
`pg_trgm` similarity ranking on name/role/industry for typo tolerance ("smyth" finds "Smith"). List sort/filter/pagination live in URL search params (not React state) — RSC re-renders on change.

**Rationale:** Server-side list state gives shareable URLs, keeps client bundles small, aligns with App Router conventions. Trigram chosen explicitly because UK recruitment names are misspelling-prone. Cost: GIN trigram indexes were free to add to existing tables.
**Source:** 01-CONTEXT.md D-13, D-14, 01-RESEARCH.md §13, §14

### D-15: Default sort = recency of engagement
Candidates and clients default-sort by `last_contacted_at DESC NULLS LAST`; jobs default-sort by `created_at DESC` with `status='open'` filter.

**Rationale:** Recruiters' mental model is "who did I last talk to about this?" not alphabetical. Recency-first prevents stale rows clogging the top of the list. NULLS LAST keeps never-contacted candidates discoverable but de-prioritized.
**Source:** 01-CONTEXT.md D-15

### D-16: Audit log ONLY on candidate detail views
`record_audit('view', 'candidate', id)` runs only inside `getCandidate()`. List views MUST NOT call it. Explicit code comment in `listCandidates()` forbids it.

**Rationale:** GDPR audit must capture detail-level reads (sufficient for compliance reporting) without ballooning write volume from every list-page render. Phase 2 may extend to list views when external GDPR self-service lands.
**Source:** 01-CONTEXT.md D-16, 01-VERIFICATION.md (R-no-change — invariant verified)

### R1: Decline reason enum frozen at 9 schema values
Despite UI-SPEC originally listing 11 friendlier names (`skills_gap`, `culture_fit`, etc.), the schema's actual enum has 9 different ones (`not_qualified`, `client_rejected_skills`, etc.). Plan 4 sources both Select options AND timeline labels from a single helper, `src/lib/legal/decline-reasons.ts`.

**Rationale:** Schema is source of truth. Extending the enum to match UI-SPEC would have been an additive enum migration with downstream impact. Single helper file eliminates the divergence risk between Select values and timeline rendering.
**Source:** 01-VERIFICATION.md R1, 01-UI-SPEC.md (post-patch)

### R7: PipelineShell uses matchMedia (not Tailwind dual-tree)
One child renders at a time via `useSyncExternalStore(matchMedia)` — desktop on SSR, mobile after first client paint. The alternative (`hidden md:block` + `block md:hidden`) doubles client bundle weight (dnd-kit AND accordion both load).

**Rationale:** Bundle size matters at Phase 1 already; Phase 2's AI surfaces will keep adding to it. Accepting a small hydration shift on mobile is preferable to shipping both trees.
**Source:** 01-VERIFICATION.md R7, 01-RESEARCH.md §21 pitfalls

### R8: Invite role check uses USER-SCOPED client BEFORE service-role admin call
`inviteTeammateAction` runs steps as: (1) user-scoped client, (2) `auth.getUser()`, (3) RLS-scoped role select on `public.users`, (4) reject if not owner, (5) ONLY THEN switch to service-role and call `admin.inviteUserByEmail`.

**Rationale:** A bug in this sequence = any signed-in user can invite anyone to any org. RLS would catch most cross-org abuse but not the `admin.*` calls (service-role bypasses RLS). The user-scoped pre-check is the only barrier.
**Source:** 01-VERIFICATION.md R8, 01-05-dashboard-PLAN.md task 5.2

---

## Lessons

### Postgres function GRANT signatures must match CREATE exactly
Plan 3's `search_clients(text, real, text, text, integer, integer)` had a GRANT statement specifying `(text, real, text, integer, integer, integer)` — the 4th param (`p_dir`) is text, not integer. The signature mismatch made Postgres unable to find the function, GRANT failed, the whole migration rolled back.

**Context:** Caught on the first `supabase db push`; fixed inline (commit `f2136a2`) since the migration had never successfully applied to any DB. The mismatch was invisible to lint/typecheck/build because it's runtime SQL. Future plans should add a comment listing param types alongside the GRANT to make the mismatch obvious in review.
**Source:** git commit f2136a2, 20260517215958_search_clients_rpc.sql

### Cross-tenant FK guards must extend to ALL tenant-scoped tables, not just the obvious ones
Plan 0 added cross-tenant FK guards on `contacts`, `jobs`, `applications` — but not on `candidate_cvs`. The code review (C1) caught that an attacker could `uploadCVAction({ candidateId: <other-org-candidate-id> })` and silently poison another org's empty candidate columns via the service-role Inngest writer.

**Context:** RLS on `candidate_cvs` was passing because it only checks the row's own `organization_id` (set by trigger from session), not whether `candidate_id`'s org matches. The fix (commit `0966875`) is a new trigger reusing `assert_same_org()`. Lesson: every FK that points at a tenant-scoped table needs an explicit org-match guard, not just RLS on the row itself.
**Source:** 01-REVIEW.md C1, 01-PLAN0-CHECKPOINT.md (guards list), commit 0966875

### LLM model pricing drifts — verify constants against the live page
Anthropic dropped Opus from $15/$75 per MTok to $5/$25 sometime before 2026-05-18. The `PRICING_PENCE_PER_MTOK` constants in `src/lib/ai/claude.ts` had Opus at 1200/6000 pence (≈$15/$75) — ~3× too high. Plan 5 caught it via Task 5.3's pricing-verification step and updated to 390/1950 pence with a `verified 2026-05-18` comment.

**Context:** Pricing-baked-into-code is fragile. Phase 2 should consider either (a) a per-call pricing lookup against a versioned table, or (b) a scheduled job that re-verifies the constants quarterly and surfaces a PR. For now the comment + verification step is the lightest pattern.
**Source:** 01-05-dashboard-PLAN.md task 5.3 step 7, commit 8fd4019

### Sentry v10 has breaking changes the wizard glosses over
The interactive `@sentry/wizard` is meant to be the easy path. It's not — v10 renamed `onRequestError` to `captureRequestError` (must re-export the alias from `instrumentation.ts`), removed `hideSourceMaps` from `SentryBuildOptions`, and the wizard tries to overwrite `next.config.ts` in ways that break manually-applied middleware patterns.

**Context:** Plan 0 Task 0.5 skipped the wizard entirely and wrote configs manually from the RESEARCH §6 skeleton, which worked. Future projects on Sentry v10+ should expect to write configs by hand or be prepared to undo wizard damage. Worth a thread or doc note.
**Source:** 01-PLAN0-CHECKPOINT.md, commit e8ea738

### `pnpm db:types --local` needs Docker; `--linked` doesn't work on every CLI version
Two ways to regen `src/types/database.ts`: `--local` (requires Docker for the local Supabase stack) or `--linked` (against the cloud project once `supabase link` succeeded). When this project tried `--linked`, it failed on the installed CLI version; `--local` was blocked because Docker wasn't running.

**Context:** Net result: types stayed pre-regen for the entire phase. Plans 1–5 worked around it with `as unknown as ...` defensive casts plus `// reason: pending regen` comments. The casts compiled cleanly and runtime worked. Lesson: schema-driven types are a "nice to have" not a hard blocker — but the regen path should be tested early in a phase, not at the end.
**Source:** Plan 0 Task 0.2 verification notes, Plan 1/2/3/4/5 commit messages mentioning "pending regen"

### `.env.local` parsing is stricter than Node's dotenv
The Supabase CLI's dotenv parser rejected `.env.local` because an accidental "Ok " keystroke at the start of line 1 (before a `#` comment) was read as a variable name. Error: "unexpected character '#' in variable name."

**Context:** Node's dotenv is more lenient. The fix was a one-character edit. Lesson: don't assume your env file passes every parser. Worth a `.env.local` linting step in CI if/when CI exists.
**Source:** Real-time chat 2026-05-18

### Plan-checker is a load-bearing gate — don't skip it
The plan-checker found **2 BLOCKERS** (decline_reason enum mismatch, missing `organizations.logo_url` column) plus 8 warnings. If those blockers had reached execution, Plan 4's DeclineModal would have shipped a Select with values the DB rejects, and Plan 5's OrganizationForm couldn't have saved. Both would have been "all gates green" at executor time and only failed at runtime.

**Context:** Static analysis can't catch enum-value vs schema-value mismatches; only schema-aware review can. The plan-checker added ~15 min of orchestrator time and saved at least one BLOCKER-grade ship bug. Don't make this optional.
**Source:** 01-VERIFICATION.md verdict + revision list

### Code review catches what executors' self-checks cannot
Despite every executor reporting "all gates green," `gsd-code-reviewer` found 1 CRITICAL + 3 HIGH + 9 MEDIUM + 11 LOW. The CRITICAL (C1) was a real cross-tenant injection vulnerability that lint/typecheck/build/unit-test couldn't see — it required reasoning about RLS, service-role bypass, and event-payload trust.

**Context:** Executors self-verify their own contracts (the ones listed in their prompt). They cannot reason about what's MISSING from those contracts. An independent review pass — even on AI-generated code — is non-negotiable for security-sensitive work.
**Source:** 01-REVIEW.md, commits 0966875..6e5eafd

### Parallel agents need explicit file-ownership scoping
Plans 1 and 3 ran in parallel and one near-collision happened on `src/lib/db/activities.ts` — Plan 3 created it, Plan 1 absorbed Plan 3's then-unstaged files into a commit via a wide `git add`. No data lost; attribution drifted. Plan 3's report explicitly flagged it.

**Context:** Worked out fine because both plans were touching mostly-disjoint trees. Future parallel waves should be briefed with strict "files you own / files you must not touch" lists (we did this for Plan 1/3 but should generalize to every parallel launch).
**Source:** 01-03-clients-SUMMARY.md, commits d163be3 (Plan 1) absorbing some Plan 3 work

---

## Patterns

### Vertical MVP slice plan organization
Each plan delivers one user-visible capability end-to-end: UI → Server Action → db helper → migration (if needed). NOT horizontal layers (no "schema task, then API task, then UI task"). Tasks within a plan interleave.

**When to use:** Any phase with `**Mode:** mvp` in ROADMAP.md. After each plan, the recruiter can demo a complete vertical capability without waiting for subsequent plans.
**Source:** 01-CONTEXT.md, all 5 feature plans

### Wave-based parallel execution with explicit dependency graph
Identify plans whose dependencies are satisfied (all upstream plans done). Group into waves. Run each wave's plans in parallel via background subagents with file-ownership scoping. Sequence waves with checkpoints.

**When to use:** Multi-plan phases where some plans depend only on the same upstream. For Phase 1: Wave 1 (Plan 0), Wave 2 (Plans 1+3), Wave 3 (Plan 2), Wave 4 (Plan 4), Wave 5 (Plan 5). Cuts wall-clock by ~30–40% vs strict sequential.
**Source:** Conversation flow, all task notifications

### Atomic per-task commits with verification gates
Each plan task = one commit. Before commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass. Commit message format: `feat(phase{N}/plan{M}): task {M.K} — short description`. No squashing.

**When to use:** Always, in executor agents. Makes the git log a per-task progress log; makes reverts surgical; surfaces regressions to the specific task that introduced them.
**Source:** Every plan's "Operating rules" section, the 30 Phase 1 commits

### Cross-tenant FK guard via shared `assert_same_org()` helper
For every FK pointing at a tenant-scoped table, add a BEFORE INSERT (and UPDATE OF fk_col) trigger that calls `assert_same_org('target_table', new.fk_col, new.organization_id)`. The helper is a single SECURITY DEFINER function with `set search_path = public`.

**When to use:** Every new tenant-scoped table with FKs to other tenant-scoped tables. Plan 0 added it for `contacts`, `jobs`, `applications`; C1 added it for `candidate_cvs`. Future tables (shortlists, placements, fee_agreements) will need the same.
**Source:** supabase/migrations/20260517204500_cross_tenant_fk_guards.sql, commit 0966875

### Service-role usage ONLY in Inngest functions with explicit tenant boundary check
Service-role bypasses RLS. The only legitimate caller is Inngest functions (background jobs) and the `auth.admin.*` flow (invite). EVERY service-role caller must validate the tenant boundary explicitly — typically `event.data.organization_id` against a DB-verified ground truth.

**When to use:** Whenever you need to bypass RLS. The grep test: `grep -rn "createServiceClient\|service_role" src/` should return only `src/lib/inngest/functions/*` and `src/app/(app)/settings/actions.ts` (invite).
**Source:** 01-RESEARCH.md §17 pitfalls, 01-REVIEW.md C1 + R8

### Single Claude wrapper with mandatory cost logging
All Claude calls go through `src/lib/ai/claude.ts`. `record_ai_usage` RPC is called on every Claude response. Grep test: `grep -rn "new Anthropic" src/` returns only `claude.ts`.

**When to use:** Any AI-touching code in any phase. The wrapper handles model selection (haiku/sonnet/opus), retry/backoff on 429/529, tool-use for structured output, and the non-negotiable cost-row write. Cost logging non-negotiable per CLAUDE.md.
**Source:** 01-RESEARCH.md §10, src/lib/ai/claude.ts

### All db queries through `src/lib/db/*` helpers
NEVER inline `.from('table')` in app routes. Every table has a helper module that exports typed query functions. The helper modules are `import 'server-only'`. Returns `{ ok, data | error }` or a discriminated `DbResult<T>` with `not_found | conflict | forbidden | internal`.

**When to use:** Always. Centralizes audit logging hook points (D-16), centralizes error→Sentry capture, makes types thread cleanly to the call site. Grep test: `grep -rn "from('candidates'\|from('jobs'\|from('applications'" src/app/` returns nothing.
**Source:** 01-PATTERNS.md conventions cheat-sheet, every db helper file

### Discriminated union state machines for async UI
Client Components with async operations use a `Status` type with a `kind` discriminant (`idle | submitting | success | error`). React reads `status.kind` to drive rendering; payload data lives in `status.data` etc.

**When to use:** Any form submission, optimistic update, or any UI that has multiple visual states tied to an async lifecycle. Plan 1's sign-in form is the canonical reference.
**Source:** 01-PATTERNS.md, src/app/(auth)/sign-in/sign-in-form.tsx (Plan 0 reference)

### Polymorphic component with `entries[]` OR `entityType + entityId` props variants
Shared rendering components like `<ActivityTimeline>` accept EITHER pre-fetched entries (caller does the fetch) OR an entity ID (component fetches internally). The prop type is a discriminated union so consumers can choose the variant that fits their data flow.

**When to use:** Shared components that get reused across surfaces where one caller has the data already and another doesn't. Plan 1's ActivityTimeline shipped both variants; Plan 3 used the `entries[]` form. Future shared components (e.g., a candidate-detail-mini-card) can use the same pattern.
**Source:** src/components/app/activity-timeline.tsx (Plan 1), client-management-tabs.tsx (Plan 3 consumer)

---

## Surprises

### Phase 1 landed in ~one working day of agent time
24 feature commits + 6 fix/doc commits + 6 migrations across 5 plans, all gates green at every commit, in roughly one wall-clock day of orchestrator + executor work. Faster than the original plan estimate of 12–14 weeks part-time.

**Impact:** The "AI-augmented solo dev" velocity is real. Estimation models from the pre-AI era under-predict by an order of magnitude. The constraint shifted from "can we build it?" to "can we verify, validate, and review it fast enough?" — review/verification load is now the bottleneck, not implementation.
**Source:** git log bbc3bfb..edfb5e5, conversation timestamps

### Plan-checker found 2 BLOCKERS that would have shipped silently
The `decline_reason` enum mismatch (UI-SPEC listed 11 values not in the schema's 9) and the missing `organizations.logo_url` column would both have passed lint/typecheck/build/unit-test at executor time. The DeclineModal Select would have shipped values the DB rejects; OrganizationForm would have shipped an UPDATE on a non-existent column.

**Impact:** Confirms the value of the pre-execution plan-check gate. Without it, both bugs would have been runtime-only and would have wasted executor time fixing them mid-execution. The plan-checker added ~15 min of orchestrator wall-clock and saved at least an hour of downstream rework.
**Source:** 01-VERIFICATION.md verdict (PASS WITH REVISIONS, 10 patches)

### Anthropic Opus pricing was 3× too high in our code
We assumed Opus was $15/$75 per MTok (the historical price). The live page on 2026-05-18 shows $5/$25 — a 60–67% drop. Pricing constants in `src/lib/ai/claude.ts` were `1200/6000` pence; corrected to `390/1950`.

**Impact:** Any `ai_usage` row for an Opus call (none yet — Plan 1 only uses Haiku/Sonnet) would have inflated `cost_pence` by 3×. SaaS pricing decisions made off that data would have over-charged customers or under-priced the product. The Task 5.3 pricing-verification step caught it cheaply.
**Source:** 01-05-dashboard-PLAN.md task 5.3, commit 8fd4019, anthropic.com/pricing (verified 2026-05-18)

### gsd-code-reviewer found a CRITICAL vulnerability after every executor said "all gates green"
The C1 finding (cross-tenant data injection via `candidate_cvs.candidate_id` lacking an FK guard) was undetectable by any of the executor self-checks. It required reasoning about: (a) RLS only checks the row's own org_id, not FK target orgs, (b) service-role bypasses RLS, (c) Inngest events are user-trustable for their own org but not for cross-org FK references.

**Impact:** Confirms the review gate is non-negotiable for security-sensitive work. Static analysis (lint/typecheck/build) is necessary but not sufficient. The review took ~10 min of agent time and surfaced a real attack vector.
**Source:** 01-REVIEW.md C1, commit 0966875

### Sentry wizard would have broken middleware discovery (issue #8845)
`@sentry/wizard@latest -i nextjs --saas` is documented as the easy install path. In practice on v10 it: renames `onRequestError`, removes `hideSourceMaps`, and has [GH issue #8845](https://github.com/getsentry/sentry-javascript/issues/8845) where `src/middleware.ts` discovery can fail after Sentry init. Plan 0 Task 0.5 skipped the wizard and wrote configs manually — and the middleware verification step at the end of the task explicitly re-confirmed the auth-guard redirect was still firing.

**Impact:** Saved an unknown amount of debugging time. Any team adopting Sentry v10 on a Next.js 16 App Router project should probably plan to write configs manually too.
**Source:** 01-RESEARCH.md §6 pitfalls, 01-PLAN0-CHECKPOINT.md

### Parallel agents don't conflict on idempotent operations
Plan 1 and Plan 3 ran in parallel. Both wanted some of the same shadcn primitives (`form.tsx`, `label.tsx`, `button.tsx`). The `shadcn add` CLI is idempotent — re-running it doesn't break — so both agents calling it concurrently was a non-event. Same for `pnpm add` commands hitting the same registry version pin.

**Impact:** Easier to design parallel waves than expected. The mental model "what if both agents touch the same file?" is mostly addressed by idempotent install tools; the real risks are at non-idempotent boundaries (git commits, migration timestamps). Future parallel waves can be aggressive about overlapping installs and conservative about non-idempotent operations.
**Source:** Plan 1 commit d163be3, Plan 3 commit 5fa7c32 (both ran shadcn add concurrently without conflict)
