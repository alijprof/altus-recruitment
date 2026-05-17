-- Plan 3 / Task 3.1 — search_clients RPC.
--
-- Mirrors search_candidates (Plan 1) for the companies table. Searches across
-- companies.name and companies.industry using pg_trgm similarity (GIN trigram
-- indexes already added by Plan 0: 20260517204502_search_indexes.sql).
--
-- `security invoker` (default for language sql, but stated explicitly) ensures
-- RLS on companies still applies — never use security definer here or queries
-- would leak across tenants.

create or replace function public.search_clients(
  p_query text,
  p_threshold real default 0.2,
  p_sort text default 'similarity',
  p_dir text default 'desc',
  p_offset integer default 0,
  p_limit integer default 25
) returns table (
  id uuid,
  organization_id uuid,
  name text,
  industry text,
  website text,
  notes text,
  last_contacted_at timestamptz,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
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
      c.*,
      greatest(
        similarity(c.name, p_query),
        coalesce(similarity(c.industry, p_query), 0)
      ) as similarity
    from public.companies c
    where
      c.name % p_query
      or coalesce(c.industry, '') % p_query
  ),
  filtered as (
    select * from ranked where similarity >= p_threshold
  ),
  counted as (
    select count(*) as total from filtered
  )
  select
    f.id,
    f.organization_id,
    f.name,
    f.industry,
    f.website,
    f.notes,
    f.last_contacted_at,
    f.created_by,
    f.created_at,
    f.updated_at,
    f.similarity,
    (select total from counted)
  from filtered f
  order by
    case when p_sort = 'similarity' and p_dir = 'desc' then f.similarity end desc nulls last,
    case when p_sort = 'similarity' and p_dir = 'asc'  then f.similarity end asc  nulls last,
    case when p_sort = 'name'       and p_dir = 'asc'  then f.name       end asc  nulls last,
    case when p_sort = 'name'       and p_dir = 'desc' then f.name       end desc nulls last,
    case when p_sort = 'last_contacted_at' and p_dir = 'desc' then f.last_contacted_at end desc nulls last,
    case when p_sort = 'last_contacted_at' and p_dir = 'asc'  then f.last_contacted_at end asc  nulls last,
    f.id
  offset p_offset
  limit p_limit;
$$;

grant execute on function public.search_clients(text, real, text, integer, integer, integer) to authenticated;
