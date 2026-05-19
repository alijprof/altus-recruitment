-- outlook_credentials — per-recruiter Microsoft 365 OAuth state.
--
-- D2-15..D2-19 (Outlook variant, locked 2026-05-19): single-tenant Entra
-- app, Mail.Read + offline_access + User.Read scopes, Graph change-
-- notification webhooks, delta-query sync, ~3-day subscription cap with
-- 6-hourly renewal.
--
-- Token columns are CIPHERTEXT — base64-packed iv:tag:ciphertext strings
-- produced by src/lib/encryption.ts. Plaintext never lands in this table.
--
-- NO cross-tenant FK guard trigger: the only FK is `user_id -> users(id)`,
-- and users are already tenant-scoped via organization_id. RLS gates
-- reads on `user_id = auth.uid()`, which is strictly stronger than a
-- per-org guard (each user can only see their own mailbox). D2-20
-- documents the exemption.
--
-- Plan 4 will additively add columns for renewal-failure tracking
-- (last_renewal_error, last_renewal_attempt_at) — out of scope here,
-- flagged for cross-plan visibility.
--
-- Manual smoke tests after apply:
--
--   -- 1) RLS scope (as user U in org A):
--   select * from public.outlook_credentials;
--   -- expect: only rows where user_id = U.id
--
--   -- 2) Cross-user query:
--   select * from public.outlook_credentials where user_id = '<other-user>';
--   -- expect: 0 rows (RLS-filtered)
--
--   -- 3) Unique on user_id (one Outlook account per recruiter):
--   insert into public.outlook_credentials
--     (user_id, microsoft_tenant_id, microsoft_user_id, microsoft_email)
--     values (auth.uid(), '<same-tenant>', '<same-user-id>',
--             'a@b.com');
--   insert into public.outlook_credentials
--     (user_id, microsoft_tenant_id, microsoft_user_id, microsoft_email)
--     values (auth.uid(), '<same-tenant>', '<same-user-id>',
--             'a@b.com');
--   -- expect: second insert fails with unique-constraint violation

create table public.outlook_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  -- Microsoft identity. Tenant + user IDs are stable across renames.
  microsoft_tenant_id uuid not null,
  microsoft_user_id uuid not null,
  microsoft_email text not null,           -- denormalised; used for webhook lookup

  -- Encrypted OAuth tokens. Format: iv_b64:authTag_b64:ciphertext_b64.
  access_token_encrypted text,
  access_token_expires_at timestamptz,
  refresh_token_encrypted text,            -- sliding 90-day expiry; rotates on each refresh
  scopes text[] not null default '{Mail.Read,offline_access,User.Read}',
  encryption_key_version smallint not null default 1,

  -- Microsoft Graph subscription state.
  subscription_id text,                    -- Graph subscription resource id
  subscription_client_state text,          -- per-subscription HMAC-derived secret
  subscription_expires_at timestamptz,     -- ≤ 4230 min from creation; renewed every 6h
  subscription_resource text default 'me/mailFolders(''Inbox'')/messages',

  -- Delta sync cursor.
  delta_link text,                         -- @odata.deltaLink; null = full resync needed

  revoked_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One mailbox per recruiter. Phase 5 SaaS shell may lift this for
  -- recruiters spanning multiple orgs.
  unique (user_id)
);

create index outlook_credentials_organization_id_idx
  on public.outlook_credentials (organization_id);
create index outlook_credentials_subscription_id_idx
  on public.outlook_credentials (subscription_id)
  where subscription_id is not null;

alter table public.outlook_credentials enable row level security;

-- RLS: every row is owned by exactly one user. Insert + select + update +
-- delete all gate on `user_id = auth.uid()`. Insert additionally checks
-- organization_id matches the session's org (the set_org trigger fills it,
-- but the WITH CHECK is defence-in-depth).
create policy "owner select" on public.outlook_credentials
  for select to authenticated
  using (user_id = auth.uid());

create policy "owner insert" on public.outlook_credentials
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and organization_id = public.current_organization_id()
  );

create policy "owner update" on public.outlook_credentials
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "owner delete" on public.outlook_credentials
  for delete to authenticated
  using (user_id = auth.uid());

-- Triggers: fill organization_id + maintain updated_at. No cross-tenant
-- FK guard required (see header).
create trigger outlook_credentials_set_org
  before insert on public.outlook_credentials
  for each row execute function public.set_organization_id();

create trigger outlook_credentials_set_updated_at
  before update on public.outlook_credentials
  for each row execute function public.set_updated_at();
