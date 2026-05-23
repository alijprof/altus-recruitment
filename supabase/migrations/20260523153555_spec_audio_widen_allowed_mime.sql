-- Widen `spec-audio` bucket's allowed_mime_types to handle the variants
-- browsers and recorder apps actually emit:
--   - macOS Voice Memos saves .m4a as `audio/x-m4a`, not the canonical
--     `audio/mp4`.
--   - some MP3 encoders emit `audio/mp3` instead of `audio/mpeg`.
--   - .wav can land as `audio/x-wav` or `audio/wave`.
--   - .m4a sometimes lands as `audio/m4a` or `audio/aac`.
--
-- These are the same audio containers — Whisper handles each natively;
-- the only thing the bucket policy needed was permission to receive
-- them. The application-side upload validator (submitSpecCallAction)
-- and the whisper.ts decoder map were widened in the same change.
--
-- This is a single-row UPDATE on the buckets row inserted by
-- 20260520003438_phase3_spec_audio_bucket.sql. Safe to re-run.

update storage.buckets
set allowed_mime_types = array[
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm'
]
where id = 'spec-audio';
