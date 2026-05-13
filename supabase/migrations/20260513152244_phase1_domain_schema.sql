-- Phase 1 domain schema. Builds on 20260513151021 (organizations + users).
-- Every domain table here is tenant-scoped via organization_id and protected
-- by RLS gated on current_organization_id().

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "vector";   -- pgvector (provides halfvec from 0.7+)
create extension if not exists "pg_trgm";  -- trigram indexes for keyword search

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.market_status as enum (
  'actively_looking',
  'passively_looking',
  'hot',
  'placed',
  'cold'
);

create type public.candidate_source as enum (
  'apply_form',
  'linkedin',
  'referral',
  'email_inbox',
  'event',
  'direct_add',
  'other'
);

create type public.consent_basis as enum ('consent', 'legitimate_interest');

create type public.cv_parsing_status as enum ('pending', 'complete', 'failed');

create type public.job_type as enum ('perm', 'contract', 'temp');

create type public.hiring_context as enum ('new_role', 'backfill');

create type public.job_status as enum ('draft', 'open', 'on_hold', 'filled', 'cancelled');

create type public.application_stage as enum (
  'applied',
  'screening',
  'cv_submitted',
  'first_interview',
  'second_interview',
  'offer',
  'placed',
  'rejected',
  'withdrawn'
);

create type public.application_type as enum ('standard', 'spec', 'float');

create type public.decline_reason as enum (
  'not_qualified',
  'salary_mismatch',
  'location_mismatch',
  'candidate_withdrew',
  'client_rejected_skills',
  'client_rejected_culture',
  'client_filled_internally',
  'client_filled_other',
  'other'
);

create type public.activity_kind as enum (
  'note',
  'call',
  'email',
  'meeting',
  'stage_change',
  'system'
);

create type public.audit_action as enum ('view', 'create', 'update', 'delete', 'export');

-- ---------------------------------------------------------------------------
-- Helpers (RLS + insert defaults)
-- ---------------------------------------------------------------------------

-- Trigger function: default organization_id from the auth context on insert
-- whenever the column is left NULL. Saves app code from threading the id
-- through every insert; RLS WITH CHECK still enforces correctness.
create or replace function public.set_organization_id()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is null then
    new.organization_id := public.current_organization_id();
  end if;
  if new.organization_id is null then
    raise exception 'organization_id is required and could not be resolved from auth context';
  end if;
  return new;
end;
$$;

-- Security-definer writer for audit_log so app code goes through one path and
-- clients can't forge rows. Authenticated users can write only against their
-- own org (we read current_organization_id() server-side).
create or replace function public.record_audit(
  p_action public.audit_action,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_id uuid;
begin
  if v_org_id is null then
    raise exception 'record_audit called outside an authenticated org context';
  end if;
  insert into public.audit_log (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- Security-definer writer for ai_usage so background jobs (Inngest functions
-- using the service role) and app code both go through one path.
create or replace function public.record_ai_usage(
  p_organization_id uuid,
  p_model text,
  p_purpose text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_pence integer,
  p_latency_ms integer default null,
  p_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ai_usage
    (organization_id, user_id, model, purpose, input_tokens, output_tokens, cost_pence, latency_ms)
  values
    (p_organization_id, p_user_id, p_model, p_purpose, p_input_tokens, p_output_tokens, p_cost_pence, p_latency_ms)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  industry text,
  website text,
  notes text,
  last_contacted_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_organization_id_idx on public.companies (organization_id);
create index companies_name_trgm_idx on public.companies using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  role_title text,
  email text,
  phone text,
  notes text,
  last_contacted_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_organization_id_idx on public.contacts (organization_id);
create index contacts_company_id_idx on public.contacts (company_id);

-- ---------------------------------------------------------------------------
-- candidates
-- ---------------------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  location text,
  current_role_title text,
  current_company text,
  market_status public.market_status not null default 'passively_looking',
  market_status_at timestamptz not null default now(),
  source public.candidate_source not null default 'direct_add',
  source_detail text,
  referrer_candidate_id uuid references public.candidates(id) on delete set null,
  salary_current_estimate integer,
  salary_expectation integer,
  currency text not null default 'GBP',
  seniority_level text,
  years_experience numeric(4, 1),
  sector_tags text[] not null default '{}',
  skills text[] not null default '{}',
  -- GDPR
  consent_basis public.consent_basis,
  consent_at timestamptz,
  consent_text_version text,
  -- Search (populated in Phase 2)
  candidate_embedding halfvec(1024),
  embedding_version integer,
  embedded_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidates_organization_id_idx on public.candidates (organization_id);
create index candidates_full_name_trgm_idx on public.candidates using gin (full_name gin_trgm_ops);
create index candidates_email_idx on public.candidates (organization_id, email);
create index candidates_market_status_idx on public.candidates (organization_id, market_status);
-- Vector index is added once data is populated in Phase 2 (HNSW build cost
-- is meaningful and pointless on an empty table).

-- ---------------------------------------------------------------------------
-- candidate_cvs (file metadata + AI-extracted fields + version history)
-- ---------------------------------------------------------------------------
create table public.candidate_cvs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint,
  version integer not null,
  parsing_status public.cv_parsing_status not null default 'pending',
  parse_error text,
  extracted_data jsonb,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, version)
);

create index candidate_cvs_organization_id_idx on public.candidate_cvs (organization_id);
create index candidate_cvs_candidate_id_idx on public.candidate_cvs (candidate_id);

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  owner_user_id uuid references public.users(id) on delete set null,
  title text not null,
  location text,
  job_type public.job_type not null default 'perm',
  hiring_context public.hiring_context not null default 'new_role',
  status public.job_status not null default 'draft',
  description text,
  salary_min integer,
  salary_max integer,
  day_rate_min integer,
  day_rate_max integer,
  currency text not null default 'GBP',
  fee_percent numeric(5, 2),
  -- Search (populated in Phase 2)
  job_embedding halfvec(1024),
  embedding_version integer,
  embedded_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_organization_id_idx on public.jobs (organization_id);
create index jobs_company_id_idx on public.jobs (company_id);
create index jobs_title_trgm_idx on public.jobs using gin (title gin_trgm_ops);
create index jobs_status_idx on public.jobs (organization_id, status);

-- ---------------------------------------------------------------------------
-- applications (candidate ↔ job junction)
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stage public.application_stage not null default 'applied',
  application_type public.application_type not null default 'standard',
  stage_changed_at timestamptz not null default now(),
  decline_reason public.decline_reason,
  decline_notes text,
  declined_at timestamptz,
  owner_user_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_id, application_type),
  constraint decline_reason_present_when_terminal
    check (
      (stage in ('rejected', 'withdrawn') and decline_reason is not null)
      or (stage not in ('rejected', 'withdrawn'))
    )
);

create index applications_organization_id_idx on public.applications (organization_id);
create index applications_candidate_id_idx on public.applications (candidate_id);
create index applications_job_id_idx on public.applications (job_id);
create index applications_stage_idx on public.applications (organization_id, stage);

-- ---------------------------------------------------------------------------
-- activities (polymorphic timeline)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.activity_kind not null,
  body text,
  actor_user_id uuid references public.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activities_entity_type_valid
    check (entity_type in ('candidate', 'company', 'contact', 'job', 'application'))
);

create index activities_organization_id_idx on public.activities (organization_id);
create index activities_entity_idx on public.activities (entity_type, entity_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- audit_log (append-only, written via record_audit())
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  action public.audit_action not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index audit_log_org_entity_idx
  on public.audit_log (organization_id, entity_type, entity_id, at desc);
create index audit_log_actor_idx on public.audit_log (organization_id, actor_user_id, at desc);

-- ---------------------------------------------------------------------------
-- ai_usage (per-tenant cost ledger; written via record_ai_usage())
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  model text not null,
  purpose text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_pence integer not null,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index ai_usage_org_created_idx on public.ai_usage (organization_id, created_at desc);
create index ai_usage_org_purpose_idx on public.ai_usage (organization_id, purpose, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at + set_organization_id triggers
-- ---------------------------------------------------------------------------
create trigger companies_set_org before insert on public.companies
  for each row execute function public.set_organization_id();
create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

create trigger contacts_set_org before insert on public.contacts
  for each row execute function public.set_organization_id();
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

create trigger candidates_set_org before insert on public.candidates
  for each row execute function public.set_organization_id();
create trigger candidates_set_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();

create trigger candidate_cvs_set_org before insert on public.candidate_cvs
  for each row execute function public.set_organization_id();
create trigger candidate_cvs_set_updated_at before update on public.candidate_cvs
  for each row execute function public.set_updated_at();

create trigger jobs_set_org before insert on public.jobs
  for each row execute function public.set_organization_id();
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

create trigger applications_set_org before insert on public.applications
  for each row execute function public.set_organization_id();
create trigger applications_set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();

create trigger activities_set_org before insert on public.activities
  for each row execute function public.set_organization_id();

-- audit_log and ai_usage are written via security-definer functions, so a
-- before-insert trigger isn't needed and would mask a misuse.

-- ---------------------------------------------------------------------------
-- RLS
--
-- One repeating pattern across all tenant tables:
--   select / insert / update / delete gated on organization_id = current_organization_id().
-- audit_log and ai_usage are read-only from the client; writes happen via
-- security-definer functions only.
-- ---------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_cvs enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.activities enable row level security;
alter table public.audit_log enable row level security;
alter table public.ai_usage enable row level security;

-- companies
create policy "tenant select" on public.companies for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.companies for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.companies for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.companies for delete to authenticated
  using (organization_id = public.current_organization_id());

-- contacts
create policy "tenant select" on public.contacts for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.contacts for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.contacts for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.contacts for delete to authenticated
  using (organization_id = public.current_organization_id());

-- candidates
create policy "tenant select" on public.candidates for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.candidates for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.candidates for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.candidates for delete to authenticated
  using (organization_id = public.current_organization_id());

-- candidate_cvs
create policy "tenant select" on public.candidate_cvs for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.candidate_cvs for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.candidate_cvs for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.candidate_cvs for delete to authenticated
  using (organization_id = public.current_organization_id());

-- jobs
create policy "tenant select" on public.jobs for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.jobs for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.jobs for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.jobs for delete to authenticated
  using (organization_id = public.current_organization_id());

-- applications
create policy "tenant select" on public.applications for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.applications for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.applications for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.applications for delete to authenticated
  using (organization_id = public.current_organization_id());

-- activities
create policy "tenant select" on public.activities for select to authenticated
  using (organization_id = public.current_organization_id());
create policy "tenant insert" on public.activities for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy "tenant update" on public.activities for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
create policy "tenant delete" on public.activities for delete to authenticated
  using (organization_id = public.current_organization_id());

-- audit_log: read for own org; writes only via record_audit() security definer
create policy "tenant select" on public.audit_log for select to authenticated
  using (organization_id = public.current_organization_id());

-- ai_usage: read for own org; writes only via record_ai_usage() security definer
create policy "tenant select" on public.ai_usage for select to authenticated
  using (organization_id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function public.record_audit(public.audit_action, text, uuid, jsonb) from public;
grant execute on function public.record_audit(public.audit_action, text, uuid, jsonb) to authenticated;

-- record_ai_usage takes an explicit organization_id and is intended to be
-- called from background jobs running under the service role. We DO NOT grant
-- execute to authenticated to prevent an end user from logging usage against
-- another org.
revoke all on function public.record_ai_usage(uuid, text, text, integer, integer, integer, integer, uuid) from public;
grant execute on function public.record_ai_usage(uuid, text, text, integer, integer, integer, integer, uuid) to service_role;
