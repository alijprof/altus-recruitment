-- hnsw_build_state — ops state for the deferred HNSW vector index builds.
--
-- D2-05 + PATTERNS.md conflict-resolution: pgvector HNSW indexes are
-- table-wide (NOT per-tenant — pgvector can't shard an HNSW index per
-- partition value), so this table is one-row-per-indexed-table, not
-- per-org. Phase 2 ships the trigger function; the actual
-- `CREATE INDEX CONCURRENTLY` runs once the anchor has ≥100 rows with
-- embeddings (Plan 1's bootstrap-vector-index Inngest function).
--
-- The table holds ops state (built_at, last_attempt_at, last_error), not
-- tenant data, so no RLS — service_role only (Inngest function writes;
-- nobody else reads).
--
-- Manual smoke tests after apply:
--
--   -- 1) authenticated cannot read:
--   set role authenticated;
--   select * from public.hnsw_build_state;
--   -- expect: permission denied
--
--   -- 2) Seed rows present:
--   set role service_role;
--   select table_name from public.hnsw_build_state order by table_name;
--   -- expect: ('candidates'), ('jobs')

create table public.hnsw_build_state (
  table_name text primary key
    check (table_name in ('candidates', 'jobs')),
  built_at timestamptz,
  last_attempt_at timestamptz,
  last_error text
);

insert into public.hnsw_build_state (table_name) values ('candidates'), ('jobs')
on conflict do nothing;

-- intentionally no RLS — table holds ops state, not tenant data.
revoke all on public.hnsw_build_state from authenticated, anon;
