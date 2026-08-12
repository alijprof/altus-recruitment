-- Phase 8 / Plan 01 — candidate_branded_cvs table.
--
-- Derived artifact, never parsed: one agency-branded, contact-stripped PDF
-- copy per candidate, rendered on demand from the candidate's CURRENT parsed
-- data (never auto-generated on CV parse — Phase 7 made parsed fields
-- editable, so an auto-generated copy would go stale the moment a field is
-- corrected).
--
-- Exactly ONE current copy per candidate: the `unique (candidate_id)`
-- constraint below IS the BCV-06 single-current-copy invariant, enforced at
-- the database rather than in application code. Regeneration is
-- write-new-then-delete-old: a fresh PDF is uploaded to a new Storage path,
-- this row is upserted (targeting `candidate_id`) to point at it, and only
-- then is the PRIOR Storage object best-effort removed — so a mid-
-- regeneration crash leaves the OLD copy still servable rather than leaving
-- nothing (mirrors the storage-first discipline already used elsewhere in
-- this codebase's erasure sweeps).
--
-- Deliberately NOT a flagged row in `candidate_cvs`: that table's
-- `(candidate_id, version)` uniqueness, `parsing_status` enum, and
-- `mime_type` semantics all encode "this is a literal uploaded revision of
-- the source CV" — a branded copy is never parsed and never versioned, and
-- overloading `candidate_cvs` would force `kind`-aware branching across
-- `cv-files-panel.tsx`, `nextCVVersion()`, and the frozen Phase-6 CV-intake
-- smoke suite for no benefit. A new table leaves every tested Phase 6/7
-- path completely untouched.
--
-- The branded PDF bytes themselves live in the EXISTING `cvs` Storage
-- bucket (path: {organization_id}/{candidate_id}/branded-cv-{uuid}.pdf) —
-- no new bucket needed here, since the bucket's RLS policy only constrains
-- the first path segment. `candidate_id ... on delete cascade` and
-- `organization_id ... on delete cascade` mean GDPR erasure of a candidate
-- or an org removes this row automatically, the same way `candidate_cvs`
-- and `ai_summaries` already cascade; the Storage-object sweep itself is
-- wired in a later Phase 8 plan.
--
-- Idempotent (create table if not exists / drop policy if exists / drop
-- trigger if exists) so a partially-applied branch can be safely re-pushed.
-- MIGRATION IS APPEND-ONLY — never edit this file once committed. Fix
-- schema issues in a new migration file with a later timestamp.

create table if not exists public.candidate_branded_cvs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  storage_path text not null,
  file_size_bytes integer,
  generated_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_branded_cvs_candidate_id_key unique (candidate_id)
);

comment on table public.candidate_branded_cvs is
  'Derived artifact, never parsed: exactly one CURRENT agency-branded, '
  'contact-stripped PDF copy per candidate (unique (candidate_id) is the '
  'BCV-06 single-current-copy invariant). Regeneration is write-new-then-'
  'delete-old, not update-in-place of the Storage object. Deliberately does '
  'NOT live in candidate_cvs, which encodes literal uploaded revisions via '
  '(candidate_id, version) + parsing_status — a branded copy is never '
  'parsed and never versioned.';

create index if not exists candidate_branded_cvs_organization_id_idx
  on public.candidate_branded_cvs (organization_id);

alter table public.candidate_branded_cvs enable row level security;

drop policy if exists "tenant select" on public.candidate_branded_cvs;
create policy "tenant select" on public.candidate_branded_cvs for select to authenticated
  using (organization_id = public.current_organization_id());

drop policy if exists "tenant insert" on public.candidate_branded_cvs;
create policy "tenant insert" on public.candidate_branded_cvs for insert to authenticated
  with check (organization_id = public.current_organization_id());

drop policy if exists "tenant update" on public.candidate_branded_cvs;
create policy "tenant update" on public.candidate_branded_cvs for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

drop policy if exists "tenant delete" on public.candidate_branded_cvs;
create policy "tenant delete" on public.candidate_branded_cvs for delete to authenticated
  using (organization_id = public.current_organization_id());

drop trigger if exists candidate_branded_cvs_set_org on public.candidate_branded_cvs;
create trigger candidate_branded_cvs_set_org before insert on public.candidate_branded_cvs
  for each row execute function public.set_organization_id();

drop trigger if exists candidate_branded_cvs_set_updated_at on public.candidate_branded_cvs;
create trigger candidate_branded_cvs_set_updated_at before update on public.candidate_branded_cvs
  for each row execute function public.set_updated_at();
