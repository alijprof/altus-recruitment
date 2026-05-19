-- record_audit_anonymous — security-definer audit writer for anonymous
-- actors (currently the public apply form; D2-14).
--
-- The existing public.record_audit() function requires
-- public.current_organization_id() to be set, which is null in an
-- unauthenticated request. We can't extend it with a nullable actor
-- without breaking the org-presence invariant for authenticated callers,
-- so we add a sibling function with a different contract:
--   * organization_id passed explicitly (server resolved it via slug)
--   * actor_user_id always null (this is the apply path — no auth)
--   * granted to SERVICE_ROLE only (no authenticated path should ever
--     produce a null-actor audit row — that would be a forensics hole)
--
-- Plan 3 calls this from the apply-form server action (which runs under
-- service_role via createServiceClient()). Plan 0 lands the function so
-- Plan 3 has nothing to invent.
--
-- Manual smoke tests after apply:
--
--   -- 1) authenticated cannot call:
--   set role authenticated;
--   select public.record_audit_anonymous(
--     '<org-id>'::uuid, 'create'::public.audit_action,
--     'candidate', '<entity-id>'::uuid, '{}'::jsonb);
--   -- expect: ERROR permission denied for function record_audit_anonymous
--
--   -- 2) service_role can call:
--   set role service_role;
--   select public.record_audit_anonymous(
--     '<org-id>'::uuid, 'create'::public.audit_action,
--     'candidate', '<entity-id>'::uuid, '{"source":"apply_form"}'::jsonb);
--   -- expect: success; new row in audit_log with actor_user_id = NULL

create or replace function public.record_audit_anonymous(
  p_organization_id uuid,
  p_action public.audit_action,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values
    (p_organization_id, null, p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

revoke all on function public.record_audit_anonymous(
  uuid, public.audit_action, text, uuid, jsonb
) from public, authenticated, anon;

grant execute on function public.record_audit_anonymous(
  uuid, public.audit_action, text, uuid, jsonb
) to service_role;
