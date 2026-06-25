-- Handover cost guardrail — per-org monthly AI-spend ceiling.
--
-- Adds an optional hard ceiling on an org's TOTAL month-to-date AI spend (the
-- sum of ai_usage.cost_pence across ALL purposes). When set and reached,
-- checkCap (src/lib/stripe/cap-enforcement.ts) hard-denies further AI calls for
-- the org. This is the real safety net for a comped / invoice-billed customer
-- whose AI usage the founder personally pays for on shared API keys: count caps
-- bound individual buckets, but only a £ ceiling bounds total spend.
--
--   null  → no per-org cap; the generous global env backstop
--           (MAX_MONTHLY_AI_SPEND_PENCE) still applies.
--   N ≥ 0 → hard ceiling of N pence/month for this org (takes precedence over
--           the global backstop when lower).
--
-- Append-only; extends plan_overrides (20260604130000). Reads use the existing
-- cast boundary in entitlement.ts / cap-enforcement.ts until db:types is
-- regenerated post-push.

alter table public.plan_overrides
  add column if not exists monthly_spend_cap_pence integer
    check (monthly_spend_cap_pence is null or monthly_spend_cap_pence >= 0);

comment on column public.plan_overrides.monthly_spend_cap_pence is
  'Optional per-org hard ceiling on total month-to-date AI spend (sum of '
  'ai_usage.cost_pence across all purposes), in pence. When set and reached, '
  'checkCap hard-denies further AI calls. null = no per-org cap (the global '
  'env backstop MAX_MONTHLY_AI_SPEND_PENCE still applies). Used to bound a '
  'comped / invoice-billed customer whose AI spend the founder pays for.';
