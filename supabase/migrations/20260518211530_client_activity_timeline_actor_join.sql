-- Phase 1 review fix H3 — join public.users into client_activity_timeline.
--
-- The Plan 3 view client_activity_timeline (20260517215956) selects
-- a.actor_user_id but does not join public.users, so getClientTimeline
-- returns rows without the actor's display name or email. The client
-- detail page's <ActivityTimeline> falls back to "System" for every entry
-- — Notes, calls, contact creation — hiding the human audit trail.
--
-- By contrast, listCandidateActivities (src/lib/db/candidates.ts:307-328)
-- joins users via `actor:users!actor_user_id(full_name, email)` and the
-- candidate detail timeline renders actor names correctly.
--
-- This migration rewrites the view to LEFT JOIN public.users on
-- actor_user_id and surface actor_full_name + actor_email. The join is
-- additive (preserves all original columns; uses LEFT JOIN so system
-- entries with actor_user_id = null keep rendering). security_invoker is
-- preserved so RLS on the underlying tables still gates per-row
-- visibility.
--
-- The TS shape ClientTimelineEntry in src/lib/db/clients.ts and the mapper
-- toActivityEntries in src/app/(app)/clients/[id]/client-management-tabs.tsx
-- are updated in the same commit to consume the new columns.

create or replace view public.client_activity_timeline
with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.kind,
  a.body,
  a.actor_user_id,
  a.occurred_at,
  a.metadata,
  a.entity_type,
  a.entity_id,
  c.id as client_id,
  case a.entity_type
    when 'company' then c.name
    when 'contact' then (select full_name from public.contacts where id = a.entity_id)
    when 'job'     then (select title from public.jobs where id = a.entity_id)
    else null
  end as entity_label,
  u.full_name as actor_full_name,
  u.email     as actor_email
from public.activities a
join public.companies c on (
  (a.entity_type = 'company' and a.entity_id = c.id) or
  (a.entity_type = 'contact' and a.entity_id in (select id from public.contacts where company_id = c.id)) or
  (a.entity_type = 'job'     and a.entity_id in (select id from public.jobs where company_id = c.id))
)
left join public.users u on u.id = a.actor_user_id;

-- Re-grant; CREATE OR REPLACE VIEW preserves existing grants in Postgres but
-- we re-state it for clarity.
grant select on public.client_activity_timeline to authenticated;
