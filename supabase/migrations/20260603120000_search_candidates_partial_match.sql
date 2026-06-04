-- search_candidates: fix partial / prefix / substring matching.
--
-- BUG (pre-this-migration): the function filtered rows with the pg_trgm `%`
-- operator (`c.full_name % p_query`). The `%` operator only returns true when
-- similarity() clears pg_trgm.similarity_threshold (0.3 on this project). A
-- short query like 'Jam' over 'Jamie Grant FIMarEST' scores similarity ~= 0.14
-- — far below 0.3 — so EVERY genuine partial match was filtered out. Only a
-- near-complete name ('Jamie Grant') cleared the threshold, which is why
-- search appeared to "only match full names".
--
-- FIX: match on substring (ILIKE '%q%') across full_name, email,
-- current_company, current_role_title, location, OR word_similarity(q, field)
-- >= 0.3 (word_similarity measures the best-matching *word extent* inside the
-- field, so a prefix like 'Jam' against 'Jamie Wallace' scores 0.75 and
-- passes — unlike whole-string similarity()). Ranking uses the greatest
-- word_similarity across the text fields (email uses similarity on lower()),
-- then full_name asc, id asc as deterministic tie-breakers for stable
-- pagination.
--
-- PRESERVED EXACTLY from the prior definition:
--   * SECURITY INVOKER (the default; pg_get_functiondef omits it) so the
--     caller's RLS policies enforce tenant isolation. NEVER switch to
--     security definer — RLS on candidates IS the tenant boundary.
--   * set search_path = public (search_path-injection hardening).
--   * language sql, stable.
--   * identical return columns + total_count window + grant to authenticated.
--
-- INDEXES: the existing GIN gin_trgm_ops indexes on full_name, lower(email),
-- current_role_title support both ILIKE '%..%' and word_similarity (pg_trgm
-- GIN serves the `%>` / set-similarity operators and LIKE/ILIKE). No new index
-- is REQUIRED for correctness. For consistent performance on the two newly
-- searched columns we add trigram GIN indexes on current_company and location
-- (small tables today, but keeps the search hot path index-backed as data
-- grows). These are additive and safe.

create index if not exists candidates_current_company_trgm_idx
  on public.candidates using gin (current_company gin_trgm_ops);

create index if not exists candidates_location_trgm_idx
  on public.candidates using gin (location gin_trgm_ops);

create or replace function public.search_candidates(
  p_query text,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid,
  organization_id uuid,
  full_name text,
  email text,
  phone text,
  location text,
  current_role_title text,
  current_company text,
  market_status public.market_status,
  source public.candidate_source,
  last_contacted_at timestamptz,
  created_at timestamptz,
  similarity real,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ranked as (
    select
      c.id,
      c.organization_id,
      c.full_name,
      c.email,
      c.phone,
      c.location,
      c.current_role_title,
      c.current_company,
      c.market_status,
      c.source,
      c.last_contacted_at,
      c.created_at,
      greatest(
        word_similarity(p_query, c.full_name),
        word_similarity(p_query, coalesce(c.current_role_title, '')),
        word_similarity(p_query, coalesce(c.current_company, '')),
        word_similarity(p_query, coalesce(c.location, '')),
        coalesce(similarity(lower(c.email), lower(p_query)), 0)
      )::real as similarity
    from public.candidates c
    where
      c.full_name ilike '%' || p_query || '%'
      or coalesce(c.current_role_title, '') ilike '%' || p_query || '%'
      or coalesce(c.current_company, '') ilike '%' || p_query || '%'
      or coalesce(c.location, '') ilike '%' || p_query || '%'
      or lower(coalesce(c.email, '')) ilike '%' || lower(p_query) || '%'
      or word_similarity(p_query, c.full_name) >= 0.3
      or word_similarity(p_query, coalesce(c.current_role_title, '')) >= 0.3
      or word_similarity(p_query, coalesce(c.current_company, '')) >= 0.3
  )
  select
    r.id,
    r.organization_id,
    r.full_name,
    r.email,
    r.phone,
    r.location,
    r.current_role_title,
    r.current_company,
    r.market_status,
    r.source,
    r.last_contacted_at,
    r.created_at,
    r.similarity,
    count(*) over ()::bigint as total_count
  from ranked r
  order by r.similarity desc nulls last, r.full_name asc, r.id asc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.search_candidates(text, integer, integer) to authenticated;

comment on function public.search_candidates(text, integer, integer) is
  'Partial/prefix/substring keyword search over candidates.full_name, email, '
  'current_company, current_role_title, location. Matches on ILIKE substring OR '
  'word_similarity >= 0.3 (fixes the prior similarity()-threshold bug that only '
  'matched near-complete names). Returns word_similarity-based rank + total_count '
  '(denormalised window). security invoker — RLS on candidates enforces tenant isolation.';
