-- Security hardening from the 2026-06-05 pre-launch audit. Two append-only,
-- app-code-neutral DB changes:
--   AUTH-01  guard public.users.role against in-tenant privilege escalation
--   LIVE-01  lock public.record_ai_usage to the service role (revoke anon/authenticated)

-- ---------------------------------------------------------------------------
-- AUTH-01: a member must not be able to make themselves owner.
--
-- WHY: the "self update" RLS policy on public.users (20260513151021) lets a user
-- UPDATE their own row, with a WITH CHECK that pins id + organization_id but NOT
-- role. So a member could issue a raw
--   supabase.from('users').update({ role: 'owner' }).eq('id', <self>)
-- and silently gain owner powers (billing, branding, team control). Cross-tenant
-- is already blocked; this closes the in-tenant escalation.
--
-- HOW: a BEFORE UPDATE trigger rejects any change to `role` unless the executing
-- role is the service role (or a privileged migration/admin role). The app never
-- updates role via the authenticated client; the only legitimate role write is
-- accept_invitation(), a SECURITY DEFINER RPC whose current_user is the definer
-- (postgres) and is therefore allowed. Mirrors guard_org_stripe_customer_id
-- (20260604140000). SECURITY INVOKER (default) so current_user reflects the real
-- caller.
create or replace function public.guard_users_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception
      'user role is managed by the platform and cannot be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_role on public.users;

create trigger users_guard_role
  before update on public.users
  for each row
  execute function public.guard_users_role();

-- ---------------------------------------------------------------------------
-- LIVE-01: record_ai_usage must be callable ONLY by the service role.
--
-- WHY: record_ai_usage(p_organization_id, ...) is SECURITY DEFINER and inserts a
-- usage/cost row using the caller-supplied organization_id with no auth check (by
-- design — meant to be invoked only by the service-role client from the AI
-- wrappers in src/lib/ai/*.ts). The original migration ran
--   revoke all on function ... from public; grant execute ... to service_role;
-- but Supabase auto-grants EXECUTE to anon + authenticated, and
-- `revoke ... from public` does NOT remove those explicit role grants. The live
-- ACL therefore left anon able to POST /rest/v1/rpc/record_ai_usage and inject
-- arbitrary AI-usage/cost rows into ANY tenant (cost-data poisoning + push a
-- victim org over its AI caps). Verified: the AI wrappers always use
-- createServiceClient(), so no anon/authenticated path is legitimate.
--
-- HOW: explicitly revoke EXECUTE from anon + authenticated, leaving service_role.
revoke execute on function public.record_ai_usage(
  uuid, text, text, integer, integer, integer, integer, uuid
) from anon, authenticated;
