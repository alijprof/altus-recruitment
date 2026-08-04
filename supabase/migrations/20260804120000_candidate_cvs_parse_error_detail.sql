-- candidate_cvs.parse_error_detail — durable root-cause capture for CV
-- parse failures (SF-1, 2026-07-31 Steele Charles feature review).
--
-- The existing `parse_error` column holds the honest, recruiter-FACING
-- copy (e.g. "This PDF has no extractable text..."). This column holds a
-- PII-free TECHNICAL cause for support/debugging: error name/status, the
-- extracted-text char COUNT, and the mime type — NEVER extracted CV text,
-- never a candidate name or email. It is recruiter-invisible; no UI reads
-- it. Same PII discipline as the app's Sentry captures (R4: never pass a
-- raw error object — only name/status).
--
-- FILE ONLY. Per project hard rules, this migration is NOT applied by the
-- executor — the founder pushes it manually via
-- `pnpm exec supabase db push --linked`. The application code that writes
-- this column (src/lib/db/candidate-cvs.ts updateCandidateCVParse) is
-- defensive: it degrades gracefully with a PGRST204 fallback when this
-- column hasn't reached production yet, so code can deploy ahead of this
-- migration with no user-facing regression.
--
-- No RLS change — inherits candidate_cvs' existing tenant policies.

alter table public.candidate_cvs
  add column if not exists parse_error_detail text;

comment on column public.candidate_cvs.parse_error_detail is
  'PII-free technical root cause for a failed parse (error name/status, '
  'extracted-text char count, mime type). Never CV text or candidate PII. '
  'Recruiter-invisible — support/debugging only. See parse_error for the '
  'recruiter-facing message.';
