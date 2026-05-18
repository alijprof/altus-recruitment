# Plan 4: Jobs & Pipeline Kanban

**Phase:** 1 — Internal ATS
**Plan:** 4 of 5 (pipeline)
**Depends on:** Plan 0 (db layer, env, types, cross-tenant FK guards on `jobs → companies` AND `applications → candidates/jobs`, Sentry, middleware). Plan 1 (candidates exist to add as applications). Plan 3 (clients/companies exist to attach jobs to; Plan 3 Jobs tab links to `/clients/[id]/jobs/new` which this plan provides). Plan 4 does NOT depend on Plan 2 (CVs are nice-to-have on a job's candidates but not required for pipeline mechanics).
**Requirements covered:** PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06
**Success criterion satisfied:** #4 — "Recruiter can create a job against a client, add candidates as applications, drag cards between pipeline stages on a kanban board, and decline a candidate with a structured reason — all stage changes auto-logged to activities"
**Mode:** mvp — vertical slice (job create → application create → kanban with drag + decline modal + mobile fallback + global `/pipeline`)

## Goal

After this plan, a recruiter on `/clients/[id]` can click "Create job", land on a job create form, save, land on `/jobs/[id]` (with fields + applications list + pipeline tab), add an existing candidate as an application, navigate to the pipeline view, drag a card between stages with the pending-state pattern (D-09), reject a card via the decline modal with required reason + optional notes (D-10), and see every stage change auto-logged to the application's activity timeline. On a phone, the kanban becomes a stacked accordion list (D-11). A global `/pipeline` view aggregates applications across all open jobs with URL-param filters (D-12).

## Required reading for executor

- `.planning/phases/01-internal-ats/01-CONTEXT.md` decisions D-09 through D-15
- `.planning/phases/01-internal-ats/01-RESEARCH.md` — sections **21 (dnd-kit library choice + full kanban code skeleton), 22 (D-09 pending-state pattern — already covered by §21 skeleton), 23 (`move_application` Postgres function + server action — full skeleton; this migration lands in this plan), 24 (mobile accordion fallback)**
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — all "Task 6 — Jobs & pipeline" rows
- `.planning/phases/01-internal-ats/01-UI-SPEC.md` — section 4 (Pipeline Kanban — full spec including column list, card spec, pending-state contract, decline modal contract, mobile fallback contract), Decline Reason Labels enum→label table
- `docs/phase-1-tasks.md` Task 6
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` — `jobs`, `applications` shapes; `application_stage` enum; `decline_reason` enum; the `decline_reason_present_when_terminal` CHECK constraint

## Tasks

### Task 4.1: Migrations + db helpers (jobs, applications) + `move_application` Postgres function + applications stage-changed index

**Files:**
- create `supabase/migrations/<ts>_move_application_function.sql`
- create `supabase/migrations/<ts>_applications_stage_changed_idx.sql`
- create `src/lib/db/jobs.ts`
- create `src/lib/db/applications.ts`

**Pattern to copy:** RESEARCH §23 — `move_application(p_application_id, p_to_stage, p_decline_reason, p_decline_notes, p_actor_user_id)` Postgres function VERBATIM. Note the function is `SECURITY INVOKER` (RLS applies) and atomic (UPDATE + INSERT in one transaction). Also adds an index `applications_stage_changed_at_idx` on `(organization_id, stage_changed_at)` for fast dashboard stale queries (RESEARCH §27 pitfalls).

**Implementation:**
1. **`<ts>_move_application_function.sql`** — paste RESEARCH §23 function verbatim. Grant `execute on function public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid) to authenticated;`. The activity body strings MUST use the exact UI-SPEC §Activity Type Labels strings: `'Moved to ' || replace(p_to_stage::text, '_', ' ')` produces "Moved to applied" / "Moved to first interview" etc.; for declines, `'Declined — ' || coalesce(p_decline_reason::text, 'unspecified')` writes the **raw enum value** (e.g., `'Declined — not_qualified'`). Per VERIFICATION R1: leave the activity body as raw enum; the frontend `<ActivityTimeline>` renders the human label via `formatDeclineReason()` from `src/lib/legal/decline-reasons.ts` (introduced in Task 4.3 step 5). Document this in code comments.
2. **`<ts>_applications_stage_changed_idx.sql`** — `create index if not exists applications_stage_changed_at_idx on public.applications (organization_id, stage_changed_at);`. Used by the dashboard stale query in Plan 5.
3. **`src/lib/db/jobs.ts`** with `import 'server-only'`:
   - `listJobs(supabase, { q, sort, dir, page, pageSize, statusFilter })` — default sort `created_at DESC`, default filter `status = 'open'` (D-15). Returns rows + total count.
   - `getJob(supabase, id)` — full row with the company name joined (`*, companies(id, name)`).
   - `listJobsForCompany(supabase, companyId)` — used by the Plan 3 Jobs tab.
   - `createJob(supabase, input)` — input includes `company_id`, `title`, `job_type` (perm/temp/contract), `hiring_context` (new/backfill), `location`, `salary_min`, `salary_max`, `description`, `owner_user_id`. The Plan 0 cross-tenant FK guard automatically validates `company_id`'s org matches.
   - `updateJob(supabase, id, patch)`.
4. **`src/lib/db/applications.ts`**:
   - `listApplicationsForJob(supabase, jobId)` — returns rows with `candidates(id, full_name, current_role_title, current_company)` joined; computed `days_in_stage = floor((now - stage_changed_at) / 86400 s)` either in SQL via `extract(epoch from (now() - stage_changed_at)) / 86400` or app-side.
   - `listApplicationsByStage(supabase, jobId)` — same data, grouped into `Record<Stage, Card[]>` for the kanban (call from server, hand-shaped to the client).
   - `listAllApplicationsByStage(supabase, { ownerId?, jobId?, clientId? })` — for the global `/pipeline` view (D-12) with optional URL-param filters; group by stage.
   - `createApplication(supabase, { jobId, candidateId, applicationType = 'standard' })` — defaults `stage = 'applied'`. The Plan 0 cross-tenant FK guard validates both `candidate_id` and `job_id` belong to the same org.

**Verification:**
- `pnpm exec supabase db reset` runs cleanly (all migrations apply, including Plan 0 + Plan 1 + Plan 3 + this Plan's)
- `pnpm typecheck` passes after `pnpm db:types` regen — the Database type includes `move_application` and the new RPC params/return.
- In `psql`: `select move_application('<app_id>', 'screening', null, null, null);` then `select stage, stage_changed_at from applications where id = '<app_id>'` — confirm UPDATE happened. `select kind, body, metadata from activities where entity_type = 'application' and entity_id = '<app_id>'` returns a row with `kind='stage_change'`, `body='Moved to screening'`, `metadata = {"from_stage": "applied", "to_stage": "screening", ...}`.
- Decline path: `select move_application('<app_id>', 'rejected', 'client_rejected_skills', 'Needs more cloud experience', '<user_id>');` — confirm `decline_reason = 'client_rejected_skills'`, `decline_notes` set, `declined_at` set, activity body `'Declined — client_rejected_skills'`. (Note: `client_rejected_skills` is one of the 9 real enum values from the schema migration line 56–66 — see VERIFICATION R1.)
- The schema CHECK `decline_reason_present_when_terminal` still fires: `select move_application('<app_id>', 'rejected', null, null, null);` from psql — expect an error.

### Task 4.2: Job create form + job detail page with applications list + add-candidate-to-job action

**Files:**
- modify `src/app/(app)/jobs/page.tsx` (currently placeholder; replace with the jobs list)
- create `src/app/(app)/jobs/jobs-table.tsx`
- create `src/app/(app)/jobs/[id]/page.tsx`
- create `src/app/(app)/jobs/[id]/job-detail-header.tsx`
- create `src/app/(app)/jobs/[id]/applications-list.tsx`
- create `src/app/(app)/jobs/[id]/add-candidate-form.tsx` (Client Component — searchable candidate picker)
- create `src/app/(app)/jobs/[id]/actions.ts` (server actions for job-level: `addCandidateToJobAction`, `moveApplicationAction`)
- create `src/app/(app)/clients/[id]/jobs/new/page.tsx`
- create `src/app/(app)/clients/[id]/jobs/new/job-form.tsx`
- create `src/app/(app)/clients/[id]/jobs/new/schema.ts`
- create `src/app/(app)/clients/[id]/jobs/new/actions.ts`

**Pattern to copy:** Plan 1 candidate-form structure for job-form. RESEARCH §23 server action skeleton for `moveApplicationAction`. UI-SPEC §1 list spec for jobs-table.

**Implementation:**
1. **Jobs list page** (`/jobs/page.tsx`) — async RSC. `listJobs(supabase, { statusFilter: 'open', sort: 'created_at', dir: 'desc', ... })`. Table columns: Title, Client (company.name), Type, Status, Created. Row click → `/jobs/[id]`. Row action dropdown with `aria-label="Actions for ${job.title}"`. Empty state per UI-SPEC: heading "No jobs yet", body "Create a job against a client to start building your pipeline.", CTA "View clients" linking to `/clients`.
2. **Job create form** at `/clients/[id]/jobs/new`:
   - Zod schema: `title` (required), `job_type` (enum perm|temp|contract), `hiring_context` (enum new|backfill), `location`, `salary_min`, `salary_max`, `description` (textarea), `owner_user_id` (defaults to current user — can be left blank in MVP). NOT `company_id` (route param supplies it).
   - Server action `createJobAction({ companyId, ...input })` calls `createJob`, `redirect(\`/jobs/${id}\`)`.
3. **Job detail page** (`/jobs/[id]/page.tsx`) — async RSC. `getJob`. Renders `<JobDetailHeader>` (title, client name with link to `/clients/[clientId]`, type/context/salary badges), then `<ApplicationsList>` (table form of applications with candidate names), then a "View pipeline" link to `/jobs/[id]/pipeline` (Task 4.3).
4. **AddCandidateForm** — `'use client'`. shadcn `<Popover>` with a `<Command>` palette (or fall back to a `<Select>` if `cmdk` isn't installed — `<Command>` requires shadcn `command` primitive; install if not yet: `pnpm dlx shadcn@latest add command`). User types to search candidates (calls a server action that hits the `search_candidates` RPC from Plan 1). Selects a candidate → calls `addCandidateToJobAction({ jobId, candidateId })`. UI-SPEC copywriting: button label "Add candidate to job".
5. **addCandidateToJobAction** in `[id]/actions.ts`:
   - `createApplication({ jobId, candidateId })`. The Plan 0 cross-tenant FK guard validates both belong to the same org.
   - `revalidatePath(\`/jobs/${jobId}\`)` and `revalidatePath(\`/jobs/${jobId}/pipeline\`)`. Returns `{ ok: true }`.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Navigate to a client detail page → Jobs tab → "Create job" → form → submit → redirect to `/jobs/[id]`. Job detail renders with the company name.
- On job detail, "Add candidate to job" opens the search popover. Type 3 letters of a candidate's name → see results. Select one → application appears in the applications list with `stage = 'applied'`.
- Cross-tenant: in org B, attempt to add a candidate from org A — the RPC fails (RLS denies `candidates` select; even if forced through, the Plan 0 FK guard raises an exception).

### Task 4.3: Pipeline kanban (per-job + global) with dnd-kit pending state + decline modal + mobile accordion fallback

**Files:**
- create `src/components/app/pipeline-board.tsx` (desktop kanban — `'use client'` with `DndContext`)
- create `src/components/app/pipeline-card.tsx` (sortable card — `'use client'`)
- create `src/components/app/pipeline-mobile-list.tsx` (mobile accordion — `'use client'`)
- create `src/components/app/decline-modal.tsx` (`'use client'`)
- create `src/app/(app)/jobs/[id]/pipeline/page.tsx`
- create `src/app/(app)/jobs/[id]/pipeline/pipeline-shell.tsx` (Client wrapper that swaps desktop kanban / mobile list based on `useMediaQuery` or matchMedia)
- modify `src/app/(app)/pipeline/page.tsx` (currently placeholder; render the global aggregated pipeline)
- modify `src/app/(app)/jobs/[id]/actions.ts` (or split into `/pipeline/actions.ts`) — implement `moveApplicationAction({ applicationId, toStage, declineReason?, declineNotes? })` per RESEARCH §23

**Pattern to copy:** RESEARCH §21 (full PipelineBoard + Column + SortableCard code skeleton — copy and adapt — including the `pendingIds: Set<string>`, the optimistic move, the snap-back on error). RESEARCH §23 (`moveApplicationAction` server action that calls `move_application` RPC). RESEARCH §24 (mobile `<Accordion>` + bottom `<Sheet>` "Move to..." picker). UI-SPEC §4 in full for the cosmetics + the decline modal contract.

**Implementation:**
1. `pnpm add @dnd-kit/core@6.3 @dnd-kit/sortable@10` (UI-SPEC §Registry Safety names these — and they're the only acceptable dnd lib per RESEARCH §21).
2. Install missing shadcn primitive: `pnpm dlx shadcn@latest add accordion command` (accordion for mobile fallback, command for the add-candidate picker if not already done in Task 4.2).
3. **PipelineBoard** — paste RESEARCH §21 skeleton wholesale and adapt. `STAGES = ['applied','screening','cv_submitted','first_interview','second_interview','offer','placed']` — verified against the `application_stage` enum in `supabase/migrations/20260513152244_phase1_domain_schema.sql` line 42 (VERIFICATION open issue #1 settled). Excludes terminal stages `rejected/withdrawn` from droppable columns visually (`placed` shows as the rightmost column; `rejected`/`withdrawn` are not columns — they're triggered by the Reject action on the card).
4. **PipelineCard** — match UI-SPEC §4 card spec: candidate name (`text-sm font-semibold`), current role (`text-xs text-muted-foreground font-normal`), days-in-stage chip (`text-xs font-normal`), stale indicator (amber dot) when `days_in_stage > 14`. `<DropdownMenuTrigger>` MUST have `aria-label="Actions for ${candidateName}"`. Options: "Move to stage" (opens a small `<DropdownMenu>` with stage options — useful for keyboard/screen-reader users) and "Reject" (in red text — opens the `<DeclineModal>`). The DropdownMenuTrigger button MUST call `event.stopPropagation()` so clicking it doesn't initiate a drag (RESEARCH §21 pitfalls).
5. **Shared decline-reason helper + DeclineModal** (per VERIFICATION R1):
   - Create `src/lib/legal/decline-reasons.ts` with `import 'server-only'` removed (this module is consumed by both server and client). Export:
     ```ts
     import type { Enums } from '@/types/database'
     export type DeclineReason = Enums<'decline_reason'>
     export const DECLINE_REASONS: ReadonlyArray<{ value: DeclineReason; label: string }> = [
       { value: 'not_qualified',            label: 'Not qualified' },
       { value: 'salary_mismatch',          label: 'Salary mismatch' },
       { value: 'location_mismatch',        label: 'Location / relocation' },
       { value: 'candidate_withdrew',       label: 'Candidate withdrew' },
       { value: 'client_rejected_skills',   label: 'Client rejected — skills' },
       { value: 'client_rejected_culture',  label: 'Client rejected — culture' },
       { value: 'client_filled_internally', label: 'Filled internally' },
       { value: 'client_filled_other',      label: 'Filled (other source)' },
       { value: 'other',                    label: 'Other' },
     ] as const
     const LABEL_BY_VALUE = Object.fromEntries(DECLINE_REASONS.map(r => [r.value, r.label])) as Record<DeclineReason, string>
     export function formatDeclineReason(value: DeclineReason | string | null | undefined): string {
       if (!value) return 'Unspecified'
       return LABEL_BY_VALUE[value as DeclineReason] ?? value
     }
     ```
   - `<DeclineModal>` — shadcn `<Dialog>`. Title "Decline {candidateName}". Body: `<Select>` for decline reason (required — no default placeholder; user must actively choose) rendered from `DECLINE_REASONS` (option `value={r.value}`, content `{r.label}`). `<Textarea>` for optional notes (placeholder "Additional notes..."). Footer: "Cancel" (variant `outline`) + "Decline candidate" (variant `destructive`, disabled until a reason is selected). On confirm: calls `moveApplicationAction({ applicationId, toStage: 'rejected', declineReason, declineNotes })`. Closes dialog. Toast "Candidate declined." on success per UI-SPEC.
   - `<ActivityTimeline>` rendering for `kind='stage_change'` reads `metadata.decline_reason` and calls `formatDeclineReason(metadata.decline_reason)` to produce the human label shown next to the raw activity body. Plan 1 Task 1.3 (ActivityTimeline creation) and Plan 3 Task 3.3 (timeline extension) must import this helper — add a note in their Required reading.
6. **moveApplicationAction** — paste RESEARCH §23 server-action skeleton verbatim. Adapts: re-validate that when `toStage in ['rejected', 'withdrawn']`, `declineReason` is provided (return `{ ok: false, error: 'Please select a decline reason.' }` per UI-SPEC error states). Call `supabase.rpc('move_application', { p_application_id, p_to_stage, p_decline_reason, p_decline_notes, p_actor_user_id })`. `revalidatePath('/pipeline')` and `revalidatePath(\`/jobs/${jobId}/pipeline\`)`. Returns `{ ok, error? }`. The Postgres function does the UPDATE + activity INSERT atomically.
7. **PipelineShell** — `'use client'`. Use `window.matchMedia('(min-width: 768px)')` inside `useEffect` to pick a single child to render (`<PipelineBoard>` desktop or `<PipelineMobileList>` mobile). Render desktop on SSR (no `window`) and let the effect swap to mobile on first client paint; acceptable hydration shift for Phase 1 per VERIFICATION R7. **Do NOT** render both trees with Tailwind `hidden`/`block` — that doubles client bundle weight (`dnd-kit` + `accordion` both load).
8. **PipelineMobileList** — paste RESEARCH §24 skeleton. shadcn `<Accordion>` with one `<AccordionItem>` per stage; expanded body lists cards vertically. Tapping a card opens a bottom `<Sheet>` with "Move to..." buttons for each non-terminal stage + "Reject" button (opens the same `<DeclineModal>`). No drag-and-drop on mobile per D-11.
9. **Per-job pipeline route** (`/jobs/[id]/pipeline/page.tsx`) — async RSC. `listApplicationsByStage(supabase, jobId)` → groups into `Record<Stage, Card[]>` → renders `<PipelineShell initial={...} jobId={id} />`.
10. **Global pipeline route** (`/pipeline/page.tsx`) — async RSC reading `searchParams` for `owner`, `job`, `client` filters (D-12). `listAllApplicationsByStage(supabase, { ownerId, jobId, clientId })` → groups into `Record<Stage, Card[]>` → renders `<PipelineShell initial={...} />` (same component). Adds a filter Popover above the board with three Select dropdowns; selecting writes URL search params and RSC re-renders.

**Verification:**
- `pnpm lint && pnpm typecheck && pnpm build` pass
- Success criterion #4 demo: navigate to a job with at least 3 applications. Drag a card from "applied" to "screening" — see the `opacity-60` + "Saving…" pending UI for ~200 ms then clear. Open the candidate's activity timeline → "Moved to screening" entry visible with the correct metadata. Click "Reject" on another card → modal opens → "Decline candidate" disabled until reason picked → select "Client rejected — skills" (renders from `DECLINE_REASONS`, submits enum value `client_rejected_skills`) + add notes → confirm → toast fires → card disappears from columns (it's now `rejected`). Activity timeline shows "Declined — client_rejected_skills" raw body with the human label "Client rejected — skills" rendered alongside via `formatDeclineReason()`.
- Simulate server failure: in DevTools, throttle/disable network briefly during a drag → expect the card to animate back to source column and the error toast "Couldn't move {Name} — please try again." per UI-SPEC.
- Resize browser to <768 px width → kanban swaps to accordion list. Tap a card → bottom sheet "Move to..." picker opens → choose a stage → move happens via the same RPC.
- Global `/pipeline` view loads with all applications across all open jobs. Apply a filter `?owner=<user-id>` via URL → only that owner's applications render.
- `select kind, metadata from activities where entity_type = 'application' order by occurred_at desc limit 5;` shows the expected `stage_change` rows with `from_stage`/`to_stage`/`decline_reason` in metadata.
- Cross-tenant: `move_application` RPC from org B against an org-A application — RLS on `applications` denies the UPDATE; RPC returns "Move failed" without exposing the row.

## Plan-level verification

Run before declaring the plan done:

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Success criterion #4 demo passes end-to-end (above).
- [ ] PIPE-05: every stage change writes an `activities` row with `kind='stage_change'` and `metadata.from_stage`/`metadata.to_stage` populated (`select count(*) from activities where kind = 'stage_change'` reflects every drag in your test session).
- [ ] PIPE-06: `/pipeline` aggregates across jobs; URL-param filters work.
- [ ] D-09 pending state observed; D-10 decline modal requires a reason at both UI and DB layers; D-11 mobile accordion works at < 768 px; D-12 global pipeline reuses the same component tree.
- [ ] No inline `.from('jobs')`, `.from('applications')` outside `src/lib/db/jobs.ts` and `src/lib/db/applications.ts`.
- [ ] Keyboard accessibility smoke: tab into a kanban card, focus the dropdown trigger, verify the `aria-label` is announced by VoiceOver/NVDA (the icon-only button rule from UI-SPEC).
- [ ] `applications_stage_changed_at_idx` index exists (`select indexname from pg_indexes where indexname = 'applications_stage_changed_at_idx'` returns a row).

## Out of scope for this plan (deferred or other plans)

- Submission tracking richness (submit-to-client workflow) — Phase 2.
- Float / spec applications (`application_type = 'float'`) — Phase 3.
- Pipeline value calculations (`charge_rate × time` etc.) — Phase 4.
- Email notifications on stage change — Phase 4.
- Bulk-move actions — Phase 5.
- Per-org configurable pipeline stage names — Phase 5 (the seven stages are fixed here).
- A `format_decline_reason()` SQL helper for prettier activity body strings — defer unless Plan 5 demo feedback demands it.
- React 19's `useOptimistic` migration — Plan 4 uses the explicit `pendingIds` Set per UI-SPEC §4 contract (which requires a _visible_ pending indicator).
