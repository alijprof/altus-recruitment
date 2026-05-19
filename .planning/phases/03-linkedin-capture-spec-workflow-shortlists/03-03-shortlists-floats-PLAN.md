# Plan C (03-03): Shortlists + speculative floats — enum migration + pipeline filter + per-job tab + candidate floats

**Wave:** 1
**Goal:** Recruiter can add a candidate to a per-job shortlist (working set, invisible from the formal pipeline), float a candidate speculatively with no job attached, and promote a shortlist row to a formal application in one click.
**Depends on:** Plan 0 (Vitest scaffolds + Sentry tag conventions)
**Requirements covered:** SHORT-01, SHORT-02 (Success criterion #4 — first half)
**Decisions implemented:** D3-16 (reuse `applications` with new `'shortlist'` enum value; `'float'` already exists), D3-17 (pipeline + standard list filter on `application_type='standard'`), D3-18 (drop `applications.job_id NOT NULL`; add `CHECK` so only floats may have null job), D3-26 (append-only migrations, trigger-ordering convention), D3-27 (cross-tenant FK guard preserved with NULL-safe short-circuit).

---

## Tasks

### Task C.1 — Migrations: enum + nullable `job_id` + CHECK constraint + null-safe FK guard

**Type:** migration

**Files:**
- NEW `supabase/migrations/<ts0>_phase3_application_type_shortlist.sql` — enum addition; MUST be its own migration (Postgres limitation: `ALTER TYPE ... ADD VALUE` cannot be in a transaction with other DDL referencing the same enum per RESEARCH §M1)
- NEW `supabase/migrations/<ts1>_phase3_applications_nullable_job_id.sql` — drop NOT NULL + add CHECK + redo unique constraint
- NEW `supabase/migrations/<ts2>_phase3_applications_same_org_guard_null_safe.sql` — patch the existing guard function to short-circuit on `new.job_id is null` per RESEARCH §Pitfall 7

`<ts0> < <ts1> < <ts2>` so migrations apply in that order.

**Detail:**

**Migration 1 — `phase3_application_type_shortlist.sql`:**
```sql
-- Phase 3 D3-16: 'spec' and 'float' already exist in application_type from Phase 1
-- (verified in 20260513152244_phase1_domain_schema.sql:54). Only 'shortlist' is missing.
-- Postgres requires ALTER TYPE ... ADD VALUE to be the ONLY DDL in this migration —
-- subsequent migrations cannot reference 'shortlist' until this migration commits.
alter type public.application_type add value if not exists 'shortlist';
```

**Migration 2 — `phase3_applications_nullable_job_id.sql`:**
```sql
-- Phase 3 D3-18: floats have job_id IS NULL.
-- TRIGGER ORDERING NOTE (Phase 1 commit 3f748f8): this migration does NOT add triggers, only
-- relaxes a NOT NULL and reshapes the unique constraint. The existing applications_set_org
-- and applications_verify_same_org_check triggers continue to fire in alphabetical order.

alter table public.applications alter column job_id drop not null;

-- Only floats may have NULL job_id. standard / shortlist / spec MUST have a job_id.
alter table public.applications
  add constraint applications_job_id_required_unless_float
  check ((application_type = 'float' and job_id is null)
      or (application_type <> 'float' and job_id is not null));

-- Drop the old uniqueness (it referenced NOT NULL job_id). Add a new one that allows multiple
-- floats per candidate (Postgres treats NULL as distinct in unique constraints, which is
-- precisely what we want — same candidate can be floated to many notional clients across time).
alter table public.applications drop constraint if exists applications_candidate_job_type_unique;
alter table public.applications
  add constraint applications_candidate_job_type_unique
  unique (candidate_id, job_id, application_type);
```

**Migration 3 — `phase3_applications_same_org_guard_null_safe.sql`:**
```sql
-- Phase 3 D3-27 + RESEARCH §Pitfall 7. The existing applications_check_same_org() (or whatever
-- the trigger function is called in the Phase 1 cross_tenant_fk_guards migration) calls
-- assert_same_org('public.jobs', new.job_id, new.organization_id) UNCONDITIONALLY.
-- After D3-18 makes job_id nullable, that call panics on float rows.
--
-- Fix: short-circuit on NULL.
--
-- This migration REPLACES the function body via create or replace — append-only at the
-- migration level (HARD RULE 6); the function definition is the same name, new body.

create or replace function public.applications_check_same_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.candidate_id is not null then
    perform public.assert_same_org('public.candidates', new.candidate_id, new.organization_id);
  end if;
  if new.job_id is not null then
    perform public.assert_same_org('public.jobs', new.job_id, new.organization_id);
  end if;
  return new;
end$$;

-- Smoke test embedded as comment (run manually per PATTERNS §3):
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values (<org>, <cand>, null, 'float'); -- should succeed
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values (<org>, <cand>, null, 'standard'); -- should fail CHECK
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values (<org>, <other-org-cand>, <other-org-job>, 'standard'); -- should fail FK guard
```

**Acceptance:**
- `pnpm db:reset --local` applies all three cleanly.
- `select enumlabel from pg_enum where enumtypid = 'application_type'::regtype order by enumsortorder` returns `applied, ..., standard, spec, float, shortlist` (or equivalent — `shortlist` is present).
- Smoke test 1 (float insert with NULL job_id): succeeds.
- Smoke test 2 (standard insert with NULL job_id): fails with CHECK violation.
- Smoke test 3 (cross-tenant FK): fails with same-org assertion.
- `select trigger_name from information_schema.triggers where event_object_table='applications' order by trigger_name` still shows `applications_set_org` before `applications_verify_same_org_check`.

---

### Task C.2 — DB helpers + pipeline filter patch + per-job shortlist tab + candidate floats tab

**Type:** code (auto, tdd="true")

**Files:**
- NEW `src/lib/db/shortlists.ts` — `listShortlistForJob`, `listFloatsForCandidate`, `listAllFloats` per PATTERNS §7
- NEW `src/lib/db/shortlists.test.ts` — Vitest; assert shortlist list query includes `.eq('application_type','shortlist')`; assert float list includes `.is('job_id', null)`
- EDIT `src/lib/db/applications.ts` — **CRITICAL** patch `listApplicationsByStage` (lines 166–173) and `listAllApplicationsByStage` (lines 185+) to add `.eq('application_type','standard')` filter (D3-17 invariant). Without this, shortlist rows pollute the pipeline kanban once they exist.
- EDIT `src/lib/db/applications.test.ts` (or NEW if missing) — REPLACE Plan 0 placeholder `applications-pipeline-filter.test.ts`; assert pipeline-style queries return ZERO shortlist rows
- NEW `src/app/(app)/jobs/[id]/shortlist/page.tsx` — RSC tab; pattern per existing `jobs/[id]/page.tsx` plus the kanban-list pattern from `jobs/[id]/pipeline/...`
- NEW `src/app/(app)/jobs/[id]/shortlist/shortlist-list.tsx` — Client Component; renders rows + "Convert to formal application" button per row
- NEW `src/app/(app)/jobs/[id]/shortlist/add-to-shortlist-dialog.tsx` — Client Component; candidate picker + submit calls `addToShortlistAction`
- NEW `src/app/(app)/candidates/[id]/floats/page.tsx` — RSC tab listing floats for this candidate
- NEW `src/app/(app)/candidates/[id]/floats/float-form.tsx` — Client Component; submit calls `addFloatAction` (no `job_id`)
- NEW `src/app/(app)/floats/page.tsx` — RSC org-wide floats list (Phase 4 may extend; Phase 3 ships the basic view)
- EDIT `src/app/(app)/jobs/[id]/layout.tsx` (or page.tsx, wherever tabs live) — add `Shortlist` tab entry between `Pipeline` and existing tabs
- EDIT `src/app/(app)/candidates/[id]/layout.tsx` (or page.tsx) — add `Floats` tab entry
- EDIT `src/components/app/top-nav.tsx` — add `Floats` nav item (org-wide list)

**Detail:**

**`shortlists.ts` helpers** (per PATTERNS §7 `applications.ts` shape):
```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const APP_WITH_CANDIDATE_SELECT = `id, application_type, stage, created_at, ...,
  candidate:candidates(id, name, current_role_title, current_company, email)`

export async function listShortlistForJob(supabase: SupabaseClient<Database>, jobId: string): Promise<DbResult<...>> {
  const { data, error } = await supabase
    .from('applications')
    .select(APP_WITH_CANDIDATE_SELECT)
    .eq('job_id', jobId)
    .eq('application_type', 'shortlist')
    .order('created_at', { ascending: false })
  // standard Sentry-capture-then-return pattern
}

export async function listFloatsForCandidate(supabase, candidateId) {
  // .eq('candidate_id', candidateId).eq('application_type','float').is('job_id', null)
}

export async function listAllFloats(supabase, opts?: { ownerId?: string }) {
  // org-wide; optional owner filter for D3-29 "mine only" toggle (UI param, not enforced server-side)
}
```

**Patches to `applications.ts`** (D3-17 — REQUIRED):
- Find `listApplicationsByStage` (lines 166–173 per PATTERNS §7). Add `.eq('application_type', 'standard')` to its select chain.
- Find `listAllApplicationsByStage` (lines 185+). Same patch.
- Add a comment above each: `// D3-17: shortlists and floats live in their own tabs and MUST NOT appear in the pipeline kanban. This filter is the invariant.`

**TDD assertion (`applications-pipeline-filter.test.ts`):**
- Seed 3 rows: one `application_type='standard'`, one `'shortlist'`, one `'float'` (with null job_id).
- Call `listApplicationsByStage(jobId)` → assert only the `'standard'` row returned.

**Per-job shortlist tab (`/jobs/[id]/shortlist`):**
- RSC fetches `listShortlistForJob(supabase, params.id)`.
- Layout: header with "Add to shortlist" button (opens `AddToShortlistDialog`), then a `<Table>` with columns `Candidate | Added | Notes | Actions`.
- Each row's `Actions` column has a "Convert to formal application" `<Button>` that calls `convertShortlistToApplicationAction({ applicationId })`.

**`addToShortlistAction`** (NEW in `src/app/(app)/jobs/[id]/shortlist/actions.ts`, per PATTERNS §5):
```
'use server'
export async function addToShortlistAction({ jobId, candidateId }: { jobId: string; candidateId: string }) {
  // Zod safeParse; createClient + getUser; insert into applications with
  // { candidate_id, job_id, application_type: 'shortlist', stage: 'applied' }
  // organization_id is filled by the _set_org trigger from session — do NOT pass it
  // (PATTERNS §10: TablesInsert as unknown as ... cast for trigger-filled fields).
  // Revalidate /jobs/${jobId}/shortlist.
}
```

**`convertShortlistToApplicationAction`** (NEW in `src/app/(app)/candidates/[id]/shortlist-actions.ts`, per PATTERNS §5 + per CONTEXT D3-16 "one-way; no demotion"):
```
'use server'
export async function convertShortlistToApplicationAction({ applicationId }: { applicationId: string }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // Defensive read — RLS will filter by org, but verify type so we don't accidentally
  // promote a float or no-op on a 'standard' row
  const { data: app, error } = await supabase.from('applications')
    .select('id, application_type, job_id, candidate_id').eq('id', applicationId).single()
  if (error || !app) return { ok: false, error: 'Not found.' }
  if (app.application_type !== 'shortlist') return { ok: false, error: 'Only shortlist rows can be promoted.' }

  const { error: updErr } = await supabase.from('applications').update({
    application_type: 'standard',
    stage: 'applied',
    stage_changed_at: new Date().toISOString(),
  }).eq('id', applicationId)
  if (updErr) return { ok: false, error: 'Promotion failed.' }

  // Activity log per D3-16 audit-trail expectation
  await supabase.from('activities').insert({
    candidate_id: app.candidate_id, job_id: app.job_id,
    kind: 'stage_change',
    body: 'Promoted from shortlist to application',
    metadata: { from: 'shortlist', to: 'standard' },
    // organization_id + actor_user_id filled by triggers
  })

  revalidatePath(\`/jobs/${app.job_id}\`)
  revalidatePath(\`/jobs/${app.job_id}/pipeline\`)
  revalidatePath(\`/jobs/${app.job_id}/shortlist\`)
  revalidatePath(\`/candidates/${app.candidate_id}\`)
  return { ok: true }
}
```

**`addFloatAction`** (NEW in `src/app/(app)/candidates/[id]/floats/actions.ts`):
- Insert with `application_type='float'`, `job_id=null`. The CHECK constraint enforces correctness; the null-safe FK guard from Task C.1 allows it.

**TopNav addition** (`src/components/app/top-nav.tsx`):
- Add `{ href: '/floats', label: 'Floats' }` in the existing `NAV_ITEMS` array; alphabetical insertion between `Dashboard` and `Jobs`.

**Acceptance:**
- `pnpm test -- --run src/lib/db/shortlists.test.ts src/lib/db/applications.test.ts` passes.
- `pnpm typecheck` clean.
- Local manual E2E: create a candidate + a job; click "Add to shortlist" from job detail; row appears in `/jobs/[id]/shortlist` tab; row does NOT appear in `/jobs/[id]/pipeline` kanban; click "Convert to formal application" → row vanishes from shortlist, appears in pipeline at `applied` stage; an activity entry `kind='stage_change'` was logged with `{from:'shortlist', to:'standard'}`.
- Local manual E2E: from candidate detail, add a float (no job); row visible at `/candidates/[id]/floats` and at `/floats`; row does NOT appear at the candidate's "Applications" tab (which filters on `standard`).

---

## AI cost
None. This is pure schema + UI work.

## Risks
- **Existing RPCs assume `job_id NOT NULL`.** PATTERNS §3 calls out: survey `match_candidates_for_job` / pipeline RPCs first. **Mitigation included in Task C.2 prep:** before writing the patch, executor runs `grep -rn "job_id" supabase/migrations/*.sql` and inspects any RPC that joins on `applications.job_id`. If any RPC's logic breaks when `job_id IS NULL`, file a sibling migration to add `where a.job_id is not null` to that RPC's body. The pipeline kanban RPC + match RPC are the obvious candidates.
- **`shortlist` enum value used before migration commits.** Postgres limitation per RESEARCH §M1: separate migration for the enum addition. The two follow-on migrations CAN reference `'shortlist'`.

## Playwright E2E touchpoint
**Stub path:** `tests/e2e/shortlist-and-float.spec.ts` — sign in, create candidate + job (use existing helpers), navigate to `/jobs/[id]/shortlist`, click "Add to shortlist", select candidate, assert row appears; navigate to `/jobs/[id]/pipeline`, assert no shortlist row visible in kanban; click "Convert to formal application", assert row moves into pipeline `applied` column; navigate to candidate's `/floats` tab, add a float without a job, assert row appears at `/floats` org-wide list.

## Cross-plan dependencies
- **Consumes from Plan 0:** Vitest scaffolds (`applications-pipeline-filter.test.ts`), Sentry tag conventions.
- **Independent of Plans A/B/D/E/F:** no shared files; safe to run in parallel with Plans A and B in Wave 1.
- **Provides to Plan F:** the existing `applications.stage='placed'` rows still feed source attribution — Plan F's RPC ignores `application_type` (placements are placements regardless of how they entered the pipeline).
