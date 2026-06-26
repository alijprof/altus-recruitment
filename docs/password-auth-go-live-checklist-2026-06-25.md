# Email + Password auth — go-live checklist (deferred items)

_Built 2026-06-25. Tasks 1–3 (sign-in toggle, Settings → Security set-password,
forgot/reset) are implemented, gated, and pre-smoked. Tasks 4 & 5 below are left
for the founder — they are config/dashboard/optional-code, not blockers for the
self-serve flows that already ship._

## What already works (no action needed)

- **Sign-in**: magic link is still the default; users can click **"Sign in with
  a password instead"**. A friendly message handles "no password set yet".
- **Set a password**: any signed-in user can set/change one at
  **Settings → Security** (`/settings/security`). This is how every existing
  passwordless user (and any provisioned customer) gets a password.
- **Forgot / reset**: `/forgot-password` → email → `/reset-password`. Doubles as
  "set my first password".

---

## Task 5 — Supabase dashboard config (DO THIS before telling customers to use passwords)

These are **prod Supabase dashboard** changes. None require a code deploy.

1. **Confirm email+password is enabled.**
   Dashboard → Authentication → Providers → **Email**: ensure "Enable Email
   provider" and password sign-in are on. (Local `config.toml` already has it on;
   verify prod matches.)

2. **Allow the reset redirect URL.** ⬅ _required or reset silently fails_
   Dashboard → Authentication → **URL Configuration → Redirect URLs**: add
   `https://altusrecruit.com/reset-password` (and any preview origin you test
   against, e.g. `https://*.vercel.app/reset-password`).
   `resetPasswordForEmail` uses `window.location.origin + /reset-password`; if
   that origin isn't allow-listed, Supabase refuses the redirect.

3. **Turn on leaked-password protection.** (already on the handover open-items list)
   Dashboard → Authentication → **Password security** → enable "Check against
   HaveIBeenPwned". Confirm a sane **minimum length** (we validate ≥ 8 client-side
   in the set-password and reset forms; set the server min length to **8** to
   match, or higher).

4. **Wire custom Resend SMTP for auth emails.** ⬅ _the recurring open item_
   Until this is done, the **password-reset email rides Supabase's built-in SMTP
   throttle (~4/hour on free tier)** — the same limit that bites magic links.
   Dashboard → Authentication → **SMTP Settings** → enter the Resend SMTP creds
   (host `smtp.resend.com`, port 465/587, the Resend SMTP username/password).
   Sender should be the verified `altusmove.com` domain.
   - 🔐 _Reminder:_ the Resend SMTP password is shown once — **save it to
     Bitwarden** at creation. Use a dedicated/scoped Resend key for Supabase SMTP
     (one key per consumer), and don't revoke any old key until the new one is
     confirmed sending.

5. **(Recommended) Switch the recovery email template to the cross-device
   `token_hash` link.** Optional but more robust.
   Dashboard → Authentication → **Email Templates → Reset Password**. The default
   `{{ .ConfirmationURL }}` works (the reset page handles it via `?code=` /
   legacy hash), but `?code=` PKCE is **same-device only** — if a user opens the
   reset link in a different browser/device than they requested it from, it fails.
   To make resets work cross-device, point the template at:
   ```
   {{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery
   ```
   The reset page already prefers this `token_hash` path (`verifyOtp`).

---

## Task 4 — Admin set-initial-password (OPTIONAL, lower priority)

Tasks 2 + 3 already cover onboarding self-serve, so this is genuinely optional.

- **Recommendation: don't hold a customer's password.** Prefer the customer
  setting their own via Settings → Security or the reset link. If you ever do set
  an initial password for them in `/admin` (via `supabase.auth.admin.updateUserById`),
  tell them to **change it on first login**.
- Not implemented in this phase by design.

---

## Optional hardening (my recommendation, not done — your call)

- **`noopLock` on the browser Supabase client** (`src/lib/supabase/client.ts`).
  Per the global cross-project rule, a single-account SPA should default the
  browser client to `noopLock` to sidestep the `navigator.locks` "lock-stolen"
  wedge. I did **not** add it this phase to keep the proven magic-link client
  untouched — and the reset/set-password forms already neutralise the lock-hang
  with a 5 s timeout race. If you want belt-and-braces, add `noopLock` (see the
  global CLAUDE.md snippet) and re-smoke magic-link sign-in. Low risk, but it
  touches the shared client, so it's a deliberate separate change.

---

## Quick manual UAT script (after Task 5 SMTP is wired)

1. Sign in with magic link (unchanged) — still works.
2. Settings → Security → set a password (watch the strength meter). Sign out.
3. Sign in → "Sign in with a password instead" → new password → lands on dashboard.
4. Sign out → Sign in → password → wrong password → friendly message (no leak).
5. `/forgot-password` → email → click link → `/reset-password` → new password →
   lands authenticated.
6. Accept-invite flow (invite a teammate) — still magic-link only, unchanged.
