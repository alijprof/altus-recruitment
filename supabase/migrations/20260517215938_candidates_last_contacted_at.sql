-- Add last_contacted_at to candidates + auto-bump trigger on activity insert.
--
-- Rationale: D-15 mandates `last_contacted_at DESC NULLS LAST` as the default
-- sort key for the candidate list. The original Phase 1 domain schema only put
-- `last_contacted_at` on companies and contacts; candidates were missed. This
-- migration fixes that gap and mirrors the trigger pattern referenced by
-- RESEARCH §20 for the companies/contacts side.
--
-- The trigger fires on inserts into public.activities where entity_type =
-- 'candidate' and kind in ('note','call','email','meeting'). It uses
-- new.occurred_at (not now()) so backfilled activity rows update
-- last_contacted_at to the correct historical point — but only if it would
-- move the value forward (no stale overwrite).
--
-- security definer is required: the RLS policy on candidates is "self org
-- write", but a recruiter logging an activity from a server action already
-- holds that scope. We re-assert it explicitly here.

alter table public.candidates
  add column if not exists last_contacted_at timestamptz;

create index if not exists candidates_last_contacted_at_idx
  on public.candidates (organization_id, last_contacted_at desc nulls last);

create or replace function public.bump_candidate_last_contacted_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entity_type <> 'candidate' then
    return new;
  end if;
  if new.kind not in ('note', 'call', 'email', 'meeting') then
    return new;
  end if;
  update public.candidates
    set last_contacted_at = greatest(coalesce(last_contacted_at, '-infinity'::timestamptz), new.occurred_at)
    where id = new.entity_id
      and organization_id = new.organization_id;
  return new;
end;
$$;

drop trigger if exists activities_bump_candidate_last_contacted on public.activities;
create trigger activities_bump_candidate_last_contacted
  after insert on public.activities
  for each row execute function public.bump_candidate_last_contacted_at();

comment on function public.bump_candidate_last_contacted_at() is
  'After-insert trigger on activities: updates candidates.last_contacted_at when '
  'an activity of a contact-bearing kind (note/call/email/meeting) is logged '
  'against a candidate. Used by the candidate list default sort (D-15).';
