# Code & UI Review — 260524-bpy org invitations

**Reviewed:** 2026-05-24
**Reviewer:** Opus (autonomous code+UI review pre-UAT)
**Verdict:** BLOCK

Two correctness/security defects must be fixed before UAT (B1 orphan-org race; B2 unauthenticated `shouldCreateUser` abuse vector). A third (B3 untrusted `x-forwarded-host` for invite link origin) is a near-blocker for any non-Vercel deploy; on Vercel it's acceptable because the platform strips/canonicalises forwarded headers, but the current `resolveOrigin` ordering inverts the plan's stated preference for `NEXT_PUBLIC_SITE_URL`.

The crypto, RPC transaction structure, RLS policies, GRANT EXECUTE restrictions, null-email guard, cookie hardening, and email-match check are all correct. The migration is well-written and the threat model has been faithfully implemented for the threats it enumerates — the issues below are gaps the threat model did not enumerate.

---

## Blockers (must fix before UAT)

### B1 — Orphan-org cleanup TOCTOU; concurrent insert into the about-to-be-deleted org cascades

**File:** `supabase/migrations/20260524000100_org_invitations.sql:197-205`

**What's wrong:**
The RPC takes `FOR UPDATE` on the invitation row and on the moving user's row, but the orphan-org check does NOT lock the old org or its remaining users:

```sql
select count(*) into v_other_users
from public.users
where organization_id = v_old_org;

if v_other_users = 0 then
  delete from public.organizations where id = v_old_org;
end if;
```

Between the `select count(*)` and the `delete`, a concurrent transaction (another invite acceptance, an Inngest job inserting a system user, or a backfill script) can insert a `public.users` row referencing `v_old_org`. The count returns 0, the delete fires, and the FK on `public.users.organization_id` is `references public.organizations(id) on delete cascade`, so the new user row is silently cascade-deleted along with everything in that org (candidates, jobs, etc., all of which cascade off `organization_id`).

This is the worst-case bug in the codebase per CLAUDE.md ("cross-tenant data leakage is the worst possible bug") — and although strictly it's intra-tenant deletion not cross-tenant leak, the blast radius (an entire org silently deleted under a race) is comparable.

The plan's RPC spec at PLAN.md:188 actually called for `SELECT 1 FROM users WHERE organization_id = old_org_id FOR UPDATE LIMIT 1, returns zero rows` — the implementation diverged from the plan and lost the lock.

**Why it matters:**
1. Concurrent accept of two invitations to the same `v_old_org` (rare but possible: a user with a fresh org gets two invites from two different recipient orgs and processes them simultaneously across two browser tabs) — both transactions see count=0 and one deletes the org out from under the other.
2. The handle_new_user trigger could fire for a different new auth.users row referencing `v_old_org` (no — that only happens for fresh orgs which create a new org, not reuse — so this specific scenario is fine).
3. Any future feature that inserts `public.users` rows for an org (e.g. system bots, OAuth-attached personas) would race here.

**Suggested fix:**
Take an explicit row lock on remaining users via `FOR UPDATE`, OR (cleaner) lock the organization row itself before the count:

```sql
if v_old_org is not null and v_old_org <> v_invite.organization_id then
  -- Lock the org row so concurrent inserts that need this org for an FK
  -- check serialise behind us.
  perform 1 from public.organizations where id = v_old_org for update;

  select count(*) into v_other_users
  from public.users
  where organization_id = v_old_org;

  if v_other_users = 0 then
    delete from public.organizations where id = v_old_org;
  end if;
end if;
```

Note: locking `organizations` row is the correct primitive because PostgreSQL's FK validation acquires a row-share lock on the referenced table when validating an insert into `users`. A `FOR UPDATE` on `organizations` blocks any concurrent insert into `users` that would reference this org until our transaction commits, at which point the org is gone and the concurrent insert correctly fails FK validation.

---

### B2 — `shouldCreateUser: true` on bare `?invite=1` URL enables arbitrary auth.users provisioning + email enumeration

**Files:**
- `src/app/(auth)/sign-in/sign-in-form.tsx:55, 96-102`
- `src/app/auth/callback/route.ts:36-39` (no-cookie path)

**What's wrong:**
`inviteMode = searchParams.get('invite') === '1'` is sourced purely from the URL — no proof that an actual invite exists. When true, the form passes `shouldCreateUser: true` to `signInWithOtp`, which causes Supabase Auth to create a NEW `auth.users` row for any email an attacker supplies — even when there is no signed `altus_invite_token` cookie.

The plan acknowledges this and says (PLAN.md:94-95) the defence is: "the callback handler re-verifies the cookie's token against the invitation row's email server-side inside the RPC ... a forged ?invite=1 URL without a matching signed cookie cannot escalate privilege beyond 'create a fresh-org account' (which the regular /sign-up flow already permits)."

That defence is incomplete:

1. **Junk org / junk user creation at scale.** When an attacker hits `/sign-in?invite=1&email=victim@example.com` and submits the form, Supabase Auth creates an `auth.users` row, the `handle_new_user` trigger fires creating a fresh `public.organizations` + `public.users` row, and Supabase sends a magic link to `victim@example.com`. The fresh org + user are NEVER cleaned up because there's no invite cookie for the callback to clean up — the callback in this scenario takes the **no-cookie path** at line 36-39 and just redirects. The orphan org and user persist forever. An attacker scripting this can spawn unlimited junk orgs in the production DB.

2. **Email enumeration & spam vector.** Attacker submits 1000 known competitor emails — every one of them receives a magic-link email purporting to be from Altus inviting them to sign in. Even with `shouldCreateUser: true` no separate fresh-org row will result if the email already had an account (Supabase will send a regular sign-in link), but for non-existent emails it WILL create accounts. This is a phishing surface (attacker spoofs invite emails via legitimate Altus infrastructure) and a Resend cost vector.

3. **Spam Resend / hit your Resend daily quota.** Each attempt costs you a Resend send. Resend free tier is 100/day, paid tiers have hard caps. A bot loop will exhaust the quota.

**Why it matters:**
The `/sign-up` flow's existing behaviour requires the user to enter an organisation name and arguably has its own anti-spam (none currently — also a problem, but pre-existing). The new `?invite=1` parameter is a NEW abuse surface that bypasses any future sign-up CAPTCHA or quota by piggybacking on the invite UX.

**Suggested fix (pick one):**

**Option A (server-side cookie check):** Change the sign-in form's `shouldCreateUser` flag from a URL-derived boolean to a server-fetched value. Convert `sign-in/page.tsx` to read the cookie via `next/headers` and pass `inviteMode: boolean` as a prop to the client form. The client cannot lie about something it didn't supply.

**Option B (proof-of-invite token in URL):** Have `/accept-invite/[token]/route.ts` redirect to `/sign-in?email=...&invite=1&token={short_signed_jwt_of_invite_id_with_5min_expiry}` and have the client only set `shouldCreateUser: true` when the token is present AND the form server-validates it on submit before triggering OTP. More plumbing.

**Option C (cheapest):** Remove the URL-driven `shouldCreateUser: true` flip entirely. Always pass `shouldCreateUser: false` and require invitees to use `/sign-up` first if they don't have an account. Trade-off: extra friction for invitees, but pre-UAT scope is unlikely to hit this in real use.

Recommended: **Option A**. It costs ~15 lines of code and closes the abuse vector completely. The plan's own justification — "the cookie set by /accept-invite is the defence in depth" — actually justifies Option A directly.

---

### B3 — `resolveOrigin()` trusts `x-forwarded-host` BEFORE consulting `NEXT_PUBLIC_SITE_URL`; host-header injection redirects invite links to attacker domain

**File:** `src/app/(app)/settings/team/actions.ts:43-51`

**What's wrong:**
The plan (PLAN.md:165, 198) explicitly says: *"Get origin via `headers().get('origin')` or `headers().get('x-forwarded-host')` (Next 16 server action context) — fallback to env.NEXT_PUBLIC_SITE_URL if defined"*. Implementation does this **in reverse order** — env is never consulted at all:

```ts
async function resolveOrigin(): Promise<string | null> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}
```

Server action requests usually carry an `origin` header set by the browser (which the browser controls — cannot be spoofed by an attacker via headers). So in practice on Vercel this returns `https://altus.app` and works. But:

1. The fallback chain `x-forwarded-host` → `host` is untrusted attacker-controlled input on any deploy without a properly stripping reverse proxy. If a customer self-hosts behind nginx without `proxy_set_header X-Forwarded-Host`, an attacker can curl `POST /settings/team -H 'X-Forwarded-Host: attacker.com'` against the action endpoint and the invite link will read `https://attacker.com/accept-invite/{token}`. Note this attack requires the attacker to BE an authenticated owner of an org — but it lets them silently exfiltrate tokens they generate by tricking invitees into clicking attacker-domain links.
2. `NEXT_PUBLIC_SITE_URL` is documented in CLAUDE.md / env.ts (presumably) as the canonical site origin and should be the authoritative source. The plan calls for it as a fallback; it should be the FIRST choice when set.

**Why it matters:**
Self-hosting or future multi-region deployments will not have Vercel's header stripping. The bug is latent on Vercel today but ships as a footgun for the SaaS sale path (which is the strategic intent in CLAUDE.md).

**Suggested fix:**
Invert the precedence, env first:

```ts
async function resolveOrigin(): Promise<string | null> {
  // Trusted source first.
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL
  const h = await headers()
  // Browser-supplied origin is safe (browser-controlled, not header-spoofable).
  const origin = h.get('origin')
  if (origin) return origin
  // Final fallback — only safe behind a proxy that strips inbound x-forwarded-*.
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}
```

Also: import `env` from `@/lib/env`. Verify `NEXT_PUBLIC_SITE_URL` is in the env schema; if not, add it.

---

## High-priority issues

### H1 — Email-mismatch path leaks: an attacker can determine if a token is valid + whose email it's bound to

**Files:**
- `src/app/accept-invite/[token]/route.ts:42-54` (pre-sign-in lookup)
- `supabase/migrations/20260524000100_org_invitations.sql:176-179` (RPC mismatch return)

**What's wrong:**
Two separate disclosure paths combined:

1. The `/accept-invite/[token]` route discriminates `invalid-invite` (token unknown) vs `expired-invite` (token known but expired/accepted) via the URL query string. A token-probing attacker can enumerate valid token UUIDs (although UUIDv4 entropy makes this infeasible in practice — 122 bits — so not really exploitable, but it IS an information disclosure).
2. More interesting: the redirect URL contains `?email={encodedEmail}&invite=1` for VALID + PENDING tokens. An attacker with a stolen/leaked token can fetch `/accept-invite/{token}` (no auth required, no cookies needed) and read the response `Location` header to learn the invitee's email. The route handler intentionally pre-fills email purely as UX, but the URL is the disclosure channel.

**Why it matters:**
A leaked token (e.g. forwarded email screenshot, archive logging) is supposed to reveal only what's already in the email body — but the email body never shows the invitee's email address (only the inviter's name + org). The route handler discloses MORE info than the email did.

**Suggested fix:**
Stop including `?email=` in the redirect. Either:
- Drop pre-fill entirely (invitee can type their email — minor UX cost).
- Carry the email in a second short-lived signed cookie instead of the URL.

Token enumeration disclosure (the `invalid` vs `expired` bucketing) is documented as intentional in the route handler comments — accept as designed.

---

### H2 — `handle_new_user` and `accept_invitation` race: first-time invitee is briefly an owner of a junk org

**File:** `src/app/auth/callback/route.ts:30-69`

**What's wrong:**
For a brand-new user who's never signed in before:
1. `exchangeCodeForSession(code)` runs the `on auth.users insert → handle_new_user()` trigger, creating a fresh org + `users` row with `role='owner'`.
2. Only AFTER the exchange returns does the route handler invoke `accept_invitation(...)` RPC which reassigns to the inviter's org and (correctly) demotes to recruiter + deletes the orphan.

The window between (1) and (2) is short (single Node tick + one DB round-trip) but it exists, and during it:
- The auto-created junk org has a fresh `id`, `name = invitee@email.com` (from the trigger's fallback at handle_new_user_invite.sql:41-44), and `slug`. If any background job, audit logger, webhook, or trigger fires off the `organizations` INSERT (e.g. analytics emit, "new org created" notification), it fires with garbage data.
- If the RPC fails for any reason (DB transient error, RPC granted incorrectly, etc.), the junk org stays.

**Why it matters:**
For now this is mostly cosmetic — there is no "new org created" hook in the codebase that I can see. But it's a real semantic mismatch with the plan's claim that "the trigger runs … our custom flow CANNOT prevent the trigger from firing because it has no visibility into the cookie" (PLAN.md:141-142). The plan accepted the race; you should know it exists.

**Suggested fix (optional, defer to follow-up):**
Pass the cookie token through the OTP signup metadata so `handle_new_user` itself short-circuits the fresh-org creation. Concretely:
- In sign-in-form, when invite mode, also pass `options.data.invitation_token: cookieValue`.
- In handle_new_user, if `raw_user_meta_data->>'invitation_token'` is non-null, look up `org_invitations` directly and attach to that org as recruiter.
- The callback RPC becomes a no-op-or-idempotent for first-time users.

Defer to follow-up; not pre-UAT blocking.

---

### H3 — `getInviteAcceptUrl()` helper exists but is never used; both actions hand-roll the URL

**Files:**
- `src/lib/invitations/cookie.ts:34-36` (defines helper)
- `src/app/(app)/settings/team/actions.ts:140, 309` (hand-rolls `${origin}/accept-invite/${token}`)

**What's wrong:**
Dead exported code — `getInviteAcceptUrl` is declared but never called. The hand-rolled string in actions.ts will drift from the helper in the future. The token here is also interpolated without validation (it comes from the DB which is trusted, but the helper would centralise the construction).

**Suggested fix:**
Either use the helper in actions.ts, or delete it from `cookie.ts`.

---

### H4 — Cookie cleared after success — but the redirect `${origin}${next}` may strip cookies due to Set-Cookie + Location interaction; verify in browser

**File:** `src/app/auth/callback/route.ts:96-99`

**What's wrong:**
Minor — `NextResponse.redirect(url)` followed by `response.cookies.set(...)` is the documented Next 16 pattern and should work. But the cookie is being SET with `maxAge: 0` to clear it, which is equivalent to `expires=epoch`. Some legacy Safari versions ignore `maxAge=0` and require `expires=Thu, 01 Jan 1970 00:00:00 GMT`. The `cookies()` Next API typically handles this internally — verify in browser dev tools during UAT that the invite cookie actually disappears after callback.

**Suggested fix:**
If UAT shows cookie persistence in Safari, switch to `expires: new Date(0)` instead of `maxAge: 0`. Otherwise no action.

---

## Medium-priority issues / nice-to-haves

### M1 — `resendInviteAction` doesn't rotate the token

**File:** `src/app/(app)/settings/team/actions.ts:222-340`

When an owner "Resends" an invitation, the same `token` UUID is reused with a refreshed `expires_at`. Whoever saw the original email (mailing list forward, shared inbox archive, leaked screenshot) can still use that token for another 7 days. Industry-standard practice is to rotate the token on resend.

**Fix:** In the stale branch (line 274-288), also update `token = gen_random_uuid()` via service-role and use the new token in the email body. Note: this requires the existing-invitation SELECT to return `id` and then re-fetch `token` after the update, or use `.update(...).select('token').single()`.

### M2 — `inviteMemberSchema` accepts trailing periods / no domain TLD enforcement

**File:** `src/app/(app)/settings/team/schema.ts:9-16`

Zod's `.email()` is permissive — accepts `a@b` (no TLD). For a B2B invite flow this is probably fine because Resend will reject malformed addresses, but a tighter regex would surface the error earlier (better UX) and avoid wasting a Resend send.

**Fix:** Apply a stricter regex via `.regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email.')` after `.email()`.

### M3 — DB-level email length cap missing

**File:** `supabase/migrations/20260524000100_org_invitations.sql:75`

`email text not null` has no `check (length(email) <= 320)` (320 chars is the email standard maximum). Zod caps at 255 in the action layer, but a service-role insertion (e.g. an Inngest backfill that later mass-imports invitations) won't be bounded.

**Fix:** Add a CHECK in a follow-up migration if/when bulk invite import is built. Defer.

### M4 — `revokeInviteAction` is idempotent silently — UX may confuse

**File:** `src/app/(app)/settings/team/actions.ts:206-219`

If two owners simultaneously click Revoke on the same row, both see "Invitation revoked" toast. Fine functionally; not a bug, noting.

### M5 — Settings/Team page doesn't gate on org existence

**File:** `src/app/(app)/settings/team/page.tsx:46-51`

If `getProfile` succeeds but `profile.data.organization_id` is null (theoretically possible due to data corruption), the subsequent `select` queries return empty and the page renders an empty member list with the "Invite member" button — clicking it would fail at the action layer (no org). Cosmetic only.

### M6 — Resend email subject contains untrusted `inviterName` and `orgName`

**File:** `src/app/(app)/settings/team/actions.ts:154, 321`

Subject is `${inviterName} invited you to Altus on ${orgName}`. These come from `public.users.full_name` and `public.organizations.name` — both user-controlled within the org. If an owner sets their `full_name` to `\r\nBcc: someone@evil.com\r\n`, this could be a header injection vector against Resend. The Resend REST API JSON body wrapping prevents true header injection (Resend parses JSON, sets headers itself), so this is benign with the current implementation. Worth noting if you ever switch to an SMTP backend.

### M7 — No max-length on `inviterName` / `orgName` in subject

If `orgName` is 500 characters, subject becomes 500+ characters. Most mail clients truncate, Resend may reject (Resend max subject length not documented). Defensive truncation would prevent silent send failures.

**Fix:** `const orgName = (org?.name ?? 'their team').slice(0, 80)` and similarly for inviterName.

### M8 — `accept_invitation` RPC always hard-codes `role = 'recruiter'`

**File:** `supabase/migrations/20260524000100_org_invitations.sql:188-191`

Plan notes this as a known limitation for Phase 5 multi-role support (SUMMARY.md follow-ups). Confirming: an invitee currently CANNOT be invited as anything other than recruiter. Accepted as designed.

### M9 — `users.role` reassignment loses `role='owner'` status without warning

**File:** `supabase/migrations/20260524000100_org_invitations.sql:188-191`

The RPC unconditionally sets `role = 'recruiter'`. If somehow an existing owner of org A accepts an invite to org B, they become a recruiter in B (correct). But if org A had only that one user (most common), the orphan deletion removes org A entirely — including any candidates, jobs, etc. that org A had created. CASCADE on `organizations` will obliterate the org's data. This is the design but is worth flagging: **an accepted invite is a destructive operation for the accepter's previous org if they were the sole member**. UAT should explicitly verify the user understands this.

**Fix:** Surface a confirmation in the UI before the user accepts ("You will leave your current organisation, and if you were the only member, it will be permanently deleted including any candidates/jobs."). Defer to a UX follow-up.

### M10 — `RevokeInviteButton` AlertDialog doesn't close on success

**File:** `src/app/(app)/settings/team/revoke-invite-button.tsx:25-39`

`setOpen(false)` is called on success — good. But if the action fails (`formError` returned), the dialog stays open. The user sees a toast but the modal lingers, which is correct (lets them retry) — flagging for explicit UAT verification.

### M11 — `INVITE_COOKIE_OPTIONS` typed implicitly — Next 16 may infer string for sameSite

**File:** `src/lib/invitations/cookie.ts:18-24`

`sameSite: 'lax' as const` is the only `as const` annotation. Next 16's `ResponseCookie` type expects `sameSite?: 'strict' | 'lax' | 'none' | boolean`. Without `as const` on the whole object the inferred type may be too wide and TS may complain. The fact that lint passes suggests it works, but consider `as const` on the entire object for safety.

### M12 — Magic-link `emailRedirectTo` uses `window.location.origin`

**File:** `src/app/(auth)/sign-in/sign-in-form.tsx:100`

Client-side `window.location.origin` is fine BUT differs from the server-action `resolveOrigin()` chain (B3). If the customer has misconfigured DNS or accesses the site via a non-canonical hostname (e.g. preview deployment), the magic link URL embedded in the email will point at that non-canonical host, the cookie set on it will be host-only, and the callback will work — until they later visit the canonical host where the cookie isn't visible. Mostly self-consistent; flag for environment-specific UAT.

### M13 — `lookupInvitationByToken` doesn't constrain by `expires_at` in the SELECT

**File:** `src/lib/invitations/lookup.ts:24-36`

The function returns the full row and `isInvitationUsable` does the expiry check in JS. Marginal info-leak: if someone could call this helper directly (they can't — `server-only`), they'd see expired invitations. Not exploitable; minor stylistic preference to push the check into SQL.

---

## UI/UX observations

### U1 — `/settings` has BOTH the legacy inline Team Card AND the new linked Team card

**File:** `src/app/(app)/settings/page.tsx:82-123`

Owners see two "Team" sections back-to-back. The legacy `<InviteForm /> + <InvitationsList />` block (lines 82-99) AND the new linked card pointing to `/settings/team` (lines 104-123). The summary doc acknowledges this is a deferred cleanup. For UAT this WILL confuse users — they may use the legacy form (which calls the old `inviteTeammateAction` → Supabase Auth admin invite, doesn't write to `org_invitations`) and be confused that their invite doesn't show up on the new Team page.

**Recommend:** Hide the legacy card behind a feature flag or just comment it out for UAT — keep the file diff small but get the duplicate UI out of the user's face.

### U2 — `InviteMemberDialog` Send button text is "Send invitation" (good) but loading is "Sending…" — consistent

### U3 — `ResendInviteButton` and `RevokeInviteButton` are siblings in the row but visually similar (both ghost-styled). User may misclick Revoke when they meant Resend.

**File:** `src/app/(app)/settings/team/page.tsx:155-158`

Revoke uses `text-destructive` class which helps. But on a mobile viewport where text wraps, the destructive colour may be the only differentiator. Consider an icon (e.g. `Trash2`, `Send`) to disambiguate.

### U4 — Empty state for invitations: "No pending invitations." — good. No empty state for members. The plan says 'No team members yet' — implemented at page.tsx:95.

### U5 — `formatDateLong(row.expires_at)` — if the invite expires in 6 hours, this shows a date but no time. User sees "Expires 24 May 2026" without realising it's later today. Consider relative format ("Expires in 6 hours") for invitations < 24h out.

### U6 — Sign-in form invite banner text: "You've been invited to Altus — sign in with this email to accept the invitation."

The user may not have set up an account yet — the word "sign in" implies an existing account. Consider: "You've been invited to Altus. Continue with this email to accept." (covers both existing and new accounts.)

### U7 — Error banner on `?error=invalid-invite`: "That invitation link isn't valid. Ask your teammate to send a new one."

Good copy. No PII leakage. Doesn't disclose whether the user/email already exists.

### U8 — `RevokeInviteButton` AlertDialog: "The invitation for {email} will be removed. They will no longer be able to join with the existing link."

Accurate. Good.

### U9 — Mobile: the row layout uses `flex flex-wrap` for actions. Both Resend + Revoke buttons may wrap below the email on small screens, fine. Tap targets meet 44px (Button size="sm" + h-9). Acceptable.

### U10 — `RevokeInviteButton` and `ResendInviteButton` don't disable each other while one is pending. User can click Revoke while Resend is in flight, causing weird interactions. Probably fine because both end in a `revalidatePath('/settings/team')` and the slower one's result wins. Minor.

---

## Things that look right

- **SECURITY DEFINER RPC + GRANT EXECUTE only to service_role:** Confirmed at migration lines 213-216. Authenticated/anon/public cannot call the RPC directly. Attack surface limited to `/auth/callback`.
- **Email-match check inside RPC, BEFORE org reassignment:** Lines 176-179 of migration — token-validity check first, email-match second, mutations third. Order correct; forged-token-with-victim's-email attacker cannot bypass.
- **`FOR UPDATE` on invitation row:** Line 167. Concurrent double-accept is correctly serialized (only the invitation row's lock, not the orphan-org lock — see B1).
- **Null-email guard runs BEFORE any service-role call:** `src/app/auth/callback/route.ts:53-57` — verified by inspection. The plan's T-260524-bpy-11 mitigation is implemented correctly.
- **`import 'server-only'` markers:** Present on `src/lib/invitations/cookie.ts:1`, `src/lib/invitations/lookup.ts:1`, `src/lib/supabase/service.ts:1`. Service-role boundary intact; no Client Component can pull these in.
- **Cookie hardening:** `httpOnly: true`, `sameSite: 'lax'`, `secure: process.env.NODE_ENV === 'production'`, `path: '/'`, `maxAge: 3600`, `domain` intentionally omitted. All correct per plan T-260524-bpy-01.
- **Cookie cleared on every failure + success path:** Verified in `src/app/auth/callback/route.ts` — every `return` statement on the invite branch (lines 54-56, 75-77, 91-93, 97-98, 104-106) sets the clear-cookie before returning.
- **Email lowercase enforcement:** Zod schema does `.trim().toLowerCase().email()` AND the DB has `check (lower(email) = email)`. Double-belted.
- **Partial unique index on (organization_id, email) WHERE accepted_at IS NULL:** Line 84-86 of migration. Prevents duplicate pending invites; allows re-invite after acceptance.
- **R8 ordering in all three server actions:** parse → user-scoped client → role check via RLS-bounded SELECT → reject non-owners → THEN escalate. Correctly mirrored from `inviteTeammateAction`.
- **Sentry captures NEVER contain invitee email or token:** Verified in actions.ts (every `Sentry.capture*` only passes the error + static `tags` + numeric `status`). Verified in callback/route.ts (`'invite_email_mismatch'` static message; no email/token in extras).
- **Plaintext-only email body:** No `html` field passed to `sendResendEmail` — only `text`. T-260524-bpy-06 mitigation correctly implemented.
- **Token shape validation in /accept-invite handler:** `tokenSchema = z.string().uuid()` at line 24 — non-UUIDs bounce immediately. Probing defence works.
- **Owner-only gate on /settings/team page:** `if (profile.data.role !== 'owner') redirect('/settings')` at page.tsx:49-51. Non-owners cannot load the page.
- **No `any` without a `// reason:` comment:** The single cast `as unknown as TablesInsert<'org_invitations'>` at actions.ts:94 has a "reason:" comment explaining it. Conforms to CLAUDE.md.
- **Idempotent revoke + idempotent already-accepted resend check:** Correctly handles double-click and concurrent-accept scenarios.
- **No `domain` attribute on the invite cookie:** Host-only. Cannot leak across staging→prod or vice versa.
- **`safeNext()` still gates the `?next=` open-redirect on both paths:** Line 23 + 38 + 97.
- **Migration is append-only with timestamp `20260524000100`** — later than the existing `20260524000000_feedback.sql`. Migration hygiene preserved.
- **RLS policies on `org_invitations`:** SELECT, INSERT, DELETE — all scoped to `current_organization_id()`. NO UPDATE policy — accept happens via the RPC, resend uses service-role. Correctly designed.
- **TypeScript `database.ts` hand-patch for `accept_invitation` args:** Args are an object so key order is irrelevant at runtime. supabase-js sends `{ p_token, p_user_id, p_user_email }` as JSON; the RPC receives them by name. No bug from the alphabetical reorder in the types file.

---

_Reviewed: 2026-05-24_
_Reviewer: Opus (gsd-code-reviewer, deep depth)_
_Files reviewed: 14_
