-- Attribution trigger: stamp created_by on insert (audit §4.9).
--
-- Steele Charles feature review 2026-07-31, Batch 2 Task 2 Step B: the
-- buyer-value report is attribution-blind because `created_by` is NEVER
-- stamped by app code today — every row created through the UI or
-- Inngest has created_by = NULL, so coalesce(owner_user_id, created_by)
-- in the buyer-value RPCs falls all the way through to NULL for any row
-- that also lacks an explicit owner_user_id.
--
-- Mirrors `set_organization_id()` from
-- 20260513152244_phase1_domain_schema.sql:86 — same shape, same BEFORE
-- INSERT timing, same SECURITY INVOKER posture.
--
-- TRIGGER-ORDERING LESSON (20260518213836_fix_same_org_trigger_order.sql):
-- Postgres fires same-timing (BEFORE INSERT) triggers on the same table in
-- ALPHABETICAL ORDER BY TRIGGER NAME. This migration's triggers are named
-- `<table>_set_created_by`, which sorts BEFORE both `<table>_set_org` and
-- `<table>_verify_same_org_check` ("set_c" < "set_o" < "verify_s"). That
-- ordering is harmless here: no cross-tenant guard or org-fill trigger
-- reads `created_by` — the same-org guards only inspect `candidate_id`,
-- `job_id`, `company_id`, `organization_id`, and set_organization_id()
-- only writes `organization_id`. `created_by` has no downstream trigger
-- dependency, so firing first or last makes no observable difference.
--
-- `coalesce(new.created_by, auth.uid())` means an explicitly-supplied
-- created_by always wins (defence in depth, matches set_organization_id's
-- coalesce shape), and service-role inserts (Inngest, the public apply
-- form) where auth.uid() is NULL keep today's NULL behaviour — nothing
-- regresses for those paths.
--
-- Additive + idempotent only: new function, new triggers on 5 existing
-- tables. Zero backfill, zero data risk — this affects INSERT only, no
-- existing row is touched.

create or replace function public.set_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;
-- SECURITY INVOKER (the default — do NOT mark this SECURITY DEFINER). The
-- audit already flagged 11 anon-executable SECURITY-DEFINER functions;
-- this trigger function deliberately avoids adding another one. `set
-- search_path = public` is deliberate too — the audit flagged 8
-- mutable-search_path functions.

drop trigger if exists candidates_set_created_by on public.candidates;
create trigger candidates_set_created_by
  before insert on public.candidates
  for each row execute function public.set_created_by();

drop trigger if exists companies_set_created_by on public.companies;
create trigger companies_set_created_by
  before insert on public.companies
  for each row execute function public.set_created_by();

drop trigger if exists contacts_set_created_by on public.contacts;
create trigger contacts_set_created_by
  before insert on public.contacts
  for each row execute function public.set_created_by();

drop trigger if exists jobs_set_created_by on public.jobs;
create trigger jobs_set_created_by
  before insert on public.jobs
  for each row execute function public.set_created_by();

drop trigger if exists applications_set_created_by on public.applications;
create trigger applications_set_created_by
  before insert on public.applications
  for each row execute function public.set_created_by();
