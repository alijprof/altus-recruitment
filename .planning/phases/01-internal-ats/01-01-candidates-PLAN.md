# Plan 1: Candidates Module

**Phase:** 1 — Internal ATS
**Plan:** 1 of 5 (candidates)
**Depends on:** Plan 0 (Hardening & Infrastructure) — must be merged before this plan starts. Plan 1 consumes `src/lib/db/`, `src/lib/env.ts`, the regenerated `database.ts`, Sentry scope, the GIN trigram indexes on `candidates.full_name/email/current_role_title`, and the renamed `src/middleware.ts`.
**Requirements covered:** CAND-01, CAND-02, CAND-03, CAND-04, CAND-05, CAND-06, CAND-07
**Success criterion satisfied:** #1 — "Recruiter can create a candidate with GDPR consent captured, view and edit all fields, log calls and notes from the detail page — and be blocked from creating without consent"
**Mode:** mvp — vertical slice (after this plan, the recruiter can manage candidates end-to-end without CVs; Plan 2 layers CV upload on top)

## Goal

After this plan, a recruiter can sign in, land on `/candidates` (empty state on first run), click "Add your first candidate", fill the create form with GDPR consent, hit submit, be redirected to `/candidates/[id]` (which silently writes an audit-log row), see all fields, edit the candidate, and log a call or note from the detail page — with the activity timeline updating in place. List view supports server-side sort + search + pagination (D-13, D-14, D-15).

## Required reading for executor

- `.planning/phases/01-internal-ats/01-CONTEXT.md` (decisions D-13, D-14, D-15, D-16; specifics; deferred)
- `.planning/phases/01-internal-ats/01-RESEARCH.md` — sections **11 (RHF + zod + shadcn Form + Server Action pattern), 12 (GDPR consent UX), 13 (pg_trgm ranked search + `search_candidates` RPC — the RPC migration lives in this plan), 14 (server-side list pagination + sort + filter via URL searchParams)**
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — all "Task 3 — Candidates module" file rows + Conventions cheat-sheet section
- `.planning/phases/01-internal-ats/01-UI-SPEC.md` — sections 1 (Candidate List), 2 (Candidate Detail), 7 (Forms), Empty States, Activity Type Labels, Layout Patterns
- `CLAUDE.md` (verification checklist + "never do")
- `docs/phase-1-tasks.md` Task 3 spec (the original requirements)
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` — `candidates`, `activities`, `audit_log` table shapes; `record_audit(action, entity_type, entity_id)` function signature
- `src/app/(app)/layout.tsx`, `src/lib/db/profiles.ts`, `src/lib/db/organizations.ts` (analog patterns for new helpers)
- `src/app/(auth)/sign-in/sign-in-form.tsx` (analog Client Component form — but new candidate form uses react-hook-form per D-13 — see disagreement resolution in PATTERNS.md)

## Tasks

### Task 1.1: shadcn primitives + candidates db helper + `search_candidates` RPC migration

**Files:**
- modify `package.json` / `components.json` (via `pnpm dlx shadcn@latest add table dialog sheet form select badge skeleton card separator dropdown-menu avatar textarea checkbox popover` — primitives needed across Plans 1–5; install them up-front here)
- create `src/lib/db/candidates.ts`
- create `src/lib/db/activities.ts`
- create `supabase/migrations/<ts>_search_candidates_rpc.sql`

**Pattern to copy:** PATTERNS.md "Task 3" rows `src/lib/db/candidates.ts`. RESEARCH §9 (db helper shape) + RESEARCH §13 (RPC body for trigram search with `similarity()` ranking + tie-breaker). The activities helper mirrors the candidates helper shape.

**Implementation:**
1. Run `pnpm dlx shadcn@latest add table dialog sheet form select badge skeleton card separator dropdown-menu avatar textarea checkbox popover progress alert tabs` (UI-SPEC §1 lists every primitive Phase 1 needs; install all at once so later plans don't trip on missing components).
2. Create `src/lib/db/candidates.ts` with `import 'server-only'` at the top. Export the following functions; each accepts `supabase: SupabaseClient<Database>` as first arg and returns `DbResult<T>`:
   - `listCandidates(supabase, { q?, sort, dir, page, pageSize })`: when `q` is non-empty, calls the `search_candidates` RPC. Otherwise plain `.select()` with `.order(sort, { ascending: dir === 'asc', nullsFirst: false })`, `.range(offset, offset + pageSize - 1)`, and a parallel `.select('*', { count: 'exact', head: true })` for total. **Default sort:** `last_contacted_at DESC NULLS LAST` (D-15). **MUST NOT call `record_audit`** — D-16 forbids audit on list views.
   - `getCandidate(supabase, id)`: returns the full row. **MUST call `record_audit(p_action: 'view', p_entity_type: 'candidate', p_entity_id: id)` via `.rpc()` AFTER the select succeeds** (D-16, CAND-06). Wrap the rpc call in try/catch that captures to Sentry but doesn't fail the page render.
   - `createCandidate(supabase, input)`: insert into `candidates` with `consent_basis`, `consent_at = now()`, `consent_text_version` populated. Returns the new row id.
   - `updateCandidate(supabase, id, patch)`: update by id.
   - `listCandidateActivities(supabase, candidateId, limit = 50)`: select from `activities` where `entity_type = 'candidate' and entity_id = candidateId`, ordered by `occurred_at DESC`.
3. Create `src/lib/db/activities.ts` exporting `logActivity(supabase, { entityType, entityId, kind, body, metadata })` — inserts into `activities`. The Postgres trigger added in Plan 0 will not bump `last_contacted_at` on candidates (that trigger only covers companies/contacts — see RESEARCH §20). For candidate activities, after insert, call `updateCandidate(supabase, candidateId, { last_contacted_at: new Date().toISOString() })` if the kind is `call|email|meeting|note`. Keep this in the helper, not in route code, so every activity path benefits.
4. Create the search RPC migration. Use RESEARCH §13 body — `create or replace function public.search_candidates(p_query text, p_limit int, p_offset int) returns table(<columns>) language sql stable as $$ select ... from candidates where (full_name % p_query or coalesce(email,'') % p_query or coalesce(current_role_title,'') % p_query) order by greatest(similarity(full_name, p_query), similarity(coalesce(email,''), p_query), similarity(coalesce(current_role_title,''), p_query)) desc, full_name asc limit p_limit offset p_offset $$;`. Grant `execute` to `authenticated`. The function is `stable` (read-only) and security invoker by default — RLS on `candidates` still applies.

**Verification:**
- `pnpm exec supabase db reset` runs all migrations cleanly (including the new RPC)
- `pnpm typecheck` passes — the regenerated `Database` type now includes `search_candidates` in its `Functions` block (rerun `pnpm db:types` after `db reset` if needed)
- From `psql`: `select * from search_candidates('smy', 25, 0);` returns matches for `'Smith'` (proves trigram operator is wired)
- `grep -n "record_audit" src/lib/db/candidates.ts` shows the call inside `getCandidate` and NOT inside `listCandidates`

### Task 1.2: Candidate list + search + create form + GDPR consent capture

**Files:**
- create `src/lib/legal/consent.ts` (exports `CURRENT_CONSENT_VERSION = 'v1'` constant + `CONSENT_TEXT_V1` string)
- modify `src/app/(app)/candidates/page.tsx` (currently a placeholder stub — replace with the real list view)
- create `src/app/(app)/candidates/candidate-table.tsx`
- create `src/app/(app)/candidates/search-input.tsx` (Client Component — debounced URL search-param updater)
- create `src/components/app/market-status-badge.tsx` (used by the table and the detail header)
- create `src/components/app/empty-state.tsx` (shared — UI-SPEC empty-state pattern)
- create `src/components/app/list-skeleton.tsx` (shared — UI-SPEC skeleton rows)
- create `src/app/(app)/candidates/new/page.tsx`
- create `src/app/(app)/candidates/new/schema.ts`
- create `src/app/(app)/candidates/new/candidate-form.tsx`
- create `src/app/(app)/candidates/new/actions.ts`

**Pattern to copy:** RESEARCH §14 (list page = async RSC + `await searchParams` + `listCandidates()` + table component + pagination buttons that write URL params), RESEARCH §11 + §12 (form + consent UX — the full code skeleton in §11 IS the implementation). UI-SPEC §1 (list spec — debounce 300ms on the search input) + UI-SPEC §7 (form spec). PATTERNS.md "Task 3" rows for the exact file structure.

**Implementation:**
1. Create `src/lib/legal/consent.ts` with `export const CURRENT_CONSENT_VERSION = 'v1'` and `export const CONSENT_TEXT_V1 = 'I confirm we have appropriate consent or legitimate-interest basis to hold this candidate\'s data, in line with UK GDPR.'`. The form imports the text; the action imports the version. Bumping privacy copy = bump constant + add v2.
2. **List page** (`src/app/(app)/candidates/page.tsx`) — async RSC that:
   - Accepts `searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string }>` (Next.js 16 makes `searchParams` a Promise).
   - Awaits it; defaults: `sort = 'last_contacted_at'`, `dir = 'desc'`, `page = 1`, `pageSize = 25` (D-15).
   - Calls `listCandidates()` and renders either the `<EmptyState heading="No candidates yet" body="Add your first candidate to get started." cta={{ href: '/candidates/new', label: 'Add candidate' }} />` when count is 0 OR `<CandidateTable rows={...} totalCount={...} page={page} />` otherwise.
   - Wraps `<SearchInput initialQuery={q} />` above the table; renders a "Add candidate" `Link` button when rows exist.
   - Loading state: use the `<ListSkeleton rows={5} cols={6} />` component inside `<Suspense>` or as the route-level loading skeleton (per UI-SPEC §1 "Loading: skeleton rows").
3. **CandidateTable** (RSC) — shadcn `<Table>` with sticky header; columns Name, Role / Company, Location, Market Status, Last Contacted, Source (UI-SPEC §1). Column headers are `text-xs text-muted-foreground font-normal` (no `font-medium`). Each row is wrapped in `<Link href={`/candidates/${id}`}>` (or use Next.js `useRouter().push` inside a Client wrapper — RSC `<Link>` is cleaner). Row action `<DropdownMenuTrigger>` MUST have `aria-label="Actions for ${candidate.full_name}"` (UI-SPEC accessibility rule). Sort column header shows lucide `ChevronUp`/`ChevronDown` based on the active `sort`/`dir`. Pagination footer with Previous/Next that update the URL `?page=` param.
4. **SearchInput** — Client Component, `'use client'` at the top. Holds the input value in `useState`, debounces 300ms (UI-SPEC §1: "do NOT call on every keystroke"), then `router.replace(\`/candidates?q=${value}&page=1\`)`. Use `useTransition` to show a subtle pending UI if appropriate.
5. **MarketStatusBadge** — props `{ status: Enums<'market_status'> }`; renders shadcn `<Badge>` with the color mapping from UI-SPEC §Color (green for actively_looking, blue for passively_looking, amber for hot, purple for placed, gray for cold). Hardcode the class mapping inline (5 cases, trivial).
6. **EmptyState** + **ListSkeleton** — match UI-SPEC empty-state copy table and skeleton-rows spec.
7. **Create form** — full skeleton in RESEARCH §11. File breakdown:
   - `schema.ts`: zod schema with `full_name`, `email`, `phone`, `location`, `current_role_title`, `current_company`, `market_status` (enum), `source` (enum), `consent_basis` (enum), `consent_confirmed: z.literal(true)`. Export `CreateCandidateInput = z.infer<...>`.
   - `actions.ts`: `'use server'` at the top. `createCandidateAction(rawInput: unknown)` re-validates with the same schema, calls `createCandidate()` from the db helper with `consent_at: new Date().toISOString()` and `consent_text_version: CURRENT_CONSENT_VERSION`. Returns `{ ok, fieldErrors? | formError? }`. On success, `revalidatePath('/candidates')` then `redirect('/candidates/[id]')`.
   - `candidate-form.tsx`: `'use client'`. Uses `useForm` + `zodResolver`. Form structure matches RESEARCH §11 — every domain field, then a `<Separator />` with "Data & Consent" heading (`text-sm font-semibold`), `consent_basis` select, `consent_confirmed` checkbox bound to `z.literal(true)`, inline privacy paragraph (`text-xs text-muted-foreground`) using `CONSENT_TEXT_V1`. Submit button disabled until `form.watch('consent_confirmed') === true` (UX safety net) AND zod re-checks server-side (legal guarantee). Toast on error via `sonner`.
   - `page.tsx`: minimal RSC wrapper rendering `<CandidateForm />` inside the `(app)` layout's `<main>`.
8. **Where appropriate, add `sonner`**: `pnpm add sonner`. Inject `<Toaster />` into `src/app/(app)/layout.tsx` so toasts from all `(app)` routes render. (Not in the root layout — auth routes don't need toasts in Phase 1.)

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Navigate to `/candidates` while signed in — empty state visible with "Add your first candidate" CTA (UI-SPEC copywriting contract).
- Click CTA — `/candidates/new` form renders. Try submitting with no `full_name`: zod error inline. Try submitting without ticking consent: button disabled. Tick consent + fill name + submit: redirect to `/candidates/[id]`.
- Back to `/candidates` — list shows the new row. Search for first 3 letters of the name — row stays. Search for nonsense — empty results region.
- `select * from audit_log where entity_type = 'candidate' order by created_at desc limit 1;` returns a row written when `/candidates/[id]` rendered (Task 1.3 below also verifies, but the helper call happens here)
- RLS smoke: sign in as a second account in a different org (use Supabase Studio to create one) — your candidate is invisible.

### Task 1.3: Candidate detail page + edit form + activity logging from detail view

**Files:**
- create `src/app/(app)/candidates/[id]/page.tsx`
- create `src/app/(app)/candidates/[id]/candidate-detail-header.tsx`
- create `src/components/app/activity-timeline.tsx` (shared — Plans 3 and 4 reuse)
- create `src/app/(app)/candidates/[id]/log-activity-form.tsx` (Client Component — note/call/meeting buttons + textarea)
- create `src/app/(app)/candidates/[id]/actions.ts`
- create `src/app/(app)/candidates/[id]/edit/page.tsx`
- create `src/app/(app)/candidates/[id]/edit/candidate-edit-form.tsx`
- create `src/app/(app)/candidates/[id]/edit/actions.ts`
- modify `src/app/(app)/candidates/[id]/actions.ts` (extend with edit + activity log actions)

**Pattern to copy:** PATTERNS.md "Task 3" rows `src/app/(app)/candidates/[id]/page.tsx`, `candidate-detail-header.tsx`, `src/components/app/activity-timeline.tsx`. UI-SPEC §2 (Candidate Detail layout — two-column desktop, stacked mobile; activity timeline newest-first; lucide icon per kind). RESEARCH §9 — `getCandidate()` calls `record_audit` (audit happens at the helper level so the route doesn't need to remember).

**Implementation:**
1. **Detail page** (`/candidates/[id]/page.tsx`) — async RSC:
   - Reads `params: Promise<{ id: string }>`, awaits, calls `getCandidate(supabase, id)`. On `not_found` → `notFound()` (Next.js 404). On `internal` → throw to error boundary.
   - Layout per UI-SPEC §2: `grid grid-cols-1 lg:grid-cols-3 gap-6`. Left 2/3: `<CandidateDetailHeader />` + field groups (Contact, Location, Employment, GDPR) + `<ActivityTimeline />`. Right 1/3: placeholder for CV history (Plan 2 fills this in; for now render an empty section card with text "CV history" — DO NOT render a real CV panel; that's Plan 2).
   - At the top: render an `<Link href={`/candidates/${id}/edit`}>` Edit button.
   - Below the header: `<LogActivityForm candidateId={id} />` Client Component.
   - Audit is automatic — `getCandidate()` already called `record_audit` (D-16).
2. **CandidateDetailHeader** — props `{ candidate: Tables<'candidates'> }`. Renders full_name (`text-xl font-semibold`), current_role + company (`text-sm text-muted-foreground`), and `<MarketStatusBadge>`. Email rendered in `--font-mono` per UI-SPEC §Typography ("technical strings only").
3. **ActivityTimeline** — props `{ entityType: 'candidate' | 'company' | 'contact' | 'job' | 'application'; entityId: string }`. Server Component that fetches via `listCandidateActivities()` (or a polymorphic version — for Plan 1, only the candidate branch is implemented; Plan 3 extends). Renders the list per UI-SPEC §2 spec — lucide icons (`MessageSquare`/`Phone`/`Users`/`ArrowRight`), actor initials, time-ago (use `Intl.RelativeTimeFormat`, no extra dependency), body. Empty state per UI-SPEC copywriting contract.
4. **LogActivityForm** — `'use client'`. shadcn `<Select>` for kind (`note | call | meeting`), `<Textarea>` for body, "Save" button. On submit, calls a `logActivityAction(formData)` server action; on success, `router.refresh()` (RSC re-fetches the timeline). Toast feedback via sonner.
5. **actions.ts** (in `/candidates/[id]/`):
   - `'use server'`
   - `logActivityAction({ candidateId, kind, body })`: re-validates with a tiny zod schema, calls `logActivity()` from `src/lib/db/activities.ts`, `revalidatePath(\`/candidates/${candidateId}\`)`. Returns `{ ok, error? }`.
6. **Edit form** — `[id]/edit/page.tsx` + `candidate-edit-form.tsx` + `edit/actions.ts`:
   - Reuse the `schema.ts` from the create form but drop the `consent_confirmed` literal and consent fields (already captured). Re-export an `editCandidateSchema = createCandidateSchema.omit({ consent_confirmed: true, consent_basis: true })` or write a fresh schema — either works.
   - The form pre-populates from the existing row (server fetches in the page, passes as `defaultValues`).
   - `updateCandidateAction(id, rawInput)` re-validates, calls `updateCandidate()`, then `redirect(\`/candidates/${id}\`)`.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Open `/candidates/[id]` for the candidate created in Task 1.2. All fields render, market-status badge has the right color, email is in mono font, activity timeline shows the empty state.
- Click Edit. Form pre-populated. Change a field. Save. Redirect back; field updated.
- Log a note via the LogActivityForm. Timeline shows the new entry with `MessageSquare` icon, "Added a note" label (UI-SPEC activity type labels), and time-ago "just now". Log a call, log a meeting — all three icons rendered.
- `select * from audit_log where entity_type = 'candidate' and entity_id = '<id>' and action = 'view' order by created_at desc limit 5;` shows multiple rows — one per visit to the detail page (D-16, CAND-06).
- `select last_contacted_at from candidates where id = '<id>';` is non-null and very recent (proves the activity helper updated the candidate row).
- Cross-tenant RLS check: in a second org, attempt `https://localhost:3000/candidates/[id-from-org-A]` — expect 404 (RLS denies select).

## Plan-level verification

Run before declaring the plan done:

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Success criterion #1 demonstrated end-to-end: sign in → `/candidates` → add candidate (with consent) → view detail → log a call + a note → edit a field → see changes. Without consent, submit is blocked at both UI and zod layers.
- [ ] `audit_log` has rows for every detail-view (CAND-06 confirmed via SQL count). List-view URLs do NOT create audit rows (D-16).
- [ ] `consent_basis`, `consent_at`, `consent_text_version` all populated on the new candidate (`select consent_basis, consent_at, consent_text_version from candidates order by created_at desc limit 1;` returns non-nulls).
- [ ] Trigram search works: search "smy" finds "Smith" (seed at least one such candidate manually or via a temporary seed script).
- [ ] URL search params govern state: `/candidates?sort=full_name&dir=asc&page=2` reloads and shows page 2 sorted by name (D-14).
- [ ] No inline `.from('candidates')` outside `src/lib/db/candidates.ts` (`grep -rn "from('candidates')" src/app/` returns nothing).
- [ ] Cross-tenant RLS smoke: candidate in org A invisible to org B user.

## Out of scope for this plan (deferred or other plans)

- CV upload + parsing + review panel — Plan 2. The detail page reserves the right-1/3 column with a placeholder "CV history" section but does NOT render a real CV upload component.
- Semantic candidate search — Phase 2 (deferred). Plan 1 ships keyword `pg_trgm` only.
- GDPR right-to-erasure flow — Phase 3 (deferred per CONTEXT.md).
- Audit logging on list/search views — Phase 2 (deferred per D-16).
- Bulk import — Phase 5.
- Candidate self-service page — Phase 2.
