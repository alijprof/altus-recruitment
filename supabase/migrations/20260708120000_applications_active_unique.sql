-- min-25: scope application uniqueness to ACTIVE (non-terminal) stages.
--
-- Problem: applications_candidate_job_type_unique is a TOTAL unique constraint
-- on (candidate_id, job_id, application_type) spanning ALL stages, including the
-- terminal 'rejected' and 'withdrawn'. So once a candidate applied to a job and
-- was rejected/withdrawn, they could NEVER re-apply — the insert 23505'd and was
-- surfaced as a generic failure.
--
-- Fix: replace the total constraint with a PARTIAL unique INDEX that excludes
-- the terminal stages. A rejected/withdrawn row then falls out of the index,
-- freeing the (candidate_id, job_id, application_type) slot for a fresh
-- application, while a LIVE application (any non-terminal stage, incl. 'placed')
-- still blocks a duplicate. (Postgres constraints cannot be partial, so this
-- must be an index, not a constraint.)
--
-- Terminal stages are exactly ('rejected','withdrawn') per the application_stage
-- enum + the schema's own decline_reason_present_when_terminal check.
--
-- Safety: the new predicate is a STRICT SUBSET of the old guarantee, so no
-- existing data can violate it — CREATE UNIQUE INDEX is guaranteed to succeed.
-- The pre-flight below is belt-and-braces; it raises rather than silently
-- creating a non-unique situation if the assumption is ever wrong.
--
-- NULL job_id (speculative floats) stay DISTINCT under default NULL-distinct
-- semantics — multiple floats for a candidate still coexist, unchanged. Do NOT
-- add NULLS NOT DISTINCT.

do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select 1
    from public.applications
    where stage not in ('rejected', 'withdrawn')
    group by candidate_id, job_id, application_type
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception 'min-25 pre-flight: % active (candidate,job,type) group(s) already duplicated — resolve before scoping the index', dup_count;
  end if;
end $$;

-- Drop the total unique constraint (and the phase-1 default name defensively).
alter table public.applications
  drop constraint if exists applications_candidate_job_type_unique;
alter table public.applications
  drop constraint if exists applications_candidate_id_job_id_application_type_key;

-- Partial unique index: uniqueness holds only among LIVE (non-terminal)
-- applications.
create unique index if not exists applications_active_candidate_job_type_uniq
  on public.applications (candidate_id, job_id, application_type)
  where stage not in ('rejected', 'withdrawn');
