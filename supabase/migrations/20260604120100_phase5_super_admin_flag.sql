-- Phase 5 Wave 0: super_admin flag on the founder account.
--
-- PURPOSE: Marks the founder's Supabase Auth user with `super_admin: true`
-- in raw_app_meta_data. The Phase 5 admin panel (05-05) reads this flag to
-- grant cross-tenant visibility without needing a separate role/table.
--
-- HOW TO USE (Task 0.4 [BLOCKING]):
-- After running `pnpm exec supabase db push --linked`, confirm the flag is
-- set by running in the Supabase Dashboard SQL editor:
--
--   select raw_app_meta_data->>'super_admin'
--   from auth.users
--   where email = 'alasdairj8@gmail.com';
--   -- expect: 'true'
--
-- If the guarded DO block below did not set it (e.g., the user was created
-- after the migration ran on a fresh DB), run the UPDATE manually in the
-- SQL editor:
--
--   update auth.users
--   set raw_app_meta_data = raw_app_meta_data || '{"super_admin": true}'::jsonb
--   where email = 'alasdairj8@gmail.com';
--
-- SAFETY: This migration is wrapped in a DO block with an existence guard
-- so `pnpm exec supabase db push --linked` is safe on a fresh database
-- (e.g., during CI or a new developer onboarding) where the founder's
-- account does not yet exist — the block silently skips rather than
-- erroring with "0 rows updated".
--
-- The merge operator (`||`) is additive: it sets super_admin=true without
-- disturbing other existing app_metadata fields.

do $$
begin
  if exists (
    select 1 from auth.users where email = 'alasdairj8@gmail.com'
  ) then
    update auth.users
    set raw_app_meta_data = raw_app_meta_data || '{"super_admin": true}'::jsonb
    where email = 'alasdairj8@gmail.com';
  end if;
end
$$;
