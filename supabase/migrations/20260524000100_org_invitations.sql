-- Quick task 260524-bpy: org member invitation flow.
--
-- Owns the full lifecycle of magic-link invitations to join an organisation:
-- pending row creation, list/revoke/resend (RLS-scoped to the inviter's org),
-- and a single SECURITY DEFINER RPC that atomically attaches the invitee to
-- the inviter's organisation after PKCE exchange.
--
-- This REPLACES the call path that goes via Supabase Auth admin's
-- `inviteUserByEmail`. The legacy inviteTeammateAction stays in the codebase
-- for now to avoid breaking other callers, but the new Team page calls the
-- new server actions in src/app/(app)/settings/team/actions.ts which write
-- here.
--
-- TRIGGER ORDERING:
-- Postgres fires BEFORE triggers in alphabetical order by trigger NAME. The
-- two BEFORE INSERT triggers on this table are:
--   - org_invitations_set_invited_by  (fires first — `i` < `o`)
--   - org_invitations_set_org         (fires second)
-- They touch DIFFERENT columns (invited_by vs organization_id), so the
-- ordering does not affect correctness — either order produces the same row.
-- The naming convention is preserved for consistency with `_set_org` across
-- the schema (see spec_drafts, feedback).
--
-- WHY NO UPDATE POLICY:
-- The accept path is the public.accept_invitation() RPC (SECURITY DEFINER,
-- service_role-only EXECUTE). That RPC is the ONLY canonical mutation path.
-- The /auth/callback handler is a thin caller that invokes the RPC and does
-- no orchestration of its own. Resend uses service-role for the expires_at
-- refresh (no UPDATE policy needed at the RLS layer). This keeps the policy
-- surface minimal and the accept path auditable.
--
-- PARTIAL UNIQUE INDEX INTENT:
-- (organization_id, email) WHERE accepted_at IS NULL prevents two pending
-- invites to the same address in the same org. A second invite AFTER the
-- first is accepted IS allowed (rare but possible: a user leaves the org and
-- is re-invited later).
--
-- Manual smoke tests (run as a real authenticated session):
--
--   -- 1) Same-org insert succeeds; organization_id + invited_by auto-fill:
--   set role authenticated;
--   insert into public.org_invitations (email) values ('alice@example.com');
--   -- expect: row exists with organization_id=current org, invited_by=auth.uid()
--
--   -- 2) Mixed-case email rejected by CHECK constraint:
--   insert into public.org_invitations (email) values ('Alice@Example.com');
--   -- expect: ERROR 'violates check constraint "org_invitations_email_lower_check"'
--
--   -- 3) Duplicate pending invite rejected by partial unique index:
--   insert into public.org_invitations (email) values ('alice@example.com');
--   -- expect: ERROR 'duplicate key value violates unique constraint "org_invitations_org_email_pending_uq"'
--
--   -- 4) Accepted-then-new-invite allowed (second insert after accept):
--   update public.org_invitations set accepted_at = now() where email = 'alice@example.com';
--   insert into public.org_invitations (email) values ('alice@example.com');
--   -- expect: success
--
--   -- 5) Cross-tenant INSERT WITH CHECK rejection:
--   insert into public.org_invitations (organization_id, email)
--     values ('<other-org>', 'mallory@example.com');
--   -- expect: ERROR 'new row violates row-level security policy for table "org_invitations"'
--
--   -- 6) RPC with expired token returns ok=false reason='invalid', no mutation:
--   update public.org_invitations set expires_at = now() - interval '1 day' where email = 'alice@example.com';
--   select * from public.accept_invitation('<token>'::uuid, '<user-id>'::uuid, 'alice@example.com');
--   -- expect: { ok: false, reason: 'invalid' }; users.organization_id unchanged
--
--   -- 7) RPC with email mismatch returns ok=false reason='email_mismatch', no mutation:
--   select * from public.accept_invitation('<token>'::uuid, '<user-id>'::uuid, 'someone-else@example.com');
--   -- expect: { ok: false, reason: 'email_mismatch' }; users.organization_id unchanged

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null constraint org_invitations_email_lower_check check (lower(email) = email),
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Partial unique: at most one pending invite per (org, email).
create unique index org_invitations_org_email_pending_uq
  on public.org_invitations (organization_id, email)
  where accepted_at is null;

-- Hot path for the pending-invites list on /settings/team.
create index org_invitations_org_pending_idx
  on public.org_invitations (organization_id, accepted_at);

alter table public.org_invitations enable row level security;

create policy "tenant select" on public.org_invitations
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "tenant insert" on public.org_invitations
  for insert to authenticated
  with check (organization_id = public.current_organization_id());

create policy "tenant delete" on public.org_invitations
  for delete to authenticated
  using (organization_id = public.current_organization_id());

-- Intentionally NO UPDATE policy. The canonical accept path is
-- public.accept_invitation() (SECURITY DEFINER, service_role only).
-- resendInviteAction also goes through service-role to refresh expires_at.

-- Auto-fill organization_id from the auth context. Mirrors spec_drafts_set_org.
create trigger org_invitations_set_org
  before insert on public.org_invitations
  for each row execute function public.set_organization_id();

-- Auto-fill invited_by from auth.uid() when caller is authenticated. Mirrors
-- the auto-fill pattern of set_organization_id but for the invited_by FK.
create or replace function public.set_invited_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.invited_by is null then
    new.invited_by := auth.uid();
  end if;
  if new.invited_by is null then
    raise exception 'invited_by is required and could not be resolved from auth context';
  end if;
  return new;
end;
$$;

create trigger org_invitations_set_invited_by
  before insert on public.org_invitations
  for each row execute function public.set_invited_by();

-- The canonical accept path. SECURITY DEFINER + service_role-only EXECUTE
-- so this is unreachable from a client JWT — the only caller is
-- /auth/callback (server-side, after exchangeCodeForSession + null-email
-- guard). Returns a single result row { ok boolean, reason text }.
--
-- All work happens inside this function body, which is one transactional
-- boundary: SELECT...FOR UPDATE on the invitation row prevents TOCTOU
-- between the validity check and the mutation. If any step fails the
-- transaction rolls back, leaving every row untouched.
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
  -- Lock the invitation row for the duration of this transaction so
  -- concurrent accept attempts serialise.
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

  -- Capture the user's current org so we can clean up the orphan if no
  -- other users reference it after we move this user away.
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

-- Restrict EXECUTE to service_role only. The route handler at
-- /auth/callback uses the service-role client to call this RPC.
revoke all on function public.accept_invitation(uuid, uuid, text) from public;
revoke all on function public.accept_invitation(uuid, uuid, text) from authenticated;
revoke all on function public.accept_invitation(uuid, uuid, text) from anon;
grant execute on function public.accept_invitation(uuid, uuid, text) to service_role;
