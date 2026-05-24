-- Quick task 260524-iav (B1): patch a TOCTOU in the orphan-org cleanup branch
-- of public.accept_invitation.
--
-- BACKGROUND:
-- The original migration (20260524000100_org_invitations.sql) shipped the
-- accept_invitation RPC with a SELECT count(*) FROM users WHERE
-- organization_id = v_old_org immediately followed by DELETE FROM
-- organizations WHERE id = v_old_org. There is no row lock on the org row
-- between those statements. A concurrent INSERT into public.users (or any
-- ON DELETE CASCADE child) that points at v_old_org can slip in BETWEEN the
-- count and the DELETE — the count returns 0, the DELETE fires, and the
-- concurrently-inserted row is cascaded away. The most realistic vector is
-- the handle_new_user trigger creating an auth.users-derived row pointing at
-- the about-to-be-deleted org, but any service-role write hits the same race.
--
-- Net effect on production data: silent loss of an organisation row and
-- every ON DELETE CASCADE child (users, candidates, jobs, applications,
-- audit_log, ai_usage, org_invitations, …). This is the worst class of bug
-- in the codebase per CLAUDE.md "What to never do".
--
-- FIX:
-- A single `PERFORM 1 FROM public.organizations WHERE id = v_old_org FOR
-- UPDATE` is inserted directly before the user-count SELECT. The lock is
-- acquired inside the same transaction as the count + delete, so any
-- concurrent INSERT into the orphan org's child tables either blocks until
-- accept_invitation commits (and the org has been deleted, so the INSERT
-- fails with a FK violation rather than slipping through), or, if the
-- concurrent writer holds the lock first, accept_invitation waits and reads
-- the post-insert user count (>0) and correctly skips the DELETE.
--
-- The original migration cannot be edited (append-only migrations rule in
-- CLAUDE.md). This file CREATE OR REPLACEs the function body with the lock
-- inserted at the right point. All other logic — invitation row FOR UPDATE,
-- accepted_at + expires_at check, email-match check, user reassignment,
-- accepted_at update, return shape { ok boolean, reason text } — is
-- preserved verbatim. The function SIGNATURE is unchanged (same three
-- params, same return shape) so the existing caller in
-- src/app/auth/callback/route.ts keeps working without code changes.
--
-- EXECUTE grants are intentionally NOT re-applied here. CREATE OR REPLACE
-- preserves grants on the existing signature; re-running revoke/grant would
-- be harmless noise. See REVIEW.md (260524-bpy quick task) B1 for the
-- review-time discussion.

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

  select organization_id into v_old_org
  from public.users
  where id = p_user_id
  for update;

  update public.users
  set organization_id = v_invite.organization_id,
      role = 'recruiter'
  where id = p_user_id;

  update public.org_invitations
  set accepted_at = now()
  where id = v_invite.id;

  if v_old_org is not null and v_old_org <> v_invite.organization_id then
    -- NEW: lock the orphan org row BEFORE counting remaining users so a
    -- concurrent handle_new_user INSERT cannot slip in between the count and
    -- the delete. The plan called for this lock; the original implementation
    -- lost it. See REVIEW.md B1.
    perform 1
    from public.organizations
    where id = v_old_org
    for update;

    select count(*) into v_other_users
    from public.users
    where organization_id = v_old_org;

    if v_other_users = 0 then
      delete from public.organizations where id = v_old_org;
    end if;
  end if;

  return query select true, 'ok'::text;
end;
$$;
