-- Phase 4 / Plan 04-01 — voice-note-audio storage bucket.
--
-- Creates the private storage bucket for voice note audio recordings.
-- Mirrors 20260520003438_phase3_spec_audio_bucket.sql exactly — same
-- path convention, same RLS policy shape, same bucket settings.
--
-- Path convention: <org_id>/<user_id>/<voice_note_id>.<ext>
-- The org_id at index [1] is the tenant boundary check
-- (storage.foldername(name)[1] mirrors the spec-audio + cvs bucket pattern).
-- The Inngest function additionally enforces storage_path.startsWith(org_id)
-- before any service-role download — defence in depth.
--
-- Bucket is PRIVATE — Supabase Storage RLS only applies to private buckets.
-- 50 MiB ceiling — voice notes are short recordings (typically < 5 min),
-- well within the webm/opus limits at 32 kbps that the recompressor produces.
-- This is half the spec-audio ceiling because voice notes are dictation-length,
-- not full-hour spec calls.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-note-audio',
  'voice-note-audio',
  false,
  52428800,  -- 50 MiB (voice notes are short; spec-audio is 100 MiB)
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/ogg']
) on conflict (id) do nothing;

create policy "Tenant select own org voice note audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-note-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant insert into own org voice note audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-note-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant update own org voice note audio"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'voice-note-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  )
  with check (
    bucket_id = 'voice-note-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "Tenant delete own org voice note audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-note-audio'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
