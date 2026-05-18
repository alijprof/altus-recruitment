-- move_application: atomic stage transition + auto-write to activities.
--
-- Why a SQL function (and not app code with two writes):
--   * RESEARCH §23 — UPDATE on applications + INSERT into activities must be
--     atomic; a partial failure leaves the pipeline corrupt (stage moved but
--     no audit trail). PostgREST has no transaction wrapper for two-step
--     mutations from client code, so we collapse the writes into a single
--     PL/pgSQL function and call it via supabase.rpc.
--   * SECURITY INVOKER (not DEFINER) — RLS on applications + activities
--     still applies. Cross-tenant calls are denied at the row level by the
--     "tenant select/update" policies on each table. Never switch to
--     SECURITY DEFINER (CLAUDE.md: "Never disable RLS to make it work").
--   * The schema CHECK constraint `decline_reason_present_when_terminal`
--     (phase1_domain_schema.sql:316-321) enforces that rejected/withdrawn
--     stages must have a decline_reason — this function preserves that
--     invariant by routing the reason through the same UPDATE.
--
-- Activity body strings:
--   * Non-terminal: 'Moved to ' || replace(stage::text, '_', ' ')
--       e.g. 'Moved to first interview' / 'Moved to applied'
--   * Terminal:     'Declined — ' || decline_reason::text  (RAW enum value)
--       e.g. 'Declined — client_rejected_skills'
--
-- The activity body intentionally stores the RAW enum value, NOT the human
-- label. The single source of truth for human labels is the shared
-- `formatDeclineReason()` helper in src/lib/legal/decline-reasons.ts —
-- consumed by both the DeclineModal Select (input) and ActivityTimeline
-- rendering (output). Keeping the DB raw means a future label-copy change
-- doesn't require a backfill migration. (VERIFICATION R1.)

create or replace function public.move_application(
  p_application_id uuid,
  p_to_stage public.application_stage,
  p_decline_reason public.decline_reason default null,
  p_decline_notes text default null,
  p_actor_user_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_stage public.application_stage;
  v_candidate_id uuid;
  v_org_id uuid;
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

  -- Pre-flight the CHECK constraint so callers get a friendly error string
  -- instead of a Postgres CHECK violation code. The DB will still reject if
  -- this somehow slips through (defence in depth).
  if p_to_stage in ('rejected', 'withdrawn') and p_decline_reason is null then
    raise exception 'decline_reason is required when moving to %', p_to_stage;
  end if;

  update public.applications
  set
    stage = p_to_stage,
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
    end
  where id = p_application_id;

  -- Auto-write the activity row in the same transaction. The
  -- set_organization_id BEFORE INSERT trigger resolves organization_id from
  -- the auth context; we still pass it explicitly via the metadata so
  -- downstream consumers can read both shapes.
  insert into public.activities (kind, body, actor_user_id, entity_type, entity_id, metadata)
  values (
    'stage_change',
    case
      when p_to_stage in ('rejected', 'withdrawn')
        then 'Declined — ' || coalesce(p_decline_reason::text, 'unspecified')
      else 'Moved to ' || replace(p_to_stage::text, '_', ' ')
    end,
    p_actor_user_id,
    'application',
    p_application_id,
    jsonb_build_object(
      'from_stage', v_old_stage,
      'to_stage', p_to_stage,
      'decline_reason', p_decline_reason,
      'decline_notes', p_decline_notes,
      'candidate_id', v_candidate_id
    )
  );
end;
$$;

-- The function takes uuid, application_stage, decline_reason, text, uuid in
-- that order; the signature below MUST match the create-or-replace above.
revoke all on function public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid) from public;
grant execute on function public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid) to authenticated;

comment on function public.move_application(uuid, public.application_stage, public.decline_reason, text, uuid) is
  'Atomically transition an application to a new stage and write the matching '
  'activities row. SECURITY INVOKER so RLS applies. Use the supabase.rpc(''move_application'', ...) '
  'wrapper in src/app/(app)/jobs/[id]/pipeline/actions.ts (moveApplicationAction).';
