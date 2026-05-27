# Pre-UAT Agent B — HTTP-level deep smoke

**Method:** bash + Node (built-in `fetch`) for HEAD/GET/POST/PUT/PATCH/OPTIONS/DELETE probes against the live production URL. (Vercel sandbox blocked raw curl; switched to native `fetch` in Node 24 — same on-the-wire effect.)
**Target:** https://altus-recruitment.vercel.app
**Production deploy id present in HTML payloads:** `dpl_6JXhpg6mFsYHTbb84sfAyux2KqPC` (commit `a1a520d`, includes 57d028c middleware fix)
**Routes / method-combos exercised:** 51
**Bytes downloaded:** ~165 KB (HTML + JSON)
**Wall-clock:** ~6 min
**Logs:** `/tmp/altus-smoke/probe-output.txt`, `/tmp/altus-smoke/probe2-output.txt`, `/tmp/altus-smoke/probe3-output.txt`

---

## Blockers (must fix before human UAT)

### B1 — `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/robots.txt`, `/sitemap.xml` are auth-walled (PWA + SEO break)

**Severity:** P1 (blocker for PWA install + crawler indexing; not P0 because the marketing/landing surface is currently nonexistent, so SEO impact is low).
**File:** `src/lib/supabase/middleware.ts:8-34` (PUBLIC_PATHS) + `src/middleware.ts:9-14` (matcher).
**Live evidence:**

```
HEAD /manifest.webmanifest  -> 307  location: /sign-in?next=%2Fmanifest.webmanifest
HEAD /icon                  -> 307  location: /sign-in?next=%2Ficon
HEAD /apple-icon            -> 307  location: /sign-in?next=%2Fapple-icon
HEAD /robots.txt            -> 307  location: /sign-in?next=%2Frobots.txt
HEAD /sitemap.xml           -> 307  location: /sign-in?next=%2Fsitemap.xml
```

The matcher in `src/middleware.ts` excludes `_next/static`, `_next/image`, `favicon.ico`, and image extensions (.svg/.png/.jpg/.jpeg/.gif/.webp). It does **not** exclude:
- `.webmanifest` (text/json content-type)
- Next.js metadata file routes `/icon` and `/apple-icon` (no extension — dynamically generated images)
- `/robots.txt`, `/sitemap.xml`

Source files all exist (`src/app/manifest.ts`, `src/app/icon.tsx`, `src/app/apple-icon.tsx`) so the redirect is purely middleware over-reach, not missing routes.

**Why it matters now:**
- iOS/Android "Add to home screen" silently fails for the PWA (manifest 307 → HTML).
- Browser will not fetch the app-defined icon set; users see the default favicon only (works because `/favicon.ico` is in the matcher exclusion).
- Any future SEO/crawler will treat the site as redirecting every URL to a login page, which can drop indexing entirely once a marketing surface is added.

**Recommended fix:** Extend the matcher exclusion (one-line change) to also skip these well-known public files. Suggested matcher:
```
'/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)'
```

Or add them to `PUBLIC_PATHS` (cheaper, but still pays the supabase getUser() round-trip per request).

---

## High-priority issues (response headers, leaks, edge-input handling)

### H1 — `/api/inngest` accepts unauthenticated `PUT` and returns `Successfully registered`

**Severity:** P2 — not exploitable on its own (Inngest re-syncs the function manifest from the deployed code, no caller-supplied payload accepted on this path), but it is internet-facing and writeable, and confirms the registration sync runs without method-level signing checks.
**Evidence (unauthenticated, no signing header):**
```
PUT /api/inngest -> 200 {"message":"Successfully registered","modified":true}
GET /api/inngest -> 401 {"message":"Unauthorized"}
POST /api/inngest -> 401 {"message":"Unauthorized"}
```
The `modified:true` flag tells us the server **did re-sync** the function list with Inngest Cloud as a result of the anonymous request. Repeated calls will hit the Inngest control plane every time.

**Risk:**
- Cheap denial-of-control-plane: a bot can spam PUT against this endpoint and burn Inngest's sync API quota / generate noise in their dashboard.
- If a future deploy ever introduces a code path that reads request body during register, this becomes a real injection point.

**Mitigation:** Inngest's middleware accepts a `signingKey` option. Confirm `INNGEST_SIGNING_KEY` is set in Vercel and being passed to `serve({ signingKey: env.INNGEST_SIGNING_KEY })`. If it is, the SDK should reject unsigned PUTs — the fact that the unsigned PUT succeeds suggests it isn't enforced. Worth a 10-min check against `src/app/api/inngest/route.ts`.

### H2 — No defence-in-depth security response headers on HTML routes

**Severity:** P2 — pure hardening; nothing is currently exploitable, but a CSP would have caught the XSS vector in B2 below before it ever reached the page.
**Evidence (HEAD on `/sign-in`):**
```
content-security-policy: MISSING
x-frame-options: MISSING
x-content-type-options: MISSING
referrer-policy: MISSING
permissions-policy: MISSING
```

- No `X-Frame-Options` / `frame-ancestors` → site can be iframed by attacker site, enabling clickjacking on sign-in / future authenticated routes.
- No `Referrer-Policy` → invite-link `Referer` leaks to any third-party resource the user visits next (compounds existing 260524-iav WR-01 about `&invite=1` URL param).
- No `X-Content-Type-Options: nosniff` → uploaded user content (CV files via Supabase Storage) could be sniffed by older browsers, though Supabase's Storage URLs serve their own headers.

**Recommendation:** Add a Next.js config `headers()` block before any external traffic ramp-up. Not blocking UAT but should land before customer #1's logo is on the site.

### H3 — `x-powered-by: Next.js` advertised on HTML routes

**Severity:** P3 — purely informational leak; an attacker can fingerprint Next.js trivially from the HTML anyway. Easy to remove via `poweredByHeader: false` in `next.config.ts`. Worth bundling with H2.

### H4 — Path-traversal payload silently normalised, but URL-encoded payload reaches handler

**Evidence:**
```
GET /accept-invite/00000000-0000-0000-0000-000000000000/../../etc/passwd
  -> 307 /sign-in?next=%2Fetc%2Fpasswd          (collapsed BEFORE route match)
GET /accept-invite/%2Fetc%2Fpasswd
  -> 307 https://altus-recruitment.vercel.app/sign-in?error=invalid-invite  (route handler ran, treated as invalid token)
```

Both end safely, but the divergence is worth understanding:
- Vercel's edge proxy normalises real `../` segments before route matching, so `/accept-invite/X/../../etc/passwd` resolves to `/etc/passwd`, which middleware then auth-walls (B1 again — the same matcher gap).
- URL-encoded slashes pass through to the route handler and are rejected by the Zod UUID validator (correct).

**Result:** safe in both cases. Documented because it confirms the route handler's UUID validation is doing real work, not relying on path shape.

---

## Medium / nice-to-haves

### M1 — `/accept-invite/` (trailing slash, no token) → 308 → `/accept-invite` → 404

The Next.js default `/foo/` → `/foo` redirect kicks in, then the bare `/accept-invite` (no `[token]`) 404s with the full HTML error page. Functionally correct but it serves a ~14 KB HTML 404 instead of a small text one. Tradeoff is intentional Next.js behaviour; not actionable.

### M2 — 404 routes are auth-walled instead of returning real 404s

**Evidence:**
```
GET /this-route-does-not-exist -> 307 /sign-in?next=%2Fthis-route-does-not-exist
GET /api/this-does-not-exist  -> 307 /sign-in?next=%2Fapi%2Fthis-does-not-exist
GET /_next/data/this-does-not-exist.json -> 307 /_next/data/this-does-not-exist/sign-in.json?next=%2F
```

Unauthenticated users probing the site see redirects for **every** unknown URL. This:
- Inflates auth subsystem load (every 404 round-trips through `supabase.auth.getUser()`).
- Confuses monitoring (an external uptime checker hitting `/healthz` will see 307→200, not 404).
- Hides real 404s during development.

**Fix:** Have middleware skip path validation entirely and let Next's router decide; return 307 to sign-in only after the route is confirmed to exist (this would need the auth-guard to live in the layout rather than middleware, which is already the case in `(app)/layout.tsx`). Or — simpler — leave it.

### M3 — `/sign-in?invite=foo` (non-`1`) renders the **normal** sign-in (`<h1>Sign in</h1>`)

Confirmed `inviteMode: false` for any value of `?invite` other than the exact string `1`. Good — server-derived flag is not pre-fillable by URL. Already covered indirectly in 260527's verification but re-confirmed with the broader `?invite=foo` payload.

### M4 — `POST /sign-in` returns 200 HTML (not 405)

Hitting the sign-in **page** with POST returns the normal sign-in HTML rather than 405. Standard Next.js behaviour (page handlers respond to all HTTP methods). Not a bug; noted because a paranoid scanner will flag it.

### M5 — `/accept-invite/[token]` POST/PUT/DELETE → 405

```
POST /accept-invite/zero -> 405
PUT  /accept-invite/zero -> 405
DELETE /accept-invite/zero -> 405
```
Correct — route handler exports only `GET`. Good.

---

## Confirmations clean

| Probe | Result |
|---|---|
| `accept-invite` zero-UUID → `?error=invalid-invite` (no leak, no cookie set, no 5xx) | OK |
| `accept-invite` not-a-uuid → `?error=invalid-invite` | OK |
| `accept-invite` `?next=https://evil.example` open-redirect probe → ignored, redirects to `/sign-in?error=invalid-invite` only (no reflected `next`) | OK |
| `accept-invite` URL-encoded `%2Fetc%2Fpasswd` → handler runs, Zod rejects, `?error=invalid-invite` | OK |
| `accept-invite` 101-char garbage → `?error=invalid-invite` (no DB blowup) | OK |
| `accept-invite` **no Set-Cookie on invalid token** (cookie only set on the success path) | OK — verified `set-cookies: []` on zero-uuid response |
| **XSS in `/sign-in?email=<script>alert(1)</script>`** — payload appears in RSC JSON payload as `<script>…</script>` (unicode-escaped, safe). Raw `<script>` substring absent from body. | OK |
| **`+` in email** — `?email=a+b@c.com` renders correctly as `value="a+b@c.com"` in the rendered `<input>`. | OK |
| `?email=` empty → renders sign-in normally | OK |
| `?invite=foo` (non-`1`) → invite-mode NOT activated (`<h1>Sign in</h1>`, no "Accept invitation" copy) | OK |
| `?invite=1&email=` (no email) → renders sign-in (graceful) | OK |
| Host-header reflection probe (`Host: evil.example`, `X-Forwarded-Host: evil.example`) → no occurrence of `evil.example` anywhere in body, no `<base>` tag emitted | OK |
| `/apply/<script>` and `/apply/some-org-slug` → 404 HTML, no echo of slug into title or body (`<title>Altus Recruitment</title>`) | OK |
| `Strict-Transport-Security` present on every response, `max-age=63072000; includeSubDomains; preload` (2 years, exceeds 1-year HSTS minimum) | OK |
| `/api/inngest` GET/POST without signing → 401 JSON, no stack-trace leak | OK |
| `/api/linkedin/ingest` (any method, any Origin) → 307 to `/sign-in` (auth-gated, no CORS reflection — `Access-Control-Allow-Origin` header absent) | OK |
| Runtime: 0 5xx responses across all 51 probes | OK |

---

## Coverage gaps (where this method can't see)

HTTP-level smoke cannot verify:

1. **JavaScript-driven invite-mode UI** — the `inviteMode` flag is rendered in the RSC payload but the visible copy ("Accept invitation", branded header) is only assembled after React hydration. The HTML payload contains the prop but not the rendered text. Browser automation (Agent A) is the right tool here.
2. **The auth-callback success path** — requires a real OTP and Supabase round-trip; can't simulate without spamming the dev's email or burning a test account.
3. **The `altus_invite_token` cookie lifecycle** on a *valid* invite token — only verified that invalid tokens don't set the cookie. Valid path needs the integration test or a hand-driven UAT step.
4. **PWA installability** in a real browser — can confirm the manifest is reachable (it isn't, per B1) but not whether Chrome's install prompt actually fires.
5. **RSC client-side navigation behaviour** — only the initial server render is observable here.
6. **Inngest event-receive endpoint behaviour with a valid signature** — would require the Inngest signing key.
7. **Cross-tenant RLS enforcement** — requires authenticated session in two different orgs.
8. **Outlook OAuth callback (`/api/outlook/callback`)** — requires a real Microsoft `code` + matching `oauth_state` cookie; only verified that it's correctly in `PUBLIC_PATHS`.
9. **Microsoft Graph webhook signing (`/api/outlook/webhook`)** — same — in `PUBLIC_PATHS`, but `clientState` validation can only be checked with a forged-but-valid notification payload, out of scope for HTTP smoke.

---

## Single-line recap for the dispatcher

**Blockers:** 1 (B1 — middleware matcher kills `/manifest.webmanifest`, `/icon`, `/apple-icon`, `/robots.txt`, `/sitemap.xml`; PWA install + future SEO broken).
**High:** 2 (H1 unsigned Inngest PUT registers OK; H2 zero security response headers on HTML routes).
**Cleanly verified:** accept-invite hardened against every edge input tested (zero-uuid, non-uuid, open-redirect probe, path-traversal, URL-encoded, oversize) — no leaks, no Set-Cookie, no 5xx. Email pre-fill correctly escapes XSS (unicode-escaped in RSC payload). Host-header reflection safe.
