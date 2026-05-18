-- Phase 1 review fix M1 — lock search_path on bump_last_contacted_at().
--
-- R3 added `set search_path = public` to set_organization_id() (migration
-- 20260517204504). Plan 1's bump_candidate_last_contacted_at()
-- (20260517215938) and Plan 0's assert_same_org / *_same_org_guard()
-- helpers all set search_path = public. Plan 3's bump_last_contacted_at()
-- (the company/contact trigger, 20260517215957) is the lone outlier — no
-- search_path lock and no security_definer.
--
-- Without the lock, a future shadowing object in another schema (added
-- inadvertently by a tenant or by a malicious migration the agency-owner
-- mistakenly applies) could intercept calls to the relations referenced
-- inside the function body. This is the same concern R3 closed for
-- set_organization_id.
--
-- The function is intentionally security INVOKER: the UPDATE relies on RLS
-- on companies/contacts to gate per-row writes. Only the search_path is
-- added — body verbatim from the original migration.

create or replace function public.bump_last_contacted_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind in ('call', 'email', 'meeting', 'note') then
    if new.entity_type = 'company' then
      update public.companies
      set last_contacted_at = new.occurred_at
      where id = new.entity_id;
    elsif new.entity_type = 'contact' then
      update public.contacts
      set last_contacted_at = new.occurred_at
      where id = new.entity_id;
      update public.companies
      set last_contacted_at = new.occurred_at
      where id = (select company_id from public.contacts where id = new.entity_id);
    end if;
  end if;
  return new;
end;
$$;
