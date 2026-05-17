---
phase: 1
plan: 3
subsystem: clients-contacts
tags: [clients, contacts, activity-timeline, pg_trgm, rls]
requirements: [CLIENT-01, CLIENT-02, CLIENT-03, CLIENT-04, CLIENT-05]
success_criterion: '#3 — Create client, add contacts, see combined activity timeline'
mode: mvp
status: complete
---

# Phase 1 Plan 3: Clients & Contacts Summary

End-to-end clients module: list with pg_trgm search + dormant flag, create form, detail page with Contacts/Jobs/Activity/Notes tabs, nested contact CRUD with separate edit route, log-note flow that propagates to `client_activity_timeline` and bumps `last_contacted_at` via a Postgres trigger.

## Per-task outcome

| Task | Status | Commit | Files touched |
|------|--------|--------|---------------|
| 3.1 db helpers + view + trigger + search RPC | done | `5fa7c32` | 3 migrations, 3 db helpers |
| 3.2 client list + search + create form | done (via Plan 1's commit) | `d163be3` | 1 modified page, 5 new components |
| 3.3 client detail + tabs + contact CRUD + delete | done | `cec2b16` | 9 new files |

## New migrations (orchestrator: tell user to `pnpm exec supabase db push` then `pnpm db:types`)

- `supabase/migrations/20260517215956_client_activity_view.sql` — `client_activity_timeline` view defined `with (security_invoker = true)` (line 15 of the migration). UNIONs activities across company / contact / job entities into one chronological feed scoped per tenant via RLS on underlying tables.
- `supabase/migrations/20260517215957_bump_last_contacted_at.sql` — `AFTER INSERT` trigger on `public.activities`. When `kind ∈ {call, email, meeting, note}` and `entity_type ∈ {company, contact}`, propagates `occurred_at` to `companies.last_contacted_at` (and `contacts.last_contacted_at` when entity is a contact). Explicitly skips `entity_type = candidate` so Plan 1's manual candidate bump path doesn't double-fire; skips `stage_change` / `system` so pipeline movement isn't recorded as human outreach.
- `supabase/migrations/20260517215958_search_clients_rpc.sql` — `search_clients(p_query, p_threshold, p_sort, p_dir, p_offset, p_limit)` pg_trgm-ranked search over `companies.name + companies.industry`. `security invoker` so RLS still gates per-tenant.

## Files created / modified

### Task 3.1 (db helpers)
- `src/lib/db/clients.ts` — `listClients` (RPC search branch + plain branch with N+1-safe active-jobs enrichment), `getClient`, `createClient`, `updateClient`, `getClientTimeline`, `isDormant` (>60d threshold).
- `src/lib/db/contacts.ts` — `listContactsForCompany`, `getContact`, `createContact`, `updateContact`, `deleteContact`.
- `src/lib/db/activities.ts` — polymorphic `listActivities`, `createActivity` covering all five `entity_type` values.

### Task 3.2 (list, search, create)
- `src/app/(app)/clients/page.tsx` — RSC list with URL-driven sort/dir/page/q, dormant computed server-side, empty + no-match states, pagination.
- `src/app/(app)/clients/client-table.tsx`, `search-input.tsx` — shadcn Table + debounced search.
- `src/app/(app)/clients/new/{page,client-form,schema,actions}.tsx|ts` — RHF + zod + Server Action create flow.

### Task 3.3 (detail, tabs, contacts, log-note, delete)
- `src/app/(app)/clients/[id]/page.tsx` — RSC pre-fetches contacts + jobs + timeline in parallel.
- `src/app/(app)/clients/[id]/client-management-tabs.tsx` — shadcn Tabs (Contacts/Jobs/Activity/Notes). Activity tab uses Plan 1's `<ActivityTimeline entries={...} />`.
- `src/app/(app)/clients/[id]/contact-table.tsx` — table + DropdownMenu Edit/Delete; Delete uses shadcn AlertDialog inline-confirmation per UI-SPEC Destructive Actions.
- `src/app/(app)/clients/[id]/log-note-form.tsx` — Client Component textarea + Save; calls `logNoteAction`, `router.refresh()`.
- `src/app/(app)/clients/[id]/contacts/new/{page,contact-form,schema}.tsx|ts` and `[contactId]/edit/page.tsx` (separate edit route per **VERIFICATION R6**; not inline Sheet).
- `src/app/(app)/clients/[id]/actions.ts` — all server actions: `createContactAction`, `updateContactAction`, `deleteContactAction`, `logNoteAction`, `updateClientAction`.

## Verification gates

| Gate | Result |
|------|--------|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test --run` | 8 passed |
| `pnpm build` | success; all 5 new routes registered (`/clients/[id]`, `/clients/[id]/contacts/new`, `/clients/[id]/contacts/[contactId]/edit`) |

## Plan-level verification checklist

- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [x] No inline `.from('companies')`, `.from('contacts')`, `.from('client_activity_timeline')` outside `src/lib/db/clients.ts` and `src/lib/db/contacts.ts` (verified by grep)
- [x] `client_activity_timeline` view has `security_invoker = true` (line 15 of `20260517215956_client_activity_view.sql`)
- [x] `bump_last_contacted_at` trigger fires only on `kind ∈ {call, email, meeting, note}` and `entity_type ∈ {company, contact}` — coexists with Plan 1's candidate path without conflict
- [x] Dormant flag rendered when `last_contacted_at` > 60 days (computed app-side in `clients.ts` `isDormant()`); list + header both consume the same flag
- [x] Delete contact uses the locked AlertDialog inline-confirmation pattern; contact edit on the locked separate route (R6)
- [ ] **Awaiting user push of new migrations to cloud Supabase** — once pushed, the SQL smoke tests (cross-tenant FK guard fire, trigger bump, view security_invoker) can be re-run

## Deviations from Plan

### Resolved without deviation

- **Plan 1 race on Task 3.2 commit:** Plan 1's Task 1.2 commit (`d163be3`) included my Task 3.2 client files (page.tsx, client-table.tsx, search-input.tsx, new/*.tsx). Implementation is mine; attribution is Plan 1's. Code state on `main` is correct.
- **Activity timeline handoff:** Built Task 3.3 with an inline `InlineTimeline` placeholder first (per orchestrator coordination note), then swapped to Plan 1's `<ActivityTimeline entries={...}>` once `2ca89ce` landed mid-session. Mapping helper in `client-management-tabs.tsx` (`toActivityEntries`) flattens `entity_label` from the view into `metadata.entity_label` so the shared component can render the company/contact/job context.

### Rule 3 auto-fixes

- **RHF + zod resolver type incompatibility (transform output ≠ input):** Schemas use `optional()` only (no `.transform()`) so RHF's `TFieldValues` and the resolver's `TTransformedValues` stay structurally identical. Server actions coerce empty strings to `null` before reaching the DB helper. Same convention as Plan 1's candidate form.
- **`set_organization_id` trigger vs generated insert types:** Generated `TablesInsert<'companies'>` etc. mark `organization_id` as required, but the BEFORE INSERT trigger populates it server-side. Helpers `as` cast the insert payload with an explanatory `// reason:` comment per CLAUDE.md.
- **`Json` recursive type vs `Record<string, unknown>`:** Metadata accepted as `Record<string, unknown>` on the helper boundary and cast at the DB call site / activity-timeline mapping site.

### Rule 2 auto-additions

- Defence-in-depth: `[contactId]/edit/page.tsx` validates `contact.company_id === routeId` before rendering — RLS already gates cross-tenant access, but this catches stale URLs that bookmark a contact under a different company within the same org.

## Known stubs / deferred items

- **Jobs tab** is a placeholder until Plan 4 lands — empty state shows "No jobs yet. … Create job (Plan 4)" with a disabled CTA. Documented inline in `client-management-tabs.tsx`. CLIENT-* requirements unaffected (jobs aren't required by Plan 3's success criterion).
- **Top-level client edit page** (`/clients/[id]/edit`): `updateClientAction` is exported and ready, but no dedicated UI was shipped — the row dropdown links to it for forward-compat. Plan-level acceptable per the optional-edit-route language in the plan.

## What Plan 1 should know

- Shared utility I created: nothing under `src/components/app/`. All my reusable code lives under `src/app/(app)/clients/`. No naming collisions risked.
- I'm consuming `@/components/app/activity-timeline` via the `entries` prop variant. Don't break that signature without coordination.
- I'm consuming `@/lib/date` `formatTimeAgo` in `client-management-tabs.tsx` Notes tab.

## Self-Check: PASSED

- [x] `supabase/migrations/20260517215956_client_activity_view.sql` exists
- [x] `supabase/migrations/20260517215957_bump_last_contacted_at.sql` exists
- [x] `supabase/migrations/20260517215958_search_clients_rpc.sql` exists
- [x] `src/lib/db/clients.ts` exists (Task 3.1, commit `5fa7c32`)
- [x] `src/lib/db/contacts.ts` exists (Task 3.1, commit `5fa7c32`)
- [x] `src/lib/db/activities.ts` exists (Task 3.1, commit `5fa7c32`)
- [x] `src/app/(app)/clients/page.tsx` modified (Task 3.2, in commit `d163be3`)
- [x] `src/app/(app)/clients/[id]/page.tsx` exists (Task 3.3, commit `cec2b16`)
- [x] `src/app/(app)/clients/[id]/client-management-tabs.tsx` exists
- [x] `src/app/(app)/clients/[id]/contacts/[contactId]/edit/page.tsx` exists (R6 separate edit route)
- [x] Commits `5fa7c32`, `cec2b16` verified via `git log`. Task 3.2 implementation persisted in `d163be3` (race with Plan 1).
