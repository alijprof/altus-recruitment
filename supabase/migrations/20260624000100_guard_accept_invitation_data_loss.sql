-- Handover security blocker 2 — stop accept_invitation() from silently
-- destroying a user's workspace.
--
-- THE DATA-LOSS BUG
-- accept_invitation() (latest body in 20260601000100) moves the accepting user
-- into the inviting org and then, if the user's OLD org has zero remaining
-- members, DELETES that old org. Every domain table FKs organizations ON
-- DELETE CASCADE, so the delete wipes all of the old org's candidates, jobs,
-- clients, CVs and activity. The biting scenario for a 2-3 person agency: one
-- person sets up a solo trial, fills it with candidates/jobs, is LATER invited
-- (same email) into a shared org, and accepting silently and irreversibly
-- erases their solo workspace — no confirmation, no recovery.
--
-- THE FIX
-- The orphan-org cleanup is still useful for the normal invite case (a
-- throwaway org created moments earlier by handle_new_user, holding no data),
-- so we keep it — but ONLY when the old org genuinely has no recruiter data.
-- We add a data guard: the old org is deleted only when it has zero other
-- users AND no candidates, companies, or jobs. Any org that contains real work
-- is left intact (it simply becomes a memberless org; harmless, and never
-- destroys data). Everything else — signature, return shape, the FOR UPDATE
-- TOCTOU locks, and all M-5 audit calls — is preserved verbatim from
-- 20260601000100.
--
-- Append-only; supersedes the function body from 20260601000100.

create or replace function public.accept_invitation(
  p_token uuid,
  p_user_id uuid,
  p_user_email text
)
returns table(ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.org_invitations%rowtype;
  v_old_org uuid;
  v_old_role text;
  v_other_users int;
  v_old_org_has_data boolean;
begin
  select * into v_invite
  from public.org_invitations
  where token = p_token
  for update;

  if not found
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now() then
    return query select false, 'invalid'::text;
    return;
  end if;

  if lower(v_invite.email) <> lower(p_user_email) then
    return query select false, 'email_mismatch'::text;
    return;
  end if;

  select organization_id, role::text into v_old_org, v_old_role
  from public.users
  where id = p_user_id
  for update;

  update public.users
  set organization_id = v_invite.organization_id,
      role = 'recruiter'
  where id = p_user_id;

  -- Audit the org transfer + role change together (M-5). Actor = the user
  -- accepting the invite; logged against the inviting org.
  perform public.record_audit_explicit(
    v_invite.organization_id,
    p_user_id,
    'update'::public.audit_action,
    'users',
    p_user_id,
    jsonb_build_object(
      'via_invitation', true,
      'invitation_id', v_invite.id,
      'old_organization_id', v_old_org,
      'new_organization_id', v_invite.organization_id,
      'old_role', v_old_role,
      'new_role', 'recruiter'
    )
  );

  update public.org_invitations
  set accepted_at = now()
  where id = v_invite.id;

  perform public.record_audit_explicit(
    v_invite.organization_id,
    p_user_id,
    'update'::public.audit_action,
    'org_invitations',
    v_invite.id,
    jsonb_build_object('accepted_by_user_id', p_user_id)
  );

  if v_old_org is not null and v_old_org <> v_invite.organization_id then
    -- Lock the orphan org row BEFORE counting remaining users (TOCTOU fix
    -- from 20260524000300 — preserved verbatim).
    perform 1
    from public.organizations
    where id = v_old_org
    for update;

    select count(*) into v_other_users
    from public.users
    where organization_id = v_old_org;

    -- DATA-LOSS GUARD: never delete an org that holds real recruiter data.
    -- Presence of any candidate, company, or job means the user did real work
    -- in the old org; keep it intact rather than cascade-deleting it.
    select
      exists (select 1 from public.candidates where organization_id = v_old_org)
      or exists (select 1 from public.companies where organization_id = v_old_org)
      or exists (select 1 from public.jobs where organization_id = v_old_org)
    into v_old_org_has_data;

    if v_other_users = 0 and not v_old_org_has_data then
      -- Audit the orphan-org deletion BEFORE the delete, against the inviting
      -- org (audit_log FKs organizations ON DELETE CASCADE — logging against
      -- the old org would be cascaded away with it).
      perform public.record_audit_explicit(
        v_invite.organization_id,
        p_user_id,
        'delete'::public.audit_action,
        'organizations',
        v_old_org,
        jsonb_build_object(
          'reason', 'orphan_cleanup_after_invitation',
          'transferred_user_id', p_user_id,
          'into_organization_id', v_invite.organization_id
        )
      );

      delete from public.organizations where id = v_old_org;
    end if;
  end if;

  return query select true, 'ok'::text;
end;
$$;
