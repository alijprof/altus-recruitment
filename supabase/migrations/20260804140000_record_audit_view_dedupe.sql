-- Dedupe `view` audit rows per (actor, entity, hour).
--
-- Review 2026-08-04 M4: the detail-view audit write lives in the RSC render
-- body (src/app/(app)/jobs/[id]/page.tsx, clients/[id]/page.tsx, and inside
-- getCandidate). Next re-renders that body on EVERY revalidatePath for the
-- route — add candidate to job, move stage, decline, place, add job ad — and
-- on route prefetch. Each of those filed another 'view' row for a page the
-- recruiter never opened.
--
-- audit_log is the compliance artifact. Inflating it with non-views makes
-- "who accessed this candidate's record, and when" unanswerable, which is the
-- one question it exists to answer. Deduping at the SQL layer is what makes
-- the fix complete: record_audit is the single write path for every 'view'
-- (page bodies, getCandidate's inline audit, recordViewAudit), and it is the
-- ONLY place `auth.uid()` is available without an extra network round-trip
-- from the render path.
--
-- FILE ONLY — per project hard rules this migration is NOT applied by the
-- executor. The founder pushes it manually via
-- `pnpm exec supabase db push --linked`. The application code needs no change
-- and behaves identically before and after it lands (it just files fewer
-- rows once applied), so there is no pre/post-migration skew to tolerate.
--
-- ---------------------------------------------------------------------------
-- Scope of the dedupe — deliberately narrow.
--
--   * ONLY `p_action = 'view'`. 'create' / 'update' / 'delete' / 'export' are
--     discrete business events; every one of them must be recorded. The guard
--     below never sees them.
--
--   * NOT `entity_type = 'search'`. recordSearchAudit files 'view' rows
--     against the nil UUID with {mode, semantic_ok, result_count, surface}
--     metadata — each is a real, distinct search event, and collapsing them
--     per hour would silently destroy the search telemetry this batch added.
--
--   * Bucketed on `date_trunc('hour', now())`, matched on
--     (organization_id, actor_user_id, entity_type, entity_id). That is
--     exactly the review's "(actor, entity, hour)" recommendation.
--
-- The existing index audit_log_org_entity_idx
-- (organization_id, entity_type, entity_id, at desc) — 20260513152244:363 —
-- serves the lookup directly. No new index needed.
--
-- ---------------------------------------------------------------------------
-- Safety.
--
-- `create or replace function` preserves the function's existing privileges,
-- so the anon REVOKE applied by 20260804120100 survives this file even though
-- this filename sorts after it. The explicit grant statements at the bottom
-- restate the intended end state anyway (idempotent, and they make the
-- posture readable without cross-referencing two migrations).
--
-- Signature, language, SECURITY DEFINER and `set search_path = public` are
-- reproduced verbatim from 20260513152244_phase1_domain_schema.sql:104-126.
-- The org-context RAISE is unchanged. The return value on a deduped call is
-- the EXISTING row's id, which keeps the `returns uuid` contract truthful
-- (callers ignore it, but a NULL return would be a lie).
--
-- Additive only: no data is read outside audit_log, nothing is deleted or
-- updated, and the worst case if the SELECT ever misbehaved is an extra row —
-- i.e. today's behaviour.

create or replace function public.record_audit(
  p_action public.audit_action,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := public.current_organization_id();
  v_id uuid;
begin
  if v_org_id is null then
    raise exception 'record_audit called outside an authenticated org context';
  end if;

  -- Per-hour dedupe for entity views only (see header). 'search' is excluded:
  -- every search is its own event.
  if p_action = 'view' and p_entity_type <> 'search' then
    select al.id
      into v_id
      from public.audit_log al
     where al.organization_id = v_org_id
       and al.actor_user_id is not distinct from auth.uid()
       and al.action = 'view'
       and al.entity_type = p_entity_type
       and al.entity_id = p_entity_id
       and al.at >= date_trunc('hour', now())
     limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.audit_log (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- Restate the intended privilege posture (idempotent; `create or replace`
-- above did not change it). `revoke ... from public` alone does NOT remove
-- Supabase's default direct anon grant, which is why anon is named explicitly
-- — the same lesson 20260804120100 was written to close.
revoke all on function public.record_audit(public.audit_action, text, uuid, jsonb) from public;
revoke execute on function public.record_audit(public.audit_action, text, uuid, jsonb) from anon;
grant execute on function public.record_audit(public.audit_action, text, uuid, jsonb) to authenticated;
