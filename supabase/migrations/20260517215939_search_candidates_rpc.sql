-- search_candidates RPC: pg_trgm-ranked keyword search over candidates.
--
-- Used by src/lib/db/candidates.ts when a `q` parameter is present. The
-- function relies on the GIN trigram indexes added by
-- 20260517204502_search_indexes.sql plus the pre-existing index on
-- candidates.full_name.
--
-- Notes:
--   * security invoker (default) so the caller's RLS policies apply naturally —
--     this is critical for tenant isolation. Never switch to security definer.
--   * set search_path = public hardens against search_path attacks (matches the
--     style of record_audit / record_ai_usage in the domain schema migration).
--   * The candidates_email_trgm_idx index in 20260517204502 is built on
--     lower(email); we mirror that with lower(c.email) in the WHERE / ranking
--     clauses so the index is actually used.
--   * Order: similarity desc, then full_name asc as a deterministic tie-breaker
--     so paginated results don't flap between requests.
--   * total_count is denormalised onto every row via a window function so the
--     caller does one round-trip (vs. a parallel count(*) query).
--   * last_contacted_at is read directly from candidates (added by
--     20260517215938_candidates_last_contacted_at.sql) — no activity-table
--     aggregation needed in the search hot path.

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
        similarity(c.full_name, p_query),
        coalesce(similarity(lower(c.email), lower(p_query)), 0),
        coalesce(similarity(c.current_role_title, p_query), 0)
      )::real as similarity
    from public.candidates c
    where
      c.full_name % p_query
      or lower(c.email) % lower(p_query)
      or c.current_role_title % p_query
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
  'pg_trgm-ranked keyword search over candidates.full_name, email, current_role_title. '
  'Returns similarity score and total_count (denormalised window) so callers do one round-trip. '
  'security invoker — RLS on candidates enforces tenant isolation.';
