---
phase: quick-260524-bpy
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 11/11 must-haves verified (all code-verifiable truths PASS; truths gated on Resend/PKCE/email delivery routed to human verification)
overrides_applied: 0
human_verification:
  - test: "Send a real invite to a fresh address via /settings/team and confirm the inbox receives an email whose subject is exactly `{inviterName} invited you to Altus on {orgName}` containing a clickable /accept-invite/{token} link"
    expected: "Email arrives within a minute; subject formatted as specified; body is plaintext with the absolute accept URL"
    why_human: "Requires RESEND_API_KEY set in the runtime env and access to the invitee inbox; Resend delivery cannot be verified by grep"
  - test: "End-to-end accept flow: in a private window, click the /accept-invite/{token} link, observe redirect to /sign-in with email pre-filled and the invite banner, submit, click the magic link, and confirm landing on /dashboard"
    expected: "Cookie set on /accept-invite redirect; sign-in page shows the banner + pre-filled email; after PKCE exchange the invitee's public.users row has organization_id = inviter's org, role = 'recruiter'; invitation row has accepted_at set; orphan auto-created org row is deleted"
    why_human: "Requires running Supabase + Next.js dev server + magic-link email delivery + DB inspection — outside the static-analysis scope of this verifier"
  - test: "Regression check: in a separate private window with NO invite cookie, sign up a brand-new user via /sign-up"
    expected: "User lands in /dashboard with a freshly created organization row, role = 'owner' (handle_new_user invariant preserved)"
    why_human: "Requires a live sign-up flow; the code path was verified to be bit-for-bit unchanged but the runtime regression check needs human execution"
  - test: "Adversarial: hand-set the altus_invite_token cookie to a valid token belonging to invitee A, then sign in as a DIFFERENT email B"
    expected: "RPC returns ok=false reason='email_mismatch'; cookie cleared; redirect to /sign-in?error=invalid-invite; public.users row for B unchanged; Sentry breadcrumb emitted with no PII"
    why_human: "Requires the dev server + Sentry breadcrumb visibility + DB inspection"
  - test: "Re-click an accept-invite link AFTER successful acceptance"
    expected: "/accept-invite/{sameToken} redirects to /sign-in?error=expired-invite (the `accepted` bucket maps to the expired UI by design); no cookie set"
    why_human: "Requires the running app and a previously accepted invite row"
  - test: "Visual / UX: /settings/team renders Members card + Pending invitations card with Revoke + Resend buttons; non-owner visiting /settings/team is redirected to /settings"
    expected: "Owner sees both cards with correct empty states; non-owner experiences redirect"
    why_human: "Visual layout + redirect-on-role-mismatch flow"
---

# Quick 260524-bpy: org member invitation flow — Verification Report

**Goal:** Owners can invite teammates by email (magic-link with 7-day token); invitees clicking `/accept-invite/[token]` get attached to inviter's org instead of fresh org; existing sign-ups without an invite cookie continue to bootstrap a fresh org (invariant preserved). Server-side RPC `accept_invitation` handles the atomic join.

**Verified:** 2026-05-24
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Owner sees current org members + pending invites on /settings/team | VERIFIED | `page.tsx` parallel selects from `users` and `org_invitations` (filtered `accepted_at IS NULL`), renders Members + Pending cards with empty states. Owner-only — non-owners redirected to /settings (line 49–51). |
| 2 | Owner can submit email → row created in `public.org_invitations` | VERIFIED | `inviteMemberAction` parses Zod (lowercased), R8 owner check, then `supabase.from('org_invitations').insert({ email })` via user-scoped client. RLS WITH CHECK + `set_organization_id()` + `set_invited_by()` triggers auto-fill the FKs. 23505 mapped to friendly field error. |
| 3 | Invitee receives email with subject `{inviterName} invited you to Altus on {orgName}` + /accept-invite/{token} link | VERIFIED (code) / HUMAN (delivery) | `actions.ts:154` constructs subject exactly as specified; plaintext body contains `${origin}/accept-invite/${token}`. `sendResendEmail` invoked. Actual Resend delivery routed to human. |
| 4 | /accept-invite/{token} sets signed httpOnly cookie + redirects to /sign-in?email=…&invite=1 | VERIFIED | `accept-invite/[token]/route.ts:56–58` builds `${origin}/sign-in?email=${encodeURIComponent(invitation.email)}&invite=1`, sets `INVITE_COOKIE_NAME` with `INVITE_COOKIE_OPTIONS` (httpOnly, Lax, maxAge 3600, host-only). Sign-in form reads `?email=` and `?invite=1` (lines 51–56). |
| 5 | After PKCE callback with valid invite cookie + email match → user attached to inviter's org + accepted_at set | VERIFIED | `auth/callback/route.ts` reads cookie, runs null-email guard, calls `service.rpc('accept_invitation', { p_token, p_user_id, p_user_email })`. RPC body in migration: UPDATE users SET organization_id = invite.organization_id, role='recruiter'; UPDATE invitations SET accepted_at = now(). Single transactional boundary. |
| 6 | New sign-up WITHOUT invite cookie continues to get fresh org | VERIFIED | `auth/callback/route.ts:37–39` short-circuits to `redirect(${origin}${next})` BEFORE the invite branch when cookie absent — bit-for-bit unchanged from legacy. `handle_new_user` trigger (20260517204503) still creates fresh org when `invited_to_org` meta is null/empty. |
| 7 | Expired/accepted token → /sign-in?error=expired-invite; unknown token → ?error=invalid-invite | VERIFIED | Route handler: uuid shape fail → invalid-invite (line 36); lookup returns null → invalid-invite (line 43); `isInvitationUsable` returns expired/accepted → expired-invite (line 53). Comment documents the intentional bucketing of accepted under expired. |
| 8 | Owner can revoke (delete row) and resend (refresh expires_at + re-fire email) | VERIFIED | `revokeInviteAction`: R8 owner check + RLS-scoped DELETE. `resendInviteAction`: R8 owner check + RLS-scoped SELECT, service-role UPDATE expires_at if stale (RLS has no UPDATE policy by design), re-fires Resend email. |
| 9 | Cross-tenant token replay blocked by email-match check | VERIFIED | `accept_invitation` RPC body line 176: `if lower(v_invite.email) <> lower(p_user_email) then return query select false, 'email_mismatch'`. Returns BEFORE any UPDATE — no state mutation on mismatch. Sentry tag emitted with no PII. |
| 10 | Null-email session short-circuits BEFORE service-role lookup | VERIFIED | `auth/callback/route.ts:53–57` — `if (!user?.email) { ... clear cookie + redirect to /sign-in?error=invalid-invite + return }` is the FIRST statement after `getUser()`. No `createServiceClient()` or `.rpc()` precedes it. Comment block on lines 47–52 documents T-260524-bpy-11 rationale. |
| 11 | Org reassignment + orphan-org deletion + accepted_at marking atomic via single RPC | VERIFIED | Migration lines 147–209: single `LANGUAGE plpgsql` function body. `SELECT … FOR UPDATE` on invitation (line 167) and on old-org user count (line 186), then UPDATE users + UPDATE invitations + conditional DELETE organizations — all inside one implicit transaction. No TOCTOU. Callback handler does no direct table mutation. |

**Score:** 11/11 truths verified at the code level. Truths 3 and 5 also require runtime confirmation of Resend delivery + magic-link round-trip (routed to human verification).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260524000100_org_invitations.sql` | table + RLS + 2 BEFORE INSERT triggers + partial unique idx + accept_invitation RPC | VERIFIED | 217 lines; contains all declared elements; grep confirms `create or replace function public.accept_invitation`, `create table public.org_invitations`, `org_invitations_org_email_pending_uq`, `set_invited_by`. RPC EXECUTE granted to service_role only (revoked from public/authenticated/anon). |
| `src/app/(app)/settings/team/actions.ts` | inviteMemberAction / revokeInviteAction / resendInviteAction with R8 pattern | VERIFIED | 341 lines; three exported server actions; R8 ordering (Zod → user client → role check → service-role) followed in all three. |
| `src/app/(app)/settings/team/page.tsx` | server component listing members + pending invites | VERIFIED | 168 lines; owner gate; parallel fetch; renders both cards with per-row Resend + Revoke buttons. |
| `src/app/(app)/settings/team/invite-member-dialog.tsx` | shadcn Dialog + email input + Send | VERIFIED | RHF + zodResolver; calls `inviteMemberAction`; sonner toast on success; field errors mapped via `form.setError`. |
| `src/app/(app)/settings/team/revoke-invite-button.tsx` | AlertDialog confirm + revoke action | VERIFIED | Destructive ghost button + AlertDialog; calls `revokeInviteAction`. |
| `src/app/(app)/settings/team/resend-invite-button.tsx` | Single button calling resend action | VERIFIED | Ghost button with `useTransition`; calls `resendInviteAction`; toast on result. |
| `src/app/(app)/settings/team/schema.ts` | Three Zod schemas with email lowercasing | VERIFIED | `inviteMemberSchema` uses `.trim().toLowerCase().email()`; revoke/resend schemas validate uuid. |
| `src/app/accept-invite/[token]/route.ts` | GET handler validating token + setting cookie + redirect | VERIFIED | 60 lines; uuid validation; service-role lookup; cookie set via `response.cookies.set` with `INVITE_COOKIE_OPTIONS`. |
| `src/app/auth/callback/route.ts` | null-email guard + RPC-driven org join | VERIFIED | 108 lines; null-email guard at line 53 is FIRST statement after `getUser()`; RPC call wrapped in try/catch with Sentry; cookie cleared on every exit (success + every failure branch). |
| `src/app/(auth)/sign-in/sign-in-form.tsx` | email pre-fill + invite banner + ?error mapping + conditional shouldCreateUser | VERIFIED | `prefilledEmail` via `useMemo`; `inviteMode` flips `shouldCreateUser`; error banner messages for invalid-invite / expired-invite; React-19 derived-state-with-reset-key pattern used (per deviation #3 in SUMMARY). |
| `src/lib/invitations/cookie.ts` | INVITE_COOKIE_NAME + options + host-only comment | VERIFIED | `import 'server-only'`; constants + clear-options exported; `domain` intentionally omitted with documented rationale; `maxAge: 3600`. |
| `src/lib/invitations/lookup.ts` | lookupInvitationByToken + isInvitationUsable | VERIFIED | `import 'server-only'`; typed helper; pre-sign-in validity check only — header comment forbids state mutation. |
| `src/types/database.ts` | org_invitations + accept_invitation type entries | VERIFIED | Lines 943–990 contain Row/Insert/Update/Relationships for `org_invitations`; lines 1291–1297 contain `accept_invitation` function signature. Confirmed orchestrator regenerated post-migration push (commit 8ef2bac). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| inviteMemberAction | public.org_invitations | RLS-scoped INSERT, triggers autofill FKs | VERIFIED | `supabase.from('org_invitations').insert(insertPayload)` at line 96–100; payload contains only `email`. |
| inviteMemberAction | sendResendEmail | /accept-invite/{token} link in body | VERIFIED | `sendResendEmail({ to, subject, text })` at line 152; `text` body contains `acceptUrl = ${origin}/accept-invite/${inserted.token}`. |
| /accept-invite handler | lookupInvitationByToken | service-role lookup + validity check | VERIFIED | `lookupInvitationByToken(service, token)` at line 41; `isInvitationUsable(invitation)` at line 46. |
| /accept-invite handler | INVITE_COOKIE_NAME | sets httpOnly Lax host-only cookie | VERIFIED | `response.cookies.set(INVITE_COOKIE_NAME, token, INVITE_COOKIE_OPTIONS)` at line 58. |
| /auth/callback handler | public.accept_invitation RPC | atomic email-match + org reassignment | VERIFIED | `service.rpc('accept_invitation', { p_token, p_user_id, p_user_email })` at line 65–69; null-email guard precedes RPC; cookie cleared on every exit branch. |
| /settings/page.tsx | /settings/team | Linked owner-only Card | VERIFIED | `<Link href="/settings/team">` at line 107 inside owner-only Card. |
| handle_new_user trigger (legacy) | (preserved) | No invite cookie → legacy redirect untouched | VERIFIED | Callback line 37–39 short-circuits to `redirect(${origin}${next})` when `!inviteCookie` — invariant preserved. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| team/page.tsx | `members` | `supabase.from('users').select(...)` (RLS-scoped) | Yes (real DB query) | FLOWING |
| team/page.tsx | `pending` | `supabase.from('org_invitations').select(...).is('accepted_at', null)` | Yes (real DB query, filtered) | FLOWING |
| team/page.tsx | `memberById` | `new Map(members.map(...))` over real fetched data | Yes | FLOWING |
| accept-invite route | `invitation` | `lookupInvitationByToken(service, token)` via service-role SELECT | Yes (real DB query) | FLOWING |
| auth/callback route | `data` from RPC | `service.rpc('accept_invitation', …)` returning `[{ ok, reason }]` | Yes (transactional RPC result) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration contains all required elements | `grep -E "create or replace function public.accept_invitation\|create table public.org_invitations\|org_invitations_org_email_pending_uq\|set_invited_by" supabase/migrations/20260524000100_org_invitations.sql` | All four patterns match | PASS |
| Callback has null-email guard + RPC call | `grep -E "!user\?\.email\|accept_invitation" src/app/auth/callback/route.ts` | Both patterns match | PASS |
| Service-role NOT used in any client component | `grep -r "createServiceClient" src/components/` | Zero matches | PASS |
| Server-only marker on invitation libs | `grep -l "'use client'" src/lib/invitations/` | Zero matches (server-only confirmed by `import 'server-only'` in both files) | PASS |
| Three feat commits + types regen commit on main | `git log --oneline` | `87f055f`, `bf4536c`, `4d4a5db` feats + `62fcfa1` merge + `8ef2bac` types regen present | PASS |
| App build / dev-server smoke | `pnpm dev` + browser flow | Not executed (orchestrator runs migration + types out-of-band; runtime smoke is human-verification) | SKIP |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| n/a — no `scripts/*/tests/probe-*.sh` declared in plan or SUMMARY | — | — | n/a |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| QUICK-260524-bpy | 260524-bpy-PLAN.md | Custom org member invitation flow with magic-link + 7-day token + atomic accept RPC | SATISFIED | All 11 must-have truths verified; threat-model items T-01 through T-09 + T-11 implemented; T-10 explicitly accepted in plan with rationale. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none — full grep of modified files for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER returned no unreferenced markers) | — | — | — | — |

Notes:
- All comments in the modified files are explanatory (R8 rationale, T-260524-bpy-11 rationale, host-only cookie rationale, trigger ordering, atomic-transaction invariant) — none are deferred-work markers.
- The "Deferred cleanup" follow-ups listed in SUMMARY (legacy `inviteTeammateAction`, legacy `/settings` inline Team card, audit_log entries, resend rate-limit, multi-role accept arg) are explicitly out-of-scope for this slice and documented; they are NOT in-code TBD markers.
- `// reason:` comment present in actions.ts line 91 for the deliberate `as unknown as TablesInsert<'org_invitations'>` cast — this matches the same pattern used elsewhere in the codebase (submit-feedback.ts) when triggers auto-fill required columns.

### Stub / Hollow Check

- All artifacts are substantive (no empty handlers, no `return null` placeholders, no `console.log`-only implementations).
- The pre-sign-in lookup helper (`lookupInvitationByToken`) and the canonical accept path (`accept_invitation` RPC) are intentionally separated; the lookup helper is for UI redirect choice only and the header comment forbids it being used to mutate state — this is by design, not a stub.

### Human Verification Required

See frontmatter `human_verification:` items 1–6.

The codebase-verifiable substrate is complete and consistent. The remaining checks all require live-runtime artefacts that cannot be evidenced by static analysis:

1. Resend email delivery (requires `RESEND_API_KEY` + real inbox).
2. Magic-link PKCE round-trip end-to-end.
3. Regression test that no-cookie sign-up still creates a fresh org (code path verified bit-for-bit unchanged; runtime confirmation needed).
4. Adversarial cookie tamper / email mismatch path with Sentry breadcrumb visibility.
5. Re-click on accepted invite link runtime check.
6. Visual / UX of /settings/team + non-owner redirect.

### Gaps Summary

No code-level gaps. The phase goal is achieved in the codebase:

- Owners CAN invite, revoke, and resend via /settings/team.
- Invitees clicking /accept-invite/{token} are routed to /sign-in with the email pre-filled and a signed httpOnly cookie set.
- /auth/callback applies the null-email precondition before any service-role lookup, then invokes the `accept_invitation` SECURITY DEFINER RPC for the atomic org-join + accepted_at marking + orphan-org cleanup.
- The legacy non-invite callback path is bit-for-bit unchanged, preserving the fresh-org bootstrap invariant for direct sign-ups.
- The migration applied to the linked DB and types regenerated cleanly (orchestrator commits `8ef2bac`).

Status is `human_needed` solely because end-to-end runtime confirmation (Resend delivery, magic-link round-trip, DB state after acceptance, regression check on plain sign-up) cannot be verified by static analysis.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
