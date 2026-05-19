# HNSW vector index build runbook

This runbook documents the **one-off operator step** required to bring up a
pgvector HNSW index on the production `candidates.candidate_embedding` and
`jobs.job_embedding` columns. The Inngest function
`bootstrap-vector-index` records state and signals when a build is needed;
the actual DDL must be run manually because
`CREATE INDEX CONCURRENTLY` cannot execute inside a transaction (and
`supabase-js` has no raw-DDL escape hatch — see PRD decision D2-05).

## Prerequisites

- Supabase Dashboard SQL editor access for the target project
- ≥ 100 rows with non-null embeddings in the target table
  (`/settings/integrations` surfaces a row count and only shows the
  "Build" button at threshold)
- The `bootstrap-vector-index` Inngest function ran successfully (a
  Sentry event with `tag: action = hnsw_build_requested` was emitted)

## Procedure — candidates

Open the Supabase Dashboard SQL editor and run:

```sql
-- Concurrent index build. Runs OUTSIDE a transaction so DML is not blocked.
-- Expected duration: ~1 minute per 10k rows.
CREATE INDEX CONCURRENTLY candidates_embedding_hnsw_idx
  ON public.candidates
  USING hnsw (candidate_embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Flag the build complete so the Inngest function (and the UI) hide the
-- "Build" button next render.
UPDATE public.hnsw_build_state
SET built_at = now(),
    last_error = NULL
WHERE table_name = 'candidates';
```

Verify:

```sql
\di candidates_embedding_hnsw_idx
-- expect: one row, schema=public
```

## Procedure — jobs

Same shape, different column / table:

```sql
CREATE INDEX CONCURRENTLY jobs_embedding_hnsw_idx
  ON public.jobs
  USING hnsw (job_embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

UPDATE public.hnsw_build_state
SET built_at = now(),
    last_error = NULL
WHERE table_name = 'jobs';
```

## If the build fails

Capture the SQL error in `hnsw_build_state.last_error` so the UI surfaces
it on next render:

```sql
UPDATE public.hnsw_build_state
SET last_attempt_at = now(),
    last_error = '<paste error message here>'
WHERE table_name = '<candidates | jobs>';
```

Then triage in the Supabase logs. Common causes:

- **Disk pressure during build.** HNSW needs ~2× the column size in
  scratch space. Drop to a smaller `m` (e.g., 12) if necessary.
- **Lock contention.** `CONCURRENTLY` waits for in-flight transactions;
  if a long-running query is blocking, identify via `pg_stat_activity`
  and either wait or cancel.
- **Insufficient `maintenance_work_mem`.** Bump for the session:
  `SET maintenance_work_mem = '512MB';` before running the build.

## Rationale (why this isn't automated)

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction, and
`supabase-js` does not expose raw DDL. Adding a direct `pg` client
dependency JUST for this one statement (which runs once per cluster per
table) is disproportionate — see PRD decision D2-05 ("HNSW deferred")
and VERIFICATION M-1 (manual-DDL path) in
`.planning/phases/02-search-match-intake/02-VERIFICATION.md`.

The future state, once row counts grow into multiple millions and HNSW
is mandatory in production, is to either:

1. Run the build from a one-off Vercel scheduled cron in Postgres
   maintenance mode, or
2. Add `pg` as a dependency and let `bootstrap-vector-index` execute the
   DDL via `pg.Client.query()` (outside a pool, no implicit transaction).

Until then, this runbook is the operational seam.
