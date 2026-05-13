-- Initial schema: organizations + users.
-- Multi-tenancy foundation. Every domain table added in Task 2 will reference
-- organizations(id) and gate RLS on current_organization_id().

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- users (app-facing; mirrors auth.users 1:1 and links to an organization)
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'admin', 'recruiter');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email text not null,
  full_name text,
  role public.user_role not null default 'recruiter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_organization_id_idx on public.users (organization_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenant resolution helper. Every RLS policy in this project goes through this.
-- SECURITY DEFINER so it can read public.users without triggering its own RLS
-- (otherwise we'd have a recursive policy evaluation).
-- ---------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.users where id = auth.uid()
$$;

revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.users enable row level security;

-- organizations: members can read; owners can update.
create policy "members read own organization"
  on public.organizations
  for select
  to authenticated
  using (id = public.current_organization_id());

create policy "owners update own organization"
  on public.organizations
  for update
  to authenticated
  using (
    id = public.current_organization_id()
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'owner'
    )
  )
  with check (id = public.current_organization_id());

-- users: members can read others in their org. A user can update their own row.
-- Insert is performed by the auth trigger (security definer), not by clients.
create policy "members read org users"
  on public.users
  for select
  to authenticated
  using (organization_id = public.current_organization_id());

create policy "self update"
  on public.users
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and organization_id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- Auth trigger: on auth.users insert, create the org + the public.users row.
-- Reads organization_name / full_name from raw_user_meta_data so the sign-up
-- flow can pass them through Supabase Auth's signInWithOtp options.data.
--
-- Idempotent on retry — if the user metadata is missing organization_name
-- (e.g. invitation flow added later), the trigger falls back to the email.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org_id uuid;
  v_org_name text;
  v_slug_base text;
  v_full_name text;
begin
  -- If this auth.users row was created as part of an invitation flow, the app
  -- will have already inserted into public.users; do nothing.
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  v_org_name := coalesce(
    nullif(new.raw_user_meta_data->>'organization_name', ''),
    new.email
  );
  v_full_name := nullif(new.raw_user_meta_data->>'full_name', '');

  v_slug_base := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(both '-' from v_slug_base);
  if v_slug_base = '' then
    v_slug_base := 'org';
  end if;

  insert into public.organizations (name, slug)
  values (
    v_org_name,
    v_slug_base || '-' || substr(replace(new.id::text, '-', ''), 1, 8)
  )
  returning id into v_org_id;

  insert into public.users (id, organization_id, email, full_name, role)
  values (new.id, v_org_id, new.email, v_full_name, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
