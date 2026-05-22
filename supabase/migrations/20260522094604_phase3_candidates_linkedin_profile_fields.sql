-- Phase 3 follow-up: surface LinkedIn-captured profile fields on the candidate row.
--
-- Context: Plan 03-01 (D3-26) deliberately skipped schema migrations and
-- stashed only the structured-CRM fields (name, location, role, company,
-- skills) from a LinkedIn capture. The biographical/long-form fields
-- (headline, about, work_experience, education) were dropped on the floor by
-- upsertCandidateFromLinkedIn. UAT revealed the recruiter needs all of these
-- visible on the candidate page, so this migration adds the missing columns.
--
-- Shape:
--   - headline / about: free text. Headline ≤ 300 chars and about ≤ 5000 in
--     the validation schema; we don't add CHECK constraints here because the
--     route already enforces caps and a future ingest path (e.g., CV review)
--     might emit longer values.
--   - work_experience / education: jsonb arrays. We avoid creating join tables
--     because (a) we don't query into individual entries today, (b) the
--     LinkedIn shape is best-effort and may carry partial data, and (c) it
--     matches the candidate_cvs.extracted_data convention.
--
-- RLS: no policy changes needed. The existing tenant policy on `candidates`
-- (`organization_id = current_organization_id()`) covers the new columns.

alter table public.candidates
  add column if not exists headline text,
  add column if not exists about text,
  add column if not exists work_experience jsonb not null default '[]'::jsonb,
  add column if not exists education jsonb not null default '[]'::jsonb;

comment on column public.candidates.headline is
  'Short professional headline (≤300 chars in app). Sourced from LinkedIn capture or manual edit.';
comment on column public.candidates.about is
  'Long-form biographical/about text (≤5000 chars in app). Sourced from LinkedIn or CV.';
comment on column public.candidates.work_experience is
  'jsonb array of { title, company, dates } entries. Best-effort capture from LinkedIn.';
comment on column public.candidates.education is
  'jsonb array of { school, degree, dates } entries. Best-effort capture from LinkedIn.';
