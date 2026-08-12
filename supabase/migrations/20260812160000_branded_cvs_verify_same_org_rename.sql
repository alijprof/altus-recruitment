-- Phase 8 review RESID-01 (BLOCKER, re-review 2026-08-12) — rename the
-- candidate_branded_cvs cross-tenant FK guard trigger so it fires AFTER
-- candidate_branded_cvs_set_org, not before it.
--
-- 20260812150000_branded_cvs_same_org_guard.sql (committed, append-only —
-- see the append-only rule below, do NOT edit that file) installed the
-- guard trigger as `candidate_branded_cvs_same_org_check`. Postgres fires
-- same-timing (BEFORE INSERT) triggers in alphabetical order by trigger
-- NAME, and `..._same_org_check` sorts BEFORE `..._set_org` ("same" <
-- "set"). The guard therefore ran while NEW.organization_id was still
-- NULL. assert_same_org() (20260517204500) raises whenever the parent's
-- org `is distinct from` the child's — `<uuid> is distinct from NULL` is
-- true — so the guard would have raised on EVERY insert once pushed.
-- upsertBrandedCv (src/lib/db/candidate-branded-cvs.ts) deliberately never
-- supplies organization_id itself; it relies entirely on the set_org
-- trigger to fill it. Net effect: branded-CV generation would have failed
-- 100% of the time, for every tenant, from the first click after the push.
--
-- This repo has hit this EXACT bug before and already carries the fix on
-- record: 20260518213836_fix_same_org_trigger_order.sql renamed the
-- original contacts/jobs/applications/candidate_cvs guards from
-- `<table>_same_org_check` to `<table>_verify_same_org_check` ('v' > 's',
-- so it sorts AFTER `<table>_set_org`) — see that file's header for the
-- full incident writeup. 20260812150000 was written by copying the
-- PRE-FIX precedent migration (20260518211005) verbatim, including the
-- exact trigger name that 20260518213836 exists to retire. Every table
-- added to this project since 20260518213836 (ai_summaries, spec_drafts,
-- job_ads) already uses the correct `verify_same_org_check` name from
-- creation — candidate_branded_cvs is the one regression.
--
-- 20260812150000 is committed and append-only — it must NOT be edited.
-- This migration corrects the trigger name in a new, separate file, per
-- the project's append-only migration convention. The trigger FUNCTION
-- (public.candidate_branded_cvs_same_org_guard(), defined in 20260812150000)
-- is UNCHANGED and reused as-is here — only the trigger NAME (and its
-- create/drop statements) moves. Same assert_same_org() body, same BEFORE
-- INSERT OR UPDATE OF candidate_id, organization_id timing.
--
-- Idempotent: drops both the old (bad) name and the new (correct) name
-- before recreating, so a partially-applied branch or a repeat push is
-- safe either way. MUST land in the same `db push` as 20260812120000 /
-- 20260812120100 / 20260812150000 so the "table + guard exist, guard
-- fires correctly" window is never split across separate production
-- deploys.
--
-- ---------------------------------------------------------------------------
-- Manual SQL smoke test (run against a database with the Phase 8 migrations
-- applied, two orgs A and B, one candidate in B, and an authenticated
-- session for org A):
--
--   -- negative test: cross-tenant insert must still be rejected
--   insert into public.candidate_branded_cvs
--     (organization_id, candidate_id, storage_path)
--   values
--     ('<org-A-uuid>', '<candidate-in-org-B-uuid>', 'org-A/candidate-in-B/branded-cv-x.pdf');
--   -- expected: ERROR: cross-tenant FK guard: public.candidates belongs to
--   --           org <B>, expected <A>
--
--   -- positive test: a same-org insert must now succeed (this is the case
--   -- that was broken before this migration — NEW.organization_id was NULL
--   -- when the guard ran, so even a correct, same-org insert raised)
--   insert into public.candidate_branded_cvs (candidate_id, storage_path)
--   values ('<candidate-in-org-A-uuid>', 'org-A/candidate-in-A/branded-cv-x.pdf');
--   -- expected: success — set_org fills organization_id BEFORE the guard
--   --           now runs, so assert_same_org sees a real, matching org.
-- ---------------------------------------------------------------------------

drop trigger if exists candidate_branded_cvs_same_org_check
  on public.candidate_branded_cvs;
drop trigger if exists candidate_branded_cvs_verify_same_org_check
  on public.candidate_branded_cvs;
create trigger candidate_branded_cvs_verify_same_org_check
  before insert or update of candidate_id, organization_id on public.candidate_branded_cvs
  for each row execute function public.candidate_branded_cvs_same_org_guard();
