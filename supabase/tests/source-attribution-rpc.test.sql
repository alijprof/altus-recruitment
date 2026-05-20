-- Phase 3 / Plan 03-06 / Task F.2 — REPEAT-02 (D3-22).
--
-- DB-level integration test for `source_attribution_summary(p_from, p_to)`
-- per the migration `20260520023200_phase3_source_attribution_rpc.sql`.
--
-- This file replaces the Plan 0 placeholder and asserts:
--
--   (A) Cross-org invisibility (D3-22 + security invoker)
--       --  As org-A's authenticated user, calling the RPC returns ONLY
--           rows whose underlying applications belong to org-A.
--       --  org-B's placed applications in the same date window must NOT
--           appear in org-A's aggregation.
--
--   (B) CRITICAL-3 (plan-check 2026-05-19) — the
--       `coalesce(placed_at, stage_changed_at)` branch is exercised both
--       ways:
--       --  Seed 4 placed applications for org-A, all `linkedin` source so
--           they aggregate into a single row.
--           * 2 rows have `placed_at IS NOT NULL` (recruiter filled fee +
--             placed_at later) — these contribute `placed_at` to the avg.
--           * 2 rows have `placed_at IS NULL` (legacy / quick-place) — these
--             fall back to `stage_changed_at` via coalesce.
--       --  Assert `avg_time_to_place_days` equals the average across ALL 4
--           rows. If the RPC silently dropped the NULL branch, the avg
--           would equal only the avg of the explicit-placed_at rows.
--
--   (C) Date filter
--       --  `coalesce(placed_at, stage_changed_at)::date BETWEEN p_from AND p_to`
--           — rows outside the window must be excluded.
--
--   (D) total_fee_pence aggregation
--       --  NULL fee_pence sums to 0 (coalesce), not group-eliminating.
--
--   (E) Grant
--       --  EXECUTE is granted to authenticated; NOT to anon.
--
-- Local invocation:
--   psql --file supabase/tests/source-attribution-rpc.test.sql -d <db>
--
-- Wrapped in BEGIN/ROLLBACK so the seed never persists. Manual seed in PL/pgSQL
-- mirrors `supabase/tests/applications-float-null-job.test.sql` style.

begin;

do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_cand_a_linkedin uuid;
  v_cand_a_apply uuid;
  v_cand_b_linkedin uuid;
  v_job_a uuid;
  v_job_b uuid;

  -- We INSERT placed applications with explicit stage_changed_at and
  -- created_at values so the avg time-to-place is deterministic.
  v_now timestamptz := now();

  -- For CRITICAL-3: 4 placed applications, all linkedin source.
  --   row1: placed_at IS NOT NULL, days-to-place = 30
  --   row2: placed_at IS NOT NULL, days-to-place = 50
  --   row3: placed_at IS NULL, falls back to stage_changed_at, days = 10
  --   row4: placed_at IS NULL, falls back to stage_changed_at, days = 20
  -- avg = (30 + 50 + 10 + 20) / 4 = 27.5 days.
  v_expected_avg numeric := 27.5;

  v_actual_avg numeric;
  v_actual_count int;
  v_actual_fee_pence bigint;
  v_visible_orgs int;
  v_anon_can_execute boolean;
begin
  select id into v_org_a from public.organizations order by created_at limit 1;
  select id into v_org_b from public.organizations where id <> v_org_a order by created_at limit 1;
  if v_org_a is null or v_org_b is null then
    raise notice 'SKIP: need at least two organizations in seed data';
    return;
  end if;

  -- Two candidates in org-A: one linkedin (4 placed apps), one apply_form
  -- (for source-grouping assertion). One candidate in org-B (cross-org
  -- visibility test).
  select id into v_cand_a_linkedin
    from public.candidates
    where organization_id = v_org_a and source = 'linkedin'
    order by created_at limit 1;
  select id into v_cand_a_apply
    from public.candidates
    where organization_id = v_org_a and source = 'apply_form'
    order by created_at limit 1;
  select id into v_cand_b_linkedin
    from public.candidates
    where organization_id = v_org_b and source = 'linkedin'
    order by created_at limit 1;
  select id into v_job_a from public.jobs where organization_id = v_org_a limit 1;
  select id into v_job_b from public.jobs where organization_id = v_org_b limit 1;

  if v_cand_a_linkedin is null or v_cand_a_apply is null
     or v_cand_b_linkedin is null or v_job_a is null or v_job_b is null then
    raise notice 'SKIP: need linkedin + apply_form candidates per org and a job each';
    return;
  end if;

  -- Clear any prior placed apps for these candidates so the test seed is
  -- deterministic (the BEGIN/ROLLBACK guarantees this is reverted anyway).
  delete from public.applications
   where candidate_id in (v_cand_a_linkedin, v_cand_a_apply, v_cand_b_linkedin)
     and stage = 'placed';

  -- ---------------------------------------------------------------------
  -- Seed 4 placed linkedin apps for org-A (CRITICAL-3 fixture).
  -- Insert standard application_type so the existing CHECK constraints
  -- (job_id required unless float) are satisfied. We use stage='applied'
  -- on insert then UPDATE to 'placed' with the explicit timestamps —
  -- inserting directly into stage='placed' would trip
  -- decline_reason_present_when_terminal? No — terminal stages are
  -- 'rejected' and 'withdrawn' (per Phase 1 schema line 318).
  -- ---------------------------------------------------------------------
  -- row1: placed_at NOT NULL, 30-day placement
  insert into public.applications
    (organization_id, candidate_id, job_id, application_type, stage,
     created_at, stage_changed_at, placed_at, fee_pence)
  values
    (v_org_a, v_cand_a_linkedin, v_job_a, 'standard', 'placed',
     v_now - interval '60 days', v_now - interval '30 days',
     v_now - interval '30 days', 500000);

  -- row2: placed_at NOT NULL, 50-day placement
  -- Reuse same candidate+job: candidate_job_type_unique blocks duplicates,
  -- so use a different application_type? No — placed twice on same job is
  -- nonsensical anyway. Instead create a SECOND candidate in org-A so the
  -- two linkedin placements roll up. Look up another linkedin candidate.
  declare
    v_cand_a_linkedin_2 uuid;
  begin
    select id into v_cand_a_linkedin_2
      from public.candidates
      where organization_id = v_org_a and source = 'linkedin' and id <> v_cand_a_linkedin
      order by created_at limit 1;
    if v_cand_a_linkedin_2 is null then
      raise notice 'SKIP: need at least 2 linkedin candidates in org-A for CRITICAL-3 test';
      return;
    end if;

    insert into public.applications
      (organization_id, candidate_id, job_id, application_type, stage,
       created_at, stage_changed_at, placed_at, fee_pence)
    values
      (v_org_a, v_cand_a_linkedin_2, v_job_a, 'standard', 'placed',
       v_now - interval '100 days', v_now - interval '50 days',
       v_now - interval '50 days', 750000);

    -- row3: placed_at NULL → falls back to stage_changed_at, 10-day placement.
    -- Use a third linkedin candidate.
    declare
      v_cand_a_linkedin_3 uuid;
    begin
      select id into v_cand_a_linkedin_3
        from public.candidates
        where organization_id = v_org_a and source = 'linkedin'
          and id not in (v_cand_a_linkedin, v_cand_a_linkedin_2)
        order by created_at limit 1;
      if v_cand_a_linkedin_3 is null then
        raise notice 'SKIP: need at least 3 linkedin candidates in org-A for CRITICAL-3 test';
        return;
      end if;
      insert into public.applications
        (organization_id, candidate_id, job_id, application_type, stage,
         created_at, stage_changed_at, placed_at, fee_pence)
      values
        (v_org_a, v_cand_a_linkedin_3, v_job_a, 'standard', 'placed',
         v_now - interval '20 days', v_now - interval '10 days',
         null, null);

      -- row4: placed_at NULL, 20-day placement.
      declare
        v_cand_a_linkedin_4 uuid;
      begin
        select id into v_cand_a_linkedin_4
          from public.candidates
          where organization_id = v_org_a and source = 'linkedin'
            and id not in (v_cand_a_linkedin, v_cand_a_linkedin_2, v_cand_a_linkedin_3)
          order by created_at limit 1;
        if v_cand_a_linkedin_4 is null then
          raise notice 'SKIP: need at least 4 linkedin candidates in org-A for CRITICAL-3 test';
          return;
        end if;
        insert into public.applications
          (organization_id, candidate_id, job_id, application_type, stage,
           created_at, stage_changed_at, placed_at, fee_pence)
        values
          (v_org_a, v_cand_a_linkedin_4, v_job_a, 'standard', 'placed',
           v_now - interval '40 days', v_now - interval '20 days',
           null, 250000);
      end;
    end;
  end;

  -- Seed an apply_form placed app for org-A so the report has 2 source rows.
  insert into public.applications
    (organization_id, candidate_id, job_id, application_type, stage,
     created_at, stage_changed_at, placed_at, fee_pence)
  values
    (v_org_a, v_cand_a_apply, v_job_a, 'standard', 'placed',
     v_now - interval '60 days', v_now - interval '15 days',
     v_now - interval '15 days', 300000);

  -- Seed a placed linkedin app for org-B. Org-A's RPC call must NOT see it.
  insert into public.applications
    (organization_id, candidate_id, job_id, application_type, stage,
     created_at, stage_changed_at, placed_at, fee_pence)
  values
    (v_org_b, v_cand_b_linkedin, v_job_b, 'standard', 'placed',
     v_now - interval '40 days', v_now - interval '10 days',
     v_now - interval '10 days', 999999);

  -- ---------------------------------------------------------------------
  -- Assertion (A) — cross-org invisibility.
  --
  -- Switch role to a user in org-A. The RPC's security invoker model means
  -- RLS on applications/candidates filters out org-B rows automatically.
  -- ---------------------------------------------------------------------
  declare
    v_user_a uuid;
    v_user_b uuid;
  begin
    select id into v_user_a from public.users where organization_id = v_org_a limit 1;
    select id into v_user_b from public.users where organization_id = v_org_b limit 1;
    if v_user_a is null or v_user_b is null then
      raise notice 'SKIP: need a user per organization';
      return;
    end if;

    -- Org-A view.
    perform set_config('request.jwt.claim.sub', v_user_a::text, true);
    perform set_config('role', 'authenticated', true);
    set local role authenticated;

    -- (A) cross-org check: every row returned must be from org-A. We can't
    -- directly inspect organization_id on the RPC result, but the count of
    -- distinct linkedin placements should be exactly 4 (org-A's). If org-B
    -- bled in, we'd see 5.
    select placements_count, avg_time_to_place_days, total_fee_pence
      into v_actual_count, v_actual_avg, v_actual_fee_pence
      from public.source_attribution_summary(
        (v_now - interval '365 days')::date,
        (v_now + interval '1 day')::date
      )
      where source = 'linkedin';

    if v_actual_count is null then
      raise exception 'source-attribution test (A): linkedin row missing from org-A view';
    end if;

    if v_actual_count <> 4 then
      raise exception 'source-attribution test (A): expected 4 linkedin placements for org-A, got %', v_actual_count;
    end if;

    -- (D) total_fee_pence: row1=500000 + row2=750000 + row3=NULL→0 + row4=250000 = 1_500_000.
    if v_actual_fee_pence <> 1500000 then
      raise exception 'source-attribution test (D): expected fee_pence 1_500_000, got %', v_actual_fee_pence;
    end if;

    -- (B) CRITICAL-3: avg_time_to_place_days must be the average of ALL 4
    -- rows (30, 50, 10, 20) = 27.5. If the NULL branch were dropped the
    -- avg would be (30+50)/2 = 40.
    if round(v_actual_avg, 1) <> round(v_expected_avg, 1) then
      raise exception 'source-attribution test (B / CRITICAL-3): expected avg_time_to_place_days = %, got % (NULL placed_at branch silently dropped?)',
        v_expected_avg, v_actual_avg;
    end if;

    -- Reset role and switch to org-B user.
    reset role;
    perform set_config('request.jwt.claim.sub', v_user_b::text, true);
    set local role authenticated;

    select count(*) into v_visible_orgs
      from public.source_attribution_summary(
        (v_now - interval '365 days')::date,
        (v_now + interval '1 day')::date
      );

    -- Org-B has exactly 1 placed app (linkedin); org-A's 5 placements
    -- must be invisible.
    if v_visible_orgs <> 1 then
      raise exception 'source-attribution test (A): org-B should see exactly 1 source row, got %', v_visible_orgs;
    end if;

    reset role;
  end;

  -- ---------------------------------------------------------------------
  -- Assertion (C) — date filter excludes rows outside the window.
  --
  -- Use a narrow window (last 3 days). Every seeded row is older than 10
  -- days, so the result should be empty for org-A.
  -- ---------------------------------------------------------------------
  declare
    v_user_a uuid;
    v_narrow_count int;
  begin
    select id into v_user_a from public.users where organization_id = v_org_a limit 1;
    perform set_config('request.jwt.claim.sub', v_user_a::text, true);
    set local role authenticated;

    select count(*) into v_narrow_count
      from public.source_attribution_summary(
        (v_now - interval '3 days')::date,
        v_now::date
      );

    if v_narrow_count <> 0 then
      raise exception 'source-attribution test (C): narrow window expected 0 rows, got %', v_narrow_count;
    end if;

    reset role;
  end;

  -- ---------------------------------------------------------------------
  -- Assertion (E) — grant: anon role must NOT be able to execute.
  -- ---------------------------------------------------------------------
  select has_function_privilege(
    'anon',
    'public.source_attribution_summary(date, date)',
    'EXECUTE'
  ) into v_anon_can_execute;

  if v_anon_can_execute then
    raise exception 'source-attribution test (E): anon must NOT have EXECUTE on source_attribution_summary';
  end if;

  raise notice 'source-attribution-rpc tests passed: cross-org isolation OK; CRITICAL-3 NULL placed_at branch averaged with NOT-NULL rows; date filter OK; anon denied';
end$$;

rollback;
