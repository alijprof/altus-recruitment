-- Phase 3 job_ads: persists generated ads + inclusivity score variants per job
-- (D3-12 / D3-33). One ad row per generation — no dedup; recruiters keep the
-- full history of variants.
--
-- TRIGGER ORDERING (Phase 1 commit 3f748f8 bug class — see migration
-- 20260518213836_fix_same_org_trigger_order.sql for the canonical narrative):
-- Postgres fires BEFORE triggers in ALPHABETICAL ORDER by trigger NAME.
-- We name `job_ads_set_org` (s < v) and `job_ads_verify_same_org_check` so
-- that `set_organization_id()` populates organization_id BEFORE the
-- cross-tenant guard reads it. Without this ordering the guard fires while
-- NEW.organization_id is still NULL, fetches the parent's real org, and
-- raises "expected NULL".
--
-- Manual smoke tests after apply (run via psql as a real authenticated session):
--
--   -- 1) Same-org insert succeeds:
--   set role authenticated;
--   -- (as user in org A, job X is in org A)
--   insert into public.job_ads (job_id, body_markdown, model, cost_pence)
--     values ('<X>', '# Senior Engineer', 'claude-sonnet-4-6', 2);
--   -- expect: success; organization_id auto-filled to A
--
--   -- 2) Cross-tenant insert fails:
--   insert into public.job_ads
--     (organization_id, job_id, body_markdown, model, cost_pence)
--     values ('<org-A>', '<job-in-org-B>', '# x', 'claude-sonnet-4-6', 2);
--   -- expect: ERROR 'cross-tenant FK guard: public.jobs belongs to org <B>'
--
--   -- 3) Trigger ordering check:
--   select trigger_name from information_schema.triggers
--     where event_object_table = 'job_ads' order by trigger_name;
--   -- expect:
--   --   job_ads_set_org
--   --   job_ads_set_updated_at
--   --   job_ads_verify_same_org_check
--
--   -- 4) inclusivity_score range CHECK:
--   insert into public.job_ads (job_id, body_markdown, model, cost_pence, inclusivity_score)
--     values ('<X>', '# x', 'claude-sonnet-4-6', 2, 101);
--   -- expect: ERROR 'new row for relation "job_ads" violates check constraint'

create table public.job_ads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  body_markdown text not null,
  -- 0-100 inclusivity score. CHECK enforces the contract surfaced by the
  -- Sonnet wrapper (D3-12 / D3-15).
  inclusivity_score smallint check (inclusivity_score is null or (inclusivity_score between 0 and 100)),
  -- Array of { original, improved, reason }; nullable when score not computed.
  inclusivity_suggestions jsonb,
  -- { gender, age, jargon, accessibility, salary_transparency } per-dimension
  -- breakdown — nullable when score not computed.
  inclusivity_dimensions jsonb,
  model text not null,
  cost_pence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D3-33: a job has multiple ads — fast list-by-job for the saved ads section.
create index job_ads_job_id_idx on public.job_ads (job_id, created_at desc);
create index job_ads_org_idx on public.job_ads (organization_id, created_at desc);

alter table public.job_ads enable row level security;

create policy "tenant select" on public.job_ads
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "tenant insert" on public.job_ads
  for insert to authenticated
  with check (organization_id = public.current_organization_id());

create policy "tenant update" on public.job_ads
  for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "tenant delete" on public.job_ads
  for delete to authenticated
  using (organization_id = public.current_organization_id());

-- Auto-fill organization_id from the auth context. RLS WITH CHECK still
-- enforces correctness for service-role inserts that pass org explicitly.
create trigger job_ads_set_org
  before insert on public.job_ads
  for each row execute function public.set_organization_id();

create trigger job_ads_set_updated_at
  before update on public.job_ads
  for each row execute function public.set_updated_at();

-- Cross-tenant FK guard. job_id is required; created_by is conditionally
-- checked because it is nullable (recruiter may be deleted after the ad is
-- generated). Trigger name MUST sort after `_set_org` (v > s alphabetical)
-- so it reads the auto-filled organization_id.
create or replace function public.job_ads_same_org_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_same_org(
    'public.jobs'::regclass, new.job_id, new.organization_id
  );
  if new.created_by is not null then
    perform public.assert_same_org(
      'public.users'::regclass, new.created_by, new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger job_ads_verify_same_org_check
  before insert or update of job_id, organization_id, created_by on public.job_ads
  for each row execute function public.job_ads_same_org_guard();
