-- Phase 3 / Plan 03-05 / Task E.1 — REPEAT-01.
--
-- `dormant_clients(p_dormant_days, p_long_dormant_days)` returns the rows that
-- power the dashboard "Dormant clients" widget + the /clients page badge.
--
-- D3-19: dormant threshold defaults to 60 days; rows older than
--        `p_long_dormant_days` (default 90) carry an `is_long_dormant` flag so
--        the UI can render a stronger badge.
--
-- D3-29 / REPEAT-01: org-wide visibility — anyone in the org sees all dormant
-- clients (anchor agency is 2-3 people; transparency wins over owner-only
-- filtering). Tenant isolation comes from RLS on the underlying tables:
-- `security invoker` means the function runs as the calling user, so the
-- existing companies / applications / jobs RLS policies apply naturally and
-- no cross-org row can ever leak.
--
-- Filter rules:
--   * `companies.last_contacted_at < now() - p_dormant_days days` — we have
--     gone quiet on this account for at least p_dormant_days.
--   * `exists (placement for this company)` — only show previously-engaged
--     accounts. We don't widget every cold lead with a stale contact
--     timestamp (RESEARCH §M6).
--
-- Output columns:
--   client_id, client_name, last_contacted_at, days_since,
--   is_long_dormant, last_placement_summary
--
-- `last_placement_summary` is the most recent placed application's role
-- title + the month/year of `stage_changed_at`, rendered as "Senior Python
-- Engineer placed Jan 2026". Sonnet uses this string as concrete context for
-- the outreach draft so the email can reference the previous engagement.
--
-- Manual psql smoke tests (run after `pnpm db:reset --local`):
--   1. set role authenticated;
--      set request.jwt.claim.sub = '<user in org A>';
--      select * from dormant_clients();  -- only org A rows
--   2. set request.jwt.claim.sub = '<user in org B>';
--      select * from dormant_clients();  -- only org B rows; no cross-org leak
--   3. select * from dormant_clients(30, 60);
--      -- threshold params honoured; rows with >60d dormancy carry is_long_dormant=true

create or replace function public.dormant_clients(
  p_dormant_days int default 60,
  p_long_dormant_days int default 90
) returns table (
  client_id uuid,
  client_name text,
  last_contacted_at timestamptz,
  days_since int,
  is_long_dormant boolean,
  last_placement_summary text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as client_id,
    c.name as client_name,
    c.last_contacted_at,
    extract(day from (now() - c.last_contacted_at))::int as days_since,
    (now() - c.last_contacted_at) > make_interval(days => p_long_dormant_days)
      as is_long_dormant,
    (
      select format('%s placed %s', j.title, to_char(a.stage_changed_at, 'Mon YYYY'))
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where j.company_id = c.id
        and a.stage = 'placed'
      order by a.stage_changed_at desc nulls last
      limit 1
    ) as last_placement_summary
  from public.companies c
  where c.last_contacted_at is not null
    and c.last_contacted_at < now() - make_interval(days => p_dormant_days)
    and exists (
      select 1
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where j.company_id = c.id
        and a.stage = 'placed'
    )
  order by c.last_contacted_at asc;
$$;

grant execute on function public.dormant_clients(int, int) to authenticated;

comment on function public.dormant_clients(int, int) is
  'Phase 3 / REPEAT-01: list companies the org has been quiet on for at least '
  'p_dormant_days that have at least one prior placement. security invoker — '
  'org isolation comes from RLS on companies / applications / jobs.';
