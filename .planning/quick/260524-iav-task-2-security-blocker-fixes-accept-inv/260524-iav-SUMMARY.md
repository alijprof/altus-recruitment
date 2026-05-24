---
phase: quick-260524-iav
plan: 01
subsystem: auth-invitations
tags: [security, postgres, auth, server-actions, env]
dependency_graph:
  requires:
    - quick/260524-bpy (org_invitations table + accept_invitation RPC + /settings/team)
    - "supabase/migrations/20260524000100_org_invitations.sql"
    - "src/lib/invitations/cookie.ts (INVITE_COOKIE_NAME)"
    - "src/lib/env.ts (@t3-oss/env-nextjs handle)"
  provides:
    - "supabase/migrations/20260524000300_fix_accept_invitation_lock.sql (FOR UPDATE on orphan org row)"
    - "src/app/(auth)/sign-in/page.tsx (async server component; cookie-derived inviteMode prop)"
    - "src/app/(auth)/sign-in/sign-in-form.tsx (inviteMode as typed prop; URL ?invite=1 no longer honoured)"
    - "src/app/(app)/settings/team/actions.ts (resolveOrigin precedence: env → origin → forwarded-host)"
    - "src/lib/env.ts (NEXT_PUBLIC_SITE_URL declared client schema + experimental__runtimeEnv)"
  affects:
    - "src/app/auth/callback/route.ts (continues to call public.accept_invitation; signature unchanged)"
    - "src/app/(app)/accept-invite/[token]/route.ts (continues to set the invite cookie unchanged)"
tech_stack:
  added: []
  patterns:
    - "@t3-oss/env-nextjs: add NEXT_PUBLIC_* var by declaring in both client schema and experimental__runtimeEnv"
    - "Next.js 16 App Router: await cookies() in async server components to read httpOnly cookies"
    - "Postgres SECURITY DEFINER RPCs: CREATE OR REPLACE preserves grants on identical signature"
key_files:
  created:
    - "supabase/migrations/20260524000300_fix_accept_invitation_lock.sql"
  modified:
    - "src/app/(auth)/sign-in/page.tsx"
    - "src/app/(auth)/sign-in/sign-in-form.tsx"
    - "src/app/(app)/settings/team/actions.ts"
    - "src/lib/env.ts"
decisions:
  - "EXECUTE grants NOT re-applied in the new migration — CREATE OR REPLACE preserves grants on identical signature; re-emitting revoke/grant would be noise."
  - "Cookie-presence check (?.value != null) is sufficient at the page boundary — token validity is re-verified server-side inside public.accept_invitation() RPC during /auth/callback. The flag here is purely a UX banner + shouldCreateUser:true switch."
  - "NEXT_PUBLIC_SITE_URL declared on the client schema (not server) — server actions in env-nextjs can read client vars, and putting it on the client schema keeps the door open for future client-side URL building without re-litigating placement."
  - "Trailing slash stripped from NEXT_PUBLIC_SITE_URL inside resolveOrigin so callers' `${origin}/accept-invite/${token}` cannot produce double-slashes if an operator sets it as `https://app.example.com/`."
metrics:
  duration_seconds: 383
  completed_date: "2026-05-24"
  tasks_completed: 3
  files_changed: 5
  commits: 3
---

# Quick task 260524-iav: Task 2 security blocker fixes (B1/B2/B3) Summary

Closed the three blocker-class security defects identified by REVIEW.md against the org-invitations flow shipped in 260524-bpy. One append-only Postgres migration + surgical edits to four TS files; three atomic commits, one per blocker.

## Commits

| Hash | Subject |
|------|---------|
| `3f34d41` | fix(260524-iav): accept_invitation FOR UPDATE on orphan org row (B1) |
| `3ac51fc` | fix(260524-iav): derive sign-in inviteMode from cookie, not URL (B2) |
| `c79d03a` | fix(260524-iav): invert resolveOrigin precedence — env first, header last (B3) |

## What was built

### Task 1 — B1: accept_invitation FOR UPDATE on orphan org row (`3f34d41`)

New append-only migration `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` CREATE-OR-REPLACEs `public.accept_invitation` with the SAME signature `(p_token uuid, p_user_id uuid, p_user_email text) returns table(ok boolean, reason text)` so the existing caller in `src/app/auth/callback/route.ts` keeps working unchanged. The one functional change: a `perform 1 from public.organizations where id = v_old_org for update` is inserted directly before the `select count(*) into v_other_users` inside the orphan-cleanup branch (lines 96-99 in the new file, before the count at line 101).

Closes the TOCTOU: a concurrent `handle_new_user` INSERT into the about-to-be-deleted org now either (a) blocks on the org row lock until accept_invitation commits — at which point the org has been deleted and the INSERT fails with a FK violation rather than slipping through, or (b) acquired the lock first, causing accept_invitation to wait, then read the post-insert count (>0) and correctly skip the DELETE.

Original migration `20260524000100_org_invitations.sql` is byte-identical to before — last touched by `87f055f` (the original 260524-bpy commit).

### Task 2 — B2: server-derived inviteMode from cookie (`3ac51fc`)

`src/app/(auth)/sign-in/page.tsx` converted to `async function SignInPage()`, reads the httpOnly `altus_invite_token` cookie via `await cookies()` + `INVITE_COOKIE_NAME` from `@/lib/invitations/cookie`, and passes `inviteMode` as a typed boolean prop to `<SignInForm />`.

`src/app/(auth)/sign-in/sign-in-form.tsx` gains a `SignInFormProps` interface (`inviteMode: boolean`), accepts it as a prop, and no longer derives it from `useSearchParams()`. The line `const inviteMode = searchParams.get('invite') === '1'` is removed; `?email=` pre-fill, `?password=` dev fallback, `?error=` banner, the invite banner JSX, and `shouldCreateUser: inviteMode` are all preserved unchanged. Updated the two comment blocks (state-machine intro and pre-OTP block) to reflect the new source of truth.

Closes the spam / junk-org vector: `/sign-in?invite=1&email=victim@example.com` without the cookie now sends `shouldCreateUser: false` so Supabase Auth's `signInWithOtp` will NOT create an `auth.users` row + cascade-fire `handle_new_user` to produce a junk organisation.

### Task 3 — B3: invert resolveOrigin precedence (`c79d03a`)

`src/lib/env.ts` declares `NEXT_PUBLIC_SITE_URL: z.string().url().optional()` in BOTH the `client` schema and `experimental__runtimeEnv` (the second is required by `@t3-oss/env-nextjs` for any NEXT_PUBLIC_* var to ship to the client bundle / be available to typed env at server-action runtime).

`src/app/(app)/settings/team/actions.ts` imports `env` from `@/lib/env` and replaces the body of `resolveOrigin()` so the precedence is now **`env.NEXT_PUBLIC_SITE_URL` → `origin` header → `x-forwarded-host`/`host` header**. Trailing slashes on the env value are stripped via `.replace(/\/$/, '')` so callers' `${origin}/accept-invite/${token}` cannot produce `https://app.example.com//accept-invite/...`. The signature is unchanged (`Promise<string | null>`); the two callers (`inviteMemberAction` and `resendInviteAction`) and their `${origin}/accept-invite/${token}` concatenations are untouched.

Closes the phishing vector: a non-Vercel proxy forwarding an attacker-controlled `X-Forwarded-Host` header can no longer redirect outbound accept-invite emails to `attacker.example` on any deployment that sets `NEXT_PUBLIC_SITE_URL`.

## Verification

| Check | Result |
|-------|--------|
| `pnpm typecheck` after each commit | PASS (0 errors) |
| `pnpm lint` — new errors introduced | 0 |
| `pnpm lint` — pre-existing errors | 1 (`src/app/(app)/candidates/[id]/cv-review-panel.tsx:98:31` impure-function-during-render; out of scope per Scope Boundary — predates this task, last modified by 57b171e on 2026-05-23, logged across deferred-items.md in 260524-b6v/cjl/cwd) |
| `git log --oneline -3` shows three `fix(260524-iav): ...` commits | PASS (`3f34d41`, `3ac51fc`, `c79d03a` — verbatim plan messages) |
| `grep -c 'for update' supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` | 3 (invitation row, user row, NEW orphan-org row) |
| `grep -RnE "searchParams\.get\(['\"]invite['\"]" src/app/(auth)/sign-in/` | 0 matches (URL invite no longer read) |
| `grep -n 'env.NEXT_PUBLIC_SITE_URL' src/app/(app)/settings/team/actions.ts` | 2 hits (`if (env.NEXT_PUBLIC_SITE_URL)` and `env.NEXT_PUBLIC_SITE_URL.replace(...)`) |
| Original `20260524000100_org_invitations.sql` untouched | PASS (`git log` shows last touched by `87f055f` — original 260524-bpy commit) |
| Files modified outside `files_modified` list | None |
| New npm dependencies | None |

## Manual smoke (deferred to orchestrator / human)

Per the plan's `<verification>` section, three browser-level smokes need a real session and were NOT exercised by the executor (worktree has no live preview deployment, and the OTP send requires Resend domain verification that's still pending per STATE.md):

1. `/sign-in?invite=1` with NO `altus_invite_token` cookie → no invite banner, OTP call sends `shouldCreateUser: false` (DevTools Network tab).
2. `/accept-invite/<valid-token>` → cookie set → redirected to `/sign-in` → invite banner shows → OTP send shows `shouldCreateUser: true`.
3. Inviting a teammate locally with `NEXT_PUBLIC_SITE_URL=https://altus-prod.example.com` in `.env.local` produces an email whose link starts with `https://altus-prod.example.com/accept-invite/...` regardless of the dev origin.

All three are code-verifiable from the diff (the prop wiring + the cookie precedence are mechanical), but the runtime confirmation is left to the post-merge UAT bundle alongside the 6 outstanding 260524-bpy items already logged in STATE.md.

## Out-of-band (orchestrator)

- `pnpm exec supabase db push --linked` — TODO for orchestrator. The new migration `20260524000300_fix_accept_invitation_lock.sql` must be applied to the linked Supabase project before B1 is closed in production.
- `pnpm db:types` — TODO for orchestrator. Signature unchanged (same three params, same return shape, same return column names + types), so the regen is expected to be a no-op against `src/types/database.ts`. Confirm by `git diff --stat src/types/database.ts` after regen — non-zero diff would mean the regen picked up unrelated drift that warrants its own follow-up.

## Deviations from plan

### Pre-existing lint error waived (Scope Boundary)

**Found during:** Task 1 (and every subsequent task — same error).
**Issue:** `pnpm lint` exits non-zero with `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98:31 — Error: Cannot call impure function during render`.
**Why waived:** Pre-existing from `57b171e` (2026-05-23, Phase 3 `full_name upgrade + auto-refresh CV review panel`), unrelated to any of the five files touched by this plan. Logged across `deferred-items.md` in 260524-b6v/cjl/cwd and noted in STATE.md autonomous-run summary as "noted but out of scope for every task in this run." Same pattern applies here.
**Action:** None. Per Scope Boundary in deviation rules ("Only auto-fix issues DIRECTLY caused by the current task's changes. Pre-existing warnings, linting errors, or failures in unrelated files are out of scope"), this is documented and skipped. All five files modified by this plan typecheck cleanly and have zero lint errors of their own.

### No other deviations

All three tasks executed exactly as planned. No new dependencies, no new files outside `files_modified`, no architectural changes (Rule 4 not triggered), no auto-fixes to in-scope code (Rules 1-3 not triggered — the diff matches the plan text).

## Deferred follow-ups

- **REVIEW.md H3** — Wire `getInviteAcceptUrl(origin, token)` from `src/lib/invitations/cookie.ts` into `inviteMemberAction` and `resendInviteAction` instead of the inline `${origin}/accept-invite/${token}` concatenation. Explicitly out of scope per the plan's Task 3 action notes; defer to a follow-up quick task. Low priority — the helper exists and the inline form is correct; the change is purely a DRY cleanup.
- **`cv-review-panel.tsx:98` impure-function-during-render** — Same fix pattern used in `sign-in-form.tsx` during 260524-bpy (replace `useEffect`/ref-init in render body with the React-19 adjust-state-during-render idiom or hoist `Date.now()` into `useState` initialiser). Affects every `pnpm lint` exit code in the worktree.
- **Set `NEXT_PUBLIC_SITE_URL` in the linked Vercel project's Production + Preview env** — Without this, Task 3 (B3) is a no-op in production: the env-first branch is only taken when the var is set. Operators MUST configure this before the next invite email goes out from a non-Vercel deployment, and SHOULD configure it on Vercel as defence in depth (Vercel's own `x-forwarded-host` is trustworthy but the env var also pins the canonical host across preview deploys).

## Self-Check: PASSED

- Migration file exists: `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` — FOUND.
- Modified files exist: `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-in/sign-in-form.tsx`, `src/app/(app)/settings/team/actions.ts`, `src/lib/env.ts` — all FOUND.
- Commits exist: `3f34d41`, `3ac51fc`, `c79d03a` — all FOUND in `git log`.
- Original migration `20260524000100_org_invitations.sql` last touched by `87f055f` (260524-bpy) — UNTOUCHED.
- `pnpm typecheck` exit 0 after final commit — PASS.
- No new lint errors introduced — PASS (only the pre-existing `cv-review-panel.tsx:98` error remains).
