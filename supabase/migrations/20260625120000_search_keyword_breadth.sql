-- Batch A item 4 — broaden the keyword search fallback to skills + sector +
-- (for the hybrid RPC) location + company.
--
-- Rebased on the CURRENT definitions of both RPCs (NOT the original ones):
--   * search_candidates — current def is 20260603120000_search_candidates_partial_match
--     (ILIKE substring + word_similarity over full_name/email/current_role_title/
--     current_company/location). It already covers location + company, so the
--     only gap is the array columns skills[] + sector_tags[].
--   * match_candidates — current def is 20260519130000_match_candidates_for_job_org_filter
--     (5-arg, takes p_organization_id and filters BOTH CTEs — the Phase 2 review
--     C1 cross-tenant fix). Its trigram CTE still only matched full_name +
--     current_role_title, so we add location, current_company, skills[],
--     sector_tags[]. The p_organization_id tenant filter is PRESERVED exactly.
--
-- Array columns (skills, sector_tags) are matched PER-ELEMENT via unnest, never
-- as a single concatenated blob: an exact skill ("python") in a long list must
-- score high, whereas similarity against the whole blob would be diluted below
-- threshold and miss. Empty arrays ('{}') unnest to zero rows → coalesce(...,0),
-- no error. Per-element matching is a sequential scan (no usable trigram index
-- across unnest), fine at the anchor's scale (low thousands of candidates per
-- org, RLS/org-narrowed first). Revisit with a denormalised search_text column
-- if candidate volumes grow large.
--
-- INVARIANTS PRESERVED: identical signatures + RETURNS TABLE + grants,
-- security invoker (RLS / explicit org filter unchanged), set search_path,
-- ranking thresholds (word_similarity >= 0.3 / trigram % 0.3 / RRF k=60), and
-- the deterministic ORDER BY tie-breakers. Migrations are append-only — these
-- are CREATE OR REPLACE updates that keep each function's exact argument list.

-- ---------------------------------------------------------------------------
-- search_candidates — keyword-only ranked search. Add per-element skills[] /
-- sector_tags[] matching to the existing ILIKE + word_similarity logic.
-- ---------------------------------------------------------------------------
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
        coalesce(similarity(lower(c.email), lower(p_query)), 0),
        coalesce((select max(word_similarity(p_query, s)) from unnest(c.skills) s), 0),
        coalesce((select max(word_similarity(p_query, t)) from unnest(c.sector_tags) t), 0)
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
      or exists (
        select 1 from unnest(c.skills) s
        where s ilike '%' || p_query || '%' or word_similarity(p_query, s) >= 0.3
      )
      or exists (
        select 1 from unnest(c.sector_tags) t
        where t ilike '%' || p_query || '%' or word_similarity(p_query, t) >= 0.3
      )
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

-- CREATE OR REPLACE preserves existing grants; re-granting is idempotent and
-- matches the established per-migration RPC style.
grant execute on function public.search_candidates(text, integer, integer) to authenticated;

comment on function public.search_candidates(text, integer, integer) is
  'Partial/prefix/substring keyword search over candidates.full_name, email, '
  'current_company, current_role_title, location, and per-element skills[] / '
  'sector_tags[]. Matches on ILIKE substring OR word_similarity >= 0.3. Returns '
  'word_similarity-based rank + total_count (denormalised window). security '
  'invoker — RLS on candidates enforces tenant isolation.';

-- ---------------------------------------------------------------------------
-- match_candidates — hybrid semantic + trigram (RRF k=60), tenant-scoped via
-- p_organization_id (Phase 2 review C1 fix — PRESERVED). Only the trigram CTE
-- changes: broaden its matched columns. Signature is unchanged (5-arg), so
-- CREATE OR REPLACE is valid and all callers / grants are unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.match_candidates(
  p_query_text text,
  p_query_embedding halfvec(1024),
  p_organization_id uuid,
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
      and c.organization_id = p_organization_id
    order by c.candidate_embedding <=> p_query_embedding asc
    limit p_match_count * 4
  ),
  trigram as (
    select
      c.id,
      greatest(
        similarity(c.full_name, p_query_text),
        coalesce(similarity(c.current_role_title, p_query_text), 0),
        coalesce(similarity(c.location, p_query_text), 0),
        coalesce(similarity(c.current_company, p_query_text), 0),
        coalesce((select max(similarity(s, p_query_text)) from unnest(c.skills) s), 0),
        coalesce((select max(similarity(t, p_query_text)) from unnest(c.sector_tags) t), 0)
      )::real as trigram_similarity,
      row_number() over (
        order by greatest(
          similarity(c.full_name, p_query_text),
          coalesce(similarity(c.current_role_title, p_query_text), 0),
          coalesce(similarity(c.location, p_query_text), 0),
          coalesce(similarity(c.current_company, p_query_text), 0),
          coalesce((select max(similarity(s, p_query_text)) from unnest(c.skills) s), 0),
          coalesce((select max(similarity(t, p_query_text)) from unnest(c.sector_tags) t), 0)
        ) desc
      ) as trigram_rank
    from public.candidates c
    where
      c.organization_id = p_organization_id
      and (
        c.full_name % p_query_text
        or c.current_role_title % p_query_text
        or c.location % p_query_text
        or c.current_company % p_query_text
        or exists (select 1 from unnest(c.skills) s where s % p_query_text)
        or exists (select 1 from unnest(c.sector_tags) t where t % p_query_text)
      )
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
  where c.organization_id = p_organization_id  -- belt-and-braces final filter
  order by b.rrf_score desc, c.full_name asc, c.id asc
  limit p_match_count;
$$;

grant execute on function public.match_candidates(text, halfvec, uuid, integer, real)
  to authenticated;

comment on function public.match_candidates(text, halfvec, uuid, integer, real) is
  'Hybrid RRF (k=60) search blending pgvector cosine (halfvec_cosine_ops) and '
  'pg_trgm similarity over full_name, current_role_title, location, '
  'current_company, and per-element skills[] / sector_tags[]. Tenant-scoped via '
  'explicit p_organization_id filter — DOES NOT rely on RLS, so safe to call '
  'from service-role contexts. Phase 2 review C1 fix preserved.';
