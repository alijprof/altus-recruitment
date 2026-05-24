-- Quick task 260524-cwd — REPORT-02 (buyer-value dashboards).
--
-- Four net-new aggregation RPCs that power /reports/buyer-value:
--   1. placements_by_recruiter_quarter — stacked bar "placements per recruiter per quarter"
--   2. time_to_fill_by_sector           — horizontal bar median + p90 days (single "Unspecified" bucket v1)
--   3. pipeline_value_sparkline          — daily series of pipeline value across the window
--   4. commission_summary_by_recruiter   — per-recruiter total fee + 20% estimated commission
--
-- The source-attribution metric on the same page REUSES the existing
-- `source_attribution_summary(p_from, p_to)` RPC from
-- 20260520023200_phase3_source_attribution_rpc.sql — no duplicate created here.
--
-- security invoker — RLS on applications / jobs / users does the tenancy
-- work; the explicit `organization_id = public.current_organization_id()`
-- predicates inside each function body are belt-and-braces only, NOT the
-- primary security control. Matches the pattern in
-- 20260520031200_phase3_dormant_clients_rpc.sql.
--
-- Currency note: commission summary filters to GBP placements via
-- `coalesce(a.placement_currency, 'GBP') = 'GBP'` (per locked plan
-- decision — anchor customer is GBP-only; multi-currency aggregation is
-- future work). Pipeline sparkline does NOT filter currency on jobs because
-- `jobs.currency` is per-job (not per-placement) and the sparkline approximates
-- across all open jobs assumed GBP — documented in the Methodology details
-- panel on the page.
--
-- Sector note: `jobs` has no sector column (verified in
-- 20260513152244_phase1_domain_schema.sql). The time-to-fill RPC returns a
-- single literal `'Unspecified'::text` bucket until a sector field is added.
--
-- All four functions: language sql, stable, security invoker,
-- set search_path = public, grant execute to authenticated, comment on
-- function. Defaults match the plan's 90d window so callers can invoke with
-- no args from psql for smoke testing.

-- ---------------------------------------------------------------------------
-- 1. placements_by_recruiter_quarter(p_from, p_to)
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
    u.id as recruiter_id,
    coalesce(u.full_name, u.email) as recruiter_name,
    count(*)::int as placements_count
  from public.applications a
  join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1, 2, 3
  order by 1 asc, 4 desc;
$$;

grant execute on function public.placements_by_recruiter_quarter(date, date)
  to authenticated;

comment on function public.placements_by_recruiter_quarter(date, date) is
  '260524-cwd REPORT-02: placements aggregated by recruiter + quarter for the '
  'buyer-value stacked-bar card. Recruiter attribution: owner_user_id with '
  'fallback to created_by. security invoker — RLS on applications/users does '
  'tenancy.';

-- ---------------------------------------------------------------------------
-- 2. time_to_fill_by_sector(p_from, p_to)
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
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;

grant execute on function public.time_to_fill_by_sector(date, date)
  to authenticated;

comment on function public.time_to_fill_by_sector(date, date) is
  '260524-cwd REPORT-02: median + p90 time-to-fill across placed applications '
  'for the buyer-value horizontal-bar card. Single Unspecified sector bucket '
  'until jobs.sector exists. security invoker — RLS on applications/jobs does '
  'tenancy.';

-- ---------------------------------------------------------------------------
-- 3. pipeline_value_sparkline(p_from, p_to)
-- ---------------------------------------------------------------------------
-- NOTE: pipeline_value_pence = sum(jobs.salary_max * 100 * 0.20) over open jobs
-- as of each bucket date. Approximations (documented in /reports/buyer-value
-- Methodology):
--   * salary_max stored as whole-pounds integer; *100 converts to pence
--   * "open as of date X" approximated as status='open' AND created_at::date <= X
--     (we have no historical status table — indicative trend only)
--   * jobs.currency NOT filtered — assumes GBP for anchor customer
create or replace function public.pipeline_value_sparkline(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  bucket_date date,
  pipeline_value_pence bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with day_series as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  )
  select
    ds.d as bucket_date,
    coalesce(sum((j.salary_max * 100 * 0.20)::bigint), 0)::bigint as pipeline_value_pence
  from day_series ds
  left join public.jobs j
    on j.organization_id = public.current_organization_id()
    and j.status = 'open'
    and j.created_at::date <= ds.d
    and j.salary_max is not null
  group by ds.d
  order by ds.d asc;
$$;

grant execute on function public.pipeline_value_sparkline(date, date)
  to authenticated;

comment on function public.pipeline_value_sparkline(date, date) is
  '260524-cwd REPORT-02: daily pipeline value series (sum of open jobs '
  'salary_max*20% as expected fee) for the buyer-value sparkline. Indicative '
  'only — no historical status table. security invoker — RLS on jobs does '
  'tenancy.';

-- ---------------------------------------------------------------------------
-- 4. commission_summary_by_recruiter(p_from, p_to)
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
    u.id as recruiter_id,
    coalesce(u.full_name, u.email) as recruiter_name,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence,
    (coalesce(sum(a.fee_pence), 0) * 0.20)::bigint as estimated_commission_pence
  from public.applications a
  join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placement_currency, 'GBP') = 'GBP'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by u.id, u.full_name, u.email
  order by total_fee_pence desc;
$$;

grant execute on function public.commission_summary_by_recruiter(date, date)
  to authenticated;

comment on function public.commission_summary_by_recruiter(date, date) is
  '260524-cwd REPORT-02: per-recruiter total fee + 20% estimated commission '
  'for the buyer-value commission card. Filters to GBP placements (anchor '
  'customer). Commission rate is a placeholder until per-recruiter rates '
  'exist. security invoker — RLS on applications/users does tenancy.';
