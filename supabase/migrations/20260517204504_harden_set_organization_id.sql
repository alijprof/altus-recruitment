-- Per VERIFICATION R3: re-declare public.set_organization_id() with an
-- explicit `set search_path = public` clause to close the CONCERNS.md item
-- "set_organization_id() lacks search_path guard".
--
-- The original definition (in 20260513152244_phase1_domain_schema.sql:86-99)
-- was missing the search_path lock. Without it, a future schema with a
-- shadowing object could intercept the call. Body is unchanged.

create or replace function public.set_organization_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is null then
    new.organization_id := public.current_organization_id();
  end if;
  if new.organization_id is null then
    raise exception 'organization_id is required and could not be resolved from auth context';
  end if;
  return new;
end;
$$;
