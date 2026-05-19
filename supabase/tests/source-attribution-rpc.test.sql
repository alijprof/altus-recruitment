-- Placeholder pgTAP-style scaffold for REPEAT-02 (source-attribution RPC).
-- Plan 03-06 executor replaces the stubs below with real BEGIN/ROLLBACK
-- pgTAP assertions once `source_attribution_summary(p_from, p_to)` RPC
-- migration lands.
--
-- Expected behavior (per PATTERNS §3 + D3-22 / D3-32 cross-tenant rule):
--   1. As org-A authenticated user, calling source_attribution_summary()
--      returns ONLY rows from org-A placements.
--   2. Org-B placements that fall in the same date range MUST be invisible
--      from org-A's call (security-definer function MUST filter on
--      current_organization_id()).
--   3. Group-by-candidates.source produces one row per distinct source.
--   4. placements counts only applications where stage='placed' AND
--      stage_changed_at::date BETWEEN p_from AND p_to.
--   5. total_fee_pence aggregates placement fee correctly (handles NULL
--      fee values as zero, not as group-eliminating).
--   6. EXECUTE granted only to `authenticated`, NOT to `anon`.

-- TODO Plan 03-06: replace with real pgTAP assertions.
select 1 as placeholder;
