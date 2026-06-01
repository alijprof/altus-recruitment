-- Launch-readiness M-3 — buyer-value RPC correctness fixes (acquirer-facing
-- numbers must reconcile against raw counts). Append-only CREATE OR REPLACE of
-- three RPCs first shipped in 20260524000200_buyer_value_rpcs.sql:
--
--   HI-01  placements_by_recruiter_quarter + commission_summary_by_recruiter
--          used an INNER JOIN to public.users on
--          coalesce(owner_user_id, created_by). Placements where BOTH columns
--          are NULL were silently dropped — the dashboard under-counted vs a
--          raw `count(*) where stage='placed'`. Fixed with a LEFT JOIN + a
--          nil-UUID "Unattributed" bucket so every placement is counted and
--          the bucket key is stable + non-null for the UI.
--
--   HI-03  time_to_fill_by_sector included placements dated BEFORE their job
--          was created (data-entry anomalies → negative durations that skew
--          percentile_cont on a low-volume org). Fixed by excluding rows where
--          coalesce(placed_at, stage_changed_at) < jobs.created_at.
--
-- HI-02 (pipeline_value_sparkline back-projects today's status) is a known
-- modelling limitation with no historical status table — left as-is and
-- documented honestly in the /reports/buyer-value Methodology, not "fixed" in
-- SQL.
--
-- All three keep their exact signature + return columns, so the typed helpers
-- in src/lib/db/buyer-value.ts need no change. security invoker preserved.

-- ---------------------------------------------------------------------------
-- 1. placements_by_recruiter_quarter — HI-01
-- ---------------------------------------------------------------------------
create or replace function public.placements_by_recruiter_quarter(
  p_from date default (now() - interval '365 days')::date,
  p_to date default now()::date
) returns table (
  quarter date,
  recruiter_id uuid,
  recruiter_name text,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('quarter', coalesce(a.placed_at, a.stage_changed_at))::date as quarter,
    coalesce(u.id, '00000000-0000-0000-0000-000000000000'::uuid) as recruiter_id,
    coalesce(u.full_name, u.email, 'Unattributed') as recruiter_name,
    count(*)::int as placements_count
  from public.applications a
  left join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1, 2, 3
  order by 1 asc, 4 desc;
$$;

grant execute on function public.placements_by_recruiter_quarter(date, date)
  to authenticated;

comment on function public.placements_by_recruiter_quarter(date, date) is
  'REPORT-02 (M-3 HI-01 fix): placements by recruiter + quarter. LEFT JOIN so '
  'placements with neither owner_user_id nor created_by fall into a nil-UUID '
  'Unattributed bucket instead of being dropped. security invoker.';

-- ---------------------------------------------------------------------------
-- 2. time_to_fill_by_sector — HI-03
-- ---------------------------------------------------------------------------
create or replace function public.time_to_fill_by_sector(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  sector text,
  median_days numeric,
  p90_days numeric,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    'Unspecified'::text as sector,
    percentile_cont(0.5) within group (
      order by extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400
    )::numeric(10, 1) as median_days,
    percentile_cont(0.9) within group (
      order by extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400
    )::numeric(10, 1) as p90_days,
    count(*)::int as placements_count
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at) >= j.created_at
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;

grant execute on function public.time_to_fill_by_sector(date, date)
  to authenticated;

comment on function public.time_to_fill_by_sector(date, date) is
  'REPORT-02 (M-3 HI-03 fix): median + p90 time-to-fill. Excludes placements '
  'dated before job creation (negative-duration data anomalies). Single '
  'Unspecified bucket until jobs.sector exists. security invoker.';

-- ---------------------------------------------------------------------------
-- 3. commission_summary_by_recruiter — HI-01
-- ---------------------------------------------------------------------------
create or replace function public.commission_summary_by_recruiter(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  recruiter_id uuid,
  recruiter_name text,
  placements_count int,
  total_fee_pence bigint,
  estimated_commission_pence bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(u.id, '00000000-0000-0000-0000-000000000000'::uuid) as recruiter_id,
    coalesce(u.full_name, u.email, 'Unattributed') as recruiter_name,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence,
    (coalesce(sum(a.fee_pence), 0) * 0.20)::bigint as estimated_commission_pence
  from public.applications a
  left join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placement_currency, 'GBP') = 'GBP'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1, 2
  order by total_fee_pence desc;
$$;

grant execute on function public.commission_summary_by_recruiter(date, date)
  to authenticated;

comment on function public.commission_summary_by_recruiter(date, date) is
  'REPORT-02 (M-3 HI-01 fix): per-recruiter total fee + 20% estimated '
  'commission. LEFT JOIN so unattributed GBP placements fall into a nil-UUID '
  'Unattributed bucket instead of being dropped. security invoker.';
