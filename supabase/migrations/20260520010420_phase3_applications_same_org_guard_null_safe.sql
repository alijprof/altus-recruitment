-- Phase 3 / Plan 03-03 / Task C.1 — make the cross-tenant FK guard for the
-- applications table NULL-safe on job_id (D3-27 + RESEARCH §Pitfall 7).
--
-- Background: the existing `public.applications_same_org_guard()` function
-- (created in 20260517204500_cross_tenant_fk_guards.sql) calls
-- `assert_same_org('public.jobs', new.job_id, new.organization_id)`
-- UNCONDITIONALLY. After the sibling migration
-- `*_phase3_applications_nullable_job_id.sql` lets float rows have
-- job_id IS NULL, that call would raise
--   "cross-tenant FK guard: parent row <null> not found in public.jobs"
-- because assert_same_org looks up the parent row by id and the NULL
-- branch raises on missing parent. Floats are intentional; this is not a
-- tenant violation.
--
-- Fix: short-circuit on NULL job_id BEFORE calling assert_same_org. We also
-- defensively guard candidate_id (in practice it is NOT NULL on the column,
-- but the symmetry is cheap and matches the "always check before assert"
-- pattern used in the other Phase 3 guards).
--
-- This migration REPLACES the function body via `create or replace function`
-- with the SAME name. That is the canonical "edit a function" path in this
-- schema — migrations are append-only at the file level (HARD RULE 6); the
-- function source-of-truth is the most-recent definition.
--
-- TRIGGER ORDERING NOTE (Phase 1 commit 3f748f8): the trigger
-- `applications_verify_same_org_check` is unchanged — only the function
-- body it calls is replaced. Alphabetical ordering vs
-- `applications_set_org` is preserved (v > s).
--
-- HARD RULE 3 trigger ordering reference cited.

create or replace function public.applications_same_org_guard()
returns trigger
language plpgsql
as $$
begin
  -- candidate_id is the NOT NULL anchor on the table (Phase 1 schema), but
  -- defensively short-circuit on NULL anyway so any future schema change
  -- that loosens the column doesn't cascade into a guard panic.
  if new.candidate_id is not null then
    perform public.assert_same_org('public.candidates'::regclass, new.candidate_id, new.organization_id);
  end if;

  -- job_id is nullable for floats (D3-18). assert_same_org raises on missing
  -- parent, which would fire on every float insert — short-circuit instead.
  if new.job_id is not null then
    perform public.assert_same_org('public.jobs'::regclass, new.job_id, new.organization_id);
  end if;

  return new;
end;
$$;

-- Manual smoke tests (run after the three Phase 3 / Task C.1 migrations
-- apply, in order):
--
--   -- (1) float insert with NULL job_id — succeeds (no FK guard panic)
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values ('<org>', '<cand-in-org>', null, 'float');
--
--   -- (2) standard insert with cross-tenant candidate — still fails
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values ('<org-A>', '<cand-in-org-B>', '<job-in-org-A>', 'standard');
--   -- ERROR: cross-tenant FK guard: public.candidates belongs to org <B>,
--   --        expected <A>
--
--   -- (3) trigger ordering preserved:
--   select trigger_name from information_schema.triggers
--     where event_object_table='applications'
--     order by trigger_name;
--   -- expected (alphabetical): applications_set_org,
--   --                          applications_verify_same_org_check
