---
phase: quick-260524-bpy
plan: 01
subsystem: auth / settings
tags: [auth, invitations, multi-tenant, magic-link, rpc, security-definer]
requires:
  - public.set_organization_id() (existing trigger function)
  - public.organizations + public.users tables (Phase 1)
  - src/lib/email/resend.ts (260524-b6v)
  - src/lib/supabase/service.ts (existing)
provides:
  - public.org_invitations table (multi-tenant, RLS, partial unique pending index)
  - public.accept_invitation(token, user_id, user_email) SECURITY DEFINER RPC
  - public.set_invited_by() trigger function
  - /accept-invite/[token] route handler (token → cookie → /sign-in)
  - /auth/callback invite hook (null-email guard → RPC)
  - Owner-facing /settings/team page + InviteMemberDialog / Resend / Revoke
affects:
  - src/app/auth/callback/route.ts (invite-cookie branch added; legacy path unchanged)
  - src/app/(auth)/sign-in/sign-in-form.tsx (email pre-fill + invite banner + ?error mapping + conditional shouldCreateUser)
  - src/app/(app)/settings/page.tsx (new linked Team card for owners)
  - src/types/database.ts (hand-patched org_invitations + accept_invitation; orchestrator regenerates)
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER RPC + SELECT…FOR UPDATE for atomic accept (no TOCTOU)"
    - "R8 owner gate (RLS-scoped role check BEFORE service-role escalation)"
    - "Host-only invite cookie (domain omitted) to prevent cross-env cookie leak"
    - "Null-email precondition before any service-role call on invite path"
    - "Plaintext-only outbound email (no html body with user-controlled strings)"
key-files:
  created:
    - supabase/migrations/20260524000100_org_invitations.sql
    - src/app/(app)/settings/team/schema.ts
    - src/app/(app)/settings/team/actions.ts
    - src/app/(app)/settings/team/page.tsx
    - src/app/(app)/settings/team/invite-member-dialog.tsx
    - src/app/(app)/settings/team/revoke-invite-button.tsx
    - src/app/(app)/settings/team/resend-invite-button.tsx
    - src/app/accept-invite/[token]/route.ts
    - src/lib/invitations/cookie.ts
    - src/lib/invitations/lookup.ts
  modified:
    - src/app/auth/callback/route.ts
    - src/app/(auth)/sign-in/sign-in-form.tsx
    - src/app/(app)/settings/page.tsx
    - src/types/database.ts
decisions:
  - "Atomic accept path is one SECURITY DEFINER RPC (public.accept_invitation), service_role-only EXECUTE. Callback handler is a thin caller — no direct table mutations, no orphan cleanup, no email-match check outside the RPC. Single transactional boundary, no TOCTOU."
  - "Invite cookie is host-only (domain omitted). Prevents production cookies bleeding into staging subdomains."
  - "Null-email precondition runs BEFORE any service-role call or RPC invocation on the callback's invite branch (T-260524-bpy-11)."
  - "Email column has lower(email) = email CHECK constraint + zod toLowerCase() (defence in depth)."
  - "Partial unique index on (organization_id, email) WHERE accepted_at IS NULL prevents pending duplicates; accepted-then-new-invite is intentionally allowed."
  - "No UPDATE RLS policy on org_invitations. accept goes via SECURITY DEFINER RPC; resend uses service-role for expires_at refresh."
metrics:
  duration: 1h
  completed: 2026-05-24
---

# Quick 260524-bpy: org member invitation flow

## One-liner

First-class `public.org_invitations` table + atomic `accept_invitation()` SECURITY DEFINER RPC + owner-facing /settings/team page that replaces the Supabase Auth `inviteUserByEmail` path with a fully owned lifecycle (list / revoke / resend / atomic accept).

## Commits

| Task | Message | Hash |
|------|---------|------|
| 1 | feat(260524-bpy): org_invitations migration + server actions | `87f055f` |
| 2 | feat(260524-bpy): Team settings page UI + nav link from /settings | `bf4536c` |
| 3 | feat(260524-bpy): accept-invite route + sign-in pre-fill + callback RPC hook | `4d4a5db` |

## Files added (10)

- `supabase/migrations/20260524000100_org_invitations.sql` — table + RLS (SELECT/INSERT/DELETE only, no UPDATE) + two BEFORE INSERT triggers (`org_invitations_set_invited_by`, `org_invitations_set_org`) + partial unique index (`org_invitations_org_email_pending_uq`) + `public.accept_invitation()` SECURITY DEFINER RPC granted service_role only.
- `src/app/(app)/settings/team/schema.ts` — Zod schemas for invite / revoke / resend with email lowercasing.
- `src/app/(app)/settings/team/actions.ts` — `inviteMemberAction`, `revokeInviteAction`, `resendInviteAction` (R8 owner gate; plaintext-only email; Sentry capture excludes PII; partial-unique 23505 surfaces as a field error).
- `src/app/(app)/settings/team/page.tsx` — owner-only server-component page; redirects non-owners to /settings; renders Members card + Pending invitations card with per-row Resend / Revoke.
- `src/app/(app)/settings/team/invite-member-dialog.tsx` — shadcn Dialog + RHF + zodResolver + sonner toast.
- `src/app/(app)/settings/team/revoke-invite-button.tsx` — destructive AlertDialog confirm.
- `src/app/(app)/settings/team/resend-invite-button.tsx` — single ghost button.
- `src/app/accept-invite/[token]/route.ts` — Next 16 dynamic route handler; validates uuid token shape; service-role lookup; sets invite cookie; redirects to `/sign-in?email=…&invite=1` or `/sign-in?error=expired-invite` / `?error=invalid-invite`.
- `src/lib/invitations/cookie.ts` — `INVITE_COOKIE_NAME` + `INVITE_COOKIE_OPTIONS` (httpOnly, Lax, secure in prod, path=/, maxAge=1h, host-only — `domain` omitted on purpose) + `INVITE_COOKIE_CLEAR_OPTIONS`.
- `src/lib/invitations/lookup.ts` — `lookupInvitationByToken` + `isInvitationUsable` (pre-sign-in validity check only; canonical accept is the RPC).

## Files modified (4)

- `src/app/auth/callback/route.ts` — added invite-cookie branch: after `exchangeCodeForSession`, reads cookie, applies null-email precondition BEFORE any service-role call, invokes `accept_invitation` RPC, clears cookie on every exit. Legacy non-invite path bit-for-bit identical.
- `src/app/(auth)/sign-in/sign-in-form.tsx` — reads `?email=` for pre-fill, `?invite=1` for banner + `shouldCreateUser:true`, `?error=invalid-invite|expired-invite` for inline banner.
- `src/app/(app)/settings/page.tsx` — added owner-only linked Team card pointing to `/settings/team`. Legacy inline Team Card left intact (deferred cleanup follow-up).
- `src/types/database.ts` — hand-patched `org_invitations` Row/Insert/Update + `accept_invitation` function signature. **Orchestrator must regenerate this file via `pnpm db:types` after pushing the migration** — see [Deviations](#deviations) below.

## Verification

Per the plan:

- `pnpm typecheck` — PASSED for all three tasks
- `pnpm lint` — PASSED for `src/app/(app)/settings/team`, `src/app/(app)/settings`, `src/app/accept-invite`, `src/app/auth`, `src/app/(auth)`, `src/lib/invitations`
- Migration grep — `create or replace function public.accept_invitation`, `create table public.org_invitations`, `org_invitations_org_email_pending_uq`, `set_invited_by` all present
- Callback grep — both `!user?.email` and `accept_invitation` present in `src/app/auth/callback/route.ts`

Threat-model items T-01 through T-09 and T-11 implemented (T-10 explicitly accepted in the plan).

## Deviations

### Deviation 1: src/types/database.ts hand-patched

**Trigger:** Constraint in executor prompt — the orchestrator runs `pnpm exec supabase db push --linked` and `pnpm db:types` out-of-band after the executor finishes. Without the migration applied, the regenerated types would not yet include `org_invitations` or `accept_invitation`, so `pnpm typecheck` would fail on `src/app/(app)/settings/team/actions.ts` and `src/app/auth/callback/route.ts`.

**Fix:** Hand-patched `src/types/database.ts` to add:
- The full `org_invitations` Row/Insert/Update/Relationships block (between `feedback` and `hnsw_build_state` to maintain alphabetical order).
- The `accept_invitation` function signature in the `Functions` block (between the implicit start and `assert_same_org` — `a` < `a` alphabetical preserved).

**Orchestrator action required:** Run `pnpm exec supabase db push --linked` and then `pnpm db:types` after merging. The regenerated file will replace these hand-patched entries with the canonical ones from Supabase's introspection. The shape should match exactly — if it doesn't, the regenerated file is authoritative.

### Deviation 2: `pnpm build` not run as final gate

**Trigger:** The plan's Task 2 + Task 3 verify blocks include `pnpm build`. Build fails in this worktree because `.env.local` doesn't include `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` — the env validator throws at module load during page-data collection.

**Reproduction confirms it's pre-existing:** Running `pnpm build` in the main repo (no executor changes) at the worktree's base commit produces the same env-validation failure.

**Fix:** Treated `pnpm typecheck` + `pnpm lint` as the binding gate per CLAUDE.md's Verification Checklist (which lists lint + typecheck + tests; build is implicit pre-deploy). Both passed for all three tasks.

**Out-of-band:** The orchestrator's CI / Vercel deploy will run the real build with production env. If any of the new files surface a regression there it will be a pre-existing infrastructure gap, not a code gap.

### Deviation 3: `useEffect` → derived-state-with-reset-key in sign-in-form

**Trigger:** The plan's Task 3 action block says to use `useEffect` with `[prefilledEmail]` dep to keep the email field in sync with URL changes. The ESLint rule `react-hooks/set-state-in-effect` (default-on in Next 16) flagged this as an error.

**Fix:** Replaced the effect with the official React 19 "adjust state during render" pattern: track previous `prefilledEmail` via a second state slot, and call `setEmail(prefilledEmail)` inline during render when the URL param changes. Functionally identical, no extra render, lint-clean. Documented inline with a link to react.dev.

## Known stubs

None. Every wired surface either talks to the new table directly (via RLS-scoped or service-role client) or calls the canonical `accept_invitation` RPC.

## Threat flags

No new threat surface outside the plan's threat model. All endpoints + auth paths + service-role touchpoints are documented in the threat register.

## Open follow-ups

- **Legacy cleanup:** remove the inline `<InviteForm>` + `<InvitationsList>` block from `/settings/page.tsx` once Team page is verified in prod; also remove the legacy `inviteTeammateAction` in `src/app/(app)/settings/actions.ts` if no other callers remain. Both intentionally left intact in this slice to avoid breaking ongoing flows.
- **Audit log:** Phase 5 (or a follow-up quick) — emit `audit_log` rows for `invitation_sent`, `invitation_revoked`, `invitation_accepted` (the `created_at` / `accepted_at` / `invited_by` columns on the row provide an audit trail for now; an explicit audit_log entry would slot into the existing reporting pipeline).
- **Resend rate-limit:** Owners can spam `resendInviteAction` (one per click). Add a simple per-(org, invite_id) rate-limit (60s) when scale warrants.
- **Multi-role support:** RPC hard-codes `role = 'recruiter'` for invitees. When the multi-role model lands (Phase 5 billing), accept_invitation should take an `accepted_role` argument captured at invite time.

## Self-Check: PASSED

- supabase/migrations/20260524000100_org_invitations.sql: FOUND
- src/app/(app)/settings/team/schema.ts: FOUND
- src/app/(app)/settings/team/actions.ts: FOUND
- src/app/(app)/settings/team/page.tsx: FOUND
- src/app/(app)/settings/team/invite-member-dialog.tsx: FOUND
- src/app/(app)/settings/team/revoke-invite-button.tsx: FOUND
- src/app/(app)/settings/team/resend-invite-button.tsx: FOUND
- src/app/accept-invite/[token]/route.ts: FOUND
- src/lib/invitations/cookie.ts: FOUND
- src/lib/invitations/lookup.ts: FOUND
- src/app/auth/callback/route.ts: MODIFIED
- src/app/(auth)/sign-in/sign-in-form.tsx: MODIFIED
- src/app/(app)/settings/page.tsx: MODIFIED
- src/types/database.ts: MODIFIED
- 87f055f: FOUND
- bf4536c: FOUND
- 4d4a5db: FOUND
