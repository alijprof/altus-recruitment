-- Cross-tenant FK trigger guards.
--
-- Postgres CHECK constraints cannot reference other tables; composite FKs would
-- require editing committed migrations (forbidden). Triggers close the integrity
-- gap without any schema change. They fire BEFORE INSERT or UPDATE and raise
-- when a child row's organization_id does not match its referenced parent's.
--
-- Triggers fire AFTER set_organization_id (alphabetical ordering inside the
-- same timing): set_org < same_org_check, so the column is populated before
-- the guard runs.

-- Helper: validate that a child row's organization_id matches its referenced
-- parent. Accepts (parent_table, parent_id, child_org_id) and raises on any
-- mismatch (or when the parent row is missing).
create or replace function public.assert_same_org(
  p_parent_table regclass,
  p_parent_id uuid,
  p_child_org_id uuid
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parent_org_id uuid;
begin
  execute format('select organization_id from %s where id = $1', p_parent_table)
    into v_parent_org_id
    using p_parent_id;
  if v_parent_org_id is null then
    raise exception 'cross-tenant FK guard: parent row % not found in %', p_parent_id, p_parent_table;
  end if;
  if v_parent_org_id is distinct from p_child_org_id then
    raise exception 'cross-tenant FK guard: % belongs to org %, expected %',
      p_parent_table, v_parent_org_id, p_child_org_id;
  end if;
end;
$$;

-- contacts.company_id -> companies
create or replace function public.contacts_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.companies'::regclass, new.company_id, new.organization_id);
  return new;
end;
$$;
create trigger contacts_same_org_check
  before insert or update of company_id, organization_id on public.contacts
  for each row execute function public.contacts_same_org_guard();

-- jobs.company_id -> companies
create or replace function public.jobs_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.companies'::regclass, new.company_id, new.organization_id);
  return new;
end;
$$;
create trigger jobs_same_org_check
  before insert or update of company_id, organization_id on public.jobs
  for each row execute function public.jobs_same_org_guard();

-- applications.candidate_id -> candidates AND applications.job_id -> jobs
create or replace function public.applications_same_org_guard()
returns trigger language plpgsql as $$
begin
  perform public.assert_same_org('public.candidates'::regclass, new.candidate_id, new.organization_id);
  perform public.assert_same_org('public.jobs'::regclass, new.job_id, new.organization_id);
  return new;
end;
$$;
create trigger applications_same_org_check
  before insert or update of candidate_id, job_id, organization_id on public.applications
  for each row execute function public.applications_same_org_guard();
