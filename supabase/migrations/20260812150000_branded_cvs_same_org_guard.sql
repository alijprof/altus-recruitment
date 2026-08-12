-- Phase 8 review fix CR-02 (BLOCKER) — cross-tenant FK guard on
-- candidate_branded_cvs.candidate_id → candidates.id.
--
-- 20260812120000_candidate_branded_cvs.sql installed a plain FK to
-- candidates(id) plus `unique (candidate_id)`, with organization_id filled
-- by the `set_organization_id` BEFORE INSERT trigger. The INSERT/UPDATE RLS
-- policies only check `organization_id = current_organization_id()` —
-- nothing checks that the referenced candidate belongs to the caller's org.
-- Postgres FKs do not enforce tenancy, and they bypass RLS.
--
-- This repo has already been bitten by this exact shape and fixed it as a
-- CRITICAL: 20260518211005_candidate_cvs_cross_tenant_fk_guard.sql installs
-- assert_same_org('public.candidates', new.candidate_id, new.organization_id)
-- on candidate_cvs; ai_summaries, applications, jobs, contacts, spec_drafts
-- and job_ads all carry the same guard (20260517204500_cross_tenant_fk_guards.sql,
-- 20260520010420_phase3_applications_same_org_guard_null_safe.sql).
-- candidate_branded_cvs did not, until now.
--
-- Concrete exploit this closes: an attacker in org A learns a victim
-- candidate's UUID in org B (e.g. via the public apply form's dedupe
-- response, apply/[orgSlug]/actions.ts:549-550), then POSTs directly at
-- PostgREST with their own JWT: candidate_id = <victim-uuid>. The
-- set_organization_id trigger stamps organization_id = attacker's org, the
-- WITH CHECK passes, the plain FK passes, and the row commits — poisoning
-- the `unique (candidate_id)` slot for a candidate the attacker's org can
-- never see. The victim org's own Generate action then permanently fails
-- (INSERT collides on 23505, the recovery UPDATE matches 0 rows under the
-- victim's RLS, PGRST116) with no UI or support path to clear the row,
-- because it is invisible to the victim's RLS.
--
-- The helper public.assert_same_org() already exists (Plan 0 / Phase 1) —
-- reuse it, same pattern as candidate_cvs.
--
-- Idempotent (create or replace function / drop trigger if exists) so a
-- partially-applied branch can be safely re-pushed.
-- MIGRATION IS APPEND-ONLY — never edit this file once committed. Fix
-- schema issues in a new migration file with a later timestamp.
--
-- NOT applied to any database by this change — it joins the founder's
-- pending Phase 8 migration push (20260812120000, 20260812120100) so the
-- cross-tenant poisoning window never opens in production.
--
-- ---------------------------------------------------------------------------
-- Manual SQL smoke test (run against a database with two orgs A and B, one
-- candidate in B, and an authenticated session for org A):
--
--   insert into public.candidate_branded_cvs
--     (organization_id, candidate_id, storage_path)
--   values
--     ('<org-A-uuid>',
--      '<candidate-in-org-B-uuid>',
--      'org-A/candidate-in-B/branded-cv-x.pdf');
--
-- Expected:
--   ERROR: cross-tenant FK guard: public.candidates belongs to org <B>,
--          expected <A>
-- ---------------------------------------------------------------------------

create or replace function public.candidate_branded_cvs_same_org_guard()
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

drop trigger if exists candidate_branded_cvs_same_org_check
  on public.candidate_branded_cvs;
create trigger candidate_branded_cvs_same_org_check
  before insert or update of candidate_id, organization_id on public.candidate_branded_cvs
  for each row execute function public.candidate_branded_cvs_same_org_guard();
