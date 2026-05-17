-- Plan 3 / Task 3.1 — bump_last_contacted_at trigger.
--
-- Whenever a "human contact" activity (note, call, email, meeting) is inserted
-- against a company or a contact, propagate `occurred_at` to the relevant
-- `last_contacted_at` columns:
--   * entity_type = 'company' → update companies.last_contacted_at
--   * entity_type = 'contact' → update both the contact row AND its parent
--                                company (so dormant clients respect contact-
--                                level engagement too — UI-SPEC §5 dormant flag
--                                + CLIENT-05).
--
-- This trigger explicitly does NOT fire on entity_type = 'candidate' (Plan 1
-- updates candidates.last_contacted_at manually inside its activity helper —
-- both code paths can coexist without conflict) and not on entity_type = 'job'
-- or 'application' (no last_contacted_at column there).
--
-- The WHEN clause excludes `stage_change` and `system` kinds so automated
-- pipeline movement doesn't masquerade as human outreach.

create or replace function public.bump_last_contacted_at()
returns trigger
language plpgsql
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

create trigger activities_bump_last_contacted
  after insert on public.activities
  for each row
  execute function public.bump_last_contacted_at();
