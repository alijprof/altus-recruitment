-- GIN trigram indexes backing pg_trgm-ranked keyword search (D-13).
-- The existing phase1_domain_schema migration already created indexes on
-- companies.name, candidates.full_name, jobs.title. This migration adds the
-- remaining columns Phase 1 search will touch.
--
-- The search_candidates / search_clients RPCs themselves land in Plans 1 and 3
-- alongside the routes that consume them.

create index if not exists candidates_email_trgm_idx
  on public.candidates using gin (lower(email) gin_trgm_ops);

create index if not exists candidates_current_role_trgm_idx
  on public.candidates using gin (current_role_title gin_trgm_ops);

create index if not exists companies_industry_trgm_idx
  on public.companies using gin (industry gin_trgm_ops);
