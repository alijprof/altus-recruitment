-- Handover cost guardrail (follow-up to 20260624151720) — server-side
-- per-purpose month-to-date ai_usage aggregate.
--
-- The AI bucket caps (checkCap → getAiUsageThisMonth) previously counted
-- ai_usage rows CLIENT-SIDE, which PostgREST truncates at max_rows = 1000
-- (supabase/config.toml). A busy org logging >1000 AI rows in a month has its
-- bucket counts silently plateau at 1000, so caps above 1000 become unreachable
-- and every bucket cap under-enforces (audit MAJOR-2). Compute the grouped
-- aggregate in the database instead — no row cap, one indexed pass over
-- ai_usage(organization_id, created_at).
--
-- Returns per purpose: the call count and the SUM of input_tokens. Whisper
-- stores audio SECONDS in ai_usage.input_tokens, so the caller derives the
-- specMinutes bucket as ceil(sum(input_tokens)/60) — counting MINUTES, not call
-- rows (audit min-17/21). The purpose→bucket mapping stays in TypeScript
-- (PURPOSE_CAP_BUCKETS — the single source of truth); this RPC only aggregates,
-- so adding a new purpose never requires a migration.
--
-- SECURITY: SECURITY DEFINER + service_role-only EXECUTE, mirroring
-- org_ai_spend_pence_this_month. It must NEVER be callable from a JWT-scoped
-- role: a SECURITY DEFINER function that takes an arbitrary org id and is
-- callable by `authenticated` would be a cross-tenant read (cf. the
-- assert_same_org anon-exec finding). checkCap runs it under the service-role
-- client; the RLS/display path (billing usage page) falls back to a scoped,
-- RLS-enforced row scan in the caller.
--
-- Append-only.

create or replace function public.ai_usage_month_by_purpose(p_organization_id uuid)
returns table(purpose text, call_count bigint, input_tokens_sum bigint)
language sql
security definer
set search_path = public
as $$
  select
    purpose,
    count(*)::bigint as call_count,
    coalesce(sum(input_tokens), 0)::bigint as input_tokens_sum
  from public.ai_usage
  where organization_id = p_organization_id
    -- Start of the current calendar month in UTC — mirrors the JS helper's
    -- Date.UTC(year, month, 1) boundary and org_ai_spend_pence_this_month.
    and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  group by purpose;
$$;

revoke all on function public.ai_usage_month_by_purpose(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_month_by_purpose(uuid) to service_role;

comment on function public.ai_usage_month_by_purpose(uuid) is
  'Per-purpose call_count + input_tokens_sum for the org since the start of the '
  'current UTC month, computed server-side to avoid PostgREST row-cap '
  'truncation of the AI bucket caps (audit MAJOR-2). Caller maps purpose->bucket '
  'and derives specMinutes as ceil(input_tokens_sum/60). service_role only.';
