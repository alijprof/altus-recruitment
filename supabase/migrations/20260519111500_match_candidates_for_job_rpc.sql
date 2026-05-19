-- match_candidates_for_job — convenience wrapper around match_candidates
-- that reads the job's embedding server-side and calls the hybrid RPC. Used
-- by Plan 1's /jobs/[id]/matches page to surface the SEARCH-04 minimum
-- (vector-only ranked candidates for a job).
--
-- security invoker — RLS on jobs (read) AND candidates (via match_candidates)
-- enforces tenant isolation. set search_path = public guards against
-- search_path attacks.
--
-- Returns an empty set if the job has no embedding yet (e.g. created in
-- Phase 1 before this plan, or invalidated by a column change and not yet
-- re-embedded). The caller distinguishes by counting rows.
--
-- p_query_text is the empty string so the trigram half of match_candidates
-- contributes no rows — the result is pure cosine ranking (vector-only).
-- Plan 2 will add a richer match-scoring path with Sonnet-generated
-- explanations on top of this list.
--
-- Manual smoke tests after apply:
--
--   -- 1) Function body sanity:
--   select pg_get_functiondef('public.match_candidates_for_job'::regprocedure);
--
--   -- 2) Authenticated grant is present:
--   select has_function_privilege(
--     'authenticated',
--     'public.match_candidates_for_job(uuid, integer)',
--     'execute'
--   );
--   -- expect: true

create or replace function public.match_candidates_for_job(
  p_job_id uuid,
  p_match_count integer default 10
) returns table (
  id uuid,
  full_name text,
  current_role_title text,
  current_company text,
  location text,
  market_status public.market_status,
  cosine_similarity real,
  trigram_similarity real,
  rrf_score real
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_embedding halfvec(1024);
begin
  select j.job_embedding into v_embedding
  from public.jobs j
  where j.id = p_job_id;

  -- No row visible to this user (RLS) OR embedding is null → empty.
  if v_embedding is null then
    return;
  end if;

  return query
    select
      m.id,
      m.full_name,
      m.current_role_title,
      m.current_company,
      m.location,
      m.market_status,
      m.cosine_similarity,
      m.trigram_similarity,
      m.rrf_score
    from public.match_candidates(
      ''::text,
      v_embedding,
      p_match_count,
      0::real
    ) m;
end;
$$;

grant execute on function public.match_candidates_for_job(uuid, integer) to authenticated;

comment on function public.match_candidates_for_job(uuid, integer) is
  'Convenience wrapper: reads job_embedding for p_job_id (security invoker — '
  'RLS gates the job lookup) and calls match_candidates with empty trigram '
  'query. Returns vector-only ranked candidates. Used by /jobs/[id]/matches.';
