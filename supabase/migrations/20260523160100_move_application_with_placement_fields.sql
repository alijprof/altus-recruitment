-- Phase 3 / UAT-260523-PLACEMENT-CAPTURE
--
-- Recreate `move_application` RPC with 5 new defaulted trailing params for
-- placement capture. The old 5-param signature (`uuid, application_stage,
-- decline_reason, text, uuid`) is dropped first because the GRANT in
-- 20260518201900_move_application_function.sql pinned that exact signature;
-- leaving it alive after adding a new overload would cause a "function not
-- unique" error on the new GRANT.
--
-- New signature (10 params):
--   p_application_id     uuid
--   p_to_stage           application_stage
--   p_decline_reason     decline_reason      default null
--   p_decline_notes      text                default null
--   p_actor_user_id      uuid                default null
--   p_placement_fee_pence bigint             default null
--   p_placement_date     timestamptz         default null
--   p_placement_type     placement_type      default null
--   p_placement_currency text                default null
--
-- All placement params default null, so existing callers that pass only the
-- first 1–5 named args (e.g. the DeclineModal path) continue to compile and
-- run without change.
--
-- SECURITY INVOKER — RLS on applications + activities still applies. Do NOT
-- switch to SECURITY DEFINER (CLAUDE.md: "Never disable RLS to make it work").
--
-- Append-only convention: the DROP below only removes the OLD 5-param
-- overload; it does not touch any other schema object.

drop function if exists public.move_application(
  uuid,
  public.application_stage,
  public.decline_reason,
  text,
  uuid
);

create or replace function public.move_application(
  p_application_id       uuid,
  p_to_stage             public.application_stage,
  p_decline_reason       public.decline_reason  default null,
  p_decline_notes        text                   default null,
  p_actor_user_id        uuid                   default null,
  p_placement_fee_pence  bigint                 default null,
  p_placement_date       timestamptz            default null,
  p_placement_type       public.placement_type  default null,
  p_placement_currency   text                   default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_stage    public.application_stage;
  v_candidate_id uuid;
  v_org_id       uuid;
  v_activity_body text;
begin
  -- Read current row. RLS on applications filters this select to the
  -- caller's org, so a not-found is either "doesn't exist" or "wrong org".
  select stage, candidate_id, organization_id
    into v_old_stage, v_candidate_id, v_org_id
    from public.applications
    where id = p_application_id;
  if not found then
    raise exception 'application not found';
  end if;

  -- Idempotent: dropping a card on its own column is a no-op.
  if v_old_stage = p_to_stage then
    return;
  end if;

  -- Pre-flight the CHECK constraint for terminal stages so callers get a
  -- friendly error string instead of a raw Postgres violation. The DB
  -- constraint is still the authoritative gate (defence in depth).
  if p_to_stage in ('rejected', 'withdrawn') and p_decline_reason is null then
    raise exception 'decline_reason is required when moving to %', p_to_stage;
  end if;

  -- Pre-flight the placement CHECK constraint. The DB constraint
  -- `placement_fields_present_when_placed` (added in migration 20260523160000)
  -- is NOT VALID (no full-table scan) but still enforces on new writes; we
  -- surface a friendly error here first.
  if p_to_stage = 'placed' and (
    p_placement_fee_pence is null or
    p_placement_date      is null or
    p_placement_type      is null
  ) then
    raise exception 'placement fields required when moving to placed';
  end if;

  update public.applications
  set
    stage            = p_to_stage,
    stage_changed_at = now(),
    -- Decline fields: set when moving to a terminal decline stage.
    decline_reason = case
      when p_to_stage in ('rejected', 'withdrawn') then p_decline_reason
      else decline_reason
    end,
    decline_notes = case
      when p_to_stage in ('rejected', 'withdrawn') then p_decline_notes
      else decline_notes
    end,
    declined_at = case
      when p_to_stage in ('rejected', 'withdrawn') then now()
      else declined_at
    end,
    -- Placement fields: set when moving to placed.
    fee_pence = case
      when p_to_stage = 'placed' then p_placement_fee_pence
      else fee_pence
    end,
    placed_at = case
      when p_to_stage = 'placed' then p_placement_date
      else placed_at
    end,
    placement_type = case
      when p_to_stage = 'placed' then p_placement_type
      else placement_type
    end,
    placement_currency = case
      when p_to_stage = 'placed' then coalesce(p_placement_currency, placement_currency)
      else placement_currency
    end
  where id = p_application_id;

  -- Build activity body string. Placement uses "Placed — perm" style (RAW
  -- enum value, human label resolved at render time per DeclineReason
  -- precedent). Decline uses "Declined — <reason>". All other stages use
  -- "Moved to <stage label>".
  v_activity_body := case
    when p_to_stage in ('rejected', 'withdrawn')
      then 'Declined — ' || coalesce(p_decline_reason::text, 'unspecified')
    when p_to_stage = 'placed'
      then 'Placed — ' || replace(p_placement_type::text, '_', ' ')
    else 'Moved to ' || replace(p_to_stage::text, '_', ' ')
  end;

  -- Auto-write the activity row in the same transaction. The
  -- set_organization_id BEFORE INSERT trigger resolves organization_id from
  -- the auth context.
  insert into public.activities (kind, body, actor_user_id, entity_type, entity_id, metadata)
  values (
    'stage_change',
    v_activity_body,
    p_actor_user_id,
    'application',
    p_application_id,
    jsonb_build_object(
      'from_stage',          v_old_stage,
      'to_stage',            p_to_stage,
      'decline_reason',      p_decline_reason,
      'decline_notes',       p_decline_notes,
      'candidate_id',        v_candidate_id,
      'placement_fee_pence', p_placement_fee_pence,
      'placement_date',      p_placement_date,
      'placement_type',      p_placement_type,
      'placement_currency',  p_placement_currency
    )
  );
end;
$$;

-- Revoke from public (defence in depth) then grant only to authenticated.
-- The signature below MUST match the create-or-replace above exactly.
revoke all on function public.move_application(
  uuid,
  public.application_stage,
  public.decline_reason,
  text,
  uuid,
  bigint,
  timestamptz,
  public.placement_type,
  text
) from public;

grant execute on function public.move_application(
  uuid,
  public.application_stage,
  public.decline_reason,
  text,
  uuid,
  bigint,
  timestamptz,
  public.placement_type,
  text
) to authenticated;

comment on function public.move_application(
  uuid,
  public.application_stage,
  public.decline_reason,
  text,
  uuid,
  bigint,
  timestamptz,
  public.placement_type,
  text
) is
  'UAT-260523-PLACEMENT-CAPTURE: Atomically transition an application to a new '
  'stage and write the matching activities row. SECURITY INVOKER so RLS applies. '
  'Placement params (fee_pence, date, type, currency) are required when '
  'p_to_stage = ''placed''. Decline params are required when p_to_stage in '
  '(''rejected'', ''withdrawn''). All 5 trailing params default null so existing '
  'callers that omit them continue to compile without change.';
