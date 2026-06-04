-- delete_candidate: tenant-safe hard delete that BLOCKS on applications and
-- cleans up polymorphic orphans (activities, audit_log) that have no FK and
-- therefore would not cascade. candidate_cvs + ai_summaries cascade via their
-- ON DELETE CASCADE FKs. Storage CV objects are NOT removed here (no DB->Storage
-- cascade) — the calling server action best-effort removes them after success.
--
-- SECURITY DEFINER is justified: we re-assert organization_id =
-- current_organization_id() inside the function (an explicit tenant check, not
-- an RLS bypass — same pattern as record_audit), and we must atomically delete
-- by polymorphic key + write the deletion audit row in one transaction.
--
-- NOTE: floats + shortlist entries are stored in `applications` (application_type
-- enum), so "block on applications" also protects floated candidates — exactly
-- the intent: never silently destroy pipeline/float/placement history.

create or replace function public.delete_candidate(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_cand_org uuid;
  v_full_name text;
  v_has_cv boolean;
begin
  if v_org_id is null then
    raise exception 'delete_candidate called outside an authenticated org context';
  end if;

  -- (a) Load + assert tenancy. Not-found and wrong-org are indistinguishable to
  --     the caller (no cross-tenant disclosure).
  select organization_id, full_name
    into v_cand_org, v_full_name
    from public.candidates
    where id = p_candidate_id;
  if not found or v_cand_org <> v_org_id then
    raise exception 'candidate not found';
  end if;

  -- (b) BLOCK if the candidate has any applications (pipeline / float / shortlist
  --     / placement). Deleting would CASCADE and silently destroy placement +
  --     fee history. Sentinel message the server action maps to a friendly string.
  if exists (
    select 1 from public.applications a
    where a.candidate_id = p_candidate_id
  ) then
    raise exception 'candidate_has_applications'
      using hint = 'Remove this candidate from all jobs and floats before deleting.';
  end if;

  v_has_cv := exists (
    select 1 from public.candidate_cvs c where c.candidate_id = p_candidate_id
  );

  -- (c) Delete polymorphic dependents that have no FK (would orphan, not cascade).
  --     Both carry organization_id; scope to the tenant defensively.
  delete from public.activities
    where entity_type = 'candidate'
      and entity_id = p_candidate_id
      and organization_id = v_org_id;

  delete from public.audit_log
    where entity_type = 'candidate'
      and entity_id = p_candidate_id
      and organization_id = v_org_id;

  -- (d) Delete the candidate. candidate_cvs + ai_summaries cascade via FK;
  --     other candidates' referrer_candidate_id is SET NULL by its FK.
  delete from public.candidates
    where id = p_candidate_id
      and organization_id = v_org_id;
  if not found then
    -- Lost a race (deleted between the select and here). Treat as not found.
    raise exception 'candidate not found';
  end if;

  -- (e) Write the deletion audit row (the one audit record we keep for this id).
  perform public.record_audit(
    'delete'::public.audit_action,
    'candidate',
    p_candidate_id,
    jsonb_build_object('full_name', v_full_name, 'had_cv', v_has_cv)
  );
end;
$$;

revoke all on function public.delete_candidate(uuid) from public;
grant execute on function public.delete_candidate(uuid) to authenticated;

comment on function public.delete_candidate(uuid) is
  'Tenant-safe hard delete of a candidate. Blocks (raises candidate_has_applications) '
  'when the candidate has any applications so pipeline/float/placement history is never '
  'silently cascaded away. Cleans up polymorphic activities + audit_log orphans, '
  'cascades candidate_cvs + ai_summaries via FK, and writes a delete audit row. '
  'Storage CV objects are removed best-effort by the calling server action. '
  'Call via supabase.rpc(''delete_candidate'', { p_candidate_id }).';
