-- Phase 3 / Plan 03-05 / Task E.2 — D3-21.
--
-- Add 'email_draft' to public.activity_kind so the dormant-outreach drafter
-- can log the Sonnet-generated draft as an activity row (D3-21: drafted
-- email is logged whether or not it is ultimately sent — useful for the
-- retro on outreach hit rate).
--
-- Sequence at runtime:
--   1. Inngest `draft-outreach-email` function inserts an activities row
--      with kind='email_draft' on the company entity, body=subject,
--      metadata={ subject, body_html, draft_for_client_id }.
--   2. The modal polls for the latest email_draft row for the client,
--      renders it editable, recruiter clicks "Send via Outlook".
--   3. sendOutreachAction flips the same row to kind='email', adds
--      metadata.sent_at = now() (D3-21).
--
-- Postgres requires the new enum value to be visible across a COMMIT
-- boundary before any DML that references it can run — that constraint is
-- naturally satisfied here because the helper inserting 'email_draft' rows
-- ships in a later transaction (separate migration would be needed if we
-- inserted such a row in this file). Mirrors the
-- 20260520010418_phase3_application_type_shortlist.sql header note.

alter type public.activity_kind add value if not exists 'email_draft';

comment on type public.activity_kind is
  'Activity kinds: note, call, email, meeting, stage_change, system, email_draft '
  '(Phase 3 / D3-21 — Sonnet draft of an outbound email, may be promoted '
  'to ''email'' once recruiter sends).';
