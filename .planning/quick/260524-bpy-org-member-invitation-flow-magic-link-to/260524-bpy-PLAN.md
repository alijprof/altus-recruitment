---
phase: quick-260524-bpy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260524000100_org_invitations.sql
  - src/app/(app)/settings/team/page.tsx
  - src/app/(app)/settings/team/actions.ts
  - src/app/(app)/settings/team/schema.ts
  - src/app/(app)/settings/team/invite-member-dialog.tsx
  - src/app/(app)/settings/team/revoke-invite-button.tsx
  - src/app/(app)/settings/team/resend-invite-button.tsx
  - src/app/(app)/settings/page.tsx
  - src/app/accept-invite/[token]/route.ts
  - src/app/auth/callback/route.ts
  - src/app/(auth)/sign-in/sign-in-form.tsx
  - src/lib/invitations/cookie.ts
  - src/lib/invitations/lookup.ts
  - src/types/database.ts
autonomous: true
requirements:
  - QUICK-260524-bpy
user_setup: []

must_haves:
  truths:
    - "An owner can open Settings → Team and see current org members plus pending invites"
    - "An owner can submit an email via 'Invite member' dialog and a row is created in public.org_invitations"
    - "When RESEND_API_KEY is configured, the invited email receives a message with subject '{inviterName} invited you to Altus on {orgName}' linking to /accept-invite/{token}"
    - "Clicking a valid /accept-invite/{token} link sets a signed httpOnly cookie and redirects to /sign-in?email={encoded}&invite=1 with the email pre-filled in the form"
    - "After PKCE magic-link callback with a valid invite cookie whose email matches the signed-in user, the user is attached to the inviter's organization (not a fresh org) and the invitation row's accepted_at is set"
    - "A new sign-up landing at /auth/callback WITHOUT an invite cookie continues to get a fresh org (the existing handle_new_user trigger behaviour is preserved)"
    - "Expired (>7 days) or already-accepted /accept-invite/{token} requests redirect to /sign-in?error=expired-invite; unknown tokens redirect to /sign-in?error=invalid-invite"
    - "An owner can revoke a pending invite (deletes the row) and resend (refreshes expires_at + fires email again)"
    - "Cross-tenant: a token belonging to org A cannot attach a signed-in user to org B even if the cookie is forged with a known token of the wrong org (email match check enforces user-to-invite binding)"
    - "A user whose PKCE-exchanged session has no email (null user.email) cannot be attached to an inviter's org — the callback short-circuits to /sign-in?error=invalid-invite BEFORE any service-role lookup"
    - "Org reassignment + orphan-org deletion + accepted_at marking happen atomically inside a single transaction via public.accept_invitation() RPC — no TOCTOU window for partial state"
  artifacts:
    - path: "supabase/migrations/20260524000100_org_invitations.sql"
      provides: "org_invitations table + RLS + _set_org trigger + invited_by autofill trigger + partial unique index + public.accept_invitation() RPC (canonical atomic accept path)"
      contains: "create table public.org_invitations"
    - path: "src/app/(app)/settings/team/actions.ts"
      provides: "inviteMemberAction, revokeInviteAction, resendInviteAction server actions"
      exports: ["inviteMemberAction", "revokeInviteAction", "resendInviteAction"]
    - path: "src/app/(app)/settings/team/page.tsx"
      provides: "Team settings page (server component) listing members + pending invites"
      min_lines: 40
    - path: "src/app/(app)/settings/team/invite-member-dialog.tsx"
      provides: "Client dialog with email input + Send button calling inviteMemberAction"
    - path: "src/app/accept-invite/[token]/route.ts"
      provides: "GET handler that validates token via service-role and sets invite cookie + redirects"
      exports: ["GET"]
    - path: "src/lib/invitations/cookie.ts"
      provides: "Cookie name constant + serialise/parse helpers for altus_invite_token (httpOnly, sameSite=Lax, max-age=3600, host-only — domain intentionally omitted)"
    - path: "src/lib/invitations/lookup.ts"
      provides: "lookupInvitationByToken(serviceClient, token) server helper returning { id, organization_id, email, expires_at, accepted_at } | null"
    - path: "src/app/auth/callback/route.ts"
      provides: "Updated PKCE handler: null-email guard, then if altus_invite_token cookie present, calls public.accept_invitation() RPC for atomic org-join"
    - path: "src/app/(auth)/sign-in/sign-in-form.tsx"
      provides: "Sign-in form reads ?email= for pre-fill + ?invite=1 to show banner"
  key_links:
    - from: "src/app/(app)/settings/team/actions.ts (inviteMemberAction)"
      to: "public.org_invitations"
      via: "Supabase RLS-scoped INSERT (organization_id + invited_by autofilled by triggers)"
      pattern: "from\\('org_invitations'\\).*insert"
    - from: "src/app/(app)/settings/team/actions.ts (inviteMemberAction)"
      to: "src/lib/email/resend.ts"
      via: "sendResendEmail with /accept-invite/{token} link in body"
      pattern: "sendResendEmail"
    - from: "src/app/accept-invite/[token]/route.ts"
      to: "src/lib/invitations/lookup.ts"
      via: "service-role token lookup, validates expires_at + accepted_at"
      pattern: "lookupInvitationByToken"
    - from: "src/app/accept-invite/[token]/route.ts"
      to: "src/lib/invitations/cookie.ts"
      via: "sets altus_invite_token cookie (httpOnly, sameSite=Lax, max-age=3600, secure in prod, host-only)"
      pattern: "altus_invite_token"
    - from: "src/app/auth/callback/route.ts"
      to: "public.accept_invitation() RPC"
      via: "single atomic transaction: verify email match, reassign user.organization_id, mark accepted_at, delete orphan org if empty"
      pattern: "accept_invitation"
---

<objective>
Add a custom org member invitation flow that lets owners invite teammates by email via a magic-link with a 7-day expiring token stored in a new `public.org_invitations` table. Replaces the existing Supabase `auth.admin.inviteUserByEmail` flow for this slice with an owned flow that supports listing pending invites, revoking, and resending — and that correctly short-circuits the existing fresh-org bootstrap so the invitee lands in the inviter's organization instead of a brand-new one.

Purpose: The current invite flow has no token persistence (cannot list / revoke / resend) and depends on Supabase Auth admin metadata which is hard to manage. A first-class `org_invitations` table gives owners full lifecycle control and is the foundation Phase 5 multi-role / billing will build on.

Output:
- New `public.org_invitations` migration (table + RLS + triggers + partial unique index + atomic accept RPC)
- Owner-facing Settings → Team page with InviteMemberDialog + per-row Revoke / Resend
- Three server actions (invite / revoke / resend) wired through Resend
- `/accept-invite/[token]` route handler + `/auth/callback` org-join hook (null-email guarded + RPC-driven)
- Sign-in form email pre-fill + invite banner
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@supabase/migrations/20260524000000_feedback.sql
@supabase/migrations/20260520003437_phase3_spec_drafts.sql
@supabase/migrations/20260517204504_harden_set_organization_id.sql
@supabase/migrations/20260517204503_handle_new_user_invite.sql
@src/app/(app)/layout.tsx
@src/app/auth/callback/route.ts
@src/app/(auth)/sign-in/sign-in-form.tsx
@src/app/(app)/settings/page.tsx
@src/app/(app)/settings/actions.ts
@src/app/(app)/settings/invitations-list.tsx
@src/app/(app)/_actions/submit-feedback.ts
@src/lib/supabase/server.ts
@src/lib/supabase/service.ts
@src/lib/email/resend.ts
@src/lib/auth/safe-next.ts
@src/lib/env.ts

<interfaces>
<!-- Key contracts the executor will use. Extracted from existing codebase. -->

From src/lib/supabase/server.ts:
- `export async function createClient(): Promise<SupabaseClient<Database>>` — user-scoped SSR client, RLS applies.

From src/lib/supabase/service.ts:
- `export function createServiceClient(): SupabaseClient<Database>` — service-role, bypasses RLS. server-only.

From src/lib/email/resend.ts:
- `export async function sendResendEmail(input: { to: string|string[]; subject: string; html?: string; text?: string; from?: string }): Promise<ResendSendResult>` — NEVER throws; returns { ok, reason } discriminated union. Prefer `text` to avoid HTML injection (see submit-feedback.ts T-260524-b6v-05).

From src/lib/auth/safe-next.ts:
- `export function safeNext(rawNext: string | null): string` — open-redirect guard; reuse for any `?next=` handling in /accept-invite if added.

From supabase trigger `public.handle_new_user()` (20260517204503_handle_new_user_invite.sql):
- Fires AFTER INSERT on auth.users. If `raw_user_meta_data->>'invited_to_org'` is a non-empty uuid, attaches user to that org as 'recruiter'. Otherwise creates a fresh organisation and attaches the user as 'owner'.
- IMPORTANT: this trigger runs as part of `exchangeCodeForSession()` for the very first sign-in. Our custom flow CANNOT prevent the trigger from firing because it has no visibility into the cookie; the callback handler MUST repair the bootstrap (reassign user.organization_id and delete the orphan auto-created org) after the exchange.

From supabase trigger pattern (spec_drafts_set_org):
- `before insert on <table> for each row execute function public.set_organization_id()` auto-fills `organization_id` from `current_organization_id()` when caller is authenticated. Required to mirror exactly so RLS WITH CHECK enforces correctness.

From existing `inviteTeammateAction` in src/app/(app)/settings/actions.ts:
- This plan REPLACES the call path used by the Team page UI (the existing function stays in place to avoid breaking other callers, but the new Team page calls the new actions in `src/app/(app)/settings/team/actions.ts`).
- The R8 verification rule (user-scoped role check BEFORE service-role escalation) is load-bearing — copy the exact ordering for the new actions.

From src/app/(app)/settings/page.tsx:
- TopNav already has a `Settings` link. The existing settings/page.tsx will get an additional `<Link href="/settings/team">` card so users can navigate to the new Team page. The legacy `<InviteForm>` + `<InvitationsList>` block on /settings stays for now (out of scope to remove in this slice — defer cleanup to a follow-up).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: org_invitations migration (table + RLS + triggers + atomic accept RPC) + server actions</name>
  <files>supabase/migrations/20260524000100_org_invitations.sql, src/app/(app)/settings/team/schema.ts, src/app/(app)/settings/team/actions.ts, src/types/database.ts</files>
  <behavior>
    - Inserting an org_invitations row as an authenticated user auto-fills organization_id from current_organization_id() and invited_by from auth.uid() (both via BEFORE INSERT triggers mirroring spec_drafts_set_org). RLS WITH CHECK enforces organization_id = current_organization_id().
    - Email column rejects mixed-case input via a CHECK constraint (lower(email) = email). Server-side Zod also lowercases before insert (defence in depth).
    - Partial unique index on (organization_id, email) WHERE accepted_at IS NULL prevents two pending invites to the same address in the same org. A second invite after the first is accepted is allowed (rare but possible if the user later leaves).
    - public.accept_invitation(p_token uuid, p_user_id uuid, p_user_email text) SECURITY DEFINER RPC performs the entire join atomically inside a single transaction: SELECT...FOR UPDATE the invitation row by token; verify expires_at > now() AND accepted_at IS NULL; verify lower(invitation.email) = lower(p_user_email); SELECT current users.organization_id WHERE id = p_user_id as old_org_id; UPDATE users SET organization_id = invitation.organization_id, role = 'recruiter' WHERE id = p_user_id; UPDATE org_invitations SET accepted_at = now() WHERE id = invitation.id; if old_org_id is distinct from new org AND no other users reference old_org_id (locked via SELECT 1 FROM users WHERE organization_id = old_org_id FOR UPDATE LIMIT 1, returns zero rows), DELETE FROM organizations WHERE id = old_org_id. Returns a result row { ok boolean, reason text } — reasons: 'invalid' (not found / expired / accepted), 'email_mismatch', 'ok'. All failure paths return ok=false WITHOUT mutating state. The whole function body is one transactional boundary; either everything commits or nothing does.
    - inviteMemberAction: owner-only (R8 pattern — RLS-scoped role check on public.users BEFORE service-role). Validates Zod, inserts row, fetches org name + inviter name, calls sendResendEmail with text body containing /accept-invite/{token} absolute URL (use NEXT_PUBLIC_SITE_URL if present; otherwise derive from request headers via `headers()`). On Resend failure (http_error) → Sentry.captureMessage but return { ok: true } (the row is canonical).
    - revokeInviteAction: owner-only; deletes the row via user-scoped client (RLS scopes to own org). Idempotent: missing row → return ok.
    - resendInviteAction: owner-only; if invitation expired or expiring within 24h, UPDATE expires_at = now() + interval '7 days' via service-role (RLS has no UPDATE policy by design); always re-fire email. Returns ok regardless of Resend outcome.
  </behavior>
  <action>
    Migration `supabase/migrations/20260524000100_org_invitations.sql`:
    - Append-only file, timestamp 20260524000100 (later than the existing 20260524000000_feedback.sql).
    - Header comment block (mirror feedback.sql style) explaining: purpose; trigger ordering (alphabetically `org_invitations_set_invited_by` fires before `org_invitations_set_org` — note the two triggers commute because they touch independent columns, so ordering does not affect correctness); why no UPDATE policy (accept happens via the public.accept_invitation() RPC, which is the canonical accept path; the /auth/callback handler is a thin caller that invokes the RPC and does no orchestration of its own); the partial unique index intent.
    - Columns: id uuid pk default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, email text not null check (lower(email) = email), token uuid not null unique default gen_random_uuid(), invited_by uuid not null references public.users(id) on delete cascade, expires_at timestamptz not null default (now() + interval '7 days'), accepted_at timestamptz, created_at timestamptz not null default now().
    - Partial unique index `org_invitations_org_email_pending_uq` on (organization_id, email) where accepted_at is null.
    - Index `org_invitations_org_pending_idx` on (organization_id, accepted_at).
    - RLS: enable, policies for SELECT/INSERT/DELETE (authenticated, organization_id = current_organization_id()); NO UPDATE policy.
    - Trigger `org_invitations_set_org` BEFORE INSERT executing public.set_organization_id() (reuse existing function).
    - Trigger function `public.set_invited_by()` language plpgsql security invoker set search_path = public: `if new.invited_by is null then new.invited_by := auth.uid(); end if; return new;` plus null-guard raising 'invited_by required and could not be resolved'. Trigger `org_invitations_set_invited_by` BEFORE INSERT.
    - RPC `public.accept_invitation(p_token uuid, p_user_id uuid, p_user_email text) RETURNS table(ok boolean, reason text)` LANGUAGE plpgsql SECURITY DEFINER SET search_path = public. Body:
      - DECLARE v_invite org_invitations%ROWTYPE; v_old_org uuid; v_other_users int;
      - SELECT * INTO v_invite FROM org_invitations WHERE token = p_token FOR UPDATE;
      - IF NOT FOUND OR v_invite.accepted_at IS NOT NULL OR v_invite.expires_at <= now() THEN RETURN QUERY SELECT false, 'invalid'::text; RETURN; END IF;
      - IF lower(v_invite.email) <> lower(p_user_email) THEN RETURN QUERY SELECT false, 'email_mismatch'::text; RETURN; END IF;
      - SELECT organization_id INTO v_old_org FROM users WHERE id = p_user_id FOR UPDATE;
      - UPDATE users SET organization_id = v_invite.organization_id, role = 'recruiter' WHERE id = p_user_id;
      - UPDATE org_invitations SET accepted_at = now() WHERE id = v_invite.id;
      - IF v_old_org IS NOT NULL AND v_old_org <> v_invite.organization_id THEN
          SELECT count(*) INTO v_other_users FROM users WHERE organization_id = v_old_org;
          IF v_other_users = 0 THEN DELETE FROM organizations WHERE id = v_old_org; END IF;
        END IF;
      - RETURN QUERY SELECT true, 'ok'::text;
    - GRANT EXECUTE on public.accept_invitation(uuid, uuid, text) TO service_role only (NOT to authenticated — callers must come through the route handler which uses service-role; this keeps the RPC out of reach of crafted client JWTs).
    - Inline psql smoke-test comments mirroring spec_drafts pattern (same-org insert succeeds, cross-org INSERT WITH CHECK fails, duplicate pending fails on partial unique, accepted-row duplicate is allowed, RPC with wrong email returns email_mismatch with no state change, RPC with expired token returns invalid).
    - Migration push is run by the orchestrator AFTER executor completes (do not run `pnpm exec supabase db push --linked` inside the executor's verify block; see done list).

    `src/app/(app)/settings/team/schema.ts` — three Zod schemas: inviteMemberSchema { email: lowercased trimmed valid email max 255 }, revokeInviteSchema { inviteId: uuid }, resendInviteSchema { inviteId: uuid }. Export inferred types.

    `src/app/(app)/settings/team/actions.ts` — three 'use server' actions implementing the R8 owner-check pattern from existing inviteTeammateAction. Get origin via `headers().get('origin')` or `headers().get('x-forwarded-host')` (Next 16 server action context) — fallback to env.NEXT_PUBLIC_SITE_URL if defined; if neither available, log a Sentry warning and skip the email but still return ok. Email subject: `${inviterName} invited you to Altus on ${orgName}`. Text body lines: greeting, invite link, "Link expires in 7 days. Ignore this email if you weren't expecting it." After insert/delete/update, call `revalidatePath('/settings/team')`. Never log invitee email or token to Sentry; only the error and { feature: 'invitations' } tag.

    `src/types/database.ts` — regenerated by orchestrator via `pnpm db:types` AFTER the migration is pushed. Keep the `// @ts-nocheck` line at top (do not remove per project convention). Executor does NOT run db:types; treat the file as out-of-band for this task.
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm lint -- "src/app/(app)/settings/team" &amp;&amp; grep -E "create or replace function public\.accept_invitation|create table public\.org_invitations|org_invitations_org_email_pending_uq|set_invited_by" supabase/migrations/20260524000100_org_invitations.sql</automated>
  </verify>
  <done>
    - Migration file contains: table, RLS policies (SELECT/INSERT/DELETE only — no UPDATE), partial unique index, both BEFORE INSERT triggers, and the public.accept_invitation() SECURITY DEFINER RPC granted only to service_role
    - inviteMemberAction, revokeInviteAction, resendInviteAction export correctly from src/app/(app)/settings/team/actions.ts
    - `pnpm typecheck` and `pnpm lint` pass for the new files
    - Out-of-band (orchestrator runs after executor finishes): `pnpm exec supabase db push --linked` applies cleanly; `pnpm db:types` regenerates src/types/database.ts and includes `org_invitations` in Database['public']['Tables']
    - Manual sanity (optional, post-push): psql against linked db — INSERT INTO public.org_invitations (email) VALUES ('Alice@Example.com') as authenticated user FAILS on lower(email) check; the same lowercased email succeeds and organization_id/invited_by are auto-populated; calling public.accept_invitation() with mismatched email returns ok=false reason='email_mismatch' and leaves users.organization_id unchanged
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Settings → Team page UI + nav link from /settings</name>
  <files>src/app/(app)/settings/team/page.tsx, src/app/(app)/settings/team/invite-member-dialog.tsx, src/app/(app)/settings/team/revoke-invite-button.tsx, src/app/(app)/settings/team/resend-invite-button.tsx, src/app/(app)/settings/page.tsx</files>
  <behavior>
    - GET /settings/team as an owner renders: page header, "Invite member" button (opens dialog), Current members list, Pending invitations list with per-row Revoke and Resend buttons.
    - Non-owners visiting /settings/team get redirected back to /settings (mirror the owner-only gate already implemented inline in /settings/page.tsx).
    - InviteMemberDialog: shadcn Dialog with an Input(email) + Send button. On submit calls inviteMemberAction; on ok closes dialog and toasts 'Invitation sent'; on field errors shows them on the input; on formError toasts the message.
    - RevokeInviteButton: small destructive ghost button + AlertDialog confirm; on confirm calls revokeInviteAction({ inviteId }); toasts result.
    - ResendInviteButton: small ghost button calling resendInviteAction({ inviteId }); toasts 'Invitation resent'.
    - /settings/page.tsx gets a new linked Card pointing to /settings/team (mirror the existing /settings/usage Card pattern with ChevronRight).
  </behavior>
  <action>
    `src/app/(app)/settings/team/page.tsx` — server component. Pattern: read user via createClient().auth.getUser(); load profile via getProfile; if !owner redirect('/settings'); setRequestScope; then in parallel:
    - SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC (RLS scopes to org)
    - SELECT id, email, expires_at, created_at, invited_by FROM org_invitations WHERE accepted_at IS NULL ORDER BY created_at DESC (RLS scopes to org). Optional left join on users for inviter name — simpler: SELECT invited_by then map via the users array already fetched.
    Render header + "Invite member" trigger (passes through to dialog) + two sub-cards (Members, Pending invitations). Empty states: 'No team members yet' / 'No pending invitations'. Show expires_at relative via formatTimeAgo / formatDateLong from @/lib/date (already in use by invitations-list.tsx).

    `src/app/(app)/settings/team/invite-member-dialog.tsx` — 'use client'. shadcn Dialog + react-hook-form + zodResolver(inviteMemberSchema) (mirror invite-form.tsx). On success: form.reset(), setOpen(false), toast.success('Invitation sent'). Use `useTransition` for pending state.

    `src/app/(app)/settings/team/revoke-invite-button.tsx` — 'use client'. shadcn Button (variant="ghost" size="sm") + AlertDialog for confirmation ('Revoke invitation for {email}?'). On confirm call revokeInviteAction.

    `src/app/(app)/settings/team/resend-invite-button.tsx` — 'use client'. Simple Button calling resendInviteAction; disabled while pending; toast on result.

    `src/app/(app)/settings/page.tsx` — add a new `<Link href="/settings/team">` Card right after the existing inline Team Card (or replace the inline one — choose to ADD a new linked card and leave the legacy inline section intact so we don't break ongoing flows). Card title 'Team', description 'Invite teammates, revoke pending invitations, and see who's joined.' with ChevronRight icon, mirroring the Usage Card visual style. Wrap in `isOwner ? ... : null` to hide for non-owners.

    Reuse formatDateLong/formatTimeAgo from `@/lib/date` and shadcn primitives already in the codebase (Card, Button, Dialog, AlertDialog, Input, Label, Form). No new dependencies.
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm lint -- "src/app/(app)/settings" &amp;&amp; pnpm build</automated>
  </verify>
  <done>
    - /settings/team renders for an owner with the dialog button, members list, and pending invitations list
    - Non-owner hitting /settings/team is redirected to /settings
    - InviteMemberDialog submit creates a row visible in the Pending list after revalidatePath
    - Revoke removes the row; Resend keeps the row and re-fires email (verify via Resend dashboard or Sentry-suppressed log when no_api_key)
    - pnpm typecheck + lint + build all pass
    - /settings now shows a clickable Team card that navigates to /settings/team
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: /accept-invite route + sign-in pre-fill + /auth/callback (null-email guard + RPC-driven org join) + invitation helpers</name>
  <files>src/app/accept-invite/[token]/route.ts, src/app/(auth)/sign-in/sign-in-form.tsx, src/app/auth/callback/route.ts, src/lib/invitations/cookie.ts, src/lib/invitations/lookup.ts</files>
  <behavior>
    - Cookie helpers in src/lib/invitations/cookie.ts: export INVITE_COOKIE_NAME = 'altus_invite_token'; export const INVITE_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 } — used by both /accept-invite route and /auth/callback. `domain` is intentionally OMITTED so the cookie is host-only — this prevents the production cookie from being sent to staging subdomains (or vice versa) and avoids accidental cross-environment leakage.
    - lookupInvitationByToken(serviceClient, token): SELECT id, organization_id, email, expires_at, accepted_at, invited_by FROM org_invitations WHERE token = $1. Returns null if not found. Used only by /accept-invite for the pre-sign-in validity check (the canonical accept path on /auth/callback goes through the public.accept_invitation() RPC, not this helper).
    - GET /accept-invite/{token} via service-role: if token not found → redirect /sign-in?error=invalid-invite. If accepted_at not null → redirect /sign-in?error=expired-invite (re-use "expired" key — a single error code for both states keeps the sign-in banner copy simple; comment notes that "accepted" is bucketed under "expired" intentionally). If expires_at < now() → redirect /sign-in?error=expired-invite. Else set httpOnly Lax cookie altus_invite_token={token} (1h max-age) and redirect to /sign-in?email={encodedEmail}&invite=1.
    - SignInForm reads ?email= via useSearchParams() and initialises the email useState to that value (decodeURIComponent). Reads ?invite=1 to render an info banner above the form: 'You've been invited to Altus — sign in with this email to accept.' Banner uses border + bg-muted styling consistent with the existing 'sent' state Card.
    - SignInForm continues to use shouldCreateUser: false on signInWithOtp by default. When ?invite=1 is present, sets shouldCreateUser: true so the invitee can land directly via the magic link without a separate /sign-up step. Comment in code explains the gate: only ?invite=1 + signed invite cookie present should toggle this, never plain /sign-in. Defence in depth: the callback handler re-verifies the cookie's token against the invitation row's email server-side inside the RPC.
    - /auth/callback after successful exchangeCodeForSession:
      1. Read altus_invite_token cookie via cookies(). If absent → existing redirect to next (no change to legacy behaviour).
      2. If cookie present, FIRST call `supabase.auth.getUser()` and apply the null-email precondition: if `!user?.email` (PKCE-exchanged session has no email address — should never happen for magic-link OTP but is defensively required), clear the invite cookie, redirect to `/sign-in?error=invalid-invite`, and RETURN. This MUST execute BEFORE any service-role lookup or RPC call. A comment block in the route handler documents the rationale: a null email means we cannot perform the email-match check that gates org reassignment, so the only safe action is to abort the invite flow entirely (the user keeps whatever fresh-org bootstrap the trigger gave them; they can re-request a new invite link).
      3. Only after the null-email guard passes: call `createServiceClient().rpc('accept_invitation', { p_token: cookieToken, p_user_id: user.id, p_user_email: user.email })`. This RPC is the canonical accept path — the callback handler does NOT orchestrate multiple statements, does NOT touch users/org_invitations/organizations tables directly, and does NOT attempt orphan cleanup itself. The RPC returns { ok, reason }.
      4. If rpc returns ok=false: clear cookie. If reason === 'email_mismatch' → Sentry.captureMessage('invite_email_mismatch', { tags: { feature: 'invitations' }}). Redirect to /sign-in?error=invalid-invite regardless of reason. Never log the actual email or token.
      5. If rpc returns ok=true: clear cookie, redirect to /dashboard (or next).
      6. Any thrown error from the RPC call: Sentry.captureException with { feature: 'invitations', step: 'callback' } tags, clear cookie, redirect to /sign-in?error=invalid-invite.
  </behavior>
  <action>
    `src/lib/invitations/cookie.ts` — `import 'server-only'`. Export INVITE_COOKIE_NAME constant + INVITE_COOKIE_OPTIONS object (see behavior). Add a helper `getInviteAcceptUrl(origin: string, token: string)` returning `${origin}/accept-invite/${token}`. Include a comment block above INVITE_COOKIE_OPTIONS: "// `domain` is intentionally omitted so the cookie is host-only. This prevents production cookies from being sent to staging subdomains (or vice versa) and keeps invite cookies scoped strictly to the host that issued them. Adding `domain` later would be a security regression unless the env is single-host-only."

    `src/lib/invitations/lookup.ts` — `import 'server-only'`. Export typed `lookupInvitationByToken(serviceClient, token: string)` returning Promise<InvitationRow | null>. Also export `isInvitationUsable(row): { ok: true } | { ok: false; reason: 'expired' | 'accepted' }`. Header comment: "Used by /accept-invite/[token]/route.ts for pre-sign-in validity display only. The canonical accept path is public.accept_invitation() RPC called from /auth/callback — this helper is intentionally NOT used to mutate state."

    `src/app/accept-invite/[token]/route.ts`:
    - Next 16 dynamic route handler. Signature: `export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> })` — note params is a Promise in Next 16.
    - Validate token shape with `z.string().uuid()` first; non-uuid → redirect to /sign-in?error=invalid-invite (defends against probing).
    - Call createServiceClient() + lookupInvitationByToken. Branch per behavior spec above.
    - Use NextResponse.redirect; set cookie on the response via `response.cookies.set(INVITE_COOKIE_NAME, token, INVITE_COOKIE_OPTIONS)`.
    - URL-encode email with encodeURIComponent in the redirect.

    `src/app/(auth)/sign-in/sign-in-form.tsx`:
    - Add `const prefilledEmail = searchParams.get('email') ?? ''` then `const [email, setEmail] = useState(prefilledEmail)`. Use a `useEffect` with [prefilledEmail] dep to update when the param changes (covers client-side nav). Decode via decodeURIComponent in a try/catch (fallback to raw on failure).
    - Add `const inviteMode = searchParams.get('invite') === '1'`. When true, render a banner above the form: `<div role="status" className="border-border bg-muted/40 text-foreground rounded-md border p-3 text-sm">You've been invited to Altus — sign in with this email to accept the invitation.</div>`.
    - Add `const errorParam = searchParams.get('error')`. Map 'invalid-invite' / 'expired-invite' to short messages rendered as inline `<p role="alert" className="text-destructive text-sm">`.
    - In onSubmit, when inviteMode is true (and not passwordMode), pass `shouldCreateUser: true` to signInWithOtp; otherwise keep `shouldCreateUser: false`. Add a comment block explaining the security rationale (the /accept-invite route is the only path that sets ?invite=1 + the signed cookie; the callback handler re-verifies token+email inside the accept_invitation RPC).

    `src/app/auth/callback/route.ts`:
    - Read invite cookie via `request.cookies.get(INVITE_COOKIE_NAME)`. Default flow (no cookie) unchanged from current implementation.
    - On invite path, after `exchangeCodeForSession`, call `supabase.auth.getUser()` to get the authenticated user object.
    - IMMEDIATELY apply the null-email guard: `if (!user?.email) { /* clear cookie + redirect to /sign-in?error=invalid-invite + return */ }`. Include an inline comment: "// Null-email precondition: PKCE-exchanged session lacks an email. We cannot perform the email-match check that gates org reassignment, so abort the invite flow entirely. Must run BEFORE any service-role lookup or RPC call — see threat T-260524-bpy-11."
    - Only after the guard passes: call `createServiceClient().rpc('accept_invitation', { p_token, p_user_id: user.id, p_user_email: user.email })`. Handle the { ok, reason } result per behavior spec — no direct table mutations, no orphan-org SELECT/DELETE in the route handler.
    - Build the response (`NextResponse.redirect(`${origin}/dashboard`)`) and clear the cookie via `response.cookies.set(INVITE_COOKIE_NAME, '', { ...INVITE_COOKIE_OPTIONS, maxAge: 0 })`.
    - Wrap the invite-path RPC call in try/catch; on any unexpected error: Sentry.captureException with { feature: 'invitations', step: 'callback' } tags, clear cookie, redirect to /sign-in?error=invalid-invite. Never log the token or invitee email.
    - Keep the existing non-invite path bit-for-bit identical (`safeNext(next)` redirect on success; redirect to /auth/auth-code-error on exchange failure).
  </action>
  <verify>
    <automated>pnpm typecheck &amp;&amp; pnpm lint -- src/app/accept-invite src/app/auth "src/app/(auth)" src/lib/invitations &amp;&amp; pnpm build &amp;&amp; grep -E "!user\?\.email|accept_invitation" src/app/auth/callback/route.ts</automated>
  </verify>
  <done>
    - GET /accept-invite/{validToken} sets altus_invite_token cookie and redirects to /sign-in?email=...&invite=1
    - GET /accept-invite/{expiredToken} redirects to /sign-in?error=expired-invite (no cookie set)
    - GET /accept-invite/{unknownToken} redirects to /sign-in?error=invalid-invite (no cookie set)
    - SignInForm pre-fills the email input and shows the invite banner when ?email=...&invite=1
    - /auth/callback null-email precondition is the FIRST statement after `auth.getUser()` on the invite path — verified by inspection that no service-role call or RPC invocation precedes the `!user?.email` check; rationale comment present in the source file
    - After magic-link click → /auth/callback exchanges code, applies null-email guard, calls public.accept_invitation() RPC, attaches user to inviter's org (verify in DB: `select organization_id from public.users where id = '<invitee>'` matches inviter), invitation marked accepted, orphan auto-created org row deleted, cookie cleared, redirects to /dashboard — all inside one transactional boundary inside the RPC
    - A second click on the same accept-invite link AFTER the user has accepted → /sign-in?error=expired-invite (accepted_at not null bucket)
    - Plain sign-up flow without an invite cookie still creates a fresh org (regression check: sign up a new user, confirm a fresh organization row is created with role=owner)
    - Email mismatch (rare adversarial path): manually set the cookie to a token belonging to a different invitee, sign in → RPC returns ok=false reason='email_mismatch', cookie cleared, redirect to /sign-in?error=invalid-invite, no organization_id mutation occurs (verify via Sentry breadcrumb)
    - Null-email path (defensive): if `auth.getUser()` returns a user with no email after PKCE exchange, the route redirects to /sign-in?error=invalid-invite WITHOUT calling the RPC or service-role lookup (verified by code inspection and by the grep in the verify block matching `!user?.email`)
    - pnpm typecheck + lint + build pass
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → /accept-invite | Public route; token is the only authority. Service-role client used server-side for lookup. |
| Browser → /sign-in?invite=1 | Public; toggles shouldCreateUser:true. Mitigation: server-side re-verification on callback. |
| Browser → /auth/callback | Receives PKCE code + cookie. Service-role calls public.accept_invitation() RPC for atomic org reassignment. |
| Authenticated browser → server actions (invite/revoke/resend) | RLS-scoped role check on public.users BEFORE service-role escalation. |
| Resend API | Outbound only. No invitee data in URLs we don't control. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260524-bpy-01 | Tampering | altus_invite_token cookie | mitigate | httpOnly + sameSite=Lax + Secure in prod prevents JS tampering; host-only (domain omitted) so prod and staging cookies do not cross subdomains; server-side re-verification via public.accept_invitation() RPC on callback; email-match check between invitation.email and authenticated user.email inside the RPC rejects forged tokens belonging to a different invitee. |
| T-260524-bpy-02 | Elevation of Privilege | Replay of expired/accepted token | mitigate | Validity check (expires_at > now() AND accepted_at IS NULL) is performed atomically inside public.accept_invitation() with SELECT...FOR UPDATE on the invitation row — no TOCTOU window. /accept-invite additionally short-circuits to an error page before sign-in for usability. |
| T-260524-bpy-03 | Spoofing | Adversary clicks invite link sent to victim's address | mitigate | Email-match check inside the accept_invitation RPC (lower(invitation.email) = lower(p_user_email)). An attacker would also need to control the invitee's email inbox to receive the magic link, making the unique attack scenario near-zero. Sentry.captureMessage on mismatch. |
| T-260524-bpy-04 | Elevation of Privilege | Non-owner attempts inviteMemberAction / revokeInviteAction / resendInviteAction | mitigate | R8 pattern: user-scoped RLS-bounded SELECT users.role WHERE id = auth.uid() BEFORE any service-role call. role !== 'owner' → return error. Pattern mirrored from existing inviteTeammateAction. |
| T-260524-bpy-05 | Information Disclosure | SERVICE_ROLE key leakage path | mitigate | src/lib/supabase/service.ts already has `import 'server-only'`; new code only imports it from server actions + route handlers (never from Client Components). Lint will flag accidental client import. Audit checklist: grep for `createServiceClient` after task — only allowed in actions.ts and route.ts files. |
| T-260524-bpy-06 | Information Disclosure | Resend email body / Sentry logs leaking invitee email or token | mitigate | Email body uses plaintext only (no html user-controlled string) per submit-feedback.ts pattern. Sentry captures NEVER include the email or token — only error object + { feature: 'invitations' } tag. Audit: grep new actions.ts for Sentry.capture* calls and verify args. |
| T-260524-bpy-07 | Tampering | Cross-tenant INSERT via crafted org_invitations payload | mitigate | RLS WITH CHECK (organization_id = current_organization_id()) + _set_org trigger autofill + invited_by autofill trigger. Client cannot pass organization_id or invited_by from outside the auth session. |
| T-260524-bpy-08 | Denial of Service | Owner repeatedly invites the same email | mitigate | Partial unique index (organization_id, email) WHERE accepted_at IS NULL; second insert fails with friendly Zod-mapped error in inviteMemberAction. resendInviteAction is the supported path for re-sending. |
| T-260524-bpy-09 | Tampering | Orphan auto-created org left behind / partial state on accept | mitigate | All of {org reassignment, accepted_at marking, orphan-org cleanup} happen inside a single transaction in public.accept_invitation() with SELECT...FOR UPDATE on the orphan org check. Either everything commits or nothing does — no TOCTOU between the "is org empty" check and the DELETE. Callback handler is a thin RPC caller and does not orchestrate multiple statements. |
| T-260524-bpy-10 | Repudiation | Invitee disputes joining the org | accept | Out of scope for this slice. created_at + invited_by + accepted_at on org_invitations provide an audit trail sufficient for support. Future phase may add audit_log entries. |
| T-260524-bpy-11 | Elevation of Privilege | Callback called with PKCE-exchanged session that has null user.email | mitigate | Null-email precondition in /auth/callback runs BEFORE any service-role lookup or RPC call: if `!user?.email`, clear cookie + redirect to /sign-in?error=invalid-invite + return. Comment in source documents rationale (cannot perform email-match without an email; abort the invite flow). Surfaced as a verification line in Task 3's done block. |
| T-260524-bpy-SC | Tampering | npm/pnpm package installs | n/a | No new packages required. All dependencies already in package.json (Zod, react-hook-form, sonner, shadcn primitives, @supabase/*, @sentry/nextjs). No legitimacy gate needed. |
</threat_model>

<verification>
- Migration applies cleanly to linked Supabase project; `pnpm exec supabase db push --linked` exits 0 (run by orchestrator after executor completes).
- `pnpm db:types` reflects the new `org_invitations` table in src/types/database.ts (run by orchestrator out-of-band).
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` all pass at end of Task 3.
- End-to-end manual smoke (developer):
  1. Sign in as an owner; visit /settings/team; click "Invite member"; submit `teammate@example.com`.
  2. Verify a row in public.org_invitations (token, expires_at +7d, accepted_at null) via psql.
  3. Copy the /accept-invite/{token} URL from the Resend dashboard (or DB row).
  4. In a private window, visit the URL → redirected to /sign-in with email pre-filled + invite banner.
  5. Submit; click the magic link in the inbox → /auth/callback → null-email guard passes → public.accept_invitation() RPC → /dashboard.
  6. Verify `public.users` row for the invitee has organization_id = inviter's org and role = 'recruiter'.
  7. Verify the auto-created orphan org is DELETED (the RPC handles this atomically inside the same transaction as the org reassignment).
  8. Verify the invitation row has accepted_at = now().
  9. Visit /accept-invite/{sameToken} again → /sign-in?error=expired-invite.
- Regression: in a separate private window, sign up a new user without an invite cookie → /dashboard with a fresh org + role=owner (current behaviour preserved).
- Adversarial: hand-craft a callback request where the invite cookie is set but the PKCE session somehow has no email — confirm null-email guard fires and redirects to /sign-in?error=invalid-invite WITHOUT invoking the RPC (inspect Sentry breadcrumbs and logs).
</verification>

<success_criteria>
- All `must_haves.truths` verifiable end-to-end via the smoke flow above.
- Owner sees, sends, revokes, and resends invitations from /settings/team.
- Invitee accepts via /accept-invite/{token} and lands in the inviter's organization, NOT a fresh org.
- Org reassignment + orphan-org deletion + accepted_at marking are atomic — verified by inspection that the callback contains only the RPC call (no direct table mutations) and by the migration containing the full RPC body inside a single function transaction.
- Null-email defensive guard fires before any service-role call on the invite path.
- Plain sign-up (no invite) still creates a fresh org — no regression to existing behaviour.
- Migration applies (out-of-band), types regenerate (out-of-band), typecheck + lint + build pass.
- Threat model items T-01 through T-09 and T-11 implemented; T-10 explicitly accepted with rationale.
</success_criteria>

<output>
On completion, create `.planning/quick/260524-bpy-org-member-invitation-flow-magic-link-to/260524-bpy-SUMMARY.md` documenting:
- Files added/modified (paths + 1-line each)
- Commits created (one per task per the locked split)
- Migration applied to linked project (note: orchestrator runs db push + db:types after executor finishes)
- Any deviations from this plan + rationale
- Open follow-ups (e.g., legacy `inviteTeammateAction` + `/settings` inline Team card removal; audit_log entries for invitations; owner-only resend rate-limit)
</output>
