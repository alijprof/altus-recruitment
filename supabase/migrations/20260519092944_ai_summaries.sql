-- ai_summaries cache table + RLS policies + set_org trigger + cross-tenant
-- FK guard, all in ONE migration. Phase 1 lesson (3f748f8): splitting
-- related triggers across migrations caused the trigger-order bug. Keep
-- table + every trigger that operates on it in a single file so reviewers
-- see the full picture in one diff.
--
-- D2-07: cache key is (candidate_id, job_id, candidate_embedding_version,
-- job_embedding_version). When either embedding_version increments, the
-- cached row is implicitly stale; weekly Inngest cleanup deletes stale
-- rows but reads filter on version so correctness doesn't depend on the
-- sweep.
--
-- D2-20: FKs to candidates AND jobs both need cross-tenant guards. The
-- guard trigger MUST be named `ai_summaries_verify_same_org_check` so it
-- sorts AFTER `ai_summaries_set_org` alphabetically (v > s). Phase 1's
-- 3f748f8 bug taught us why this matters: with `same_org_check` (s < s),
-- the guard runs while NEW.organization_id is still NULL, fetches the
-- parent's real org, and raises "expected NULL".
--
-- Manual smoke tests after apply (run via psql as a real authenticated
-- session — RLS path is not exercised by raw SQL otherwise):
--
--   -- 1) Same-org insert succeeds:
--   -- (as user in org A, holding candidate X in org A)
--   insert into public.ai_summaries
--     (kind, candidate_id, content, model, cost_pence)
--     values ('match_score', '<X>', '{}'::jsonb, 'sonnet', 1);
--   -- expect: success; organization_id auto-filled to A
--
--   -- 2) Cross-tenant insert fails:
--   insert into public.ai_summaries
--     (organization_id, kind, candidate_id, content, model, cost_pence)
--     values ('<org-A>', 'match_score', '<candidate-in-org-B>',
--             '{}'::jsonb, 'sonnet', 1);
--   -- expect: ERROR 'cross-tenant FK guard: public.candidates belongs to
--   --   org <B>, expected <A>'
--
--   -- 3) Trigger ordering check:
--   select trigger_name from information_schema.triggers
--     where event_object_table = 'ai_summaries' order by trigger_name;
--   -- expect: ai_summaries_set_org first, then
--   --         ai_summaries_verify_same_org_check (alphabetical)

create table public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,                       -- 'match_score' | 'candidate_summary' | etc
  candidate_id uuid references public.candidates(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  candidate_embedding_version integer,
  job_embedding_version integer,
  content jsonb not null,
  model text not null,
  cost_pence integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,                   -- nullable; reserved for non-versioned cache entries
  unique (organization_id, kind, candidate_id, job_id, candidate_embedding_version, job_embedding_version)
);

create index ai_summaries_org_kind_idx
  on public.ai_summaries (organization_id, kind, created_at desc);
create index ai_summaries_candidate_idx
  on public.ai_summaries (candidate_id) where candidate_id is not null;
create index ai_summaries_job_idx
  on public.ai_summaries (job_id) where job_id is not null;

alter table public.ai_summaries enable row level security;

create policy "tenant select" on public.ai_summaries
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "tenant insert" on public.ai_summaries
  for insert to authenticated
  with check (organization_id = public.current_organization_id());

create policy "tenant update" on public.ai_summaries
  for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "tenant delete" on public.ai_summaries
  for delete to authenticated
  using (organization_id = public.current_organization_id());

-- Auto-fill organization_id from the auth context (saves callers from
-- threading it through). RLS WITH CHECK still enforces correctness.
create trigger ai_summaries_set_org
  before insert on public.ai_summaries
  for each row execute function public.set_organization_id();

-- Cross-tenant FK guard. Both FK columns are nullable, so each is
-- conditionally checked. Trigger name MUST sort after `_set_org` to
-- guarantee the trigger sees the auto-filled organization_id (Phase 1
-- 3f748f8 bug).
create or replace function public.ai_summaries_same_org_guard()
returns trigger language plpgsql as $$
begin
  if new.candidate_id is not null then
    perform public.assert_same_org(
      'public.candidates'::regclass, new.candidate_id, new.organization_id
    );
  end if;
  if new.job_id is not null then
    perform public.assert_same_org(
      'public.jobs'::regclass, new.job_id, new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger ai_summaries_verify_same_org_check
  before insert or update of candidate_id, job_id, organization_id on public.ai_summaries
  for each row execute function public.ai_summaries_same_org_guard();
