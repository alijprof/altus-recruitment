-- Phase 5 review fix (M7): protect organizations.stripe_customer_id from
-- direct mutation by the authenticated role.
--
-- WHY: stripe_customer_id is documented as service-role/webhook-owned (written
-- only via the service-role client in the checkout route). But the pre-existing
-- "owners update own organization" RLS policy (20260513151021) permits an owner
-- to UPDATE *any* column on their org row — and a column-level REVOKE does NOT
-- restrict a column while the role still holds table-level UPDATE. So without
-- this guard an org owner could issue a raw `supabase.from('organizations')
-- .update({ stripe_customer_id: ... })` and forge/clear their Stripe linkage
-- (self-DoS of billing, webhook-correlation desync).
--
-- HOW: a BEFORE UPDATE trigger rejects any change to stripe_customer_id unless
-- the executing role is the service role (or a privileged migration/admin role).
-- The app never updates stripe_customer_id via the authenticated client
-- (updateOrganization deliberately omits it), so legitimate flows are unaffected;
-- the Stripe webhook + checkout write it via the service-role client, which is
-- allowed. SECURITY INVOKER (default) so current_user reflects the real caller.

create or replace function public.guard_org_stripe_customer_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stripe_customer_id is distinct from old.stripe_customer_id
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception
      'stripe_customer_id is managed by the billing service and cannot be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_guard_stripe_customer_id on public.organizations;

create trigger organizations_guard_stripe_customer_id
  before update on public.organizations
  for each row
  execute function public.guard_org_stripe_customer_id();
