-- match_candidates — hybrid semantic + trigram search over candidates,
-- blended via Reciprocal Rank Fusion (D2-04).
--
-- Two parallel CTEs:
--   * semantic: orders by pgvector cosine distance (halfvec_cosine_ops)
--   * trigram:  pg_trgm similarity on full_name / current_role_title
--
-- Each CTE over-fetches `p_match_count * 4` and ranks within itself. The
-- blended CTE full-outer-joins on candidate id and computes the RRF score
-- using the standard constant k=60:
--
--   rrf_score = 1 / (60 + semantic_rank) + 1 / (60 + trigram_rank)
--
-- Filters BOTH conditions inside the RPC, never as post-RPC .eq() chained
-- against the result — PostgREST applies post-RPC filters AFTER the inner
-- LIMIT, which would silently leave us with < match_count rows (verified
-- 2026-05-18 against Supabase ai docs).
--
-- security invoker (default in plpgsql for sql functions) — RLS on
-- candidates enforces tenant isolation. set search_path = public guards
-- against search_path attacks.
--
-- Manual smoke tests after apply:
--
--   -- 1) Function body sanity:
--   select pg_get_functiondef('public.match_candidates'::regprocedure);
--   -- expect: contains '60' (RRF constant) and '<=>' (cosine operator)
--
--   -- 2) Authenticated grant is present:
--   select has_function_privilege(
--     'authenticated',
--     'public.match_candidates(text, halfvec, integer, real)',
--     'execute'
--   );
--   -- expect: true

create or replace function public.match_candidates(
  p_query_text text,
  p_query_embedding halfvec(1024),
  p_match_count integer default 25,
  p_min_cosine_similarity real default 0.5
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
language sql
stable
security invoker
set search_path = public
as $$
  with semantic as (
    select
      c.id,
      (1 - (c.candidate_embedding <=> p_query_embedding))::real as cosine_similarity,
      row_number() over (order by c.candidate_embedding <=> p_query_embedding asc) as semantic_rank
    from public.candidates c
    where c.candidate_embedding is not null
    order by c.candidate_embedding <=> p_query_embedding asc
    limit p_match_count * 4
  ),
  trigram as (
    select
      c.id,
      greatest(
        similarity(c.full_name, p_query_text),
        coalesce(similarity(c.current_role_title, p_query_text), 0)
      )::real as trigram_similarity,
      row_number() over (
        order by greatest(
          similarity(c.full_name, p_query_text),
          coalesce(similarity(c.current_role_title, p_query_text), 0)
        ) desc
      ) as trigram_rank
    from public.candidates c
    where
      c.full_name % p_query_text
      or c.current_role_title % p_query_text
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
    c.id,
    c.full_name,
    c.current_role_title,
    c.current_company,
    c.location,
    c.market_status,
    b.cosine_similarity,
    b.trigram_similarity,
    b.rrf_score
  from blended b
  join public.candidates c on c.id = b.id
  order by b.rrf_score desc, c.full_name asc, c.id asc
  limit p_match_count;
$$;

-- Param-type list must match the function declaration exactly. Postgres
-- normalises `halfvec(1024)` to `halfvec` in the function signature, so the
-- GRANT uses `halfvec` (NOT `halfvec(1024)`) to avoid the Phase 1
-- GRANT-signature mismatch that rolled back a migration.
grant execute on function public.match_candidates(text, halfvec, integer, real) to authenticated;

comment on function public.match_candidates(text, halfvec, integer, real) is
  'Hybrid RRF (k=60) search blending pgvector cosine (halfvec_cosine_ops) '
  'and pg_trgm similarity on full_name / current_role_title. Returns top '
  'p_match_count by rrf_score. security invoker — RLS on candidates '
  'enforces tenant isolation.';
