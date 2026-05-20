-- Phase 3 / Plan 03-06 / Task F.2 — REPEAT-02 (D3-22).
--
-- `source_attribution_summary(p_from, p_to)` powers `/reports/source-attribution`.
-- Aggregates placed applications by `candidates.source`, returning
-- placements count, total fee revenue (pence), and average time-to-place
-- (days) per source channel.
--
-- security INVOKER (not DEFINER) — RLS on `applications` + `candidates`
-- enforces tenant isolation for the calling user. As a defence-in-depth
-- belt-and-braces measure the function body ALSO filters
-- `applications.organization_id = current_organization_id()`, but RLS
-- already excludes other-tenant rows from the calling user's row visibility
-- before any aggregation runs.
--
-- CRITICAL-3 (plan-check 2026-05-19): `placed_at` is nullable on
-- applications. Legacy placements pre-Plan F (and any future quick-place
-- rows where the recruiter hasn't filled the explicit date) won't have it.
-- The aggregation uses `coalesce(a.placed_at, a.stage_changed_at)` for BOTH
-- the date-range filter and the avg-time-to-place calc so the report doesn't
-- silently drop the NULL branch. See `supabase/tests/source-attribution-rpc
-- .test.sql` for the assertion that exercises both branches.
--
-- Defaults: p_from = 90 days ago, p_to = today. UI re-passes whatever the
-- date filter selects (30 / 90 / 365 / custom — D3-23).
--
-- Return shape mirrors RESEARCH §M7 / PATTERNS §3:
--   source                : public.candidate_source
--   placements_count      : int      (count of placed applications)
--   total_fee_pence       : bigint   (coalesced sum; NULL fee_pence → 0)
--   avg_time_to_place_days: numeric  (placed - created), 1 decimal place
--
-- Order: placements_count desc, total_fee_pence desc so the highest-impact
-- channel ranks first.
--
-- Manual psql smoke tests (run after `pnpm db:reset --local`):
--   1. set role authenticated;
--      set request.jwt.claim.sub = '<org-A user>';
--      select * from source_attribution_summary('2026-01-01','2026-12-31');
--      -- should return ONLY rows whose underlying applications belong to org-A.
--   2. As an anon role (no JWT): grant should NOT permit execution.
--   3. \df+ source_attribution_summary
--      -- volatility=stable, security=invoker, language=sql.

create or replace function public.source_attribution_summary(
  p_from date default (now() - interval '90 days')::date,
  p_to date default now()::date
) returns table (
  source public.candidate_source,
  placements_count int,
  total_fee_pence bigint,
  avg_time_to_place_days numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.source,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence,
    coalesce(
      avg(
        extract(
          epoch from (
            coalesce(a.placed_at, a.stage_changed_at) - a.created_at
          )
        ) / 86400
      ),
      0
    )::numeric(10, 1) as avg_time_to_place_days
  from public.applications a
  join public.candidates c on c.id = a.candidate_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date
        between p_from and p_to
  group by c.source
  order by placements_count desc, total_fee_pence desc;
$$;

grant execute on function public.source_attribution_summary(date, date)
  to authenticated;

comment on function public.source_attribution_summary(date, date) is
  'Phase 3 REPEAT-02 / D3-22: placements aggregated by candidates.source for '
  'the source-attribution report. security invoker — RLS on applications + '
  'candidates handles tenant isolation. coalesce(placed_at, stage_changed_at) '
  'covers legacy NULL placed_at rows (CRITICAL-3, plan-check 2026-05-19).';
