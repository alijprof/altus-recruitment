-- Phase 3 review CR-01 fix: enforce uniqueness of `linkedin_url` per
-- organisation so the concurrent-capture race collapses into a
-- deterministic 23505 unique-violation that `upsertCandidateFromLinkedIn`'s
-- existing dedup branch already handles. The previous advisory-lock
-- approach was non-functional (`pg_try_advisory_xact_lock` is not exposed
-- via PostgREST + xact-lock scope did not span the separate-transaction
-- upsert).
--
-- Trigger ordering precedent: Phase 1 commit `3f748f8` defined the
-- `_set_org` BEFORE `_verify_same_org_check` invariant (HARD RULE 3). This
-- migration adds an index only — no triggers — so ordering is not
-- relevant here, but the precedent is cited to preserve the audit chain.

create unique index if not exists candidates_linkedin_source_detail_uniq_idx
  on public.candidates (organization_id, source_detail)
  where source = 'linkedin' and source_detail is not null;

comment on index public.candidates_linkedin_source_detail_uniq_idx is
  'Plan 03-01 + CR-01 fix: one candidate per (org, linkedin_url) when source=linkedin. Converts concurrent-capture race into a deterministic 23505 that the upsert helper''s dedup branch resolves.';
