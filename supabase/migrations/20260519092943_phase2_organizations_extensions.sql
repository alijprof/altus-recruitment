-- Phase 2 organizations extensions: apply_form_enabled + slug format check.
--
-- D2-10 (apply form path-based at /apply/[org_slug]): we add an explicit
-- regex check on `slug` so a row's slug always conforms to the apply-form
-- URL contract. The existing `handle_new_user` trigger already generates
-- slugs in this shape (`lower(name) || '-' || 8-char-id`), so the
-- constraint just hardens the invariant.
--
-- D2-12 (apply_form_enabled toggle): per-org boolean lets an owner disable
-- inbound applications without deleting the org (e.g., during a hiring
-- freeze). Default true preserves current behaviour.
--
-- We use NOT VALID + VALIDATE on the slug check so we don't take a long
-- ACCESS EXCLUSIVE lock when validating against existing rows. The existing
-- rows DO conform to the regex (handle_new_user produces them), so validate
-- succeeds immediately.
--
-- Manual smoke tests after apply:
--
--   -- 1) Valid slug succeeds:
--   update public.organizations set slug = 'acme-co' where id = '<an-org>';
--   -- expect: success
--
--   -- 2) Invalid slug fails:
--   update public.organizations set slug = 'BAD SLUG!' where id = '<an-org>';
--   -- expect: ERROR organizations_slug_format
--
--   -- 3) apply_form_enabled defaults to true on new rows:
--   select apply_form_enabled from public.organizations limit 5;
--   -- expect: every row = true

alter table public.organizations
  add column apply_form_enabled boolean not null default true;

alter table public.organizations
  add constraint organizations_slug_format
  check (slug ~ '^[a-z0-9-]{3,40}$') not valid;

alter table public.organizations validate constraint organizations_slug_format;
