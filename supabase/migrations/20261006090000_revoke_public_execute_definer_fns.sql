-- REVOKE the PUBLIC execute grant on the audited SECURITY DEFINER functions.
--
-- Follow-up to 20260804120100_revoke_anon_execute_security_definer.sql. That
-- migration revoked EXECUTE from `anon` directly, but six of its targets also
-- carry the default PUBLIC grant (proacl `=X/postgres`), and `anon` inherits
-- EXECUTE through PUBLIC. Verified on production 2026-10-03 after the push:
-- has_function_privilege('anon', …, 'execute') was still TRUE for
--   assert_same_org, bump_candidate_last_contacted_at, handle_new_user,
--   job_ads_same_org_guard, rls_auto_enable, spec_drafts_same_org_guard
-- and the Supabase security advisor still flagged all six
-- (anon_security_definer_function_executable).
--
-- Real exposure: assert_same_org(regclass, uuid, uuid) is callable over
-- PostgREST RPC by an anonymous caller, and its exception text names the
-- owning organisation id of any row whose UUID the caller supplies. The other
-- five are trigger functions (a direct RPC call errors) — hygiene only.
--
-- Safety: `authenticated` and `service_role` hold EXPLICIT grants on all six
-- (proacl `authenticated=X/postgres`, `service_role=X/postgres`), so removing
-- PUBLIC does not change their access. assert_same_org is invoked from
-- SECURITY INVOKER guard triggers (e.g. candidate_branded_cvs_same_org_guard)
-- under the inserting role — always authenticated or service_role in this
-- app (the public apply form uses the service-role client). Trigger functions
-- themselves are not EXECUTE-checked at fire time.
--
-- pg_proc-driven loop (same shape as 20260804120100): handles overloads, is a
-- no-op for a name that doesn't exist, and is idempotent.

do $$
declare
  target_fn text;
  target_fns text[] := array[
    'assert_same_org',
    'bump_candidate_last_contacted_at',
    'handle_new_user',
    'job_ads_same_org_guard',
    'rls_auto_enable',
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
      execute format('revoke execute on function %s from public', fn_oid::regprocedure);
      execute format('revoke execute on function %s from anon', fn_oid::regprocedure);
    end loop;
  end loop;
end;
$$;
