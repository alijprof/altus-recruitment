-- Phase 4 / Plan 04-01 — Wave 0 Hardening.
--
-- Creates all tables and RPCs that every Phase 4 slice depends on. Must be
-- pushed BEFORE any feature branch that touches voice notes, email campaigns,
-- or NL reporting.
--
-- Sections:
--   1. voice_notes table + RLS + indexes
--   2. email_campaigns + email_campaign_recipients tables + RLS + indexes
--   3. jobs.sector scalar column (REPORT-02 gap fix — D4-08 / Research §Gap Analysis)
--   4. time_to_fill_by_sector superseded to group by coalesce(j.sector, 'Unspecified')
--   5. ~20 NL template RPCs — all security invoker, all granted to authenticated
--
-- Security policy: all RPCs are `security invoker` — NOT `security definer`.
-- This means existing RLS on candidates / jobs / applications / companies
-- enforces tenant isolation automatically. Never use `security definer` for
-- these read-only analytics functions.

-- ===========================================================================
-- 1. voice_notes
-- ===========================================================================
-- D4-06: stores the uploaded audio reference, transcript, Sonnet's structured
-- proposal, and status machine state. Audio is cleared by the 30-day retention
-- sweep that mirrors spec-audio-retention-sweep.ts.

create table public.voice_notes (
  id                     uuid        primary key default gen_random_uuid(),
  organization_id        uuid        not null references public.organizations(id) on delete cascade,
  candidate_id           uuid        not null references public.candidates(id)     on delete cascade,
  created_by             uuid        not null references public.users(id)          on delete restrict,
  audio_storage_path     text,                          -- nulled after 30-day retention sweep
  audio_mime_type        text,
  audio_duration_seconds int,
  transcript             text,
  structured_data        jsonb,                         -- VoiceNoteProposal shape (from Sonnet)
  status                 text        not null default 'pending'
    check (status in ('pending','transcribing','ready_for_review','applied','rejected','failed')),
  applied_at             timestamptz,
  parse_error            text,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.voice_notes enable row level security;

create policy "tenant isolation" on public.voice_notes
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- covering indexes for the two most common access patterns
create index voice_notes_candidate_status_idx
  on public.voice_notes (candidate_id, status);

create index voice_notes_org_created_idx
  on public.voice_notes (organization_id, created_at desc);

-- updated_at trigger mirrors the jobs / candidates pattern
create trigger voice_notes_set_updated_at
  before update on public.voice_notes
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. email_campaigns + email_campaign_recipients
-- ===========================================================================
-- D4-07: Recruiter-authored template body + Sonnet intro/outro per recipient.
-- Campaigns move through: draft -> approved -> sending -> sent / failed.
-- MARKET-03: campaigns only send after explicit `approveCampaignAction` sets
-- status='approved' and fires the Inngest event — no auto-send ever.

create table public.email_campaigns (
  id                       uuid        primary key default gen_random_uuid(),
  organization_id          uuid        not null references public.organizations(id) on delete cascade,
  created_by               uuid        not null references public.users(id) on delete restrict,
  name                     text        not null,
  subject_template         text        not null,
  body_template            text        not null,        -- recruiter-authored middle section
  segment_market_statuses  text[]      not null,        -- ['hot','actively_looking'] etc.
  status                   text        not null default 'draft'
    check (status in ('draft','approved','sending','sent','failed')),
  approved_at              timestamptz,
  sent_at                  timestamptz,
  recipient_count          int,
  sent_count               int         not null default 0,
  failed_count             int         not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.email_campaigns enable row level security;

create policy "tenant isolation" on public.email_campaigns
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create index email_campaigns_org_status_idx
  on public.email_campaigns (organization_id, status);

create trigger email_campaigns_set_updated_at
  before update on public.email_campaigns
  for each row execute function public.set_updated_at();

-- Per-recipient tracking for idempotent Inngest fan-out and cap-exceeded logging.
create table public.email_campaign_recipients (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations(id) on delete cascade,
  campaign_id       uuid        not null references public.email_campaigns(id)  on delete cascade,
  candidate_id      uuid        not null references public.candidates(id)       on delete cascade,
  email             text        not null,
  personalised_intro  text,               -- Sonnet-generated per D4-07
  personalised_outro  text,               -- Sonnet-generated per D4-07
  resend_email_id   text,                  -- Resend message ID for bounce/click tracking
  status            text        not null default 'pending'
    check (status in ('pending','sent','failed','failed_cap_exceeded')),
  error_message     text,
  sent_at           timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.email_campaign_recipients enable row level security;

create policy "tenant isolation" on public.email_campaign_recipients
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create index email_campaign_recipients_campaign_status_idx
  on public.email_campaign_recipients (campaign_id, status);

create index email_campaign_recipients_org_idx
  on public.email_campaign_recipients (organization_id);

-- ===========================================================================
-- 3. jobs.sector — scalar column (REPORT-02 gap fix)
-- ===========================================================================
-- The existing `jobs.sector_tags` is a text[] array intended for multi-sector
-- tagging. This new `sector` column is a single scalar for the primary sector
-- of a role — required by `time_to_fill_by_sector` to return meaningful
-- buckets instead of a single 'Unspecified' row.
-- Ref: Research §Gap Analysis option (a); D4-08; Research §Open Questions Q1.

alter table public.jobs
  add column if not exists sector text;

comment on column public.jobs.sector is
  'Primary sector of the role (scalar). Distinct from sector_tags (multi-value array). '
  'Used by time_to_fill_by_sector RPC for REPORT-02 sector bucketing.';

-- ===========================================================================
-- 4. time_to_fill_by_sector — supersede the literal ''Unspecified'' version
-- ===========================================================================
-- HI-03 fix preserved. The only change vs 20260601000000 is the SELECT list:
-- 'Unspecified'::text as sector -> coalesce(j.sector, 'Unspecified') as sector
-- and GROUP BY 1 accordingly.

create or replace function public.time_to_fill_by_sector(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  sector           text,
  median_days      numeric,
  p90_days         numeric,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(j.sector, 'Unspecified') as sector,
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
    and coalesce(a.placed_at, a.stage_changed_at) >= j.created_at   -- HI-03: exclude negative durations
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;

grant execute on function public.time_to_fill_by_sector(date, date) to authenticated;

comment on function public.time_to_fill_by_sector(date, date) is
  'REPORT-02 (Phase 4 hardening): median + p90 time-to-fill grouped by '
  'coalesce(jobs.sector, Unspecified). HI-03 fix preserved — excludes '
  'placements dated before job creation. security invoker.';

-- ===========================================================================
-- 5. NL template RPCs (~20 functions)
-- ===========================================================================
-- All RPCs:
--   * language sql stable
--   * security invoker  — NEVER security definer (Research §Anti-Patterns)
--   * set search_path = public
--   * grant execute to authenticated
--   * comment on function with NL trigger phrases used in the Sonnet prompt
--
-- Parameter defaults match the most common recruiter time horizon (90 days).
-- Each function name MUST be prefixed nl_ and MUST appear in NL_TEMPLATES
-- (src/lib/reports/nl-templates.ts).

-- ---------------------------------------------------------------------------
-- nl_placements_by_sector
-- ---------------------------------------------------------------------------
create or replace function public.nl_placements_by_sector(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  sector           text,
  placements_count int,
  total_fee_pence  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(j.sector, 'Unspecified') as sector,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;

grant execute on function public.nl_placements_by_sector(date, date) to authenticated;

comment on function public.nl_placements_by_sector(date, date) is
  'NL trigger: "placements by sector", "how many placements by industry", "sector breakdown"';

-- ---------------------------------------------------------------------------
-- nl_placements_by_recruiter
-- ---------------------------------------------------------------------------
create or replace function public.nl_placements_by_recruiter(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  recruiter_name   text,
  placements_count int,
  total_fee_pence  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(u.full_name, u.email, 'Unattributed') as recruiter_name,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence
  from public.applications a
  left join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;

grant execute on function public.nl_placements_by_recruiter(date, date) to authenticated;

comment on function public.nl_placements_by_recruiter(date, date) is
  'NL trigger: "placements by recruiter", "who made the most placements", "recruiter leaderboard"';

-- ---------------------------------------------------------------------------
-- nl_time_to_fill_by_recruiter
-- ---------------------------------------------------------------------------
create or replace function public.nl_time_to_fill_by_recruiter(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  recruiter_name   text,
  median_days      numeric,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(u.full_name, u.email, 'Unattributed') as recruiter_name,
    percentile_cont(0.5) within group (
      order by extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400
    )::numeric(10, 1) as median_days,
    count(*)::int as placements_count
  from public.applications a
  join public.jobs j on j.id = a.job_id
  left join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at) >= j.created_at
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by median_days asc nulls last;
$$;

grant execute on function public.nl_time_to_fill_by_recruiter(date, date) to authenticated;

comment on function public.nl_time_to_fill_by_recruiter(date, date) is
  'NL trigger: "time to fill by recruiter", "who fills roles fastest", "recruiter speed"';

-- ---------------------------------------------------------------------------
-- nl_source_roi
-- ---------------------------------------------------------------------------
create or replace function public.nl_source_roi(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  source           text,
  placements_count int,
  total_fee_pence  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.source::text,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence
  from public.applications a
  join public.candidates c on c.id = a.candidate_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by placements_count desc;
$$;

grant execute on function public.nl_source_roi(date, date) to authenticated;

comment on function public.nl_source_roi(date, date) is
  'NL trigger: "source ROI", "which source gives most placements", "best candidate source"';

-- ---------------------------------------------------------------------------
-- nl_pipeline_value_by_stage
-- ---------------------------------------------------------------------------
create or replace function public.nl_pipeline_value_by_stage()
returns table (
  stage               text,
  candidate_count     int,
  estimated_fee_pence bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.stage::text,
    count(distinct a.candidate_id)::int as candidate_count,
    coalesce(sum((j.salary_max * 100 * 0.20)::bigint), 0) as estimated_fee_pence
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.organization_id = public.current_organization_id()
    and a.stage not in ('placed', 'rejected', 'withdrawn')
    and j.status = 'open'
  group by 1
  order by
    case a.stage::text
      when 'applied' then 1 when 'screening' then 2 when 'cv_submitted' then 3
      when 'first_interview' then 4 when 'second_interview' then 5 when 'offer' then 6
      else 7
    end;
$$;

grant execute on function public.nl_pipeline_value_by_stage() to authenticated;

comment on function public.nl_pipeline_value_by_stage() is
  'NL trigger: "pipeline value by stage", "how much is in the pipeline", "pipeline breakdown"';

-- ---------------------------------------------------------------------------
-- nl_candidates_added_per_month
-- ---------------------------------------------------------------------------
create or replace function public.nl_candidates_added_per_month(
  p_months int default 6
) returns table (
  month            date,
  candidates_added int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('month', c.created_at)::date as month,
    count(*)::int as candidates_added
  from public.candidates c
  where c.organization_id = public.current_organization_id()
    and c.created_at >= now() - make_interval(months => p_months)
  group by 1
  order by 1 asc;
$$;

grant execute on function public.nl_candidates_added_per_month(int) to authenticated;

comment on function public.nl_candidates_added_per_month(int) is
  'NL trigger: "candidates added per month", "new candidates this year", "candidate pipeline growth"';

-- ---------------------------------------------------------------------------
-- nl_applications_per_job
-- ---------------------------------------------------------------------------
create or replace function public.nl_applications_per_job(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  job_title          text,
  applications_count int,
  company_name       text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    j.title as job_title,
    count(*)::int as applications_count,
    co.name as company_name
  from public.applications a
  join public.jobs j on j.id = a.job_id
  join public.companies co on co.id = j.company_id
  where a.organization_id = public.current_organization_id()
    and a.created_at::date between p_from and p_to
  group by j.id, j.title, co.name
  order by applications_count desc
  limit 20;
$$;

grant execute on function public.nl_applications_per_job(date, date) to authenticated;

comment on function public.nl_applications_per_job(date, date) is
  'NL trigger: "applications per job", "most applied to roles", "which jobs get most candidates"';

-- ---------------------------------------------------------------------------
-- nl_fees_by_month
-- ---------------------------------------------------------------------------
create or replace function public.nl_fees_by_month(
  p_months int default 12
) returns table (
  month            date,
  total_fee_pence  bigint,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('month', coalesce(a.placed_at, a.stage_changed_at))::date as month,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence,
    count(*)::int as placements_count
  from public.applications a
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at) >= now() - make_interval(months => p_months)
  group by 1
  order by 1 asc;
$$;

grant execute on function public.nl_fees_by_month(int) to authenticated;

comment on function public.nl_fees_by_month(int) is
  'NL trigger: "fees by month", "monthly revenue", "how much have we billed this year"';

-- ---------------------------------------------------------------------------
-- nl_fees_by_recruiter
-- ---------------------------------------------------------------------------
create or replace function public.nl_fees_by_recruiter(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  recruiter_name   text,
  total_fee_pence  bigint,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(u.full_name, u.email, 'Unattributed') as recruiter_name,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence,
    count(*)::int as placements_count
  from public.applications a
  left join public.users u on u.id = coalesce(a.owner_user_id, a.created_by)
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by total_fee_pence desc;
$$;

grant execute on function public.nl_fees_by_recruiter(date, date) to authenticated;

comment on function public.nl_fees_by_recruiter(date, date) is
  'NL trigger: "fees by recruiter", "who earned the most fees", "top billing recruiter"';

-- ---------------------------------------------------------------------------
-- nl_dormant_clients_count
-- ---------------------------------------------------------------------------
create or replace function public.nl_dormant_clients_count(
  p_dormant_days int default 60
) returns table (
  dormant_count  int,
  threshold_days int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::int as dormant_count,
    p_dormant_days as threshold_days
  from public.companies c
  where c.organization_id = public.current_organization_id()
    and c.last_contacted_at is not null
    and c.last_contacted_at < now() - make_interval(days => p_dormant_days)
    and exists (
      select 1
      from public.applications a
      join public.jobs j on j.id = a.job_id
      where j.company_id = c.id
        and a.stage = 'placed'
    );
$$;

grant execute on function public.nl_dormant_clients_count(int) to authenticated;

comment on function public.nl_dormant_clients_count(int) is
  'NL trigger: "dormant clients", "how many clients gone quiet", "clients we haven''t spoken to"';

-- ---------------------------------------------------------------------------
-- nl_conversion_rate
-- ---------------------------------------------------------------------------
create or replace function public.nl_conversion_rate(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  cv_submissions bigint,
  placements     bigint,
  conversion_pct numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where a.stage in ('cv_submitted','first_interview','second_interview','offer','placed')) as cv_submissions,
    count(*) filter (where a.stage = 'placed') as placements,
    case
      when count(*) filter (where a.stage in ('cv_submitted','first_interview','second_interview','offer','placed')) = 0
        then 0::numeric
      else round(
        count(*) filter (where a.stage = 'placed')::numeric
        / count(*) filter (where a.stage in ('cv_submitted','first_interview','second_interview','offer','placed'))::numeric
        * 100, 1
      )
    end as conversion_pct
  from public.applications a
  where a.organization_id = public.current_organization_id()
    and a.created_at::date between p_from and p_to;
$$;

grant execute on function public.nl_conversion_rate(date, date) to authenticated;

comment on function public.nl_conversion_rate(date, date) is
  'NL trigger: "conversion rate", "submission to placement rate", "how many CVs become placements"';

-- ---------------------------------------------------------------------------
-- nl_average_fee_by_sector
-- ---------------------------------------------------------------------------
create or replace function public.nl_average_fee_by_sector(
  p_from date default (now() - interval '90 days')::date,
  p_to   date default now()::date
) returns table (
  sector           text,
  avg_fee_pence    bigint,
  placements_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(j.sector, 'Unspecified') as sector,
    avg(a.fee_pence)::bigint as avg_fee_pence,
    count(*)::int as placements_count
  from public.applications a
  join public.jobs j on j.id = a.job_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and a.fee_pence is not null
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  group by 1
  order by avg_fee_pence desc nulls last;
$$;

grant execute on function public.nl_average_fee_by_sector(date, date) to authenticated;

comment on function public.nl_average_fee_by_sector(date, date) is
  'NL trigger: "average fee by sector", "which sector pays best", "highest value placements"';

-- ---------------------------------------------------------------------------
-- nl_placements_this_quarter
-- ---------------------------------------------------------------------------
create or replace function public.nl_placements_this_quarter()
returns table (
  quarter          date,
  placements_count int,
  total_fee_pence  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('quarter', now())::date as quarter,
    count(*)::int as placements_count,
    coalesce(sum(a.fee_pence), 0)::bigint as total_fee_pence
  from public.applications a
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at) >= date_trunc('quarter', now());
$$;

grant execute on function public.nl_placements_this_quarter() to authenticated;

comment on function public.nl_placements_this_quarter() is
  'NL trigger: "placements this quarter", "Q2 placements", "how are we doing this quarter"';

-- ---------------------------------------------------------------------------
-- nl_top_sources_by_placements
-- ---------------------------------------------------------------------------
create or replace function public.nl_top_sources_by_placements(
  p_from  date default (now() - interval '365 days')::date,
  p_to    date default now()::date,
  p_limit int  default 5
) returns table (
  source           text,
  placements_count int,
  pct_of_total     numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with totals as (
    select
      c.source::text as source,
      count(*)::int as placements_count
    from public.applications a
    join public.candidates c on c.id = a.candidate_id
    where a.organization_id = public.current_organization_id()
      and a.stage = 'placed'
      and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
    group by 1
  ),
  grand as (
    select sum(placements_count) as total from totals
  )
  select
    t.source,
    t.placements_count,
    case when g.total = 0 then 0::numeric
         else round(t.placements_count::numeric / g.total * 100, 1)
    end as pct_of_total
  from totals t, grand g
  order by t.placements_count desc
  limit p_limit;
$$;

grant execute on function public.nl_top_sources_by_placements(date, date, int) to authenticated;

comment on function public.nl_top_sources_by_placements(date, date, int) is
  'NL trigger: "top sources", "best source of candidates", "where do our placements come from"';

-- ---------------------------------------------------------------------------
-- nl_candidates_by_market_status
-- ---------------------------------------------------------------------------
create or replace function public.nl_candidates_by_market_status()
returns table (
  market_status   text,
  candidate_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.market_status::text,
    count(*)::int as candidate_count
  from public.candidates c
  where c.organization_id = public.current_organization_id()
  group by 1
  order by
    case c.market_status::text
      when 'hot' then 1 when 'actively_looking' then 2
      when 'passively_looking' then 3 when 'placed' then 4
      when 'cold' then 5 else 6
    end;
$$;

grant execute on function public.nl_candidates_by_market_status() to authenticated;

comment on function public.nl_candidates_by_market_status() is
  'NL trigger: "candidates by market status", "how many active candidates", "candidate database breakdown"';

-- ---------------------------------------------------------------------------
-- nl_jobs_opened_per_month
-- ---------------------------------------------------------------------------
create or replace function public.nl_jobs_opened_per_month(
  p_months int default 6
) returns table (
  month       date,
  jobs_opened int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('month', j.created_at)::date as month,
    count(*)::int as jobs_opened
  from public.jobs j
  where j.organization_id = public.current_organization_id()
    and j.created_at >= now() - make_interval(months => p_months)
  group by 1
  order by 1 asc;
$$;

grant execute on function public.nl_jobs_opened_per_month(int) to authenticated;

comment on function public.nl_jobs_opened_per_month(int) is
  'NL trigger: "jobs opened per month", "new vacancies this year", "how many jobs opened"';

-- ---------------------------------------------------------------------------
-- nl_jobs_filled_vs_open
-- ---------------------------------------------------------------------------
create or replace function public.nl_jobs_filled_vs_open()
returns table (
  status    text,
  job_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    j.status::text,
    count(*)::int as job_count
  from public.jobs j
  where j.organization_id = public.current_organization_id()
  group by 1
  order by
    case j.status::text
      when 'open' then 1 when 'on_hold' then 2 when 'filled' then 3
      when 'draft' then 4 when 'cancelled' then 5 else 6
    end;
$$;

grant execute on function public.nl_jobs_filled_vs_open() to authenticated;

comment on function public.nl_jobs_filled_vs_open() is
  'NL trigger: "jobs filled vs open", "how many vacancies are open", "job status breakdown"';

-- ---------------------------------------------------------------------------
-- nl_activity_volume_by_recruiter
-- ---------------------------------------------------------------------------
create or replace function public.nl_activity_volume_by_recruiter(
  p_from date default (now() - interval '30 days')::date,
  p_to   date default now()::date
) returns table (
  recruiter_name text,
  activity_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(u.full_name, u.email, 'Unattributed') as recruiter_name,
    count(*)::int as activity_count
  from public.activities act
  left join public.users u on u.id = act.actor_user_id
  where act.organization_id = public.current_organization_id()
    and act.occurred_at::date between p_from and p_to
  group by 1
  order by activity_count desc;
$$;

grant execute on function public.nl_activity_volume_by_recruiter(date, date) to authenticated;

comment on function public.nl_activity_volume_by_recruiter(date, date) is
  'NL trigger: "activity by recruiter", "who is most active", "recruiter activity this month"';

-- ---------------------------------------------------------------------------
-- nl_fastest_fills
-- ---------------------------------------------------------------------------
create or replace function public.nl_fastest_fills(
  p_from  date default (now() - interval '90 days')::date,
  p_to    date default now()::date,
  p_limit int  default 10
) returns table (
  job_title    text,
  company_name text,
  days_to_fill numeric,
  placed_date  date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    j.title as job_title,
    co.name as company_name,
    (extract(epoch from (coalesce(a.placed_at, a.stage_changed_at) - j.created_at)) / 86400)::numeric(10,1)
      as days_to_fill,
    coalesce(a.placed_at, a.stage_changed_at)::date as placed_date
  from public.applications a
  join public.jobs j on j.id = a.job_id
  join public.companies co on co.id = j.company_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and coalesce(a.placed_at, a.stage_changed_at) >= j.created_at
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  order by days_to_fill asc nulls last
  limit p_limit;
$$;

grant execute on function public.nl_fastest_fills(date, date, int) to authenticated;

comment on function public.nl_fastest_fills(date, date, int) is
  'NL trigger: "fastest fills", "quickest placements", "which jobs filled fastest"';

-- ---------------------------------------------------------------------------
-- nl_biggest_fees
-- ---------------------------------------------------------------------------
create or replace function public.nl_biggest_fees(
  p_from  date default (now() - interval '365 days')::date,
  p_to    date default now()::date,
  p_limit int  default 10
) returns table (
  candidate_name text,
  job_title      text,
  company_name   text,
  fee_pence      bigint,
  placed_date    date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cand.full_name as candidate_name,
    j.title as job_title,
    co.name as company_name,
    a.fee_pence,
    coalesce(a.placed_at, a.stage_changed_at)::date as placed_date
  from public.applications a
  join public.candidates cand on cand.id = a.candidate_id
  join public.jobs j on j.id = a.job_id
  join public.companies co on co.id = j.company_id
  where a.organization_id = public.current_organization_id()
    and a.stage = 'placed'
    and a.fee_pence is not null
    and coalesce(a.placed_at, a.stage_changed_at)::date between p_from and p_to
  order by a.fee_pence desc nulls last
  limit p_limit;
$$;

grant execute on function public.nl_biggest_fees(date, date, int) to authenticated;

comment on function public.nl_biggest_fees(date, date, int) is
  'NL trigger: "biggest fees", "highest value placements", "top earners", "most expensive placements"';
