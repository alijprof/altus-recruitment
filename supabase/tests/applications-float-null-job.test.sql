-- Harness for the Phase 3 / Plan 03-03 / Task C.1 migrations:
--   * 20260520010418_phase3_application_type_shortlist.sql
--   * 20260520010419_phase3_applications_nullable_job_id.sql
--   * 20260520010420_phase3_applications_same_org_guard_null_safe.sql
--
-- Asserts the SHORT-02 invariants:
--   1. INSERT with application_type='float' AND job_id IS NULL — succeeds.
--   2. INSERT with application_type='standard' AND job_id IS NULL — fails
--      `applications_job_id_required_unless_float`.
--   3. INSERT with application_type='shortlist' AND job_id IS NULL — fails
--      the same CHECK (only floats may have NULL job_id).
--   4. INSERT a row with cross-tenant candidate — still fails the same-org
--      guard (NULL-safety did not break the candidate branch).
--   5. INSERT a normal standard row with same-org candidate + job —
--      succeeds (regression: the guard's candidate branch is still active).
--   6. Two floats for the same candidate may coexist (NULLs distinct in
--      `applications_candidate_job_type_unique`).
--   7. The 'shortlist' enum label is present in pg_enum.
--
-- Local invocation:
--   psql --file supabase/tests/applications-float-null-job.test.sql -d <db>
-- The file asserts DB-level behaviour and is NOT run from the Node test
-- suite. Wire into a `pnpm db:test` script later if CI catches up.

begin;

do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_cand_a uuid;
  v_cand_b uuid;
  v_job_a uuid;
  v_sql_state text;
  v_sql_msg text;
  v_float_ok boolean := false;
  v_std_null_ok boolean := false;
  v_shortlist_null_ok boolean := false;
  v_cross_tenant_ok boolean := false;
  v_normal_ok boolean := false;
  v_two_floats_ok boolean := false;
begin
  select id into v_org_a from public.organizations order by created_at limit 1;
  select id into v_org_b from public.organizations where id <> v_org_a order by created_at limit 1;
  if v_org_a is null or v_org_b is null then
    raise notice 'SKIP: need at least two organizations in seed data';
    return;
  end if;

  select id into v_cand_a from public.candidates where organization_id = v_org_a limit 1;
  select id into v_cand_b from public.candidates where organization_id = v_org_b limit 1;
  select id into v_job_a from public.jobs where organization_id = v_org_a limit 1;
  if v_cand_a is null or v_cand_b is null or v_job_a is null then
    raise notice 'SKIP: need candidates + a job per org in seed data';
    return;
  end if;

  -- (1) float with NULL job_id — succeeds.
  begin
    insert into public.applications (organization_id, candidate_id, job_id, application_type)
      values (v_org_a, v_cand_a, null, 'float');
    v_float_ok := true;
  exception when others then
    get stacked diagnostics v_sql_state = returned_sqlstate, v_sql_msg = message_text;
    raise notice 'FAIL (1) float with NULL job_id should succeed but raised %: %', v_sql_state, v_sql_msg;
  end;

  -- (2) standard with NULL job_id — fails CHECK.
  begin
    insert into public.applications (organization_id, candidate_id, job_id, application_type)
      values (v_org_a, v_cand_a, null, 'standard');
    raise notice 'FAIL (2) standard with NULL job_id should have failed CHECK but succeeded';
  exception when check_violation then
    v_std_null_ok := true;
  when others then
    get stacked diagnostics v_sql_state = returned_sqlstate, v_sql_msg = message_text;
    raise notice 'FAIL (2) expected check_violation, got %: %', v_sql_state, v_sql_msg;
  end;

  -- (3) shortlist with NULL job_id — fails CHECK.
  begin
    insert into public.applications (organization_id, candidate_id, job_id, application_type)
      values (v_org_a, v_cand_a, null, 'shortlist');
    raise notice 'FAIL (3) shortlist with NULL job_id should have failed CHECK but succeeded';
  exception when check_violation then
    v_shortlist_null_ok := true;
  when others then
    get stacked diagnostics v_sql_state = returned_sqlstate, v_sql_msg = message_text;
    raise notice 'FAIL (3) expected check_violation, got %: %', v_sql_state, v_sql_msg;
  end;

  -- (4) cross-tenant candidate on a normal (non-float) insert — same-org guard fires.
  begin
    insert into public.applications (organization_id, candidate_id, job_id, application_type)
      values (v_org_a, v_cand_b, v_job_a, 'standard');
    raise notice 'FAIL (4) cross-tenant candidate should fire same-org guard but succeeded';
  exception when others then
    get stacked diagnostics v_sql_state = returned_sqlstate, v_sql_msg = message_text;
    if v_sql_msg like 'cross-tenant FK guard:%' then
      v_cross_tenant_ok := true;
    else
      raise notice 'FAIL (4) expected cross-tenant FK guard message, got %: %', v_sql_state, v_sql_msg;
    end if;
  end;

  -- (5) regression: same-org standard insert with both candidate + job — succeeds.
  begin
    insert into public.applications (organization_id, candidate_id, job_id, application_type)
      values (v_org_a, v_cand_a, v_job_a, 'standard')
      on conflict (candidate_id, job_id, application_type) do nothing;
    v_normal_ok := true;
  exception when others then
    get stacked diagnostics v_sql_state = returned_sqlstate, v_sql_msg = message_text;
    raise notice 'FAIL (5) same-org standard should succeed but raised %: %', v_sql_state, v_sql_msg;
  end;

  -- (6) two floats for the same candidate — NULLs distinct in unique constraint.
  begin
    insert into public.applications (organization_id, candidate_id, job_id, application_type)
      values (v_org_a, v_cand_a, null, 'float');
    v_two_floats_ok := true;
  exception when others then
    get stacked diagnostics v_sql_state = returned_sqlstate, v_sql_msg = message_text;
    raise notice 'FAIL (6) second float for same candidate should succeed but raised %: %', v_sql_state, v_sql_msg;
  end;

  raise notice 'Results: float_null_job=% standard_null_job_fails_check=% shortlist_null_job_fails_check=% cross_tenant_blocked=% normal_insert_ok=% two_floats_ok=%',
    v_float_ok, v_std_null_ok, v_shortlist_null_ok, v_cross_tenant_ok, v_normal_ok, v_two_floats_ok;

  if not (v_float_ok and v_std_null_ok and v_shortlist_null_ok and v_cross_tenant_ok and v_normal_ok and v_two_floats_ok) then
    raise exception 'applications-float-null-job test: at least one assertion failed (see notices above)';
  end if;
end$$;

-- (7) Enum label presence — independent of seed data.
do $$
declare
  v_has_shortlist boolean;
begin
  select exists (
    select 1
    from pg_enum
    where enumtypid = 'public.application_type'::regtype
      and enumlabel = 'shortlist'
  ) into v_has_shortlist;
  if not v_has_shortlist then
    raise exception 'applications-float-null-job test (7): application_type enum missing ''shortlist''';
  end if;
end$$;

rollback;
