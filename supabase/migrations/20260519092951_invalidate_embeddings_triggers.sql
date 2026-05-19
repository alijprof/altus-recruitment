-- Re-embedding invalidation triggers for candidates + jobs.
--
-- When a column that feeds the embedding-input text changes, NULL out the
-- existing embedding so the scheduled `embed-candidates-batch` /
-- `embed-jobs-batch` sweep (Plan 1) picks the row up on its next run.
--
-- embedding_version is NOT decremented here — the re-embed job is
-- responsible for bumping it on the next write. Setting it from null →
-- next-value lets `ai_summaries` cache-key invalidation (D2-07) fire
-- automatically without an explicit cache wipe.
--
-- The trigger functions check `is distinct from` (not `<>`), so they
-- correctly handle null↔value transitions on either side.
--
-- Manual smoke tests after apply:
--
--   -- 1) Candidate field update invalidates:
--   update public.candidates
--     set current_role_title = current_role_title || ' (test)'
--     where id = '<a-candidate-with-an-embedding>';
--   select candidate_embedding, embedded_at from public.candidates
--     where id = '<that-id>';
--   -- expect: both columns NULL
--
--   -- 2) Unrelated update DOES NOT invalidate:
--   update public.candidates set phone = 'new-phone'
--     where id = '<a-candidate-with-an-embedding>';
--   -- expect: candidate_embedding still populated (phone isn't in the
--   --         embedding-input text)
--
--   -- 3) Same for jobs:
--   update public.jobs set description = description || ' (test)'
--     where id = '<a-job-with-an-embedding>';
--   select job_embedding, embedded_at from public.jobs
--     where id = '<that-id>';
--   -- expect: both NULL

create or replace function public.invalidate_candidate_embedding()
returns trigger
language plpgsql
as $$
begin
  if (
    new.current_role_title is distinct from old.current_role_title
    or new.current_company is distinct from old.current_company
    or new.skills is distinct from old.skills
    or new.seniority_level is distinct from old.seniority_level
    or new.years_experience is distinct from old.years_experience
    or new.sector_tags is distinct from old.sector_tags
    or new.location is distinct from old.location
    or new.full_name is distinct from old.full_name
  ) then
    new.candidate_embedding := null;
    new.embedded_at := null;
    -- embedding_version stays; the re-embed sweep bumps it on next write.
  end if;
  return new;
end;
$$;

create trigger candidates_invalidate_embedding
  before update on public.candidates
  for each row execute function public.invalidate_candidate_embedding();

create or replace function public.invalidate_job_embedding()
returns trigger
language plpgsql
as $$
begin
  if (
    new.title is distinct from old.title
    or new.location is distinct from old.location
    or new.job_type is distinct from old.job_type
    or new.hiring_context is distinct from old.hiring_context
    or new.salary_min is distinct from old.salary_min
    or new.salary_max is distinct from old.salary_max
    or new.currency is distinct from old.currency
    or new.description is distinct from old.description
  ) then
    new.job_embedding := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

create trigger jobs_invalidate_embedding
  before update on public.jobs
  for each row execute function public.invalidate_job_embedding();
