# Plan 3: Clients & Contacts

**Phase:** 1 — Internal ATS
**Plan:** 3 of 5 (clients)
**Depends on:** Plan 0 (db layer, env, types, cross-tenant FK guard on `contacts → companies`, GIN trigram index on `companies.industry` already landed in Plan 0). Does NOT depend on Plans 1 or 2 — clients can be developed in parallel after Plan 0; the orchestrator can choose to ship Plan 3 before Plan 2 if desired, since the only shared file is `src/components/app/activity-timeline.tsx` (created by Plan 1 — if Plan 3 lands first, it creates the component instead). **Order chosen here:** sequential after Plan 2 to keep wave logic simple and reuse the activity timeline.
**Requirements covered:** CLIENT-01, CLIENT-02, CLIENT-03, CLIENT-04, CLIENT-05
**Success criterion satisfied:** #3 — "Recruiter can create a client, add contacts nested under it, and see a combined activity timeline for the client across contacts and jobs"
**Mode:** mvp — vertical slice (list → detail with tabs → create client → add contact → log note → timeline reflects everything)

## Goal

After this plan, a recruiter can land on `/clients` (empty state initially), click "Add your first client", create a client, land on `/clients/[id]` showing Contacts | Jobs | Activity | Notes tabs, add 1–2 contacts inline, log a note against the client, and see the combined timeline pull in entries across the company + every contact + every job under it. Stale clients (>60 days no contact) show an amber "Dormant" badge in the list (D-15 default sort + the dormant flag from CLIENT-01).

## Required reading for executor

- `.planning/phases/01-internal-ats/01-CONTEXT.md` decisions D-13, D-14, D-15, D-16
- `.planning/phases/01-internal-ats/01-RESEARCH.md` — sections **11 (form pattern — reused), 13 (pg_trgm search — `search_clients` RPC body), 14 (list pagination/sort pattern), 19 (flat vs nested routes — Plan 3 uses flat: `/clients`, `/clients/[id]`, `/clients/[id]/contacts/new`), 20 (client_activity_timeline view + `bump_last_contacted_at()` trigger — both migrations land in this plan)**
- `.planning/phases/01-internal-ats/01-PATTERNS.md` — all "Task 5 — Clients & contacts" file rows
- `.planning/phases/01-internal-ats/01-UI-SPEC.md` — section 5 (Client Detail), Empty States row "Clients list", Copywriting Contract row "Delete contact"
- `docs/phase-1-tasks.md` Task 5
- `supabase/migrations/20260513152244_phase1_domain_schema.sql` — `companies`, `contacts` table shapes (note: `companies` is the table; the UI calls them "clients" — keep the table name `companies` in queries to match the schema)
- The `src/lib/db/candidates.ts` pattern from Plan 1 — use it as the analog for `clients.ts` and `contacts.ts`
- `src/components/app/activity-timeline.tsx` from Plan 1 — extend polymorphic branch for clients

## Tasks

### Task 3.1: Migrations (`client_activity_timeline` view + `bump_last_contacted_at` trigger + `search_clients` RPC) + db helpers

**Files:**
- create `supabase/migrations/<ts>_client_activity_view.sql`
- create `supabase/migrations/<ts>_bump_last_contacted_at.sql`
- create `supabase/migrations/<ts>_search_clients_rpc.sql`
- create `src/lib/db/clients.ts`
- create `src/lib/db/contacts.ts`
- modify `src/lib/db/activities.ts` (extend `logActivity` polymorphism to support `entity_type ∈ {company, contact, job}` — Plan 1 only built the candidate branch)

**Pattern to copy:** RESEARCH §20 — both code blocks verbatim (the view + the trigger). RESEARCH §13 — `search_clients` mirrors `search_candidates` but searches `companies.name` and `companies.industry`. RESEARCH §9 db-helper shape.

**Implementation:**
1. **`<ts>_client_activity_view.sql`** — paste RESEARCH §20 first code block verbatim: `create or replace view public.client_activity_timeline with (security_invoker = true) as ...` with the UNION-via-JOIN that pulls activities where `entity_type='company'`, `entity_type='contact' AND contact.company_id = c.id`, or `entity_type='job' AND job.company_id = c.id`. `security_invoker = true` is mandatory (RESEARCH §20 pitfalls — without it RLS is bypassed).
2. **`<ts>_bump_last_contacted_at.sql`** — paste RESEARCH §20 second code block: `create or replace function public.bump_last_contacted_at()` + the `after insert on public.activities` trigger. Function updates `companies.last_contacted_at` and `contacts.last_contacted_at` based on `entity_type` when `kind in ('call', 'email', 'meeting', 'note')`. Does NOT touch candidates (Plan 1's activity helper does that manually — see Plan 1 Task 1.1; both code paths can coexist).
3. **`<ts>_search_clients_rpc.sql`** — `create or replace function public.search_clients(p_query text, p_limit int, p_offset int) returns table(<companies columns>) language sql stable as $$ select * from companies where (name % p_query or coalesce(industry,'') % p_query) order by greatest(similarity(name, p_query), similarity(coalesce(industry,''), p_query)) desc, name asc limit p_limit offset p_offset $$;`. Grant `execute` to `authenticated`. RLS on `companies` still applies (security invoker).
4. **`src/lib/db/clients.ts`** with `import 'server-only'`:
   - `listClients(supabase, { q, sort, dir, page, pageSize })` — default sort `last_contacted_at DESC NULLS LAST` (D-15). When `q` is set, call `search_clients` RPC; otherwise plain select. Returns rows + total count + the dormant-flag computed in app code (`last_contacted_at < now() - 60 days`).
   - `getClient(supabase, id)` — returns the company row.
   - `createClient(supabase, input)`, `updateClient(supabase, id, patch)`.
   - `getClientTimeline(supabase, clientId, limit=50)` — selects from the `client_activity_timeline` view per RESEARCH §20 helper. Returns `{ kind, body, occurred_at, actor_user_id, entity_type, entity_label, metadata }[]`.
5. **`src/lib/db/contacts.ts`**:
   - `listContactsForCompany(supabase, companyId)` — ordered by `full_name`.
   - `createContact`, `updateContact`, `deleteContact` (Phase 1 supports delete per CLIENT-04). On insert, the Plan 0 cross-tenant FK guard automatically validates `organization_id` matches the parent company's org.
6. **Extend `src/lib/db/activities.ts`** — add `entity_type` parameter so `logActivity` covers candidates/companies/contacts/jobs/applications. The trigger from step 2 handles `last_contacted_at` for companies + contacts; the candidate branch in Plan 1 still manually updates `candidates.last_contacted_at`. Leave both code paths; they don't conflict.
7. After all migrations, run `pnpm exec supabase db reset` + `pnpm db:types` to regenerate types — the `Database` type now includes the view and the new RPC.

**Verification:**
- `pnpm exec supabase db reset` runs cleanly
- `pnpm typecheck` passes (no `any` left after type regen)
- In `psql`: insert a company, a contact under it, a job under it, and 3 activities (one per entity). `select * from client_activity_timeline where client_id = '<id>' order by occurred_at desc;` returns all 3 rows. `security_invoker = true` proves multi-tenant safety: sign in as org B in Studio and run the same select — zero rows.
- Insert an activity and verify `last_contacted_at` updated on both the contact row AND the parent company row (trigger from step 2).

### Task 3.2: Client list + search + create form + client list dormant flag

**Files:**
- modify `src/app/(app)/clients/page.tsx` (currently a placeholder stub)
- create `src/app/(app)/clients/client-table.tsx`
- create `src/app/(app)/clients/search-input.tsx` (mirror of candidates Plan 1 — or refactor Plan 1's into a shared component; keep duplicated for plan-scope clarity)
- create `src/app/(app)/clients/new/page.tsx`
- create `src/app/(app)/clients/new/client-form.tsx`
- create `src/app/(app)/clients/new/schema.ts`
- create `src/app/(app)/clients/new/actions.ts`

**Pattern to copy:** UI-SPEC §1 (table spec — reuse for clients) + UI-SPEC §Empty States row "Clients list" + UI-SPEC dormant flag spec ("amber Badge 'Dormant'" if `last_contacted_at > 60 days ago`). RESEARCH §11 / §14 / Plan 1 candidate-form for the form shape.

**Implementation:**
1. List page mirrors Plan 1's candidate list: async RSC reading `searchParams`, calls `listClients`, renders `<EmptyState>` on count=0 (copy "No clients yet" / "Add a client to track jobs and contacts." / "Add client") or `<ClientTable rows={...} />` otherwise.
2. `ClientTable` columns: Name, Industry, Last Contacted, Active Jobs Count, Dormant flag (badge). Active jobs count is a per-row aggregate — extend `listClients` to include `(select count(*) from jobs where company_id = companies.id and status = 'open') as active_jobs_count`. Dormant computed app-side: `Date.now() - new Date(last_contacted_at).getTime() > 60 * 86400_000`.
3. Row action `<DropdownMenuTrigger>` MUST have `aria-label="Actions for ${company.name}"` (UI-SPEC §1).
4. Create form: a zod schema with `name`, `industry`, `website`, `notes` (all optional except `name`). Mirror Plan 1's candidate-form structure (no consent section — clients aren't subject to candidate GDPR rules; the legal basis for B2B contact data is captured at the contact level if at all).
5. Server action `createClientAction(rawInput)` re-validates, calls `createClient()` helper, `revalidatePath('/clients')`, `redirect(\`/clients/${id}\`)`.

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- `/clients` empty state → click CTA → form → submit → redirect to detail page.
- Manually set a row's `last_contacted_at` to `now() - interval '61 days'` in SQL; refresh `/clients` — that row shows the amber Dormant badge.
- Trigram search "meri" finds "Meridian Energy" (seed at least one such row).
- RLS smoke: org A's client invisible to org B.

### Task 3.3: Client detail page with tabs (Contacts | Jobs | Activity | Notes) + contact nested CRUD + delete confirmation

**Files:**
- create `src/app/(app)/clients/[id]/page.tsx`
- create `src/app/(app)/clients/[id]/client-management-tabs.tsx`
- create `src/app/(app)/clients/[id]/contact-table.tsx`
- create `src/app/(app)/clients/[id]/log-note-form.tsx` (Client Component for the Notes tab)
- create `src/app/(app)/clients/[id]/contacts/new/page.tsx`
- create `src/app/(app)/clients/[id]/contacts/new/contact-form.tsx`
- create `src/app/(app)/clients/[id]/contacts/new/schema.ts`
- create `src/app/(app)/clients/[id]/contacts/[contactId]/edit/page.tsx` (per VERIFICATION R6 — separate edit route mirroring Plan 1's candidate edit pattern; imports the form + schema from `../../new/` and reuses `updateContactAction`)
- create `src/app/(app)/clients/[id]/actions.ts` (server actions: `createContactAction`, `updateContactAction`, `deleteContactAction`, `logNoteAction`, `updateClientAction`)
- modify `src/components/app/activity-timeline.tsx` (extend polymorphic branch — accept `{ entityType: 'client'; clientId: string }` variant; under the hood, calls `getClientTimeline()` from `src/lib/db/clients.ts`)
- modify `src/app/(app)/clients/[id]/page.tsx` — extend to also list jobs under the client (read-only Jobs tab; Plan 4 makes them clickable to job detail / pipeline)

**Pattern to copy:** UI-SPEC §5 (Client Detail layout — full-width header with name + industry + status badges, then shadcn `<Tabs>`: Contacts | Jobs | Activity | Notes). PATTERNS.md "Task 5" rows. Delete-contact uses the inline confirmation pattern from UI-SPEC Destructive Actions row ("Inline confirmation: 'Delete [Name]? This cannot be undone.' with destructive button + Cancel").

**Implementation:**
1. **Detail page** (`/clients/[id]/page.tsx`) — async RSC:
   - `getClient(id)` → 404 on not_found.
   - Renders header: `text-xl font-semibold` name, industry as `text-sm text-muted-foreground`, Dormant badge if applicable, "Edit" link to a separate edit form (or keep inline — Plan 3 ships a simple `/clients/[id]/edit/page.tsx`; for context budget reasons, skip a dedicated edit page and let users edit fields inline via a small Sheet OR a separate route — pick the simpler shape; recommend a separate edit route mirroring candidates Plan 1).
   - `<ClientManagementTabs clientId={id} />` Client Component.
2. **ClientManagementTabs** — `'use client'`. shadcn `<Tabs>` with four `<TabsTrigger>` items + `<TabsContent>`. Each tab's content is itself an async server-fetched section — easiest pattern: each tab body is a thin Client wrapper that lazy-loads via `<Suspense>` boundaries OR (preferred) the parent RSC pre-fetches all four data sets and passes them down as props. Pick props-down for simplicity.
   - **Contacts tab**: `<ContactTable rows={contacts} companyId={id} />`. "Add contact" button top-right linking to `/clients/[id]/contacts/new`. Each row has `<DropdownMenuTrigger aria-label="Actions for ${contact.full_name}">`. Actions: "Edit" navigates to a **separate route** `/clients/[id]/contacts/[contactId]/edit` mirroring Plan 1's `/candidates/[id]/edit` pattern — per VERIFICATION R6, lock to the separate route (do not use an inline Sheet). The edit page is RHF + zod with the same schema as the create form and reuses `updateContactAction` from `[id]/actions.ts`. "Delete" uses the inline confirmation per UI-SPEC.
   - **Jobs tab**: simple table of jobs under this client. Plan 3 reads jobs (they exist from Plan 4 onward; Plan 3 ships an empty Jobs tab gracefully — "No jobs yet. Create a job against a client to start building your pipeline." per UI-SPEC empty states). Once Plan 4 lands, the Create job link wires to `/clients/[id]/jobs/new`.
   - **Activity tab**: `<ActivityTimeline entityType="client" clientId={id} />` — uses the extended polymorphic component reading from the `client_activity_timeline` view.
   - **Notes tab**: `<LogNoteForm clientId={id} />` — textarea + Save button; on save, `logNoteAction({ companyId, body })` server action writes an activity with `kind='note'`, `entity_type='company'`, `entity_id=clientId`. `router.refresh()`.
3. **Contact create form** at `/clients/[id]/contacts/new`:
   - Zod schema: `full_name` (required), `role`, `email`, `phone`, all optional except name. NOT including `company_id` (the route param supplies it; the action injects it).
   - Server action `createContactAction({ companyId, ...input })` — `createContact(supabase, { ...input, company_id: companyId })`. The Plan 0 cross-tenant FK guard verifies the contact's org matches the company's org. `revalidatePath(\`/clients/${companyId}\`)`, `redirect(\`/clients/${companyId}\`)`.
4. **Delete contact** — inline confirmation per UI-SPEC Destructive Actions row. A small Client Component renders a "Delete" button; on click, shows a confirm prompt (shadcn `<AlertDialog>` is overkill for "this cannot be undone" — but it's the documented shadcn pattern; use it for accessibility). Confirm calls `deleteContactAction(contactId)`, `revalidatePath`. Toast "Contact deleted."

**Verification:**
- `pnpm lint && pnpm typecheck` pass
- Success criterion #3 demo: create client → land on detail → add 2 contacts → log a note via the Notes tab → switch to Activity tab → all 3 entries visible (1 note + 2 implicit "Contact added" entries IF you choose to write activity rows on contact creation — Plan 3 does NOT require this; CLIENT-05 only requires `last_contacted_at` updates which the trigger handles. Skip writing contact-creation activities unless trivial.)
- Verify `last_contacted_at` on the company row updates when ANY note is logged against ANY contact (RESEARCH §20 trigger).
- Cross-tenant FK guard smoke: in `psql`, attempt `insert into contacts(organization_id, company_id, full_name) values ('<org-A>', '<company-in-org-B>', 'X');` — expect the trigger from Plan 0 to raise an exception with `cross-tenant FK guard:` in the message.
- Delete a contact via the row dropdown → AlertDialog confirms → row gone → activity timeline still shows past entries for that contact ID even though the contact row is gone (timeline preserves history).

## Plan-level verification

Run before declaring the plan done:

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Success criterion #3 demo passes (above).
- [ ] CLIENT-05 confirmed via SQL: insert a note against a contact under company X; `select last_contacted_at from companies where id = X` is updated.
- [ ] No inline `.from('companies')`, `.from('contacts')`, or `.from('client_activity_timeline')` outside `src/lib/db/clients.ts` and `src/lib/db/contacts.ts`.
- [ ] `client_activity_timeline` view has `security_invoker = true` (`select definition from pg_views where viewname = 'client_activity_timeline'` shows `security_invoker = true` in the WITH clause OR the equivalent `relrowsecurity` is true).
- [ ] Cross-tenant FK guard fires on bad-org contact insert (smoke test from Plan 0 still passes — re-run it).
- [ ] Trigram search on `companies.industry` works: query "ener" finds "Energy" industry rows.
- [ ] Dormant flag renders correctly for rows older than 60 days; doesn't render for newer rows.

## Out of scope for this plan (deferred or other plans)

- Jobs detail/pipeline UI under the Jobs tab — Plan 4. Plan 3 renders the Jobs tab with an empty-state-friendly read-only list (or "No jobs yet" CTA pointing to `/clients/[id]/jobs/new` which Plan 4 implements).
- Per-client revenue / placement summaries — Phase 4.
- Fee agreement management UI — Phase 3.
- Dormant-clients dashboard widget — Phase 3 (Phase 1 only shows the per-row flag in the list).
- Semantic client search — Phase 2.
- Edit-contact dedicated route — keep inline edit Sheet if you want; otherwise a separate route is acceptable. Either pattern OK; don't expand scope.
