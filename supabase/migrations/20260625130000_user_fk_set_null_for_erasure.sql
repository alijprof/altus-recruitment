-- Batch B prerequisite — make users deletable (GDPR erasure / remove-teammate).
--
-- PROBLEM: three created_by FKs to public.users were declared NOT NULL +
-- ON DELETE RESTRICT:
--   spec_drafts.created_by, voice_notes.created_by, email_campaigns.created_by
-- (the other 12 created_by/owner FKs are already ON DELETE SET NULL). RESTRICT
-- means a user who ever created a spec draft, voice note, or email campaign can
-- NEVER be deleted — Supabase auth.admin.deleteUser() (which cascades to
-- public.users) fails with a FK violation. That blocks BOTH "remove teammate"
-- (item 5) AND org erasure (item 6), and is incompatible with the GDPR
-- right-to-erasure requirement Batch B exists to satisfy.
--
-- FIX: align these three with the dominant pattern — make created_by nullable
-- and ON DELETE SET NULL. Deleting a user nulls the attribution on their rows
-- (the row/data is preserved, the org keeps it); the rows are only ever
-- hard-deleted when the whole org is erased (organizations CASCADE). Existing
-- rows keep their created_by; NULL only ever appears after a user is deleted.
-- Read paths already tolerate this (the org-scoped views LEFT JOIN users).
--
-- The DO block drops whatever the existing FK on created_by is actually named
-- (no reliance on the conventional <table>_created_by_fkey name), so a single
-- idempotent-ish apply works regardless of how the constraint was generated.

do $$
declare
  t text;
  r record;
begin
  foreach t in array array['spec_drafts', 'voice_notes', 'email_campaigns']
  loop
    -- Drop any existing foreign-key constraint on this table's created_by column.
    for r in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = t
        and con.contype = 'f'
        and con.conkey = array[(
          select attnum from pg_attribute
          where attrelid = rel.oid and attname = 'created_by' and not attisdropped
        )]
    loop
      execute format('alter table public.%I drop constraint %I', t, r.conname);
    end loop;

    -- Make the column nullable and re-add the FK as ON DELETE SET NULL.
    execute format('alter table public.%I alter column created_by drop not null', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (created_by) references public.users(id) on delete set null',
      t, t || '_created_by_fkey'
    );
  end loop;
end$$;
