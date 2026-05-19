-- Phase 2 Review C1 fix — explicit org-filter on the match RPC chain.
--
-- BACKGROUND
-- ----------
-- The CRITICAL finding in 02-REVIEW.md identifies a cross-tenant data leak
-- via `match_candidates_for_job`. Both that RPC and the inner
-- `match_candidates` RPC are declared `security invoker`, which relies on
-- RLS for tenant isolation. But the precompute-matches-for-job Inngest
-- function calls them via `createServiceClient()` (RLS bypass), so the
-- candidates CTE in `match_candidates` would scan rows across EVERY org,
-- not just the requesting org. The function then ships up to 10
-- foreign-tenant CV summaries to Anthropic's Sonnet API, billed to the
-- requesting org.
--
-- FIX
-- ---
-- Add `p_organization_id uuid` as a required parameter to both RPCs and
-- filter the candidates CTEs by `organization_id = p_organization_id`
-- explicitly. The RPC now defends itself, irrespective of whether the
-- caller is service-role or an authenticated user.
--
-- `match_candidates_for_job` also validates that the job lives in
-- `p_organization_id` and raises if not — catches a forged event that
-- supplies a job_id from org A with org_id of org B.
--
-- BACKWARDS COMPAT
-- ----------------
-- This migration drops the OLD signatures (without `p_organization_id`)
-- so any caller that hasn't been updated breaks loudly. Two callers
-- exist in-tree:
--   * src/lib/db/embeddings.ts → hybridSearchCandidates +
--     getTopCandidatesForJob
-- Both are updated in the same commit as this migration.
--
-- GRANTS
-- ------
-- Per M4's note about PUBLIC defaults, we keep the existing
-- `grant execute … to authenticated` pattern but do NOT widen. A
-- follow-up could revoke PUBLIC explicitly; that's deliberately deferred
-- to a separate scope.
--
-- MANUAL SMOKE TESTS (run after `pnpm exec supabase db push`)
-- -----------------------------------------------------------
--   -- 1) Old signatures gone:
--   select count(*) from pg_proc
--   where proname = 'match_candidates'
--     and pronargs = 4;
--   -- expect: 0 (was 1; now superseded by 5-arg variant)
--
--   -- 2) New signatures present:
--   select count(*) from pg_proc
--   where proname = 'match_candidates'
--     and pronargs = 5;
--   -- expect: 1
--   select count(*) from pg_proc
--   where proname = 'match_candidates_for_job'
--     and pronargs = 3;
--   -- expect: 1
--
--   -- 3) Org mismatch on the job lookup raises:
--   --    (Assume jobA exists in orgA, NOT in orgB.)
--   select * from public.match_candidates_for_job(
--     '<jobA-uuid>'::uuid, '<orgB-uuid>'::uuid, 10
--   );
--   -- expect: ERROR — 'org_id mismatch on job lookup'
--
--   -- 4) Correct org returns ONLY candidates in that org (no cross-org
--   --    leakage):
--   set role service_role;
--   select c.id, c.organization_id
--   from public.match_candidates_for_job(
--     '<jobA-uuid>'::uuid, '<orgA-uuid>'::uuid, 10
--   ) m
--   join public.candidates c on c.id = m.id;
--   -- expect: every row has organization_id = orgA-uuid

-- ---------------------------------------------------------------------------
-- match_candidates — now takes p_organization_id and filters BOTH CTEs.
-- ---------------------------------------------------------------------------

-- Drop the old 4-arg signature first (CREATE OR REPLACE cannot change the
-- argument list — adding a required parameter requires a drop).
drop function if exists public.match_candidates(text, halfvec, integer, real);

create function public.match_candidates(
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
      c.organization_id = p_organization_id
      and (
        c.full_name % p_query_text
        or c.current_role_title % p_query_text
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
  'Hybrid RRF (k=60) search blending pgvector cosine (halfvec_cosine_ops) '
  'and pg_trgm similarity on full_name / current_role_title. '
  'Tenant-scoped via explicit p_organization_id filter — DOES NOT rely on '
  'RLS, so safe to call from service-role contexts. Phase 2 review C1 fix.';

-- ---------------------------------------------------------------------------
-- match_candidates_for_job — adds p_organization_id, validates job/org
-- match, forwards org id into match_candidates.
-- ---------------------------------------------------------------------------

drop function if exists public.match_candidates_for_job(uuid, integer);

create function public.match_candidates_for_job(
  p_job_id uuid,
  p_organization_id uuid,
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
  v_job_org_id uuid;
begin
  select j.job_embedding, j.organization_id
    into v_embedding, v_job_org_id
    from public.jobs j
   where j.id = p_job_id;

  -- Job not found (RLS may have hidden it from authenticated callers) OR
  -- embedding is null → empty result.
  if v_job_org_id is null then
    return;
  end if;

  -- Tenant assertion: caller-supplied org MUST match the job's org. This
  -- is the defence against a forged Inngest payload that claims jobA
  -- belongs to orgB. Service-role callers bypass RLS; the explicit org
  -- match is the load-bearing check.
  if v_job_org_id is distinct from p_organization_id then
    raise exception 'org_id mismatch on job lookup';
  end if;

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
      p_organization_id,
      p_match_count,
      0::real
    ) m;
end;
$$;

grant execute on function public.match_candidates_for_job(uuid, uuid, integer)
  to authenticated;

comment on function public.match_candidates_for_job(uuid, uuid, integer) is
  'Convenience wrapper: reads job_embedding for p_job_id, asserts the job '
  'belongs to p_organization_id, then forwards org_id into '
  'match_candidates. Tenant-safe under service-role (Phase 2 review C1).';
