-- REVOKE anon EXECUTE on public.set_created_by().
--
-- Review 2026-08-04 M8: 20260804130000_set_created_by_trigger.sql creates a
-- new public function and never revokes anything, so it inherits Supabase's
-- default privileges — which auto-grant EXECUTE to `anon` on every new
-- function in the public schema. Its sibling
-- 20260804120100_revoke_anon_execute_security_definer.sql closes exactly that
-- hygiene gap, but sorts BEFORE 20260804130000, so its sweep never saw this
-- function. The audit item being closed was precisely "new public functions
-- get an automatic anon grant", so leaving it would re-open it on the same
-- day it was fixed.
--
-- Exploitability is nil today: set_created_by is a TRIGGER function
-- (`returns trigger`), and PostgreSQL rejects a direct call to one — a
-- PostgREST RPC would error rather than do anything. It is also
-- SECURITY INVOKER, so it carries no elevated privilege even if it could be
-- called. This is hygiene, not an incident, and it is filed as its own
-- migration rather than by editing the committed file (append-only rule).
--
-- FILE ONLY — per project hard rules this migration is NOT applied by the
-- executor. The founder pushes it manually via
-- `pnpm exec supabase db push --linked`.
--
-- ---------------------------------------------------------------------------
-- Safety: revoking EXECUTE cannot break trigger firing.
--
-- PostgreSQL checks EXECUTE on a trigger function at CREATE TRIGGER time, not
-- at fire time, and the trigger runs in the table owner's context rather than
-- the querying role's. The five triggers installed by 20260804130000
-- (candidates / companies / contacts / jobs / applications _set_created_by)
-- are therefore unaffected — the same analysis 20260804120100 records for
-- handle_new_user, bump_candidate_last_contacted_at and the two same-org
-- guards.
--
-- `anon` and `public` ONLY. `authenticated` and `service_role` are untouched;
-- neither needs a direct grant here, and removing one would be a behaviour
-- change rather than hygiene.
--
-- The pg_proc-driven loop (same shape as 20260804120100) is used so this is a
-- safe no-op if the function does not exist — e.g. on an environment where
-- 20260804130000 has not been applied yet, or if it is dropped later. A
-- hardcoded `revoke ... on function public.set_created_by()` would fail the
-- whole migration in that case. Idempotent: running it twice is a no-op.

do $$
declare
  fn_oid oid;
begin
  for fn_oid in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_created_by'
  loop
    execute format('revoke all on function %s from public', fn_oid::regprocedure);
    execute format('revoke execute on function %s from anon', fn_oid::regprocedure);
  end loop;
end;
$$;
