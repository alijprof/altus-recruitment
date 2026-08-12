-- Phase 8 / Plan 01 — org-logos private Storage bucket + organizations.logo_storage_path.
--
-- Logos are ORG-scoped, not candidate-scoped, so this is a dedicated
-- bucket rather than a new top-level exception inside the `cvs` bucket's
-- {org}/{candidate}/... path convention. Path convention:
-- {organization_id}/logo-{uuid}.{ext}.
--
-- Bucket is PRIVATE — Supabase Storage RLS does NOT apply to public
-- buckets, and every bucket in this project is private by deliberate
-- policy (see the header comment on 20260517204501_storage_cvs_bucket.sql).
--
-- PNG/JPEG only, no SVG: @react-pdf/renderer's Image component has no
-- native SVG rasterisation, so an SVG logo would silently vanish from the
-- branded PDF the moment it tries to embed it. 2 MiB is generous — a logo
-- is realistically KBs, not MBs.
--
-- organizations.logo_storage_path supersedes the legacy free-text
-- `logo_url` column (kept only for orgs that pasted an external URL before
-- Phase 8). Only a storage-backed logo is ever embedded in a branded PDF:
-- server-fetching an arbitrary external URL at render time is an SSRF
-- surface this project refuses to open.
--
-- Idempotent (on conflict do nothing / drop policy if exists / add column
-- if not exists) so a partially-applied branch can be safely re-pushed.
-- MIGRATION IS APPEND-ONLY — never edit this file once committed. Fix
-- schema issues in a new migration file with a later timestamp.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  false,
  2097152, -- 2 MiB — Storage-side mirror of the application-level cap in 08-05
  array['image/png', 'image/jpeg']
) on conflict (id) do nothing;

drop policy if exists "Tenant select own org logos" on storage.objects;
create policy "Tenant select own org logos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

drop policy if exists "Tenant insert into own org logos" on storage.objects;
create policy "Tenant insert into own org logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

drop policy if exists "Tenant update own org logos" on storage.objects;
create policy "Tenant update own org logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  )
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

drop policy if exists "Tenant delete own org logos" on storage.objects;
create policy "Tenant delete own org logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

alter table public.organizations
  add column if not exists logo_storage_path text;

comment on column public.organizations.logo_storage_path is
  'Path inside the private org-logos Storage bucket. Supersedes the legacy '
  'free-text logo_url column, which is retained only for orgs that pasted '
  'an external URL before Phase 8. Only a storage-backed logo is ever '
  'embedded in a branded PDF — server-fetching an arbitrary external URL '
  'at render time is an SSRF surface this project refuses to open.';
