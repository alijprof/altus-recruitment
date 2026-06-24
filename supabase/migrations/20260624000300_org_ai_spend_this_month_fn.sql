-- Handover cost guardrail (follow-up to 20260624000200) — server-side
-- month-to-date AI-spend aggregate.
--
-- The £-ceiling helper (src/lib/stripe/spend-ceiling.ts) must sum an org's
-- ai_usage.cost_pence for the current month. Doing that by paging rows to the
-- client and summing in JS would be silently truncated by the PostgREST row cap
-- (supabase/config.toml sets max_rows = 1000) for a busy or runaway org — the
-- exact scenario the ceiling exists to catch — under-counting spend and failing
-- the ceiling OPEN. Computing the sum in the database removes that risk and is
-- cheaper (one indexed aggregate over ai_usage(organization_id, created_at)
-- instead of transferring up to 1000 rows).
--
-- SECURITY: SECURITY DEFINER + service_role-only EXECUTE. The helper runs under
-- the service-role client (checkCap / Inngest), never from a JWT-scoped caller.
--
-- Append-only.

create or replace function public.org_ai_spend_pence_this_month(p_organization_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(cost_pence), 0)::bigint
  from public.ai_usage
  where organization_id = p_organization_id
    -- Start of the current calendar month in UTC, as a timestamptz. Mirrors the
    -- JS helper's Date.UTC(year, month, 1) boundary.
    and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
$$;

revoke all on function public.org_ai_spend_pence_this_month(uuid) from public, anon, authenticated;
grant execute on function public.org_ai_spend_pence_this_month(uuid) to service_role;

comment on function public.org_ai_spend_pence_this_month(uuid) is
  'Sum of ai_usage.cost_pence for the org since the start of the current UTC '
  'month (all purposes), computed server-side to avoid PostgREST row-cap '
  'truncation. Backs the per-org monthly AI-spend ceiling. service_role only.';
