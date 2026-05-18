# Plan 5: Dashboard, Settings, Invite, Mobile Polish & E2E

**Phase:** 1 — Internal ATS
**Plan:** 5 of 5 (dashboard)
**Depends on:** Plans 0, 1, 2, 3, 4 — all must be live. The dashboard surfaces metrics across candidates, jobs, applications, and the activity feed; the invite flow consumes the `handle_new_user()` migration landed in Plan 0; the E2E golden path covers the full Plans 1–4 happy path.
**Requirements covered:** DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success criteria satisfied:** #5 — "Authenticated home shows real organisation metrics (candidate count, active jobs, open applications), a recent activity feed, stale-application alerts, and candidates needing follow-up"; #6 — "Recruiter can invite a teammate by email; teammate signs up and joins the same organisation". DASH-06 also requires the Phase 1 mobile-polish pass.
**Mode:** mvp — vertical slice (dashboard widgets → settings page → invite teammate → mobile polish → E2E test). The phase is usable after Plan 4; Plan 5 makes it complete + polished.

## Goal

After this plan, the authenticated home (`/`) shows real organisation metrics in four cards (candidates / active jobs / open applications / placements-this-month — placements is hardcoded 0 until Phase 4), a recent activity feed pulling the last 20 entries across all entity types, a stale-applications widget (>14 days in stage), and a "Candidates to follow up" widget sorted `hot → actively_looking → passively_looking` per CONTEXT.md specifics. `/settings` lets the user edit their profile (name + email) and organisation (name + optional logo); owners can invite teammates by email — invitees sign up, the trigger from Plan 0 reads `raw_user_meta_data.invited_to_org`, and they join with `role = 'recruiter'`. Every list view has empty states + skeletons + 44 px mobile touch targets. One Playwright E2E spec covers Tasks 3–6 golden path.

## Required reading for executor

- `.planning/phases/01-internal-ats/01-CONTEXT.md` (specifics: follow-up widget sort order; deferred item 6 — Playwright E2E)
- `.planning/phases/01-internal-ats/01-RESEARCH.md` — sections **25 (real metrics queries), 26 (recent activity feed query with batched IN), 27 (stale-application alert query — the `applications_stage_changed_at_idx` index landed in Plan 4), 28 (invite teammate flow — full skeleton, consuming the trigger update from Plan 0), 29 (mobile responsive baseline), 30 (already done in Plan 0; consult the auth setup helper), 31 (golden-path E2E spec)**, open question #2 (Anthropic pricing constants verification — addressed in this plan as a verification step)
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — all "Task 7 — Dashboard & settings" rows
- `.planning/phases/01-internal-ats/01-UI-SPEC.md` — section 6 (Dashboard), the Settings layout pattern, the mobile breakpoints, Critical mobile rule ("h-11" on primary CTAs)
- `docs/phase-1-tasks.md` Task 7
- Plan 0's `handle_new_user_invite.sql` migration body (invite metadata bridge)

## Tasks

### Task 5.1: Dashboard real metrics + recent activity feed + stale + follow-up widgets + `organizations.logo_url` migration

**Files:**
- create `src/lib/db/dashboard.ts`
- modify `src/app/(app)/page.tsx` (currently placeholder; replace with the dashboard)
- create `src/components/app/metric-card.tsx`
- create `src/app/(app)/_dashboard/recent-activity-feed.tsx` (server component)
- create `src/app/(app)/_dashboard/stale-applications-widget.tsx`
- create `src/app/(app)/_dashboard/follow-up-widget.tsx`
- create `supabase/migrations/<ts>_organizations_logo_url.sql` (per VERIFICATION R2 — `organizations.logo_url` column does not exist in the Phase 1 schema; Task 5.2 OrganizationForm requires it)

**Pattern to copy:** RESEARCH §25 (`getDashboardMetrics` — parallel counts), §26 (`getRecentActivity` — batched IN queries for entity labels, no N+1), §27 (`getStaleApplications` — `stage_changed_at < now() - 14 days` filter, joins for candidate/job names). UI-SPEC §6 (Dashboard layout — metric cards row, two-column feed/widgets on desktop, stacked on mobile).

**Implementation:**
0. **`<ts>_organizations_logo_url.sql`** (per VERIFICATION R2):
   ```sql
   alter table public.organizations add column if not exists logo_url text;
   ```
   Apply via `pnpm exec supabase db reset` (or `supabase migration up`) before Task 5.2 runs. Regenerate types with `pnpm db:types`.
1. **`src/lib/db/dashboard.ts`**:
   - `getDashboardMetrics(supabase)` — paste RESEARCH §25 body verbatim. Returns `{ candidates, openJobs, openApplications, placementsThisMonth }` (placements hardcoded 0).
   - `getRecentActivity(supabase, limit = 20)` — paste RESEARCH §26 body verbatim, including the batched IN queries for entity labels (no N+1). Application label resolves to "candidate at job" — implement the `apps` branch too (the §26 skeleton leaves it as an exercise; complete it here using the same batched-IN pattern with `applications.candidate_id` and `applications.job_id`).
   - `getStaleApplications(supabase)` — paste RESEARCH §27 verbatim. Returns up to 20 stale (>14 days in stage) non-terminal applications.
   - `getFollowUpCandidates(supabase, limit = 10)` — selects from `candidates` where `last_contacted_at < now() - 30 days OR last_contacted_at IS NULL`, ordered by `market_status` in the priority order CONTEXT.md specifies: `hot → actively_looking → passively_looking`. Achieve via `case market_status when 'hot' then 0 when 'actively_looking' then 1 when 'passively_looking' then 2 else 3 end`. Limit 10 by default.
2. **Dashboard page** (`/page.tsx`) — async RSC:
   - Calls all four helpers in parallel via `Promise.all` (each helper is already a single round-trip or a batched-IN set; total dashboard load <50 ms at anchor scale).
   - Layout per UI-SPEC §6: `<MetricCardsRow>` (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`) — four `<MetricCard value={n} label="..." />`. Then `<DashboardBody>` (`grid grid-cols-1 lg:grid-cols-3 gap-6`) — left 2/3 `<RecentActivityFeed entries={...} />`, right 1/3 stacked `<StaleApplicationsWidget items={...} />` + `<FollowUpWidget items={...} />`.
   - Empty-state special-case: if the org has zero candidates, render the "Welcome to Altus" empty state per UI-SPEC instead of the empty metric cards. Detect with `metrics.candidates === 0 && metrics.openJobs === 0`.
3. **MetricCard** — props `{ value: number; label: string }`. Renders a shadcn `<Card>` with value in Display typography (`text-3xl font-semibold`) and label in Label typography (`text-xs text-muted-foreground font-normal`).
4. **RecentActivityFeed** — reuses the lucide icon mapping from Plan 1's `<ActivityTimeline>` (note → MessageSquare, call → Phone, meeting → Users, stage_change → ArrowRight). Each entry shows `{actor_initials}` (if `actor_user_id` non-null — resolve from `users` table by ID, batched), kind icon, body text, `entity_label`, time-ago. Clicking an entry links to the entity detail page (`/candidates/[id]`, `/clients/[id]`, `/jobs/[id]`). "View all" link footer pointing to `/pipeline` per UI-SPEC §6.
5. **StaleApplicationsWidget** — shadcn `<Card>` with heading "Stale Applications" (`text-sm font-semibold`). List of items: candidate name, "stalled in {stage} for {days} days", job title. Each row links to `/jobs/[jobId]/pipeline`. Empty state per UI-SPEC: "No stale applications" / "All your applications have been updated recently."
6. **FollowUpWidget** — shadcn `<Card>` with heading "Candidates to Follow Up". Row spec per UI-SPEC: name, `<MarketStatusBadge>`, "{days} days since last contact". Sorted hot → actively_looking → passively_looking (handled in the DB helper). Empty state: "No follow-ups due" / "You're up to date with your candidate relationships."

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Dashboard at `/` loads in <200 ms (anchor scale).
- Metric cards show real counts. Open a Supabase Studio session: `select count(*) from candidates` — matches the dashboard.
- Seed-up scenario: set a candidate to `market_status = 'hot'` AND `last_contacted_at = now() - 35 days`. The Follow-Up widget surfaces it FIRST. Add a second with `actively_looking` + `last_contacted_at = now() - 40 days` — it appears below the hot one (sort order verified).
- Set an application's `stage_changed_at` to `now() - 20 days` via SQL. The Stale Applications widget shows it.
- Recent Activity feed: log a note from a candidate detail page → return to dashboard → entry appears at the top.

### Task 5.2: Settings page (profile + organisation) + invite teammate flow

**Files:**
- modify `src/app/(app)/settings/page.tsx` (currently placeholder; replace with the settings shell)
- create `src/app/(app)/settings/profile-form.tsx` (Client Component)
- create `src/app/(app)/settings/organization-form.tsx` (Client Component)
- create `src/app/(app)/settings/invite-form.tsx` (Client Component)
- create `src/app/(app)/settings/invitations-list.tsx` (lists pending invites, owner-only)
- create `src/app/(app)/settings/actions.ts` (server actions: `updateProfileAction`, `updateOrganizationAction`, `inviteTeammateAction`, `revokeInviteAction`)
- create `src/app/(app)/settings/schema.ts`
- modify `src/lib/db/profiles.ts` (extend with `updateProfile(supabase, userId, patch)`)
- modify `src/lib/db/organizations.ts` (extend with `updateOrganization(supabase, orgId, patch)`)

**Pattern to copy:** RESEARCH §28 — the `inviteTeammate` server action skeleton + the `inviteUserByEmail(email, { data: { invited_to_org, full_name } })` call. The Plan 0 `handle_new_user_invite.sql` trigger consumes `raw_user_meta_data.invited_to_org`. UI-SPEC Settings row in §Layout Patterns ("Single-column `max-w-2xl` sections with `Separator` between them").

**Implementation:**
1. **Settings page shell** (`/settings/page.tsx`) — async RSC. Fetches the current user + profile + org. Renders three `<Card>` sections separated by `<Separator>`:
   - "Profile" — `<ProfileForm initialFullName={...} initialEmail={...} />`
   - "Organisation" — `<OrganizationForm initialName={...} initialLogoUrl={...} />` (only editable by owners; for non-owners render the fields read-only)
   - "Team" — `<InviteForm />` (owner only) + `<InvitationsList />` (owner only — lists pending/recently accepted users in the org with a "Revoke" inline button per UI-SPEC Destructive Actions row)
2. **ProfileForm** — RHF + zod, fields `full_name` + `email`. On submit calls `updateProfileAction({ full_name, email })`. Backed by `updateProfile()` helper which updates `public.users`. Note: editing the auth `email` requires `supabase.auth.updateUser({ email })` — Phase 1 keeps it simple: editing email only updates `public.users.email` (display name); changing the auth email is a Phase 2 task. Document this inline.
3. **OrganizationForm** — fields `name` + `logo_url` (text input only — full upload UI deferred to Phase 2 per VERIFICATION R2). Both columns now exist on `organizations` (Task 5.1 step 0 migration adds `logo_url`). Calls `updateOrganizationAction({ name, logo_url })`. Only editable by owners; non-owners see fields read-only.
4. **InviteForm** — RHF + zod, single field `email` + optional `full_name`. Calls `inviteTeammateAction({ email, full_name })` per RESEARCH §28.
5. **inviteTeammateAction** in `actions.ts` (per VERIFICATION R8 — role check uses the user-scoped client BEFORE switching to service-role):
   - `'use server'`. Use the **user-scoped** Supabase server client (`createClient()` from `@/lib/supabase/server`) to fetch the caller via `supabase.auth.getUser()` and then `select role, organization_id from public.users where id = me.id`. RLS scopes the select to the caller's own row.
   - Reject (`{ ok: false, error: 'Only owners can invite teammates.' }`) if role is not `'owner'`. UI-SPEC: only owners invite — Phase 5 may add admins.
   - Only AFTER the role check passes, switch to `createServiceClient()` and call `auth.admin.inviteUserByEmail(email, { data: { invited_to_org: me.organization_id, full_name } })`. **Never call `.auth.admin.*` from a context that hasn't passed the role check.** The Plan 0 trigger reads `raw_user_meta_data.invited_to_org` and inserts a `public.users` row with `role = 'recruiter'` attached to the inviting org.
   - Return `{ ok: true }` on success, `{ ok: false, error: '...' }` on failure (invalid email, not owner, Supabase admin error).
6. **InvitationsList** (per VERIFICATION open issue #5 / R-locked) — Phase 1 InvitationsList lists all users in the org with **no pending/accepted distinction**. `select id, email, full_name, role, created_at from users where organization_id = current_organization_id() order by created_at desc`. Recently-added users (last 7 days) get a "Recently invited" pill based purely on `created_at`. The `last_sign_in_at`-based pending/accepted check requires service-role access to `auth.users` and is **deferred to Phase 2** along with the Revoke button. Keep the list view simple.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- As the org owner, update your `full_name` via the Profile form → refresh → top nav reflects the new name.
- Update the org name → top nav reflects the new org name.
- Invite a teammate by email (use a real second email account or a Mailpit/Inbucket dev mailbox). Open the invitation link in the email → it routes through `/auth/callback` → after sign-in completes, the new user lands in the inviting org with `role = 'recruiter'`. Verify in `psql`: `select id, organization_id, role from public.users where email = '<invitee>';` shows the correct org + role.
- The trigger from Plan 0 fires correctly: `select prosrc from pg_proc where proname = 'handle_new_user'` body contains `invited_to_org` (sanity check Plan 0 actually applied).
- As a non-owner (the freshly invited user), the Organisation form is read-only and the InviteForm is not rendered.

### Task 5.3: Mobile polish + 404 + error page + README + Playwright golden-path E2E + Anthropic pricing verification

**Files:**
- modify `src/app/not-found.tsx` (custom 404 — link back to dashboard per UI-SPEC Error States)
- modify `src/app/global-error.tsx` (or `src/app/(app)/error.tsx` for the app shell — render a friendly "Something went wrong" + retry button + Sentry capture)
- modify `src/components/app/top-nav.tsx` (mobile responsiveness — hamburger menu if labels overflow; keep this minimal — research §29 suggests the existing nav is OK for narrow viewports; only intervene if the layout actually breaks)
- audit every primary CTA in the app → add `className="h-11 md:h-10"` (UI-SPEC critical mobile rule). Surfaces to audit: candidate create, edit, log-activity, client create, contact create, job create, add-candidate-to-job, decline modal, invite teammate.
- create `tests/fixtures/sample-cv.pdf` (fictional AI-generated CV per RESEARCH open question #4 — DO NOT commit a real candidate's CV)
- create `tests/e2e/golden-path.spec.ts`
- modify `tests/e2e/global-setup.ts` (real auth setup — sign in via password against a seed user; update the seed file `supabase/seed.sql` if needed to add `test-recruiter@altus.test` with a known password)
- modify `package.json` (add `"test:e2e:reset"` if not yet present from Plan 0)
- modify `README.md` (add a short "Running E2E tests" section)

**Pattern to copy:** RESEARCH §31 (full golden-path spec body), §30 (Playwright auth setup). UI-SPEC §Mobile breakpoints + Critical mobile rule. RESEARCH §29 (mobile responsive baseline — keep light).

**Implementation:**
1. **404 + global-error** — minimal Next.js convention files. `not-found.tsx` matches UI-SPEC Error States row "404" → message "This page doesn't exist." + a `<Link href="/">` "Back to Dashboard" button. `global-error.tsx` (or `(app)/error.tsx`) renders "Something went wrong. Please try again." + a "Try again" button that calls `reset()` + Sentry captures the error.
2. **Mobile polish audit** — read each form/button surface listed above; add `className="h-11 md:h-10"` to the primary submit/CTA `<Button>`. Skim the layout in Chrome DevTools at iPhone 14 width (390×844) — every primary action reachable + touch-target compliant.
3. **TopNav mobile** — if labels currently wrap awkwardly at < 640 px, swap to a hamburger `<Sheet>` menu via shadcn (`pnpm dlx shadcn@latest add sheet` already done in Plan 1). Otherwise leave alone per RESEARCH §29.
4. **README** — extend with: prerequisites (Node + pnpm + Docker); `pnpm install`; `pnpm exec supabase start`; copy `.env.example` → `.env.local` and populate; `pnpm dev:all` (Next + Inngest concurrently); `pnpm test` for Vitest, `pnpm test:e2e` for Playwright; `pnpm test:e2e:reset` to reset the DB.
5. **Playwright golden-path** (per VERIFICATION R10 — CV step skipped for CI determinism) — paste RESEARCH §31 spec body. Adapt selectors to whatever final shadcn labels/aria-labels you used (e.g., the candidate-form labels, the kanban `data-card-id` + `data-column` attributes which you MUST add to `<PipelineCard>` and `<Column>` in Plan 4 — if you forgot, add them now). The test covers: sign in (via the global-setup storage state) → create candidate with consent → **CV-parsing step skipped** (`test.step('CV parsing — verified manually + Plan 2 plan-level checks', () => test.skip(true, 'Inngest orchestration in Playwright deferred to Phase 5'))`; Plan 5 demo verifies the CV flow manually) → create client → create job → add candidate to job → open `/pipeline` → drag card from "applied" to "screening" → confirm activity entry "Moved to screening" in the candidate's timeline. This keeps CI deterministic without requiring Inngest in the Playwright webServer config.
6. **Sample CV fixture** — generate or hand-write a 1–2 page CV PDF with fictional details (e.g., "Jane Doe — Software Engineer — 5 years experience in TypeScript, Next.js, Postgres…"). Save to `tests/fixtures/sample-cv.pdf`. **Do not use any real candidate's CV.**
7. **Anthropic pricing verification (RESEARCH open question #2)** — open `https://www.anthropic.com/pricing#api`. Confirm the `PRICING_PENCE_PER_MTOK` values in `src/lib/ai/claude.ts` (Plan 0) match the live numbers for `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7` (within a reasonable currency conversion — pence-per-million-token vs USD). If they don't match, update the constants in `src/lib/ai/claude.ts` and add a comment with the verification date.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm build` pass
- `pnpm exec supabase db reset && pnpm exec supabase db seed` succeeds (seed includes the test user from step 5).
- Manually start: `pnpm dev:all` in one terminal, then `pnpm test:e2e` in another. The `golden-path.spec.ts` test passes (full happy path Tasks 3–6 verified by Playwright).
- Open the app on a phone-sized viewport (Chrome DevTools iPhone 14). Every primary CTA is at least 44 px tall. The pipeline view becomes the accordion list at < 768 px. No horizontal scrolling needed for non-kanban pages.
- `/this-route-does-not-exist` shows the custom 404 with "Back to Dashboard" link.
- Throwing a deliberate error from a Server Action triggers the error page + Sentry capture (PII scrub verified in Plan 0; re-verify here for the production error UI).

## Plan-level verification

Run before declaring the plan done:

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` all pass
- [ ] Success criterion #5 demonstrated: dashboard shows real metrics, recent activity, stale apps, follow-up widget — all with correct sort orders and links.
- [ ] Success criterion #6 demonstrated: end-to-end invite flow — an emailed invite results in the invitee joining the inviting org as `recruiter`.
- [ ] DASH-06 confirmed: all list views (`/candidates`, `/clients`, `/jobs`, `/pipeline`, `/`) render their empty states; all have skeleton loading; everything works at iPhone 14 viewport with no horizontal scroll on non-kanban pages.
- [ ] Playwright `golden-path.spec.ts` passes (cover for Tasks 3–6 — full Phase 1 happy path).
- [ ] CLAUDE.md verification checklist clean: `pnpm lint`, `pnpm typecheck`, `pnpm test` all green; manual check of every feature in the app; `supabase db reset` runs clean; `ai_usage` rows accumulating with reasonable `cost_pence`.
- [ ] CONCERNS.md re-walk: every Critical and High item closed (or explicitly deferred with rationale). Re-link each to the plan that closed it.
- [ ] Anthropic pricing constants match the live page (date stamped in the code comment).
- [ ] Anchor customer can be onboarded — `docs/phase-1-tasks.md` Task 7 verification list satisfied.

## Out of scope for this plan (deferred or other plans)

- Onboarding tour — Phase 5 (SaaS shell).
- Per-org branding beyond logo — Phase 5.
- Reporting dashboards — Phase 4.
- Email-changing flow that updates `auth.users.email` (vs `public.users.email`) — Phase 2.
- Robust invitation revoke flow (deleting auth.users row + public.users row + audit trail) — Phase 2 cleanup; Phase 1 keeps a list-only view.
- Org-logo upload UI — defer to Phase 2 if `organizations.logo_url` schema is absent or if Storage logo bucket is non-trivial. Phase 1 ships text-only `logo_url`.
- HNSW vector indexes / embeddings — Phase 2.
- Resend / PostHog / Stripe wiring — out of Phase 1 entirely.

---

## Cross-plan open issues / risks (for the plan-checker review)

These could not be fully resolved from the upstream artifacts. The plan-checker should call them out explicitly:

1. **`application_stage` enum values vs UI-SPEC stage names.** UI-SPEC §4 names columns "Applied / Screening / Submitted / 1st Interview / 2nd Interview / Offer / Placed", and RESEARCH §21 lists the enum as `'applied', 'screening', 'cv_submitted', 'first_interview', 'second_interview', 'offer', 'placed'`. RESEARCH §17/§23 Postgres function strings assume those literal enum values. The executor of Plan 4 MUST verify the schema's actual enum values match BEFORE writing the function (`select enumlabel from pg_enum where enumtypid = 'application_stage'::regtype order by enumsortorder;`) and pick the human labels accordingly. If the enum uses `'submitted'` instead of `'cv_submitted'`, update Plan 4's STAGES constant and the activity body string mapping.

2. **`decline_reason` enum label parity.** UI-SPEC §Decline Reason Labels names exactly 11 enum values (`overqualified`, `underqualified`, `salary_mismatch`, `location_mismatch`, `skills_gap`, `culture_fit`, `withdrew`, `position_filled_internally`, `no_response`, `client_rejected`, `other`). The actual `decline_reason` enum in the schema migration must include all of them. Verify before Plan 4 writes the modal `<Select>` options.

3. **Activity body string for declines vs UI-SPEC label.** The RESEARCH §23 function writes `'Declined — ' || coalesce(p_decline_reason::text, 'unspecified')` which yields `'Declined — skills_gap'` (raw enum). UI-SPEC §Activity Type Labels expects `'Declined — Skills gap'` (human label). Plan 4 acknowledges this and either: (a) implements a small `formatDeclineReason()` SQL helper called from inside `move_application`, or (b) renders the activity body on the frontend by re-mapping the enum→label client-side. Plan 4 chose (b) — verify the activity-timeline rendering does this mapping.

4. **`organizations.logo_url` schema column.** Plan 5 Task 5.2 assumes a `logo_url` column exists on `organizations`. The original Phase 1 schema may not include it. If absent, executor must either (a) add an additive migration in this plan or (b) drop the org-logo UI entirely. Cheapest path: drop the upload, keep a text-only `logo_url` field — but verify the column first.

5. **`last_sign_in_at` access from `auth.users`.** Plan 5 InvitationsList tries to detect pending invites via `auth.users.last_sign_in_at IS NULL`. The `auth` schema is not normally exposed to `authenticated` role. The settings page would need to read this via the service-role client — which means the action wraps a server-only RPC. Acceptable to skip the "pending vs accepted" distinction in Phase 1 and just list all org users.

6. **E2E Inngest orchestration.** RESEARCH §31 pitfalls note Inngest must be running for the CV-upload step. The Playwright webServer config currently only starts Next. Plan 5 Task 5.3 must either (a) start Inngest in the Playwright global-setup, (b) mock the Inngest send/dispatch in the test (use `inngest test-engine`), or (c) skip the CV-upload step in the E2E and verify it manually. Recommendation: (b) — keeps CI deterministic.
