-- Dev seed. Two orgs so we can manually verify RLS isolation.
--
-- Auth users are created with `supabase auth.users` directly (bypasses our
-- on_auth_user_created trigger so we can deterministically link to the orgs
-- below; the trigger would otherwise spawn its own org for each).
--
-- Sign in to either of these locally by sending a magic link to the email
-- via the sign-in form, or by using `supabase auth ...` admin commands.
--
-- Plan 5 Task 5.3 E2E note: the owner@acme-recruitment.test user below has a
-- deterministic password (`AltusTestPassword!1`) so Playwright global-setup
-- can sign in via auth.admin.generateLink / signInWithPassword without
-- intercepting magic-link email. Password is dev-local only.

-- ---------------------------------------------------------------------------
-- Org A: Acme Recruitment — the rich dataset
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  raw_user_meta_data, created_at, updated_at, confirmation_sent_at, email_confirmed_at)
values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner@acme-recruitment.test',
   -- crypt(...) hashes the Playwright E2E password ("AltusTestPassword!1") at
   -- seed time so signInWithPassword works without a magic-link round-trip.
   crypt('AltusTestPassword!1', gen_salt('bf')),
   '{"full_name":"Alex Owner","organization_name":"Acme Recruitment"}'::jsonb,
   now(), now(), now(), now())
on conflict (id) do nothing;

-- The on_auth_user_created trigger handles org + public.users insertion for
-- this row. Capture the generated org id for the rest of the seed.
do $$
declare
  v_org_a uuid;
  v_owner_a uuid := '00000000-0000-0000-0000-00000000a001';
  v_org_b uuid;
  v_owner_b uuid := '00000000-0000-0000-0000-00000000b001';
  v_acme_co uuid;
  v_globex_co uuid;
  v_initech_co uuid;
  v_contact_1 uuid;
  v_contact_2 uuid;
  v_cand_1 uuid;
  v_cand_2 uuid;
  v_cand_3 uuid;
  v_cand_4 uuid;
  v_cand_5 uuid;
  v_cand_6 uuid;
  v_job_1 uuid;
  v_job_2 uuid;
  v_job_3 uuid;
  v_app_1 uuid;
  v_app_2 uuid;
begin
  -- Org B owner inserted here so both orgs are present before we fan out data.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at, confirmation_sent_at, email_confirmed_at)
  values
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner@brightline-search.test',
     '{"full_name":"Bella Owner","organization_name":"Brightline Search"}'::jsonb,
     now(), now(), now(), now())
  on conflict (id) do nothing;

  select organization_id into v_org_a from public.users where id = v_owner_a;
  select organization_id into v_org_b from public.users where id = v_owner_b;

  if v_org_a is null or v_org_b is null then
    raise notice 'Seed: trigger did not create org rows; aborting domain seed.';
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Org A: companies + contacts
  -- -------------------------------------------------------------------------
  insert into public.companies (organization_id, name, industry, website, last_contacted_at, created_by)
  values
    (v_org_a, 'Crown Estate', 'Energy / Offshore Wind', 'https://crown.example', now() - interval '2 days', v_owner_a),
    (v_org_a, 'Globex Maritime', 'Maritime', 'https://globex.example', now() - interval '30 days', v_owner_a),
    (v_org_a, 'Initech Systems', 'SaaS', 'https://initech.example', now() - interval '5 days', v_owner_a);

  select id into v_acme_co from public.companies where organization_id = v_org_a and name = 'Crown Estate';
  select id into v_globex_co from public.companies where organization_id = v_org_a and name = 'Globex Maritime';
  select id into v_initech_co from public.companies where organization_id = v_org_a and name = 'Initech Systems';

  insert into public.contacts (organization_id, company_id, full_name, role_title, email, phone, last_contacted_at, created_by)
  values
    (v_org_a, v_acme_co, 'Sam Director', 'Head of Engineering', 'sam@crown.example', '+44 20 7946 0001', now() - interval '2 days', v_owner_a),
    (v_org_a, v_acme_co, 'Rita Lead', 'Lead Recruiter', 'rita@crown.example', '+44 20 7946 0002', now() - interval '4 days', v_owner_a),
    (v_org_a, v_globex_co, 'Jules Captain', 'Operations Director', 'jules@globex.example', '+44 20 7946 0010', now() - interval '30 days', v_owner_a),
    (v_org_a, v_initech_co, 'Mike Bolton', 'CTO', 'mike@initech.example', '+44 20 7946 0020', now() - interval '5 days', v_owner_a);
  select id into v_contact_1 from public.contacts where organization_id = v_org_a and email = 'sam@crown.example';
  select id into v_contact_2 from public.contacts where organization_id = v_org_a and email = 'jules@globex.example';

  -- -------------------------------------------------------------------------
  -- Org A: candidates
  -- -------------------------------------------------------------------------
  insert into public.candidates (
    organization_id, full_name, email, phone, location, current_role_title, current_company,
    market_status, source, salary_current_estimate, salary_expectation, seniority_level,
    years_experience, sector_tags, skills, consent_basis, consent_at, consent_text_version, created_by
  ) values
    (v_org_a, 'Priya Patel', 'priya.patel@example.test', '+44 7700 900001', 'Aberdeen',
     'Senior Python Engineer', 'NorthWind Renewables',
     'actively_looking', 'linkedin', 75000, 90000, 'senior',
     8.5, array['offshore_wind', 'energy'], array['python', 'kubernetes', 'aws'],
     'legitimate_interest', now() - interval '14 days', '2026-01-v1', v_owner_a),
    (v_org_a, 'Marcus Reid', 'marcus.reid@example.test', '+44 7700 900002', 'Edinburgh',
     'Lead Backend Engineer', 'FintechHaus',
     'passively_looking', 'referral', 95000, 110000, 'lead',
     11.0, array['fintech'], array['go', 'postgres', 'kafka'],
     'consent', now() - interval '60 days', '2025-09-v1', v_owner_a),
    (v_org_a, 'Aisha Khan', 'aisha.khan@example.test', '+44 7700 900003', 'London',
     'Staff Site Reliability Engineer', 'Crown Estate',
     'hot', 'event', 110000, 130000, 'staff',
     12.0, array['energy'], array['terraform', 'kubernetes', 'observability'],
     'consent', now() - interval '7 days', '2026-01-v1', v_owner_a),
    (v_org_a, 'Tom Whittaker', 'tom.whittaker@example.test', '+44 7700 900004', 'Aberdeen',
     'Subsea Engineer', 'SubseaWorks',
     'placed', 'apply_form', 68000, 75000, 'senior',
     9.0, array['offshore_wind', 'subsea'], array['solidworks', 'ansys'],
     'consent', now() - interval '180 days', '2025-09-v1', v_owner_a),
    (v_org_a, 'Hannah Liu', 'hannah.liu@example.test', '+44 7700 900005', 'Bristol',
     'Product Manager', 'Initech Systems',
     'passively_looking', 'linkedin', 82000, 95000, 'senior',
     7.0, array['saas', 'b2b'], array['discovery', 'roadmapping', 'sql'],
     'legitimate_interest', now() - interval '40 days', '2025-09-v1', v_owner_a),
    (v_org_a, 'Owen Davies', 'owen.davies@example.test', '+44 7700 900006', 'Cardiff',
     'Senior DevOps Engineer', 'GreenGrid',
     'cold', 'apply_form', 70000, 80000, 'senior',
     6.0, array['energy'], array['gitlab', 'ansible', 'aws'],
     'consent', now() - interval '300 days', '2024-06-v1', v_owner_a);

  select id into v_cand_1 from public.candidates where email = 'priya.patel@example.test';
  select id into v_cand_2 from public.candidates where email = 'marcus.reid@example.test';
  select id into v_cand_3 from public.candidates where email = 'aisha.khan@example.test';
  select id into v_cand_4 from public.candidates where email = 'tom.whittaker@example.test';
  select id into v_cand_5 from public.candidates where email = 'hannah.liu@example.test';
  select id into v_cand_6 from public.candidates where email = 'owen.davies@example.test';

  -- -------------------------------------------------------------------------
  -- Org A: jobs
  -- -------------------------------------------------------------------------
  insert into public.jobs (
    organization_id, company_id, owner_user_id, title, location, job_type, hiring_context,
    status, description, salary_min, salary_max, fee_percent, created_by
  ) values
    (v_org_a, v_acme_co, v_owner_a, 'Senior SRE — Offshore Wind Platform', 'London / Hybrid',
     'perm', 'new_role', 'open',
     'Build and operate the data platform powering offshore wind asset management.',
     95000, 125000, 20.00, v_owner_a),
    (v_org_a, v_globex_co, v_owner_a, 'Subsea Operations Engineer', 'Aberdeen',
     'perm', 'backfill', 'open',
     'Replacement for departing Subsea Ops engineer. ROV experience essential.',
     65000, 78000, 18.00, v_owner_a),
    (v_org_a, v_initech_co, v_owner_a, 'Senior Product Manager — Platform', 'Bristol / Hybrid',
     'perm', 'new_role', 'draft',
     'Lead the platform PM function as Initech rebuilds the developer-tools stack.',
     85000, 105000, 22.00, v_owner_a);

  select id into v_job_1 from public.jobs where organization_id = v_org_a and title = 'Senior SRE — Offshore Wind Platform';
  select id into v_job_2 from public.jobs where organization_id = v_org_a and title = 'Subsea Operations Engineer';
  select id into v_job_3 from public.jobs where organization_id = v_org_a and title = 'Senior Product Manager — Platform';

  -- -------------------------------------------------------------------------
  -- Org A: applications across stages
  -- -------------------------------------------------------------------------
  insert into public.applications (
    organization_id, candidate_id, job_id, stage, application_type, owner_user_id, created_by
  ) values
    (v_org_a, v_cand_1, v_job_1, 'cv_submitted', 'standard', v_owner_a, v_owner_a),
    (v_org_a, v_cand_3, v_job_1, 'first_interview', 'standard', v_owner_a, v_owner_a),
    (v_org_a, v_cand_2, v_job_1, 'screening', 'standard', v_owner_a, v_owner_a),
    (v_org_a, v_cand_4, v_job_2, 'second_interview', 'standard', v_owner_a, v_owner_a),
    (v_org_a, v_cand_5, v_job_3, 'applied', 'standard', v_owner_a, v_owner_a);

  -- One rejected application with the required decline reason
  insert into public.applications (
    organization_id, candidate_id, job_id, stage, application_type,
    decline_reason, declined_at, owner_user_id, created_by
  ) values
    (v_org_a, v_cand_6, v_job_1, 'rejected', 'standard',
     'salary_mismatch', now() - interval '2 days', v_owner_a, v_owner_a);

  -- -------------------------------------------------------------------------
  -- Org A: activities (sample timeline entries)
  -- -------------------------------------------------------------------------
  insert into public.activities (organization_id, kind, body, actor_user_id, entity_type, entity_id)
  values
    (v_org_a, 'note', 'Initial screen — strong K8s background.', v_owner_a, 'candidate', v_cand_1),
    (v_org_a, 'call',  '20 min intro call. Open to remote.',     v_owner_a, 'candidate', v_cand_2),
    (v_org_a, 'meeting', 'Spec call with Sam at Crown.',         v_owner_a, 'company',   v_acme_co),
    (v_org_a, 'note', 'Submitted Priya for SRE role.',           v_owner_a, 'job',       v_job_1);

  -- -------------------------------------------------------------------------
  -- Org A: ai_usage sample row via the security-definer helper
  -- -------------------------------------------------------------------------
  perform public.record_ai_usage(
    v_org_a, 'claude-haiku-4-5-20251001', 'cv_parse',
    1820, 540, 1, 1240, v_owner_a
  );

  -- -------------------------------------------------------------------------
  -- Org B: minimal data so we can verify RLS isolation
  -- -------------------------------------------------------------------------
  insert into public.companies (organization_id, name, industry, website, created_by)
  values (v_org_b, 'Brightline Client Co', 'Fintech', 'https://brightline-client.example', v_owner_b);

  insert into public.candidates (
    organization_id, full_name, email, location, market_status, source,
    consent_basis, consent_at, consent_text_version, created_by
  ) values
    (v_org_b, 'Org B Confidential Candidate', 'confidential@example.test', 'Manchester',
     'actively_looking', 'apply_form',
     'consent', now() - interval '3 days', '2026-01-v1', v_owner_b);
end $$;
