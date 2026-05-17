-- Rewrite handle_new_user() so it honours invitation flows.
--
-- When auth.admin.inviteUserByEmail() is called with
--   `data: { invited_to_org: <uuid>, full_name: <text> }`,
-- the new auth.users row carries that data in raw_user_meta_data. The trigger
-- detects it and inserts the user into the inviting organization as a
-- 'recruiter' instead of creating a brand-new org.
--
-- The early-return guard (`if exists … return new`) remains to support legacy
-- pre-insert flows. Normal sign-up (no invited_to_org) creates a new org as
-- before.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invited_org uuid;
  v_org_id uuid;
  v_org_name text;
  v_slug_base text;
  v_full_name text;
begin
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  v_invited_org := nullif(new.raw_user_meta_data->>'invited_to_org', '')::uuid;

  if v_invited_org is not null then
    -- Invitation flow: attach to the inviting org as recruiter (not owner).
    v_full_name := nullif(new.raw_user_meta_data->>'full_name', '');
    insert into public.users (id, organization_id, email, full_name, role)
    values (new.id, v_invited_org, new.email, v_full_name, 'recruiter');
    return new;
  end if;

  -- Normal sign-up flow: create new org.
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
