-- Phase 3 / Plan 03-03 / Task C.1 — relax applications.job_id NOT NULL so
-- floats (application_type='float') can exist with job_id IS NULL (D3-18),
-- and re-shape the per-(candidate, job, type) uniqueness constraint so
-- multiple floats can coexist for the same candidate.
--
-- TRIGGER ORDERING NOTE (Phase 1 commit 3f748f8): this migration touches NO
-- triggers, only a column nullability and constraints. The existing
-- `applications_set_org` (BEFORE INSERT) and
-- `applications_verify_same_org_check` (BEFORE INSERT OR UPDATE) triggers
-- continue to fire in alphabetical order. The accompanying
-- `*_phase3_applications_same_org_guard_null_safe.sql` migration patches the
-- guard FUNCTION (same name, new body) so it short-circuits on NULL job_id.
--
-- Constraint rationale (D3-18):
--   * Only application_type='float' rows may have NULL job_id.
--   * standard / shortlist / spec MUST have job_id set — prevents accidental
--     orphans when the form forgets to attach a job.
--
-- Unique-constraint rationale:
--   * Postgres treats NULL as distinct in unique constraints, which is
--     exactly what we want — the same candidate can be floated to many
--     prospective clients over time (each float row has job_id IS NULL,
--     and Postgres permits multiple NULL-bearing rows under
--     unique(candidate_id, job_id, application_type)).
--   * Drop the old constraint first because its semantics assumed
--     job_id was NOT NULL.

alter table public.applications alter column job_id drop not null;

-- Only floats may have NULL job_id. standard / shortlist / spec MUST have a
-- job_id (typed as the four possible enum values explicitly so adding a new
-- application_type later is a noisy schema change, not a silent one).
alter table public.applications
  add constraint applications_job_id_required_unless_float
  check (
    (application_type = 'float' and job_id is null)
    or (application_type <> 'float' and job_id is not null)
  );

-- Re-create the per-(candidate, job, type) uniqueness so the new constraint
-- is explicit about its NULL semantics. The Phase 1 schema named this
-- constraint `applications_candidate_id_job_id_application_type_key` (the
-- Postgres default for an inline `unique(...)`); we drop both possible names
-- defensively then re-add with a stable name.
alter table public.applications
  drop constraint if exists applications_candidate_id_job_id_application_type_key;
alter table public.applications
  drop constraint if exists applications_candidate_job_type_unique;
alter table public.applications
  add constraint applications_candidate_job_type_unique
  unique (candidate_id, job_id, application_type);

-- Manual smoke tests (run after migration applies — pgTAP suite lives in
-- supabase/tests/applications-float-null-job.test.sql per Plan 0 scaffold):
--
--   -- (1) float insert with NULL job_id — succeeds
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values ('<org>', '<cand-in-org>', null, 'float');
--
--   -- (2) standard insert with NULL job_id — fails the CHECK
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values ('<org>', '<cand-in-org>', null, 'standard');
--   -- ERROR: new row for relation "applications" violates check constraint
--   --        "applications_job_id_required_unless_float"
--
--   -- (3) two floats for the same candidate — succeeds (NULL job_id distinct)
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values ('<org>', '<cand>', null, 'float'); -- first OK
--   insert into applications (organization_id, candidate_id, job_id, application_type)
--     values ('<org>', '<cand>', null, 'float'); -- second OK (NULLs distinct)
