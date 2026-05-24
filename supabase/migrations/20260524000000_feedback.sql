-- Quick task 260524-b6v: in-app feedback widget.
--
-- Persists user-submitted feedback (free-text body + page_url + user_agent)
-- written from the floating "Feedback" FAB in the (app) layout. Tenant-scoped
-- and append-only by design (no UPDATE / DELETE RLS policies): feedback is a
-- forward-only audit channel, not editable content.
--
-- Trigger pattern: `feedback_set_org` mirrors `spec_drafts_set_org` (see
-- 20260520003437_phase3_spec_drafts.sql) — name kept under `_set_org` so it
-- lexically precedes any future `_verify_*` cross-tenant guard trigger
-- (Postgres fires BEFORE triggers in alphabetical order). The auto-fill
-- trigger reads from `public.set_organization_id()` so the server action
-- never has to pass `organization_id` from the client.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submitted_by uuid not null references public.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  page_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index feedback_org_created_at_idx
  on public.feedback (organization_id, created_at desc);

alter table public.feedback enable row level security;

create policy "tenant select" on public.feedback
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy "tenant insert" on public.feedback
  for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and submitted_by = auth.uid()
  );

-- Intentionally NO UPDATE / DELETE policies. Feedback is append-only.

create trigger feedback_set_org
  before insert on public.feedback
  for each row execute function public.set_organization_id();
