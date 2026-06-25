# Phase scope — Email + Password auth (alongside magic link)

_Scoped 2026-06-25. Grounded in the live altus-recruitment auth code plus the
working password flows in two sibling projects: `altus-move` (full
email/password) and `altus-quay-forthports` (password **and** magic link
side-by-side). Both references are solid and use the same `@supabase/ssr`
patterns this repo already follows — they're safe to copy from._

## Goal

Let a user sign in with **email + password** as an alternative to the magic
link, so returning users never depend on an email arriving (no "expired link",
no Outlook Safe-Links consuming it, no hourly send throttle). **Magic-link
onboarding stays exactly as it is** — password is purely additive and opt-in.

## Why this is small (most of it already exists)

- The backend already supports password — the sign-in form even calls
  `supabase.auth.signInWithPassword(...)`. It's just hidden behind an
  E2E-only gate (`NEXT_PUBLIC_ALLOW_PASSWORD_AUTH==='1'` + `?password=1`).
- `@supabase/ssr`, PKCE, cookie sessions, and the `updateSession` middleware
  are all in place and unchanged by this work.

## The one real design point

altus-recruitment users **sign up passwordless** (`signInWithOtp`), so they have
**no password** (`encrypted_password` is NULL). `signInWithPassword` returns
"Invalid login credentials" for them until they set one. So the heart of this
phase is **how a user gets a password** without touching the working signup.

**Chosen approach (lowest risk): keep passwordless signup + magic link; add
password as an in-app opt-in.**
- A user signs in once via magic link (as today), then **sets a password** in
  Settings → Security (`supabase.auth.updateUser({ password })`).
- A **forgot/reset-password** flow doubles as "set my first password" for anyone
  who never did (and for genuine resets).
- The sign-in form gains a proper, always-available "Use password instead"
  option.

This is deliberately NOT the altus-move model (which collects a password *at*
signup) because our signup is the org-bootstrap magic-link flow and changing it
is unnecessary risk. We borrow altus-move's **flow mechanics** (reset, strength,
error handling), not its signup shape.

## Work breakdown

### Task 1 — Real "password sign-in" option on the sign-in form
`src/app/(auth)/sign-in/sign-in-form.tsx`
- Replace the E2E `?password=1` + env dual-gate with a normal UI toggle
  ("Sign in with a password" ↔ "Email me a link"). Magic link stays the default.
- On "Invalid login credentials", show a helpful message ("No password set yet —
  use the magic link, then add a password in Settings → Security, or reset it
  below") rather than a raw error. Mirror altus-move's dual-check for the
  `email_not_confirmed` case.
- Move/remove the `NEXT_PUBLIC_ALLOW_PASSWORD_AUTH` flag (promote to `env.ts` if
  kept as a kill-switch).
- Reuse: `altus-quay-forthports/src/app/login/page.tsx` (clean
  `signInWithPassword` + inline error handling); `altus-move/src/app/(auth)/login/page.tsx`.

### Task 2 — "Set / change password" in Settings → Security (the key piece)
new `src/app/(app)/settings/security/*`
- Logged-in user sets/changes a password via `supabase.auth.updateUser({ password })`.
- Password-strength meter — copy `altus-move/src/lib/auth/password-strength.ts`
  (no external deps, 0–4 scoring). Don't trim the password; never log it.
- This is how every existing passwordless user (and Liam) gets a password with
  zero disruption to onboarding.

### Task 3 — Forgot / reset password
new `src/app/(auth)/forgot-password/*` + `src/app/(auth)/reset-password/*`
- `/forgot-password`: `resetPasswordForEmail(email, { redirectTo: …/reset-password })`.
- `/reset-password`: `verifyOtp({ token_hash, type: 'recovery' })` then
  `updateUser({ password })`. Copy altus-move's hardening verbatim:
  - dual-path token handling (`token_hash` query param **and** legacy URL hash),
  - a 5s timeout race on `updateUser` so a lock-hang can't spin forever,
  - redirect to a link-expired/resend state on failure.
- **Whitelist both routes in `PUBLIC_PATHS`** (`src/lib/supabase/middleware.ts`)
  or the middleware 307s unauthenticated users to `/sign-in`.
- Reuse: `altus-move/src/app/(auth)/forgot-password/page.tsx` +
  `altus-move/src/app/(auth)/reset-password/page.tsx`.

### Task 4 (optional) — Admin set-initial-password
`src/app/admin/actions.ts`
- Optionally let the founder set an initial password (or send a set-password
  link) when provisioning an external customer, so a customer can be onboarded
  password-first. Lower priority — Tasks 2+3 already cover this self-serve.
- **Recommendation:** prefer the customer setting their own password (don't hold
  a customer's password). If an admin-set initial password is used, note
  "change it on first login".

### Task 5 — Supabase config (dashboard, not code)
- Confirm email+password is enabled on the **prod** project (local config.toml
  shows email/password enabled; verify the dashboard).
- Turn on **leaked-password protection** (already on the handover open-items
  list) + confirm a sane min length.
- **Wire custom Resend SMTP for auth emails** — the reset email rides the same
  throttle otherwise. This is the recurring open item and pairs naturally here.

## Patterns to reuse (so it's right first time)

| Need | Copy from |
|---|---|
| Password sign-in + inline errors | `altus-quay-forthports/src/app/login/page.tsx`, `altus-move/src/app/(auth)/login/page.tsx` |
| Forgot + reset (dual token, timeout race) | `altus-move/src/app/(auth)/{forgot-password,reset-password}/page.tsx` |
| Password-strength meter (no deps) | `altus-move/src/lib/auth/password-strength.ts` |
| Both methods coexisting on one user | `altus-quay-forthports` (password `/login` + OTP `/portal/login`) |
| Browser client `noopLock` (already our rule) | `altus-move/src/lib/db/client.ts` |

**Do NOT** introduce a client-side `AuthProvider`/`onAuthStateChange` unless
truly needed — altus-recruitment is server-driven (middleware + server `getUser`),
which is simpler and sidesteps the `onAuthStateChange` deadlock class entirely.
If the browser client is touched, keep `noopLock`.

## Risks / gotchas

- **Passwordless existing users**: `signInWithPassword` fails until they set a
  password — Task 1's friendly error + Task 2/3 are what prevent a confusing
  dead-end. (This is the single most important UX detail.)
- New public routes must be in `PUBLIC_PATHS` or middleware redirects them.
- Recovery uses `token_hash` (type=recovery), separate from the existing
  `/auth/callback` PKCE — don't break the magic-link callback or the
  `/accept-invite` → `accept_invitation` RPC flow.
- Reset emails hit the auth-email throttle until Resend SMTP is wired (Task 5).
- Never trim/log the password; generic error messages (don't leak Supabase
  internals or which emails exist).

## Out of scope (separate future phases)
- Google OAuth ("later" per the plan).
- 2FA/MFA.
- Changing the canonical signup to password-first (we keep passwordless signup).

## Rough effort
~1–1.5 focused days of build: Task 1 (a couple of hours), Task 2 (half day),
Task 3 (half day — reset is the fiddly part, but altus-move is a working
template), Task 4 optional, Task 5 is dashboard/DNS. Then the standard gate:
typecheck/lint/tests + adversarial review + a browser pre-smoke that exercises
password sign-in, set-password, forgot/reset, **and confirms magic-link +
invite still work unchanged**.
