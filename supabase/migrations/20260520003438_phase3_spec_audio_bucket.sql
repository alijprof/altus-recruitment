-- Supabase Storage bucket for spec-call audio recordings, with path-prefixed
-- RLS keyed by the org id. Mirrors 20260517204501_storage_cvs_bucket.sql.
--
-- Path convention: <org_id>/<user_id>/<draft_id>.<ext>
-- The org_id at index [1] means storage.foldername(name)[1] is the tenant
-- boundary check (mirrors how the cvs bucket works). The Inngest function
-- additionally enforces storage_path.startsWith(`${org_id}/`) before any
-- service-role download — defence in depth against forged events.
--
-- Bucket is PRIVATE — Supabase Storage RLS only applies to private buckets.
-- 100 MiB ceiling per D3-06 (spec calls are typically 5-20 min; 100 MiB
-- comfortably covers an hour of lightly-compressed audio).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'spec-audio',
  'spec-audio',
  false,
  104857600, -- 100 MiB per D3-06
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm']
) on conflict (id) do nothing;

create policy "Tenant select own org spec audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'spec-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant insert into own org spec audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'spec-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant update own org spec audio"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'spec-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  )
  with check (
    bucket_id = 'spec-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant delete own org spec audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'spec-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
