-- REVOKE anon EXECUTE on the audited SECURITY DEFINER functions.
--
-- 2026-07-31 Steele Charles feature review §3: 11 SECURITY DEFINER functions
-- are executable by `anon` over PostgREST RPC — the same class of hole
-- fixed for record_ai_usage on 2026-06-05
-- (20260605120000_security_guard_user_role_and_lock_ai_usage.sql, LIVE-01).
-- Supabase's default privileges auto-grant EXECUTE to anon on every new
-- public function; the individual migrations that defined these functions
-- ran `revoke all ... from public` (which does NOT touch the direct
-- anon/authenticated grants Supabase's default privileges already applied)
-- and then `grant execute ... to authenticated` — leaving anon's original
-- default grant untouched and un-revoked. Same root cause, same fix shape.
--
-- FILE ONLY — per project hard rules this migration is NOT applied by the
-- executor. The founder pushes it manually via
-- `pnpm exec supabase db push --linked`.
--
-- ---------------------------------------------------------------------------
-- Target function list, verified against supabase/migrations/*.sql during
-- planning (re-verify with:
--   grep -rn "function public.<name> *(" supabase/migrations/*.sql
-- for each name below):
--   delete_candidate, delete_company, delete_job, record_audit,
--   handle_new_user, current_organization_id, assert_same_org,
--   bump_candidate_last_contacted_at, rls_auto_enable,
--   job_ads_same_org_guard, spec_drafts_same_org_guard
--
-- Two facts established during planning, NOT re-derived by this migration:
--
--   1. `rls_auto_enable` does NOT exist anywhere in this repo (grep above
--      returns nothing). It is included in the target array anyway because
--      the loop below is a NO-OP for names that don't resolve in pg_proc —
--      harmless, and future-proofs against a function of that name being
--      added later without a REVOKE audit.
--
--   2. `record_audit_anonymous` is ALREADY anon-less — migration
--      20260519092947_record_audit_anonymous.sql revokes it from
--      public/authenticated/anon and grants EXECUTE to service_role only.
--      It is therefore DELIBERATELY EXCLUDED from the target array below.
--      The public apply form calls it through the service-role client
--      (src/app/(public)/apply/[orgSlug]/actions.ts), so it is unaffected
--      either way.
--
-- ---------------------------------------------------------------------------
-- Why a pg_proc-driven loop instead of hardcoded `revoke execute on function
-- name(args) from anon` statements (the shape used in 20260605120000):
--   - Handles overloads without enumerating every signature.
--   - Is a safe no-op for a name that doesn't exist (rls_auto_enable) or
--     gets dropped by a later migration — a hardcoded REVOKE on a
--     non-existent signature would fail the whole migration.
--   - Safely re-runnable (idempotent) — running it twice is a no-op the
--     second time.
--
-- `anon` ONLY. `authenticated` and `service_role` grants are UNTOUCHED —
-- several of these are legitimate authenticated callers (record_audit,
-- current_organization_id, the delete RPCs, etc).
--
-- ---------------------------------------------------------------------------
-- Safety analysis 1 — trigger functions are unaffected.
--
-- handle_new_user, bump_candidate_last_contacted_at, job_ads_same_org_guard,
-- and spec_drafts_same_org_guard are TRIGGER functions. PostgreSQL checks
-- EXECUTE on a trigger function at CREATE TRIGGER time, not at fire time —
-- revoking anon's EXECUTE cannot break trigger firing (the trigger fires as
-- the table-owning role's context, not the querying role's). handle_new_user
-- additionally fires as `supabase_auth_admin` (the auth.users trigger
-- owner), never as anon.
--
-- Safety analysis 2 — current_organization_id() blast radius.
--
-- Most RLS policies invoking current_organization_id() are declared
-- `to authenticated`, so anon never evaluates the function on those tables
-- and this REVOKE changes nothing for them. Four policies omit the role
-- clause (defaulting to PUBLIC, which includes anon):
--   plan_overrides            (20260604130000_phase5_admin_overrides.sql)
--   voice_notes               (20260610000000_phase4_hardening.sql)
--   email_campaigns           (20260610000000_phase4_hardening.sql)
--   email_campaign_recipients (20260610000000_phase4_hardening.sql)
-- After this migration, an anon PostgREST read of those four tables returns
-- `42501 permission denied for function current_organization_id` instead of
-- an empty result set from the (never-true for anon) policy check — still
-- fails closed, no data exposure either before or after.
--
-- No app path hits these as anon: every `(public)` route (apply,
-- unsubscribe) uses createServiceClient(), which bypasses RLS entirely and
-- never calls current_organization_id(). The only anon-role query in the
-- codebase is /status's probe of `organizations`
-- (src/app/status/page.tsx), whose policies ARE `to authenticated`
-- (20260513151021_init_organizations_and_users.sql:81-85) and therefore
-- never invoke current_organization_id() for anon either. Verified with:
--   grep -rn "createClient\|createServiceClient" src/app/(public) src/app/status src/app/api
-- ---------------------------------------------------------------------------

do $$
declare
  target_fn text;
  target_fns text[] := array[
    'delete_candidate',
    'delete_company',
    'delete_job',
    'record_audit',
    'handle_new_user',
    'current_organization_id',
    'assert_same_org',
    'bump_candidate_last_contacted_at',
    'rls_auto_enable',
    'job_ads_same_org_guard',
    'spec_drafts_same_org_guard'
  ];
  fn_oid oid;
begin
  foreach target_fn in array target_fns loop
    for fn_oid in
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = target_fn
    loop
      execute format('revoke execute on function %s from anon', fn_oid::regprocedure);
    end loop;
  end loop;
end;
$$;
