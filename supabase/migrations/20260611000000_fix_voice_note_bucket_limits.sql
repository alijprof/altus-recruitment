-- Phase 4 review fix CR-01 — align voice-note-audio bucket with the upload action.
--
-- The submit action (submitVoiceNoteAction) validates MAX_AUDIO_BYTES = 100 MiB
-- and accepts the MIME variants audio/mp3, audio/wave, audio/x-wav, but the
-- bucket created in 20260610000100 capped file_size_limit at 50 MiB and omitted
-- those MIME aliases. Files that pass action validation then fail at Storage
-- (413/415) with a dead-end retry loop.
--
-- This migration makes the bucket agree with the action:
--   - file_size_limit 104857600 (100 MiB) = MAX_AUDIO_BYTES
--   - allowed_mime_types = exactly the action's ACCEPTED_AUDIO_MIME set
--     (drops audio/ogg, which the action never accepts)
--
-- Append-only fix: 20260610000100 is committed and must not be edited.

update storage.buckets
set file_size_limit = 104857600,  -- 100 MiB — matches MAX_AUDIO_BYTES in the action
    allowed_mime_types = array[
      'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
      'audio/aac', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm'
    ]
where id = 'voice-note-audio';
