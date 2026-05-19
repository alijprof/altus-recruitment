-- Placeholder pgTAP-style scaffold for SHORT-02 (float rows with NULL job_id).
-- Plan 03-03 executor replaces the stubs below with real BEGIN/ROLLBACK
-- pgTAP assertions once the applications.job_id NOT NULL drop migration
-- and the float CHECK constraint land.
--
-- Expected behavior (per D3-18 + cross_tenant_fk_guards.sql audit):
--   1. INSERT applications row with application_type='float' AND job_id=NULL
--      MUST succeed (no NOT NULL violation, no CHECK violation).
--   2. INSERT applications row with application_type='standard' AND
--      job_id=NULL MUST FAIL the CHECK constraint
--      `((application_type='float' AND job_id IS NULL) OR
--        (application_type<>'float' AND job_id IS NOT NULL))`.
--   3. Same-org guard on applications.job_id MUST NOT throw when job_id is
--      NULL (the existing assert_same_org trigger must check for NULL first).
--   4. RLS: cross-tenant SELECT of a float row from another org returns 0 rows.

-- TODO Plan 03-03: replace with real pgTAP assertions.
select 1 as placeholder;
