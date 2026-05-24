---
phase: quick-260524-iav
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260524000300_fix_accept_invitation_lock.sql
  - src/app/(auth)/sign-in/page.tsx
  - src/app/(auth)/sign-in/sign-in-form.tsx
  - src/app/(app)/settings/team/actions.ts
  - src/lib/env.ts
autonomous: true
requirements:
  - B1-accept-invitation-FOR-UPDATE-lock
  - B2-server-derived-inviteMode-from-cookie
  - B3-resolveOrigin-env-first-precedence

must_haves:
  truths:
    - "Concurrent INSERT into a soon-to-be-orphan org during accept_invitation cannot cause silent loss of the org or its ON DELETE CASCADE children."
    - "Hitting /sign-in?invite=1&email=victim@example.com with NO altus_invite_token cookie does NOT cause Supabase to create an auth.users row or a junk organization."
    - "Hitting /sign-in?email=foo@bar.com (no ?invite=1) still pre-fills the email field for an existing user (regression-safe)."
    - "The accept-invite email link sent by inviteMemberAction always uses the host configured in NEXT_PUBLIC_SITE_URL when that env var is set, regardless of any X-Forwarded-Host header an upstream proxy attaches."
    - "pnpm typecheck and pnpm lint pass on the working tree after each of the three commits."
  artifacts:
    - path: "supabase/migrations/20260524000300_fix_accept_invitation_lock.sql"
      provides: "CREATE OR REPLACE FUNCTION public.accept_invitation with FOR UPDATE lock on orphan org row before user-count query."
      contains: "perform 1 from public.organizations where id = v_old_org for update"
    - path: "src/app/(auth)/sign-in/page.tsx"
      provides: "Server component reads altus_invite_token cookie via next/headers and passes inviteMode boolean prop to <SignInForm />."
      contains: "INVITE_COOKIE_NAME"
    - path: "src/app/(auth)/sign-in/sign-in-form.tsx"
      provides: "Client component accepts inviteMode as a prop and no longer derives it from useSearchParams()."
      contains: "inviteMode"
    - path: "src/app/(app)/settings/team/actions.ts"
      provides: "resolveOrigin() with precedence: env.NEXT_PUBLIC_SITE_URL → origin header → x-forwarded-host/host header."
      contains: "NEXT_PUBLIC_SITE_URL"
    - path: "src/lib/env.ts"
      provides: "NEXT_PUBLIC_SITE_URL declared as an optional URL on the client schema and exposed via experimental__runtimeEnv."
      contains: "NEXT_PUBLIC_SITE_URL"
  key_links:
    - from: "src/app/(auth)/sign-in/page.tsx"
      to: "src/app/(auth)/sign-in/sign-in-form.tsx"
      via: "<SignInForm inviteMode={...} /> prop"
      pattern: "inviteMode={"
    - from: "src/app/(app)/settings/team/actions.ts"
      to: "src/lib/env.ts"
      via: "import { env } from '@/lib/env'"
      pattern: "env\\.NEXT_PUBLIC_SITE_URL"
    - from: "supabase/migrations/20260524000300_fix_accept_invitation_lock.sql"
      to: "public.organizations"
      via: "PERFORM ... FOR UPDATE row lock"
      pattern: "for update"
---

<objective>
Close the three blocker-class security defects (B1, B2, B3) identified in
`.planning/quick/260524-bpy-org-member-invitation-flow-magic-link-to/260524-bpy-REVIEW.md`
against the org-invitations flow shipped in quick task 260524-bpy.

Purpose: B1 is silent data-loss under concurrency. B2 is an unauthenticated
spam vector that also pollutes the organisations table. B3 lets a logged-in
owner be tricked into sending invite emails whose links point at an
attacker-controlled host on any non-Vercel deployment that forwards
X-Forwarded-Host.

Output: One new append-only Postgres migration; surgical edits to one server
component, one client component, one server-actions file, and the env schema.
Each fix is independently committable. No scope creep beyond the three
blockers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@.planning/quick/260524-bpy-org-member-invitation-flow-magic-link-to/260524-bpy-REVIEW.md
@.planning/quick/260524-bpy-org-member-invitation-flow-magic-link-to/260524-bpy-PLAN.md
@supabase/migrations/20260524000100_org_invitations.sql
@src/app/(auth)/sign-in/page.tsx
@src/app/(auth)/sign-in/sign-in-form.tsx
@src/app/(app)/settings/team/actions.ts
@src/lib/invitations/cookie.ts
@src/lib/env.ts

<interfaces>
<!-- Key contracts the executor will use. Extracted up-front so no codebase exploration is needed. -->

From src/lib/invitations/cookie.ts:
- `export const INVITE_COOKIE_NAME = 'altus_invite_token'` — host-only, httpOnly, SameSite=Lax cookie set by /accept-invite and cleared by /auth/callback. This module is `import 'server-only'`, so it can ONLY be imported into Server Components, route handlers, server actions, or middleware — NEVER into a Client Component.

From src/lib/env.ts (`@t3-oss/env-nextjs`):
- `env` is the validated env handle. Adding a public var requires declaring it in the `client` schema AND in `experimental__runtimeEnv` (Next.js does not auto-expose NEXT_PUBLIC_* unless statically referenced there). Pattern: `NEXT_PUBLIC_SITE_URL: z.string().url().optional()` and `NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL` in `experimental__runtimeEnv`.

From Next.js 16 (App Router):
- `cookies()` from `next/headers` is ASYNC — `const cookieStore = await cookies(); cookieStore.get(NAME)?.value`. Same shape as `headers()` already used in src/app/(app)/settings/team/actions.ts:44.
- A page that uses `cookies()` becomes dynamic; this is correct for /sign-in (already dynamic via useSearchParams in the existing client form).

From supabase/migrations/20260524000100_org_invitations.sql (lines 147-209) — verbatim body of `public.accept_invitation` to be re-emitted with the single FOR UPDATE line added:
```sql
create or replace function public.accept_invitation(
  p_token uuid,
  p_user_id uuid,
  p_user_email text
)
returns table(ok boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.org_invitations%rowtype;
  v_old_org uuid;
  v_other_users int;
begin
  select * into v_invite
  from public.org_invitations
  where token = p_token
  for update;

  if not found
     or v_invite.accepted_at is not null
     or v_invite.expires_at <= now() then
    return query select false, 'invalid'::text;
    return;
  end if;

  if lower(v_invite.email) <> lower(p_user_email) then
    return query select false, 'email_mismatch'::text;
    return;
  end if;

  select organization_id into v_old_org
  from public.users
  where id = p_user_id
  for update;

  update public.users
  set organization_id = v_invite.organization_id,
      role = 'recruiter'
  where id = p_user_id;

  update public.org_invitations
  set accepted_at = now()
  where id = v_invite.id;

  if v_old_org is not null and v_old_org <> v_invite.organization_id then
    -- NEW: lock the orphan org row BEFORE counting remaining users so a
    -- concurrent handle_new_user INSERT cannot slip in between the count and
    -- the delete. The plan called for this lock; the original implementation
    -- lost it. See REVIEW.md B1.
    perform 1
    from public.organizations
    where id = v_old_org
    for update;

    select count(*) into v_other_users
    from public.users
    where organization_id = v_old_org;

    if v_other_users = 0 then
      delete from public.organizations where id = v_old_org;
    end if;
  end if;

  return query select true, 'ok'::text;
end;
$$;
```
EXECUTE grants on the function were set in the original migration and do NOT
need to be re-applied here (CREATE OR REPLACE preserves grants). Do NOT include
the `revoke ... / grant execute ... to service_role` lines in the new migration.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: B1 — accept_invitation FOR UPDATE on orphan org row</name>
  <files>supabase/migrations/20260524000300_fix_accept_invitation_lock.sql</files>
  <action>
Create a NEW append-only migration at the exact path above (timestamp 20260524000300 — sits after 20260524000200_buyer_value_rpcs.sql, the latest migration on disk).

Migration contents:
1. A leading SQL block-comment header explaining: this fixes a TOCTOU in the orphan-org cleanup branch of `public.accept_invitation`. The original migration (20260524000100_org_invitations.sql) ran `SELECT count(*) FROM users WHERE organization_id = v_old_org` and `DELETE FROM organizations WHERE id = v_old_org` without a row lock on the org. A concurrent `handle_new_user` INSERT into the about-to-be-deleted org would be cascaded away. Append-only migrations rule means we cannot edit the original; instead we CREATE OR REPLACE the function with a `PERFORM 1 FROM public.organizations WHERE id = v_old_org FOR UPDATE` statement inserted directly before the user-count SELECT. All other logic is preserved verbatim — invitation row FOR UPDATE, accepted_at + expires_at check, email-match check, user reassignment, accepted_at update, return shape `{ ok boolean, reason text }`. Reference REVIEW.md B1.
2. The full `create or replace function public.accept_invitation(p_token uuid, p_user_id uuid, p_user_email text) returns table(ok boolean, reason text) language plpgsql security definer set search_path = public as $$ ... $$;` body shown in the `<interfaces>` block above, copied EXACTLY.
3. Do NOT re-emit the `revoke ... / grant execute ... to service_role` block — CREATE OR REPLACE preserves the existing grants on the original signature, and re-running revokes is noise.
4. Do NOT change the function signature (same three params, same return shape) — callers in src/app/auth/callback/route.ts must keep working without code changes.

Append-only constraint: do NOT edit `supabase/migrations/20260524000100_org_invitations.sql`. The new file is the canonical replacement.

Commit message: `fix(260524-iav): accept_invitation FOR UPDATE on orphan org row (B1)`

Out-of-band (orchestrator runs, NOT this task): `pnpm exec supabase db push --linked` then `pnpm db:types` (signature unchanged so types likely no-op — confirm).
  </action>
  <verify>
    <automated>test -f supabase/migrations/20260524000300_fix_accept_invitation_lock.sql && grep -q 'create or replace function public.accept_invitation' supabase/migrations/20260524000300_fix_accept_invitation_lock.sql && grep -q 'for update' supabase/migrations/20260524000300_fix_accept_invitation_lock.sql && grep -E "perform[[:space:]]+1[[:space:]]+from[[:space:]]+public\.organizations[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*v_old_org" supabase/migrations/20260524000300_fix_accept_invitation_lock.sql | grep -vc '^--' | grep -qv '^0$' && pnpm typecheck && pnpm lint</automated>
  </verify>
  <done>New migration file exists at the path above. It contains exactly one `create or replace function public.accept_invitation` block. That block contains a non-comment `perform 1 from public.organizations where id = v_old_org for update` statement that appears BEFORE the `select count(*) into v_other_users` statement (visual inspection or `grep -n` to confirm ordering). Signature is unchanged. `pnpm typecheck` and `pnpm lint` pass. Original migration file 20260524000100 is untouched (`git diff` shows no changes to it).</done>
</task>

<task type="auto">
  <name>Task 2: B2 — derive sign-in inviteMode from cookie server-side, not URL</name>
  <files>src/app/(auth)/sign-in/page.tsx, src/app/(auth)/sign-in/sign-in-form.tsx</files>
  <action>
Move the source of truth for `inviteMode` from the client-side URL query string to the server-side `altus_invite_token` cookie. An attacker can craft `/sign-in?invite=1&email=victim@example.com` to flip `shouldCreateUser: true` and trick Supabase into creating an `auth.users` row + a junk organization via the `handle_new_user` trigger; the no-cookie path in /auth/callback then leaves the junk org behind. Closing this also kills the email-enumeration / Resend-quota-burn vectors from the same URL.

CHANGE 1 — `src/app/(auth)/sign-in/page.tsx` (server component):
- Add imports at top: `import { cookies } from 'next/headers'` and `import { INVITE_COOKIE_NAME } from '@/lib/invitations/cookie'`.
- Convert the default export to `async function SignInPage()` (currently synchronous — making it async is required to await `cookies()`).
- Inside the function, before JSX: `const cookieStore = await cookies()` and `const inviteMode = cookieStore.get(INVITE_COOKIE_NAME)?.value != null` (presence-only check — token validity is re-verified server-side inside the accept_invitation RPC, this flag is purely "show the invite banner + set shouldCreateUser:true on the OTP call").
- Pass the prop: change `<SignInForm />` to `<SignInForm inviteMode={inviteMode} />`.
- Update the existing comment block above `<Suspense>` to note: "inviteMode is derived from the httpOnly altus_invite_token cookie set by /accept-invite. The URL ?invite=1 is no longer honoured — see REVIEW.md B2 (quick task 260524-iav)."

CHANGE 2 — `src/app/(auth)/sign-in/sign-in-form.tsx` (client component):
- Add a `SignInFormProps` interface above the component: `interface SignInFormProps { inviteMode: boolean }`.
- Change signature: `export function SignInForm({ inviteMode }: SignInFormProps)`.
- Remove the line `const inviteMode = searchParams.get('invite') === '1'` (current line 55).
- Keep the `?email=` pre-fill logic (prefilledEmail, prevPrefilled, setEmail) UNCHANGED — `?email=` is harmless.
- Keep the `?password=` dev-only fallback UNCHANGED.
- Keep the `?error=` banner logic UNCHANGED.
- Keep the invite-mode banner JSX UNCHANGED — it now renders based on the prop.
- Keep `shouldCreateUser: inviteMode` UNCHANGED (it just consumes the new prop).
- Update the comment block at lines 47-50 to reflect: "inviteMode is supplied as a prop by the parent server component, which reads the httpOnly altus_invite_token cookie via next/headers. The URL ?invite=1 query parameter is no longer honoured. This closes the spam / junk-org vector documented in REVIEW.md B2 (quick task 260524-iav)."
- Update the comment block above the `signInWithOtp` call (lines 87-95) to remove the "forged ?invite=1 URL without a matching signed cookie" reasoning (no longer relevant — URL can no longer flip the flag at all) and replace with: "inviteMode comes from the server-derived cookie check in the parent page; the URL cannot influence it. Defence in depth: /auth/callback re-verifies the cookie's token against the invitation row inside the public.accept_invitation() RPC."

Do NOT touch:
- `src/app/auth/callback/route.ts` — out of scope.
- `src/app/(app)/accept-invite/[token]/route.ts` — out of scope; it still sets the cookie.
- The cookie name / options in `src/lib/invitations/cookie.ts` — unchanged.

Commit message: `fix(260524-iav): derive sign-in inviteMode from cookie, not URL (B2)`
  </action>
  <verify>
    <automated>grep -q "INVITE_COOKIE_NAME" "src/app/(auth)/sign-in/page.tsx" && grep -q "await cookies()" "src/app/(auth)/sign-in/page.tsx" && grep -q "inviteMode={" "src/app/(auth)/sign-in/page.tsx" && grep -q "inviteMode: boolean" "src/app/(auth)/sign-in/sign-in-form.tsx" && ! grep -qE "searchParams\.get\(['\"]invite['\"]" "src/app/(auth)/sign-in/sign-in-form.tsx" && pnpm typecheck && pnpm lint</automated>
  </verify>
  <done>`page.tsx` imports `cookies` from `next/headers` and `INVITE_COOKIE_NAME` from `@/lib/invitations/cookie`, is `async`, and passes `inviteMode={...}` to `<SignInForm />`. `sign-in-form.tsx` accepts `inviteMode` as a typed prop, no longer reads `?invite=` from `useSearchParams()`, and still pre-fills email from `?email=`. Manual smoke (executor's responsibility to note in summary): `/sign-in?invite=1` without the cookie renders WITHOUT the invite banner and the OTP call sends `shouldCreateUser: false`; `/accept-invite/<token>` followed by `/sign-in` DOES render the banner and sends `shouldCreateUser: true`. `pnpm typecheck` and `pnpm lint` pass.</done>
</task>

<task type="auto">
  <name>Task 3: B3 — invert resolveOrigin precedence, env first</name>
  <files>src/app/(app)/settings/team/actions.ts, src/lib/env.ts</files>
  <action>
Invert the precedence of `resolveOrigin()` so the env-var-controlled site URL wins over any request header, defeating X-Forwarded-Host injection on non-Vercel proxies that don't strip the header. Today an authenticated owner can be tricked into sending invite emails whose accept link points at `attacker.com`.

CHANGE 1 — `src/lib/env.ts`:
- In the `client` schema block, add: `NEXT_PUBLIC_SITE_URL: z.string().url().optional()`.
- In the `experimental__runtimeEnv` object, add: `NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL`.
- Add a comment above the new entry: "Quick task 260524-iav (B3): authoritative origin used by server actions when building absolute accept-invite URLs. MUST be set in production (e.g. `https://app.altus.example.com`). When unset, src/app/(app)/settings/team/actions.ts falls back to request-header detection, which is safe on Vercel but vulnerable to X-Forwarded-Host injection on other proxies."

CHANGE 2 — `src/app/(app)/settings/team/actions.ts`:
- Add `import { env } from '@/lib/env'` to the existing import block.
- Replace the body of `resolveOrigin()` (currently lines 43-51) with the new precedence:

```
async function resolveOrigin(): Promise<string | null> {
  // Quick task 260524-iav (B3): precedence is env → origin → forwarded-host.
  // env.NEXT_PUBLIC_SITE_URL is the trusted source in production — it is
  // server-controlled at deploy time and cannot be spoofed by an upstream
  // proxy attaching a malicious X-Forwarded-Host. When unset (dev or single-
  // env Vercel), we fall back to the browser-supplied `origin` header (set
  // by every same-origin fetch from a real browser; not present on cross-
  // origin or non-browser callers), and finally to forwarded-host as a
  // last resort. Operators MUST set NEXT_PUBLIC_SITE_URL in production.
  if (env.NEXT_PUBLIC_SITE_URL) {
    // Strip any trailing slash so caller's `${origin}/accept-invite/...`
    // doesn't double up.
    return env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) return null
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}
```

- Leave the existing `inviteMemberAction` and `resendInviteAction` callers UNCHANGED — they continue to call `resolveOrigin()` and concatenate `/accept-invite/${token}`. (Wiring the `getInviteAcceptUrl` helper from src/lib/invitations/cookie.ts is out of scope per the constraints; defer to a follow-up.)

Do NOT:
- Bypass the typed `env` handle by reading `process.env.NEXT_PUBLIC_SITE_URL` directly.
- Add the env var to the `server` schema — it is needed by future client code paths too and follows the established `NEXT_PUBLIC_*` convention. The server actions in this file are server-only but the env wrapper allows server code to read `client` vars just fine.
- Touch any other helper in actions.ts beyond `resolveOrigin` + the import.

Commit message: `fix(260524-iav): invert resolveOrigin precedence — env first, header last (B3)`
  </action>
  <verify>
    <automated>grep -q "NEXT_PUBLIC_SITE_URL" src/lib/env.ts && grep -c "NEXT_PUBLIC_SITE_URL" src/lib/env.ts | awk '{ if ($1 < 2) exit 1 }' && grep -q "env.NEXT_PUBLIC_SITE_URL" "src/app/(app)/settings/team/actions.ts" && grep -q "from '@/lib/env'" "src/app/(app)/settings/team/actions.ts" && pnpm typecheck && pnpm lint</automated>
  </verify>
  <done>`src/lib/env.ts` declares `NEXT_PUBLIC_SITE_URL` as an optional URL in BOTH the `client` schema and `experimental__runtimeEnv`. `src/app/(app)/settings/team/actions.ts` imports `env` from `@/lib/env` and `resolveOrigin()` returns `env.NEXT_PUBLIC_SITE_URL` (trailing-slash-stripped) FIRST when set, then origin header, then forwarded-host. Behavior preserved for callers (still returns a string or null; still consumed by the existing `${origin}/accept-invite/${token}` concatenation). `pnpm typecheck` and `pnpm lint` pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|----------------|
| browser → /sign-in URL | Attacker can craft arbitrary query string in a link they trick a victim into clicking. |
| upstream proxy → Next.js server actions | Non-Vercel proxies may forward attacker-controlled `X-Forwarded-Host` headers. |
| concurrent Postgres transactions | Two RPC calls (`accept_invitation`) and trigger calls (`handle_new_user`) can interleave on the same `organization_id`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260524-iav-01 | Tampering | `public.accept_invitation` RPC, orphan-org cleanup branch | mitigate | Task 1: add `PERFORM 1 FROM public.organizations WHERE id = v_old_org FOR UPDATE` before the user-count SELECT inside the same transaction so concurrent INSERTs block until accept_invitation commits. |
| T-260524-iav-02 | Spoofing / DoS | `/sign-in?invite=1&email=*` URL flipping `shouldCreateUser:true` | mitigate | Task 2: server component reads the httpOnly `altus_invite_token` cookie via `next/headers` and passes `inviteMode` as a prop. URL query is no longer honoured for inviteMode. Email pre-fill via `?email=` remains (harmless: cannot create accounts on its own). |
| T-260524-iav-03 | Tampering / Phishing | `resolveOrigin()` in `src/app/(app)/settings/team/actions.ts` building accept-invite URLs from `X-Forwarded-Host` | mitigate | Task 3: precedence becomes `env.NEXT_PUBLIC_SITE_URL → origin → forwarded-host`. Operators set the env var in production; header fallback applies only when the trusted source is absent (dev / single-env Vercel). |
| T-260524-iav-SC | Tampering | npm/pnpm installs | accept | No new dependencies added by this plan. No package legitimacy gate required. |
</threat_model>

<verification>
After all three tasks land:

1. `pnpm typecheck` exit code 0.
2. `pnpm lint` exit code 0.
3. `git log --oneline -3` shows exactly three commits, one per blocker, prefixed `fix(260524-iav): ...`.
4. `grep -n 'for update' supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` shows at least two matches (invitation row lock + new orphan-org lock).
5. `grep -RnE "searchParams\.get\(['\"]invite['\"]" src/app/(auth)/sign-in/` returns no matches.
6. `grep -n 'env.NEXT_PUBLIC_SITE_URL' src/app/(app)/settings/team/actions.ts` shows the precedence-first usage.
7. Original migration `supabase/migrations/20260524000100_org_invitations.sql` is BYTE-IDENTICAL to before (append-only rule).
8. Manual smoke (executor records in SUMMARY.md):
   - `/sign-in?invite=1` with NO cookie → no invite banner, OTP call sends `shouldCreateUser:false` (DevTools Network tab).
   - `/accept-invite/<valid-token>` → cookie set → redirected to `/sign-in` → invite banner shows → OTP send shows `shouldCreateUser:true`.
   - Inviting a teammate locally with `NEXT_PUBLIC_SITE_URL=https://altus-prod.example.com` set in `.env.local` produces an email whose link starts with `https://altus-prod.example.com/accept-invite/...` regardless of the current dev origin.

Out-of-band (orchestrator, after task 1 lands and before declaring phase complete):
- `pnpm exec supabase db push --linked`
- `pnpm db:types` (no-op expected — signature unchanged)
</verification>

<success_criteria>
- All three commits exist with the prescribed messages.
- All three blockers from REVIEW.md (B1, B2, B3) are closed by the artifacts and key_links listed in `must_haves`.
- No edits to any file not listed in `files_modified`.
- No new npm dependencies.
- `pnpm typecheck` and `pnpm lint` pass on the final HEAD.
- Original migration `20260524000100_org_invitations.sql` untouched.
</success_criteria>

<output>
Create `.planning/quick/260524-iav-task-2-security-blocker-fixes-accept-inv/260524-iav-SUMMARY.md` when done, recording:
- Three commit SHAs and one-line descriptions.
- Manual smoke results (Task 2 banner + OTP `shouldCreateUser` observations; Task 3 outbound email link host with NEXT_PUBLIC_SITE_URL set).
- Confirmation that `pnpm exec supabase db push --linked` was run by the orchestrator (or flagged as TODO) and that `pnpm db:types` produced no diff.
- Any deferred follow-ups (e.g., wiring `getInviteAcceptUrl` from `src/lib/invitations/cookie.ts` per REVIEW.md H3 — explicitly NOT done here).
</output>
