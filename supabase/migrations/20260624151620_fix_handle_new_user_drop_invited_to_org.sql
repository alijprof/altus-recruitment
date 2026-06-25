-- Handover security blocker 1 — remove the client-trusted invited_to_org
-- branch from handle_new_user (cross-tenant self-join back door).
--
-- WHY THIS IS A BACK DOOR
-- The body installed by 20260517204503 attached a brand-new auth user to an
-- arbitrary organization as 'recruiter' whenever raw_user_meta_data carried an
-- `invited_to_org` UUID. That metadata is CLIENT-CONTROLLED: supabase-js
-- signInWithOtp/signUp let the caller put anything in options.data, and it
-- lands verbatim in auth.users.raw_user_meta_data. The server-side path that
-- used to set invited_to_org (auth.admin.inviteUserByEmail) was retired in
-- favour of the email-matched public.accept_invitation() RPC (20260524000100).
-- No application code sets invited_to_org any longer (verified by grep across
-- src/). The branch is therefore dead code that functions purely as a back
-- door: anyone who learns an org's UUID — e.g. one leaked by the public
-- apply-form response — can sign up with that UUID in their metadata and land
-- silently inside that org as a recruiter, reading every candidate, CV and
-- client. RLS is intact; this defeats tenant isolation at the provisioning
-- layer, beneath RLS.
--
-- FIX
-- handle_new_user now ALWAYS creates a fresh organization with the new user as
-- 'owner'. The real invitation flow is unaffected: an invited user signs in
-- (this trigger creates a throwaway org for them), then /auth/callback calls
-- public.accept_invitation(), which moves them into the inviting org and (data
-- permitting) cleans up the throwaway org. The early-return guard is preserved
-- so the trigger stays idempotent.
--
-- Append-only; supersedes the function body from 20260517204503. The
-- on_auth_user_created trigger binding is unchanged (CREATE OR REPLACE keeps
-- the existing trigger attached).

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
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  -- Org membership is NEVER taken from client-supplied signup metadata.
  -- Every new auth user gets a fresh org as 'owner'. Joining an existing org
  -- happens only via public.accept_invitation() (email-matched, service_role
  -- only) AFTER this trigger runs.
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
