-- Plan 3 / Task 3.1 — client_activity_timeline view.
--
-- Combined chronological feed of every activity touching a client: activities
-- recorded against the company itself, against any contact under the company,
-- or against any job under the company. RLS naturally applies because the
-- view is defined `with (security_invoker = true)` (Postgres 15+; Supabase
-- schema is Postgres 17), so the underlying activities/contacts/jobs/companies
-- policies are evaluated as the calling user.
--
-- CRITICAL: `security_invoker = true` is non-negotiable. Without it Postgres
-- evaluates policies as the view owner (`postgres`), which bypasses every
-- multi-tenant RLS check on the underlying tables. RESEARCH §20 pitfall.

create or replace view public.client_activity_timeline
with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.kind,
  a.body,
  a.actor_user_id,
  a.occurred_at,
  a.metadata,
  a.entity_type,
  a.entity_id,
  c.id as client_id,
  case a.entity_type
    when 'company' then c.name
    when 'contact' then (select full_name from public.contacts where id = a.entity_id)
    when 'job'     then (select title from public.jobs where id = a.entity_id)
    else null
  end as entity_label
from public.activities a
join public.companies c on (
  (a.entity_type = 'company' and a.entity_id = c.id) or
  (a.entity_type = 'contact' and a.entity_id in (select id from public.contacts where company_id = c.id)) or
  (a.entity_type = 'job'     and a.entity_id in (select id from public.jobs where company_id = c.id))
);

-- Grant read so PostgREST can expose the view; RLS on the underlying tables
-- still gates per-row visibility via security_invoker.
grant select on public.client_activity_timeline to authenticated;
