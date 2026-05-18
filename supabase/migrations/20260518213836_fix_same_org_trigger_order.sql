-- Fix cross-tenant FK guard trigger ordering.
--
-- Postgres fires triggers sharing the same timing (BEFORE INSERT here) in
-- alphabetical order by trigger NAME. The original guards were named
-- `<table>_same_org_check` which sorts BEFORE the schema's `<table>_set_org`
-- triggers (because "same" < "set"). Result: the guard runs while
-- NEW.organization_id is still NULL, fetches the parent's real org, and
-- raises "expected NULL, got <org>". Every insert into contacts / jobs /
-- applications / candidate_cvs that relied on the trigger to fill
-- organization_id (i.e., every app-level insert) failed in production.
--
-- The plan-checker and unit/build/typecheck couldn't see this — only
-- Postgres trigger semantics surface it. Plan 0's smoke test passed
-- organization_id explicitly, which masked the bug.
--
-- Fix: drop the wrongly-named triggers and recreate them with names that
-- alphabetically sort AFTER `<table>_set_org`. Use `verify_same_org_check`
-- (v > s). Trigger FUNCTIONS are unchanged — only trigger NAMES move.
--
-- Manual smoke test after applying:
--   set role authenticated;
--   -- as a user in org A who owns company X
--   insert into jobs (company_id, title) values ('<X-id>', 'Test');
--   -- expect: success (org auto-filled, FK guard sees matching orgs)
--
--   -- attempt cross-tenant insert (negative test):
--   insert into jobs (organization_id, company_id, title)
--     values ('<org-A>', '<company-in-org-B>', 'Test');
--   -- expect: ERROR 'cross-tenant FK guard: public.companies belongs to
--   --   org <B>, expected <A>'

-- contacts.company_id
drop trigger if exists contacts_same_org_check on public.contacts;
create trigger contacts_verify_same_org_check
  before insert or update of company_id, organization_id on public.contacts
  for each row execute function public.contacts_same_org_guard();

-- jobs.company_id
drop trigger if exists jobs_same_org_check on public.jobs;
create trigger jobs_verify_same_org_check
  before insert or update of company_id, organization_id on public.jobs
  for each row execute function public.jobs_same_org_guard();

-- applications.candidate_id + applications.job_id
drop trigger if exists applications_same_org_check on public.applications;
create trigger applications_verify_same_org_check
  before insert or update of candidate_id, job_id, organization_id on public.applications
  for each row execute function public.applications_same_org_guard();

-- candidate_cvs.candidate_id (added by 20260518211005_*)
drop trigger if exists candidate_cvs_same_org_check on public.candidate_cvs;
create trigger candidate_cvs_verify_same_org_check
  before insert or update of candidate_id, organization_id on public.candidate_cvs
  for each row execute function public.candidate_cvs_same_org_guard();
