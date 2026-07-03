-- Audit min-66 — capture placement notes.
--
-- The PlacementModal collects an optional "Notes" field but the value was
-- silently discarded: it never reached move_application, so commercially
-- meaningful text (fee splits, rebate terms, start-date caveats) was lost on
-- every placement while the UI showed "Placement recorded." Add a 10th
-- defaulted param p_placement_notes and persist it in the stage_change
-- activity metadata (alongside placement_fee_pence / placement_date / etc).
--
-- Like 20260523160100, adding a trailing param means the previous 9-param
-- overload must be DROPped first — the GRANT pins the exact signature, so a
-- second overload would make the new GRANT ambiguous ("function not unique").
--
-- SECURITY INVOKER — RLS on applications + activities still applies. The body
-- is byte-for-byte the 20260523160100 function plus the notes param and the
-- one extra metadata key.
--
-- Append-only: the DROP removes only the OLD 9-param overload.

drop function if exists public.move_application(
  uuid,
  public.application_stage,
  public.decline_reason,
  text,
  uuid,
  bigint,
  timestamptz,
  public.placement_type,
  text
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
  p_placement_currency   text                   default null,
  p_placement_notes      text                   default null
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
  select stage, candidate_id, organization_id
    into v_old_stage, v_candidate_id, v_org_id
    from public.applications
    where id = p_application_id;
  if not found then
    raise exception 'application not found';
  end if;

  if v_old_stage = p_to_stage then
    return;
  end if;

  if p_to_stage in ('rejected', 'withdrawn') and p_decline_reason is null then
    raise exception 'decline_reason is required when moving to %', p_to_stage;
  end if;

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

  v_activity_body := case
    when p_to_stage in ('rejected', 'withdrawn')
      then 'Declined — ' || coalesce(p_decline_reason::text, 'unspecified')
    when p_to_stage = 'placed'
      then 'Placed — ' || replace(p_placement_type::text, '_', ' ')
    else 'Moved to ' || replace(p_to_stage::text, '_', ' ')
  end;

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
      'placement_currency',  p_placement_currency,
      'placement_notes',     p_placement_notes
    )
  );
end;
$$;

revoke all on function public.move_application(
  uuid,
  public.application_stage,
  public.decline_reason,
  text,
  uuid,
  bigint,
  timestamptz,
  public.placement_type,
  text,
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
  text,
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
  text,
  text
) is
  'Audit min-66: as 20260523160100 plus p_placement_notes (persisted into the '
  'stage_change activity metadata). Atomically transition an application and '
  'write the matching activities row. SECURITY INVOKER so RLS applies.';
