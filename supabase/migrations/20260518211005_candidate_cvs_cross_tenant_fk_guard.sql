-- Phase 1 review fix C1 (CRITICAL) — cross-tenant FK guard on
-- candidate_cvs.candidate_id → candidates.id.
--
-- Plan 0 installed cross-tenant FK trigger guards for contacts, jobs, and
-- applications (see 20260517204500_cross_tenant_fk_guards.sql), but the
-- analogous guard for candidate_cvs.candidate_id was missed. Combined with
-- the service-role bypass inside the Inngest CV parser this opened a real
-- cross-tenant data poisoning path:
--
--   1. Attacker (org A) calls uploadCVAction with candidate_id = <UUID in org B>.
--   2. uploadCVAction validates candidate_id only as a UUID — no org check.
--   3. The candidate_cvs_set_org trigger fills organization_id = caller's org
--      (A). The plain FK on candidate_id only verifies existence, NOT that the
--      candidate belongs to the same org. The row commits with
--      (organization_id = A, candidate_id = victim-in-B).
--   4. The Inngest parser's tenant-boundary check is satisfied (all three of
--      organization_id / candidate_id / storage_path were forged consistently)
--      and the service-role write into the victim's candidate row succeeds.
--
-- This trigger closes the integrity gap server-side. The helper
-- public.assert_same_org() already exists from Plan 0 — reuse it.
--
-- ---------------------------------------------------------------------------
-- Manual SQL smoke test (run against a database with two orgs A and B, one
-- candidate in B, and an authenticated session for org A):
--
--   insert into public.candidate_cvs
--     (organization_id, candidate_id, storage_path, mime_type, version)
--   values
--     ('<org-A-uuid>',
--      '<candidate-in-org-B-uuid>',
--      'foo/bar.pdf',
--      'application/pdf',
--      1);
--
-- Expected:
--   ERROR: cross-tenant FK guard: public.candidates belongs to org <B>,
--          expected <A>
-- ---------------------------------------------------------------------------

create or replace function public.candidate_cvs_same_org_guard()
returns trigger
language plpgsql
as $$
begin
  perform public.assert_same_org(
    'public.candidates'::regclass,
    new.candidate_id,
    new.organization_id
  );
  return new;
end;
$$;

create trigger candidate_cvs_same_org_check
  before insert or update of candidate_id, organization_id on public.candidate_cvs
  for each row execute function public.candidate_cvs_same_org_guard();
