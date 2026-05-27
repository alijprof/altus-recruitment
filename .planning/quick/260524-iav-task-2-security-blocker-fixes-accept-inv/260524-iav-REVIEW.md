---
phase: quick-260524-iav
reviewed: 2026-05-27T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - supabase/migrations/20260524000300_fix_accept_invitation_lock.sql
  - supabase/migrations/20260524000100_org_invitations.sql
  - src/app/(auth)/sign-in/page.tsx
  - src/app/(auth)/sign-in/sign-in-form.tsx
  - src/app/(app)/settings/team/actions.ts
  - src/lib/env.ts
  - src/lib/invitations/cookie.ts
  - src/app/auth/callback/route.ts
findings:
  blocker: 0
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Pre-UAT Code Review — 260524-iav security fixes

**Reviewed:** 2026-05-27
**Reviewer:** Opus (pre-UAT pipeline)
**Verdict:** PASS-WITH-NITS

All three B1/B2/B3 fixes land correctly. B1 (FOR UPDATE on orphan org row) is wired
exactly as the plan called for — the lock sits in the right branch and runs before
the count(*). B2 (server-derived inviteMode) is correctly threaded: the URL `?invite=1`
is no longer read anywhere in the sign-in path, the cookie is the sole source of truth,
and the `shouldCreateUser:` flag now follows the cookie. B3 (env-first resolveOrigin)
is wired with the correct precedence and the trailing-slash strip handles the most
common operator mistake (`https://app.example.com/`).

The CREATE OR REPLACE in the new migration correctly preserves the original revoke/grant
attributes — I verified the original migration is byte-identical (last touched by
`87f055f`) and that the EXECUTE-to-service_role grant survives because Postgres preserves
grants on identical signatures.

Two warnings (one is a real loose-end the fixer missed, one is an edge-case the regex
strip doesn't handle), five info items including stale `?invite=1` query in the
`/accept-invite` redirect (now dead) and the lingering audit-log gap (pre-existing,
not introduced here, but worth re-flagging since this is the security-hardening pass).

No blockers. No new lint errors introduced. The single pre-existing lint error in
`cv-review-panel.tsx:98` is unchanged.

## Blockers (must fix before UAT)

None.

## High-priority issues

### WR-01: `/accept-invite/[token]` still appends `&invite=1` to its redirect — stale URL contract

**File:** `src/app/accept-invite/[token]/route.ts:56`
**Issue:**
After B2, the sign-in page no longer reads `?invite=1` from the URL — `inviteMode` is
derived exclusively from the `altus_invite_token` cookie. But the upstream
`/accept-invite/[token]` route handler still hand-builds the redirect URL as:

```ts
const redirectUrl = `${origin}/sign-in?email=${encodeURIComponent(invitation.email)}&invite=1`
```

The `&invite=1` is now dead — sign-in-form.tsx no longer parses it (verified by `grep -RnE
"searchParams\.get\(['\"]invite['\"]" src/app/(auth)/sign-in/` → 0 matches). The route
comment at line 22 also still says "redirect to `/sign-in?email={encoded}&invite=1` so
the form pre-fills" which is now misleading: the prefill comes from `?email=` only;
`invite=1` does nothing.

**Why it matters:**
1. Misleading code — the next person who touches the sign-in path will think `?invite=1`
   is a contract and may try to re-wire it (re-introducing B2).
2. URL leakage — the invitee's email plus the `?invite=1` token is now in the browser
   address bar AND in the `Referer` header on the next outbound navigation from the
   sign-in page. The `invite=1` hint discloses "this user was invited" to any cross-origin
   resource the sign-in page links to. Minor info-leak but real.
3. The plan's must_haves §3 ("hitting `/sign-in?email=foo@bar.com` (no `?invite=1`) still
   pre-fills the email field") implicitly assumed the `?invite=1` query was removed; the
   regression-safety check passes only because the prefill is decoupled from the now-dead
   query param.

**Fix:**
Drop `&invite=1` from the redirect — there is no consumer for it anymore.

```ts
const redirectUrl = `${origin}/sign-in?email=${encodeURIComponent(invitation.email)}`
```

Also update the comment at line 22 to drop the `&invite=1` reference and add a one-line
note: "inviteMode is derived from the cookie set on line 58, not from the URL — see
quick task 260524-iav B2."

### WR-02: Trailing-slash strip is single-pass — `https://app.example.com//` collapses to `https://app.example.com/` not the bare origin

**File:** `src/app/(app)/settings/team/actions.ts:57`
**Issue:**
`.replace(/\/$/, '')` strips exactly one trailing slash. Zod's `.url()` validator accepts
`https://app.example.com//` as a valid URL (verified: `z.string().url().safeParse('https://example.com//')`
returns success), so an operator who mistypes the env var as `https://app.example.com//`
gets through schema validation, then the strip leaves `https://app.example.com/`, and
the caller builds `https://app.example.com//accept-invite/{token}` — a double-slash URL
that some routers/CDNs treat as a 301 to the single-slash form and some treat as a
distinct path.

**Why it matters:**
The whole point of the B3 strip is to eliminate `//accept-invite/...` from the outbound
email body. The single-pass strip handles `https://x.com/` correctly but only partially
handles `https://x.com//`. Combined with the operator-misconfiguration vector the env
var is supposed to defend against, it's worth tightening.

**Fix:**
Use a greedy strip:

```ts
return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '')
```

Or normalise via `new URL(...).origin`, which always returns scheme + host + port with
no trailing slash regardless of input shape:

```ts
return new URL(env.NEXT_PUBLIC_SITE_URL).origin
```

The latter is more robust because it also strips any path segments an operator might
accidentally append (`https://app.example.com/dashboard` → `https://app.example.com`).
Trade-off: it silently discards path components rather than refusing them.

## Medium-priority / nice-to-haves

### IN-01: `accept_invitation` RPC still emits zero audit-log rows

**File:** `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql` (and the
original `20260524000100_org_invitations.sql` it replaces)
**Issue:**
The CLAUDE.md "Audit-ready by default" principle says "every access to candidate data is
logged. Every consent has a timestamp + basis." Org membership transfer is exactly the
kind of consent-affecting event that should hit `audit_log` — it changes a user's
organization_id and demotes role from owner to recruiter, plus may cascade-delete an
entire org. The RPC currently logs nothing.

This is NOT a regression introduced by this task — it was missing in the original
260524-bpy migration too. But the focus areas for this review explicitly asked about
audit-trail coverage of the FOR UPDATE branch, and the answer is: there is none.

**Why it matters:**
1. A successful org-deletion via the orphan-cleanup branch is currently invisible. If
   an operator later needs to investigate "why is org X gone?", there is no row to find.
2. The new FOR UPDATE lock makes the delete more deterministic, but doesn't make it
   visible. A silent delete that's now correctly serialised is still silent.
3. The plan's threat model explicitly enumerated `T-260524-iav-01` as a "Tampering" risk
   on the orphan-org cleanup. Tampering risks in CLAUDE.md require audit trail.

**Fix:**
Add a `perform public.record_audit(...)` call inside the orphan-delete branch and another
on the role-change update. Defer to a follow-up task; not pre-UAT blocking for this fix,
but should be on the next-actions queue.

### IN-02: `NEXT_PUBLIC_SITE_URL` declared on client schema but never consumed by any Client Component

**File:** `src/lib/env.ts:111-124`, `src/app/(app)/settings/team/actions.ts:54`
**Issue:**
The plan justified putting `NEXT_PUBLIC_SITE_URL` on the client schema (not the server
schema) to "keep the door open for future client-side URL building without re-litigating
placement." Fair, but right now the only consumer is `resolveOrigin()` — a server action.
Putting it on the client schema ships the value to the browser bundle on every page load,
which is harmless (it's a public URL) but adds a few bytes to every JS chunk.

No Client Component reads it (grep `NEXT_PUBLIC_SITE_URL!` → 0 matches; no non-null
assertion anywhere). Today it's a server-only need with a client-schema declaration.

**Why it matters:**
Bundle bloat is trivial; the real risk is the next person looks at the schema and assumes
it's safe to dereference unconditionally in a Client Component (e.g. `env.NEXT_PUBLIC_SITE_URL!`
in a `'use client'` file), which silently breaks in environments where it's unset because
`emptyStringAsUndefined: true` turns missing into `undefined`.

**Fix:**
Either:
- Move it to the `server` schema (and update the `experimental__runtimeEnv` slot accordingly,
  or remove that slot — server-only vars don't need `experimental__runtimeEnv`).
- Or leave it as-is but add a comment to the schema saying "currently only consumed by
  resolveOrigin() server action; safe to dereference but cast to a non-null type only
  after a guard."

Defer per the plan's explicit rationale; this is a future-proofing nit.

### IN-03: `cookieStore.get(...)?.value != null` accepts empty-string cookie value as "invited"

**File:** `src/app/(auth)/sign-in/page.tsx:17`
**Issue:**
The presence check is `cookieStore.get(INVITE_COOKIE_NAME)?.value != null`. If the cookie
exists with an empty-string value (e.g. some buggy middleware sets it to `''` instead of
deleting), `?.value != null` returns `true` and `inviteMode` flips to true — but the
cookie has no usable token. The callback handler will then attempt to call `accept_invitation`
with `p_token: ''`, which fails Zod-side at the route handler? Actually no — the callback
route at `src/app/auth/callback/route.ts:24` reads the cookie raw and passes it to the RPC
which expects a uuid, so the RPC will throw a Postgres type-mismatch error and the user
will land on `/sign-in?error=invalid-invite`.

So it's not exploitable, but the page-level check is sloppy. A stricter check would be:

```ts
const cookieValue = cookieStore.get(INVITE_COOKIE_NAME)?.value
const inviteMode = typeof cookieValue === 'string' && cookieValue.length > 0
```

Or even better — uuid-shape validate at the page boundary so the banner is only shown
when the cookie looks usable. Less critical because callback re-verifies, but better
defence-in-depth.

**Why it matters:**
Currently low-impact (callback handles malformed values). But the discrepancy between
"page shows invite banner" and "callback rejects the invite" creates UX confusion — user
sees "you've been invited" then submits the form and gets "that invitation link isn't
valid." A stricter check would prevent the banner from rendering in the malformed-cookie
case.

**Fix:** As above. Trivial diff.

### IN-04: `H3` follow-up still deferred — `getInviteAcceptUrl` helper exported but unused

**File:** `src/lib/invitations/cookie.ts:34-36`, `src/app/(app)/settings/team/actions.ts:155, 324`
**Issue:**
The `getInviteAcceptUrl(origin, token)` helper exists and is exported but never imported.
The two server actions still hand-roll `${origin}/accept-invite/${token}`. The SUMMARY
correctly flags this as a deferred H3 follow-up — re-flagging here because it's now a
2-fix-touch-history-deep loose end. If the helper is going to live in the codebase, it
should be the canonical builder; otherwise it should be deleted.

**Why it matters:**
Dead exported code is a future-drift risk. The hand-rolled string in `actions.ts:155` and
`actions.ts:324` cannot drift from the helper (because the helper is unused) — but a
contributor who DOES adopt the helper later will need to verify the inline form matches.

**Fix:**
Either wire the helper in both actions, or delete it. Single-line change either way.
Explicitly deferred per the SUMMARY; re-confirming the deferral.

### IN-05: `audit_log, ai_usage, org_invitations, …` enumeration in migration comment may drift

**File:** `supabase/migrations/20260524000300_fix_accept_invitation_lock.sql:18`
**Issue:**
The migration header comment enumerates the cascade-delete children of `organizations`:
"users, candidates, jobs, applications, audit_log, ai_usage, org_invitations, …". This
list is maintained by hand and will drift as Phase 4/5 add more tenant tables. The
comment is informational only (not executed) so the drift is cosmetic, but the comment
sets up an expectation that the list is authoritative.

**Why it matters:**
Future-reader will trust this list. If they update CASCADE behaviour on, say, a new
`pipelines` table and don't update this comment, the next reviewer may miss the
inconsistency.

**Fix:**
Either drop the enumeration ("and every ON DELETE CASCADE child") or generate it from a
catalog query in a CI lint. Low priority; pure documentation hygiene.

## Things that look right

- **B1 (`fix_accept_invitation_lock.sql`):** The `PERFORM 1 FROM public.organizations
  WHERE id = v_old_org FOR UPDATE` statement is correctly placed inside the
  `if v_old_org is not null and v_old_org <> v_invite.organization_id then` branch (line
  91-108), so the lock attempt is skipped — not errored — when `v_old_org IS NULL`
  (brand-new user with no prior org). Lock executes BEFORE the count(*) (line 101) and
  before the DELETE (line 106). Ordering matches the plan's `<interfaces>` block verbatim.
- **CREATE OR REPLACE grant preservation:** The new migration omits the
  `revoke...grant execute...to service_role` block. This is correct per the plan and per
  Postgres semantics — CREATE OR REPLACE on an identical signature preserves the grants
  on the existing function object. Verified by inspection that the original
  `20260524000100_org_invitations.sql:213-216` set those grants and is byte-identical to
  before (git log: last touched by `87f055f`, the original 260524-bpy commit). Net effect:
  EXECUTE is still granted ONLY to `service_role` (not authenticated, not anon, not public).
- **B2 (`sign-in/page.tsx`):** Page is now `async`, awaits `cookies()`, reads the
  `altus_invite_token` cookie via `INVITE_COOKIE_NAME`, and passes `inviteMode` as a
  boolean prop. The `import 'server-only'` constraint on `src/lib/invitations/cookie.ts`
  is respected — the import lands in a Server Component (page.tsx), not the Client
  Component (sign-in-form.tsx). Prop is serializable (boolean). Pre-fill from `?email=`
  is preserved (sign-in-form.tsx:59-62). React-19 adjust-state-during-render idiom for
  the `prevPrefilled` seed is unchanged.
- **B2 (`sign-in-form.tsx`):** Client component now destructures `inviteMode` from a
  typed `SignInFormProps`, no longer derives it from `useSearchParams()`. `grep` for
  `searchParams.get('invite')` returns 0 matches in `src/app/(auth)/sign-in/`. The
  `shouldCreateUser: inviteMode` line (105) consumes the prop. Comment blocks updated to
  reflect the new source of truth.
- **B3 (`actions.ts:53-66`):** Precedence is `env.NEXT_PUBLIC_SITE_URL` → `origin` header
  → `x-forwarded-host`/`host`. Env-first branch returns trailing-slash-stripped value.
  Two callers (`inviteMemberAction`, `resendInviteAction`) are unchanged — they continue
  to consume `resolveOrigin()` returning `string | null`. Signature preserved.
- **B3 (`env.ts:118-124, 134`):** `NEXT_PUBLIC_SITE_URL` declared in both `client` schema
  (with `z.string().url().optional()`) AND `experimental__runtimeEnv` (required by
  `@t3-oss/env-nextjs` for static substitution). `emptyStringAsUndefined: true` (line 136)
  handles the operator who sets the env var to `""` — it becomes `undefined` and the
  env-first branch falls through to header detection. A single `/` would fail
  `.url()` validation at module load — fail-closed behaviour. Good.
- **Callback route untouched and correctly wired:** `src/app/auth/callback/route.ts:24`
  still reads `INVITE_COOKIE_NAME` from request cookies, line 65-69 still calls
  `accept_invitation` RPC with the same three params, and the cookie is cleared on every
  return path (success at line 98, RPC error at line 76, mismatch at line 92, exception
  at line 105). Signature change between B1's migration and the caller: none — the RPC
  args `{ p_token, p_user_id, p_user_email }` match line-for-line.
- **`getProfile`/owner-only gate on `/settings/team` unchanged:** B3 doesn't loosen the
  role check; `inviteMemberAction` still rejects non-owners at line 93-95.
- **No new lint errors introduced:** Verified — only the pre-existing
  `cv-review-panel.tsx:98:31 impure-function-during-render` error remains (last touched
  by `57b171e` on 2026-05-23, predates this task). All five files modified by this task
  typecheck and lint cleanly on their own lines.
- **`pnpm typecheck` exits 0** on the final HEAD.
- **No new `any` casts; no new `process.env.X!` non-null assertions; no new
  Sentry captures that include PII** (verified by grep across the five touched files).
- **Original migration byte-identical:** `git log --oneline supabase/migrations/20260524000100_org_invitations.sql`
  shows only `87f055f` (the original 260524-bpy commit). Append-only rule preserved.
- **Three commits in expected order with expected messages:** `3f34d41` (B1), `3ac51fc`
  (B2), `c79d03a` (B3), each prefixed `fix(260524-iav): ...` verbatim from the plan.

---

_Reviewed: 2026-05-27_
_Reviewer: Claude (gsd-code-reviewer, pre-UAT pipeline)_
_Depth: deep_
