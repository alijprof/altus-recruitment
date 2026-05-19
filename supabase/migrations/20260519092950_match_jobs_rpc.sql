-- match_jobs — hybrid semantic + trigram search over jobs, blended via
-- Reciprocal Rank Fusion (k=60). Mirrors match_candidates with two
-- differences:
--
--   * Vector column is `jobs.job_embedding` (not candidate_embedding).
--   * Trigram path runs against `jobs.title` only — there is currently no
--     trigram index on `jobs.description`, so adding similarity(description)
--     to the where/order would force a sequential scan. Plan 4 may add a
--     trigram index on description if recruiter usage demands it.
--
-- Returned columns mirror the jobs row shape used by job-detail pages:
-- id, title, location, job_type, status, salary range + currency,
-- company_id, plus the same cosine_similarity / trigram_similarity /
-- rrf_score blended-score columns.
--
-- security invoker, set search_path = public — same posture as
-- match_candidates.

create or replace function public.match_jobs(
  p_query_text text,
  p_query_embedding halfvec(1024),
  p_match_count integer default 25,
  p_min_cosine_similarity real default 0.5
) returns table (
  id uuid,
  title text,
  location text,
  job_type public.job_type,
  status public.job_status,
  salary_min integer,
  salary_max integer,
  currency text,
  company_id uuid,
  cosine_similarity real,
  trigram_similarity real,
  rrf_score real
)
language sql
stable
security invoker
set search_path = public
as $$
  with semantic as (
    select
      j.id,
      (1 - (j.job_embedding <=> p_query_embedding))::real as cosine_similarity,
      row_number() over (order by j.job_embedding <=> p_query_embedding asc) as semantic_rank
    from public.jobs j
    where j.job_embedding is not null
    order by j.job_embedding <=> p_query_embedding asc
    limit p_match_count * 4
  ),
  trigram as (
    select
      j.id,
      similarity(j.title, p_query_text)::real as trigram_similarity,
      row_number() over (order by similarity(j.title, p_query_text) desc) as trigram_rank
    from public.jobs j
    where j.title % p_query_text
    limit p_match_count * 4
  ),
  blended as (
    select
      coalesce(s.id, t.id) as id,
      coalesce(s.cosine_similarity, 0)::real as cosine_similarity,
      coalesce(t.trigram_similarity, 0)::real as trigram_similarity,
      (coalesce(1.0 / (60 + s.semantic_rank), 0)
        + coalesce(1.0 / (60 + t.trigram_rank), 0))::real as rrf_score
    from semantic s
    full outer join trigram t on s.id = t.id
    where coalesce(s.cosine_similarity, 0) >= p_min_cosine_similarity
       or coalesce(t.trigram_similarity, 0) > 0.3
  )
  select
    j.id,
    j.title,
    j.location,
    j.job_type,
    j.status,
    j.salary_min,
    j.salary_max,
    j.currency,
    j.company_id,
    b.cosine_similarity,
    b.trigram_similarity,
    b.rrf_score
  from blended b
  join public.jobs j on j.id = b.id
  order by b.rrf_score desc, j.title asc, j.id asc
  limit p_match_count;
$$;

grant execute on function public.match_jobs(text, halfvec, integer, real) to authenticated;

comment on function public.match_jobs(text, halfvec, integer, real) is
  'Hybrid RRF (k=60) search over jobs.title (trigram) + jobs.job_embedding '
  '(pgvector cosine). security invoker — RLS on jobs enforces tenant '
  'isolation.';
