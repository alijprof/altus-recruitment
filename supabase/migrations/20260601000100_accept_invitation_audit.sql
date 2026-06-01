-- Launch-readiness M-5 — audit logging for accept_invitation.
--
-- accept_invitation (20260524000100, lock-fixed in 20260524000300) performs
-- four material, privileged state changes with ZERO audit trail: org transfer,
-- role change, invitation accept, and orphan-org deletion. That violates the
-- project's "audit-ready by default" principle. This migration:
--
--   1. Adds public.record_audit_explicit() — a security-definer audit writer
--      taking BOTH org and actor explicitly. record_audit() resolves them from
--      current_organization_id()/auth.uid(), which are not the right source
--      inside a service_role-invoked SECURITY DEFINER RPC. Modelled on
--      record_audit_anonymous (20260519092947) but with an explicit actor.
--      Granted to service_role only.
--
--   2. CREATE OR REPLACEs accept_invitation with the exact body from
--      20260524000300 (signature, return shape, and the orphan-org FOR UPDATE
--      lock all preserved) plus three audit calls: the user org/role change,
--      the invitation accept, and the orphan-org delete. The delete is logged
--      BEFORE it happens and against the INVITING org, because
--      audit_log.organization_id FKs organizations ON DELETE CASCADE — a row
--      written against the about-to-be-deleted old org would be cascaded away.
--
-- Append-only; the prior migrations are not edited.

-- ---------------------------------------------------------------------------
-- 1. record_audit_explicit — explicit-org + explicit-actor audit writer
-- ---------------------------------------------------------------------------
create or replace function public.record_audit_explicit(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_action public.audit_action,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values
    (p_organization_id, p_actor_user_id, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

revoke all on function public.record_audit_explicit(
  uuid, uuid, public.audit_action, text, uuid, jsonb
) from public, authenticated, anon;

grant execute on function public.record_audit_explicit(
  uuid, uuid, public.audit_action, text, uuid, jsonb
) to service_role;

comment on function public.record_audit_explicit(
  uuid, uuid, public.audit_action, text, uuid, jsonb
) is
  'Audit writer taking explicit org + actor, for use inside SECURITY DEFINER '
  'RPCs (e.g. accept_invitation) where current_organization_id()/auth.uid() '
  'are not the right source. service_role only.';

-- ---------------------------------------------------------------------------
-- 2. accept_invitation — body from 20260524000300 + audit calls (M-5)
-- ---------------------------------------------------------------------------
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

    if v_other_users = 0 then
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
