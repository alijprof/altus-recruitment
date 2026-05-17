-- Supabase Storage bucket for candidate CVs, with path-prefixed RLS keyed by
-- the org id. Path convention: {org_id}/{candidate_id}/{uuid}-{slug}.{ext}.
-- storage.foldername(name) returns the path split into an array; [1] indexes
-- the first folder (1-indexed in Postgres).
--
-- Bucket is PRIVATE — Supabase Storage RLS does NOT apply to public buckets.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvs',
  'cvs',
  false,
  52428800, -- 50 MiB to match config.toml
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
) on conflict (id) do nothing;

create policy "Tenant select own org CVs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant insert into own org CVs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant update own org CVs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  )
  with check (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant delete own org CVs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cvs'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
