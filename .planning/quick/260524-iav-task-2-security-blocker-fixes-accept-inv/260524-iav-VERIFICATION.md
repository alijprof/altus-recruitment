---
phase: quick-260524-iav
verified: 2026-05-24T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
gaps: []
human_verification:
  - test: "Runtime smoke: hit /sign-in?invite=1&email=victim@example.com in a fresh browser session (no altus_invite_token cookie). Open DevTools Network tab and submit the form."
    expected: "No invite banner rendered. The /token POST to Supabase Auth's signInWithOtp sends shouldCreateUser:false in the JSON body. No new auth.users row is created server-side."
    why_human: "Requires a live Supabase project + browser session + network panel inspection; cannot be grep-verified. The diff is correct (inviteMode comes only from the server cookie), but the runtime contract with Supabase Auth needs human confirmation before B2 is fully closed."
  - test: "Runtime smoke: click an /accept-invite/<valid-token> link with a fresh session. After the redirect to /sign-in, submit the form."
    expected: "Invite banner renders. signInWithOtp sends shouldCreateUser:true. After magic-link click, /auth/callback exchanges + invokes accept_invitation RPC + clears the altus_invite_token cookie. User lands in the inviter's organisation as role='recruiter'."
    why_human: "End-to-end magic-link flow requires real Resend send + email click + cookie inspection. The wiring is correct in code but Resend domain verification is pending per STATE.md."
  - test: "Runtime smoke: set NEXT_PUBLIC_SITE_URL=https://altus-prod.example.com in .env.local, restart dev server, invite a teammate from /settings/team while the dev server is reachable via http://localhost:3000. Inspect the outbound Resend email body."
    expected: "Accept-invite URL in the email body begins with 'https://altus-prod.example.com/accept-invite/...' — NOT localhost. Adding a trailing slash to the env value still produces a single-slash URL."
    why_human: "Requires real Resend send + email body inspection. The code path is mechanically correct (env-first precedence + trailing-slash strip) but the email rendering is the actual contract the env var defends."
  - test: "Concurrency smoke for B1: in a psql session, BEGIN; SELECT * FROM accept_invitation(<token>, <user-id>, <email>); — do NOT commit. In a second psql session, attempt INSERT INTO public.users (id, organization_id, …) VALUES (…, <v_old_org>, …);"
    expected: "Second session blocks on the orphan-org FOR UPDATE row lock until the first session commits or rolls back. After commit (org deleted), the second INSERT fails with FK violation. After rollback, the second INSERT proceeds."
    why_human: "Concurrency behaviour cannot be observed from static analysis. Requires a live Postgres + two interactive sessions. The SQL is syntactically present and ordered correctly (line 96-99 before line 101) but the lock semantics need a runtime double-check after `supabase db push --linked` is run."
---

# Quick task 260524-iav: Task 2 security blocker fixes (B1/B2/B3) Verification Report

**Phase Goal:** Close the three blocker-class security defects (B1 orphan-org TOCTOU; B2 URL-derived shouldCreateUser abuse; B3 X-Forwarded-Host injection of invite-email host) identified in the 260524-bpy REVIEW.md.
**Verified:** 2026-05-24
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Concurrent INSERT into a soon-to-be-orphan org during accept_invitation cannot cause silent loss of the org or its ON DELETE CASCADE children. | VERIFIED | `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql:96-99` — `perform 1 from public.organizations where id = v_old_org for update;` placed at line 96-99, BEFORE the `select count(*) into v_other_users` at line 101. CREATE OR REPLACE preserves the existing signature; orchestrator confirmed migration applied to linked DB. |
| 2 | Hitting /sign-in?invite=1&email=victim@example.com with NO altus_invite_token cookie does NOT cause Supabase to create an auth.users row or a junk organization. | VERIFIED (code-level); needs runtime smoke | `src/app/(auth)/sign-in/page.tsx:9-17` is now `async`, reads `altus_invite_token` via `await cookies()`, presence-only check sets `inviteMode`. `src/app/(auth)/sign-in/sign-in-form.tsx:42-44` types the prop; line 46 destructures it; `searchParams.get('invite')` is GONE (grep returned 0 matches). `shouldCreateUser: inviteMode` at line 105 now reflects only the cookie-derived value. |
| 3 | Hitting /sign-in?email=foo@bar.com (no ?invite=1) still pre-fills the email field for an existing user (regression-safe). | VERIFIED | `src/app/(auth)/sign-in/sign-in-form.tsx:59-62` — `prefilledEmail` is still derived from `searchParams.get('email')`; the React-19 adjust-state-during-render idiom at lines 69-74 still seeds `email` from `prefilledEmail`. Only the URL-derived `inviteMode` was removed. |
| 4 | The accept-invite email link sent by inviteMemberAction always uses the host configured in NEXT_PUBLIC_SITE_URL when that env var is set, regardless of any X-Forwarded-Host header an upstream proxy attaches. | VERIFIED (code-level); needs runtime smoke | `src/app/(app)/settings/team/actions.ts:53-66` — `resolveOrigin()` checks `env.NEXT_PUBLIC_SITE_URL` FIRST (line 54), returns it trailing-slash-stripped (line 57), THEN falls back to `origin` header (line 60-61), THEN `x-forwarded-host` / `host` (line 62-65). Trust-model comment lines 40-52. |
| 5 | pnpm typecheck and pnpm lint pass on the working tree after each of the three commits. | VERIFIED (per SUMMARY); pre-existing lint error noted | SUMMARY records 0 new lint errors; pre-existing `cv-review-panel.tsx:98` impure-function-during-render predates this task (commit 57b171e on 2026-05-23) and is logged in the deferred items of multiple prior tasks. Out of scope per Scope Boundary rule. |

**Score:** 5/5 truths verified at the code level. Truths 2 and 4 additionally surfaced as human-verification items for the runtime contract (Supabase Auth shouldCreateUser body inspection; Resend email URL inspection).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` | CREATE OR REPLACE function with FOR UPDATE on orphan org row before user-count query | VERIFIED | Exists; 112 lines; contains exactly one `create or replace function public.accept_invitation` block; 3 `for update` occurrences (invitation row line 63, user row line 80, NEW orphan-org row line 99); orphan-org lock at line 96-99 precedes `select count(*)` at line 101. Signature is byte-identical to original (same three params `p_token uuid, p_user_id uuid, p_user_email text`; same return shape `table(ok boolean, reason text)`). No re-emit of revoke/grant noise. |
| `src/app/(auth)/sign-in/page.tsx` | Async server component reading altus_invite_token via next/headers and passing inviteMode prop | VERIFIED | Lines 1-5: imports `cookies` from `next/headers`, `INVITE_COOKIE_NAME` from `@/lib/invitations/cookie`. Line 9: `async function SignInPage()`. Lines 16-17: `await cookies()` + `?.value != null` presence check. Line 34: `<SignInForm inviteMode={inviteMode} />`. Comment block lines 27-32 documents the rationale. |
| `src/app/(auth)/sign-in/sign-in-form.tsx` | Client component accepts inviteMode as typed prop, no URL derivation | VERIFIED | Lines 42-44: `interface SignInFormProps { inviteMode: boolean }`. Line 46: `export function SignInForm({ inviteMode }: SignInFormProps)`. `searchParams.get('invite')` GONE (grep returned 0). Email pre-fill at line 59-62 untouched. `?password=` dev fallback line 49 untouched. Invite banner JSX line 127-134 untouched. `shouldCreateUser: inviteMode` line 105 unchanged. |
| `src/app/(app)/settings/team/actions.ts` | resolveOrigin precedence env → origin → forwarded-host | VERIFIED | Line 21: `import { env } from '@/lib/env'`. Lines 53-66: `resolveOrigin()` env-first; line 57 trailing-slash strip via `.replace(/\/$/, '')`. Callers `inviteMemberAction` (line 137) and `resendInviteAction` (line 307) unchanged. Trust-model comment lines 40-52. |
| `src/lib/env.ts` | NEXT_PUBLIC_SITE_URL declared on client schema + experimental__runtimeEnv | VERIFIED | Lines 118-124: declared in `client` schema as `z.string().url().optional()` with a quick-task comment explaining the security context. Line 134: declared in `experimental__runtimeEnv` as `process.env.NEXT_PUBLIC_SITE_URL` so Next.js statically references it. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/app/(auth)/sign-in/page.tsx` | `src/app/(auth)/sign-in/sign-in-form.tsx` | `<SignInForm inviteMode={...} />` prop | WIRED | page.tsx:34 passes the prop; sign-in-form.tsx:46 destructures it. TypeScript prop contract enforced via SignInFormProps interface. |
| `src/app/(app)/settings/team/actions.ts` | `src/lib/env.ts` | `import { env } from '@/lib/env'` | WIRED | actions.ts:21 imports `env`; line 54 reads `env.NEXT_PUBLIC_SITE_URL`; line 57 calls `.replace(/\/$/, '')` on it. |
| `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` | `public.organizations` | `PERFORM ... FOR UPDATE` row lock | WIRED | Line 96-99 emits `perform 1 from public.organizations where id = v_old_org for update;` — Postgres-syntactically valid; positioned correctly before the user-count read. Migration was applied to linked DB per orchestrator confirmation. |

### Data-Flow Trace (Level 4)

Not applicable. This is a security-fix patch task; the artifacts are migrations and server-side glue that mutate behaviour rather than render dynamic data. No new components that surface state to UI were introduced.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Original migration UNTOUCHED (append-only rule) | `git log --oneline -10 -- supabase/migrations/20260524000100_org_invitations.sql` | Only `87f055f feat(260524-bpy): org_invitations migration + server actions` — no later commit touches the file. | PASS |
| Three commits exist with prescribed messages | `git log --oneline -10` | `3f34d41` (B1), `3ac51fc` (B2), `c79d03a` (B3), `8d7dbde` (merge) — all present, all with the verbatim `fix(260524-iav): ...` prefix from the plan. | PASS |
| `for update` count in new migration (must be ≥ 2 per plan §verification step 4) | `grep -c 'for update' supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` | 3 (invitation row line 63, user row line 80, NEW orphan-org row line 99) | PASS |
| URL-derived inviteMode removed from sign-in client | `grep -RnE "searchParams\.get\(['\"]invite['\"]" src/app/(auth)/sign-in/` | 0 matches | PASS |
| env.NEXT_PUBLIC_SITE_URL referenced in resolveOrigin | `grep -n 'env.NEXT_PUBLIC_SITE_URL' src/app/(app)/settings/team/actions.ts` | 2 hits (line 54 conditional, line 57 trailing-slash strip) — plus the comment hit at line 41 | PASS |
| FOR UPDATE on orphan org precedes count(*) | `grep -n -E "for update\|count\(\*\)" supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` | line 99 `for update` precedes line 101 `select count(*)` | PASS |

### Probe Execution

Not applicable. This phase declared no `scripts/*/tests/probe-*.sh` probes; the PLAN and SUMMARY rely on grep + typecheck + lint as automated gates, with runtime smokes deferred to human verification.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| B1-accept-invitation-FOR-UPDATE-lock | 260524-iav-PLAN.md | accept_invitation RPC takes FOR UPDATE on orphan org row before counting remaining users | SATISFIED | Migration 20260524000300 lines 96-99; ordering confirmed before count at line 101. |
| B2-server-derived-inviteMode-from-cookie | 260524-iav-PLAN.md | Sign-in inviteMode derived from httpOnly altus_invite_token cookie via next/headers, not URL query | SATISFIED | page.tsx:9-17 + sign-in-form.tsx:42-46 + 105; URL grep returns 0 matches. |
| B3-resolveOrigin-env-first-precedence | 260524-iav-PLAN.md | resolveOrigin precedence: env.NEXT_PUBLIC_SITE_URL → origin → x-forwarded-host | SATISFIED | actions.ts:53-66; env.ts:118-124, 134. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/(app)/candidates/[id]/cv-review-panel.tsx` | 98 | Pre-existing impure-function-during-render lint error | Info (out of scope) | Predates this task (last touched 57b171e, 2026-05-23). Already logged in deferred items across 260524-b6v/cjl/cwd. Does not block this verification — none of the five files modified by this task contain this pattern, and per Scope Boundary the executor correctly did not auto-fix it. |

No TODO/FIXME/TBD/XXX markers introduced. No `return null` / `return []` stubs in the changed code. No hardcoded empty data flowing to render. No console.log-only handlers.

### Human Verification Required

See frontmatter `human_verification` block. Four items, each requiring a live runtime (Supabase + browser + Resend, or a live Postgres for the concurrency case):

1. **Sign-in without invite cookie sends shouldCreateUser:false** — Network panel inspection of the OTP POST body. Closes B2 at the contract layer.
2. **Sign-in after /accept-invite sends shouldCreateUser:true and end-to-end RPC accepts the invite** — Full magic-link flow + cookie + RPC. Closes B2 happy-path + verifies no regression of the original invite UX.
3. **NEXT_PUBLIC_SITE_URL wins over X-Forwarded-Host in outbound email body** — Set env var, send real invite, inspect email body. Closes B3 at the contract layer.
4. **FOR UPDATE on orphan org row actually blocks concurrent inserts** — Two psql sessions, observe lock semantics. Closes B1 at the contract layer.

### Gaps Summary

No gaps. All five must-haves are code-verified. The remaining work is runtime confirmation of the security contracts — the diffs are mechanically correct and idiomatic, and the orchestrator has already applied the migration to the linked DB. Verification status is `human_needed` (not `passed`) because the per-decision-tree rule promotes human items above truth-only confidence: the executor's own SUMMARY explicitly defers three browser-level smokes to post-merge UAT (Resend domain verification is pending per STATE.md), and B1's concurrency contract is unobservable from static analysis.

Append-only rule confirmed: `git log` on the original migration `20260524000100_org_invitations.sql` shows it has been touched exactly once (by `87f055f`, the original 260524-bpy commit). The new file at timestamp `20260524000300` is the canonical replacement and CREATE OR REPLACE preserves the existing grants without re-emitting revoke/grant noise.

Three atomic commits land in the prescribed order with the prescribed messages (`3f34d41` B1, `3ac51fc` B2, `c79d03a` B3) plus one merge commit (`8d7dbde`). No files outside `files_modified` were changed; no new npm dependencies were added.

---

_Verified: 2026-05-24_
_Verifier: Claude (gsd-verifier)_
