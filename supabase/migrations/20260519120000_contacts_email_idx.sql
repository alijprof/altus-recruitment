-- Plan 4 Task 4.3 — fast exact-email lookup on contacts for the Outlook
-- sync function.
--
-- candidates already has `candidates_email_idx (organization_id, email)`
-- from the Phase 1 schema. contacts didn't get the same treatment
-- because Phase 1 had no caller that looked up contacts by email — the
-- Plan 4 sync function is the first one.
--
-- We index `lower(email)` to support case-insensitive lookup; the
-- Outlook sync normalises to lowercase before query, so the planner
-- can use the index for the `ilike` path.

create index if not exists contacts_email_idx
  on public.contacts (organization_id, lower(email));
