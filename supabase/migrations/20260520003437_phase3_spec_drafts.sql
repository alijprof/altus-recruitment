-- Phase 3 spec_drafts: holds the in-progress JD draft between audio upload and
-- recruiter approval. Single migration containing table + indexes + RLS +
-- triggers + cross-tenant FK guard. Pattern per 20260519092944_ai_summaries.sql.
--
-- TRIGGER ORDERING (Phase 1 commit 3f748f8 bug class — see migration
-- 20260518213836_fix_same_org_trigger_order.sql for the canonical narrative):
-- Postgres fires BEFORE triggers in ALPHABETICAL ORDER by trigger NAME.
-- We name `spec_drafts_set_org` (s < v) and `spec_drafts_verify_same_org_check`
-- so the auto-fill trigger runs first and `organization_id` is populated
-- when the cross-tenant guard reads it.
--
-- Manual smoke tests after apply (run via psql as a real authenticated session):
--
--   -- 1) Same-org insert succeeds:
--   set role authenticated;
--   -- (as user in org A)
--   insert into public.spec_drafts (created_by) values ('<user-in-A>');
--   -- expect: success; organization_id auto-filled to A
--
--   -- 2) Cross-tenant insert fails:
--   insert into public.spec_drafts
--     (organization_id, created_by, client_id)
--     values ('<org-A>', '<user-in-A>', '<client-in-org-B>');
--   -- expect: ERROR 'cross-tenant FK guard: public.clients belongs to org <B>'
--
--   -- 3) Trigger ordering check:
--   select trigger_name from information_schema.triggers
--     where event_object_table = 'spec_drafts' order by trigger_name;
--   -- expect:
--   --   spec_drafts_bump_status_changed_at
--   --   spec_drafts_set_org
--   --   spec_drafts_set_updated_at
--   --   spec_drafts_verify_same_org_check
--
--   -- 4) 50k char transcript cap (D3-11):
--   insert into public.spec_drafts (created_by, transcript)
--     values ('<user>', repeat('x', 50001));
--   -- expect: ERROR 'new row for relation "spec_drafts" violates check constraint'

create type public.spec_draft_status as enum (
  'pending',
  'transcribing',
  'ready_for_review',
  'approved',
  'rejected',
  'failed'
);

create table public.spec_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  audio_storage_path text,
  audio_mime_type text,
  audio_duration_seconds integer,
  -- D3-11: cap transcript at 50 000 chars (typical spec call <= 15 min
  -- ~8k words ~50k chars). Defensive — the Inngest function truncates
  -- to 50_000 first for a friendlier UX, but the DB enforces correctness.
  transcript text check (transcript is null or char_length(transcript) <= 50000),
  structured_data jsonb not null default '{}',
  status public.spec_draft_status not null default 'pending',
  status_changed_at timestamptz not null default now(),
  parse_error text,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_job_id uuid references public.jobs(id) on delete set null,
  -- D3-30: rejected drafts are soft-deleted, then hard-deleted after 30
  -- days by a daily Inngest sweep. The status_changed_at column is the
  -- canonical "when was this rejected" anchor for the retention sweep.
  deleted_at timestamptz,
  whisper_cost_pence integer,
  sonnet_cost_pence integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spec_drafts_org_status_idx
  on public.spec_drafts (organization_id, status);
create index spec_drafts_created_by_idx
  on public.spec_drafts (created_by);

alter table public.spec_drafts enable row level security;

create policy "tenant select" on public.spec_drafts
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "tenant insert" on public.spec_drafts
  for insert to authenticated
  with check (organization_id = public.current_organization_id());

create policy "tenant update" on public.spec_drafts
  for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "tenant delete" on public.spec_drafts
  for delete to authenticated
  using (organization_id = public.current_organization_id());

-- Auto-fill organization_id from the auth context. RLS WITH CHECK still
-- enforces correctness for service-role inserts that pass org explicitly.
create trigger spec_drafts_set_org
  before insert on public.spec_drafts
  for each row execute function public.set_organization_id();

create trigger spec_drafts_set_updated_at
  before update on public.spec_drafts
  for each row execute function public.set_updated_at();

-- Bump status_changed_at whenever status changes — the retention sweep
-- (Task B.4) anchors its 30-day window on this column, not created_at.
create or replace function public.bump_status_changed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

create trigger spec_drafts_bump_status_changed_at
  before update of status on public.spec_drafts
  for each row execute function public.bump_status_changed_at();

-- Cross-tenant FK guard. Each FK is conditionally checked because client_id
-- and created_job_id are nullable. Trigger name MUST sort after `_set_org`
-- (v > s alphabetical) so it reads the auto-filled organization_id.
create or replace function public.spec_drafts_same_org_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- created_by is required — always check.
  perform public.assert_same_org(
    'public.users'::regclass, new.created_by, new.organization_id
  );
  if new.client_id is not null then
    perform public.assert_same_org(
      'public.clients'::regclass, new.client_id, new.organization_id
    );
  end if;
  if new.created_job_id is not null then
    perform public.assert_same_org(
      'public.jobs'::regclass, new.created_job_id, new.organization_id
    );
  end if;
  return new;
end;
$$;

create trigger spec_drafts_verify_same_org_check
  before insert or update of client_id, created_job_id, organization_id, created_by
  on public.spec_drafts
  for each row execute function public.spec_drafts_same_org_guard();
