-- Index for Plan 5's dashboard "stale applications" widget.
--
-- The widget asks "applications in this org whose stage has not changed in
-- the last 14 days" — without this composite index, the query scans the
-- whole applications table per request. Adding it now is cheap (small table
-- in Phase 1) and avoids a re-indexing backfill later.
--
-- The (organization_id, stage_changed_at) shape mirrors RESEARCH §27's
-- pitfalls note and the existing applications_stage_idx pattern used for
-- per-stage filtering.

create index if not exists applications_stage_changed_at_idx
  on public.applications (organization_id, stage_changed_at);

comment on index public.applications_stage_changed_at_idx is
  'Used by Plan 5 dashboard stale-applications widget. (organization_id, stage_changed_at) '
  'so the planner picks it for "where organization_id = X and stage_changed_at < now() - 14 days".';
