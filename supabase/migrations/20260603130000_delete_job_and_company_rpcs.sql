-- Tenant-safe hard deletes for jobs and companies, mirroring delete_candidate
-- (20260603120100). Both re-assert organization_id = current_organization_id()
-- inside the function (explicit tenant check, NOT an RLS bypass — same pattern as
-- record_audit), BLOCK when deleting would destroy meaningful history, clean up
-- polymorphic activities + audit_log orphans (no FK, would not cascade), let safe
-- FKs cascade, and write a delete audit row in the same transaction.

-- ===========================================================================
-- delete_job
-- FKs to jobs (live): applications (CASCADE), job_ads (CASCADE),
-- ai_summaries (CASCADE), spec_drafts.created_job_id (SET NULL).
-- BLOCK on applications: there is no placements table — placement/revenue
-- history lives on applications (stage='placed' + fee/date/type), so cascading
-- applications away would silently destroy revenue history. job_ads + ai_summaries
-- are junk-safe and cascade via FK. spec_drafts is SET NULL by its FK.
-- ===========================================================================
create or replace function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_job_org uuid;
  v_title text;
  v_company_id uuid;
begin
  if v_org_id is null then
    raise exception 'delete_job called outside an authenticated org context';
  end if;

  select organization_id, title, company_id
    into v_job_org, v_title, v_company_id
    from public.jobs
    where id = p_job_id;
  if not found or v_job_org <> v_org_id then
    raise exception 'job not found';
  end if;

  if exists (
    select 1 from public.applications a where a.job_id = p_job_id
  ) then
    raise exception 'job_has_applications'
      using hint = 'Remove all candidates from this job''s pipeline before deleting.';
  end if;

  delete from public.activities
    where entity_type = 'job'
      and entity_id = p_job_id
      and organization_id = v_org_id;

  delete from public.audit_log
    where entity_type = 'job'
      and entity_id = p_job_id
      and organization_id = v_org_id;

  delete from public.jobs
    where id = p_job_id
      and organization_id = v_org_id;
  if not found then
    raise exception 'job not found';
  end if;

  perform public.record_audit(
    'delete'::public.audit_action,
    'job',
    p_job_id,
    jsonb_build_object('title', v_title, 'company_id', v_company_id)
  );
end;
$$;

revoke all on function public.delete_job(uuid) from public;
grant execute on function public.delete_job(uuid) to authenticated;

comment on function public.delete_job(uuid) is
  'Tenant-safe hard delete of a job. Blocks (raises job_has_applications) when the '
  'job has any applications so pipeline/placement/fee history is never silently '
  'cascaded away. Cleans up polymorphic activities + audit_log orphans, cascades '
  'job_ads + ai_summaries via FK, SET-NULLs spec_drafts.created_job_id, and writes '
  'a delete audit row. Call via supabase.rpc(''delete_job'', { p_job_id }).';

-- ===========================================================================
-- delete_company (client)
-- FKs to companies (live): contacts (CASCADE), jobs (RESTRICT),
-- spec_drafts.company_id (SET NULL).
-- BLOCK on jobs: the jobs->companies FK is RESTRICT (a raw delete would error
-- with an ugly constraint message), and a client with jobs has applications /
-- placement history hanging off those jobs. Blocking on any job is the safe
-- block-on-history option and transitively protects all downstream revenue
-- history. contacts cascade via FK; spec_drafts.company_id is SET NULL.
-- ai_summaries does NOT reference companies — no AI cascade at company level.
-- ===========================================================================
create or replace function public.delete_company(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_co_org uuid;
  v_name text;
  v_contact_count int;
begin
  if v_org_id is null then
    raise exception 'delete_company called outside an authenticated org context';
  end if;

  select organization_id, name
    into v_co_org, v_name
    from public.companies
    where id = p_company_id;
  if not found or v_co_org <> v_org_id then
    raise exception 'company not found';
  end if;

  if exists (
    select 1 from public.jobs j where j.company_id = p_company_id
  ) then
    raise exception 'company_has_jobs'
      using hint = 'Delete or reassign this client''s jobs before deleting the client.';
  end if;

  v_contact_count := (
    select count(*)::int from public.contacts c where c.company_id = p_company_id
  );

  -- Clean polymorphic dependents for the company AND its contacts (contacts
  -- cascade by FK, but their activities/audit_log are polymorphic with no FK and
  -- would orphan). Done BEFORE the company delete so the contact ids still exist.
  delete from public.activities
    where organization_id = v_org_id
      and (
        (entity_type = 'company' and entity_id = p_company_id)
        or (entity_type = 'contact' and entity_id in (
          select c.id from public.contacts c where c.company_id = p_company_id
        ))
      );

  delete from public.audit_log
    where organization_id = v_org_id
      and (
        (entity_type = 'company' and entity_id = p_company_id)
        or (entity_type = 'contact' and entity_id in (
          select c.id from public.contacts c where c.company_id = p_company_id
        ))
      );

  delete from public.companies
    where id = p_company_id
      and organization_id = v_org_id;
  if not found then
    raise exception 'company not found';
  end if;

  perform public.record_audit(
    'delete'::public.audit_action,
    'company',
    p_company_id,
    jsonb_build_object('name', v_name, 'contacts_deleted', v_contact_count)
  );
end;
$$;

revoke all on function public.delete_company(uuid) from public;
grant execute on function public.delete_company(uuid) to authenticated;

comment on function public.delete_company(uuid) is
  'Tenant-safe hard delete of a client (company). Blocks (raises company_has_jobs) '
  'when the client has any jobs so applications/placement history is never silently '
  'destroyed. Cascades contacts via FK, cleans up polymorphic activities + audit_log '
  'orphans for the company and its contacts, SET-NULLs spec_drafts.company_id, and '
  'writes a delete audit row. Call via supabase.rpc(''delete_company'', { p_company_id }).';
