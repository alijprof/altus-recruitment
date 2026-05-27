# Pre-UAT Browser-Automation Verification — 2026-05-27

**Target:** https://altus-recruitment.vercel.app
**Mode:** Vercel MCP (web_fetch_vercel_url + runtime logs) — no Playwright/click automation; URL fetch + content inspection only
**Production deploy:** `dpl_HJp1hQf6vt2JuHdmC8HXC3R1NBFj` from commit `54f0f8f` — state READY
**Runtime errors in last 24h:** 0
**Reviewer:** Pre-UAT pipeline (HARD RULE #1)

## Blockers (must fix before human UAT)

### B1 — `/accept-invite/*` missing from middleware PUBLIC_PATHS (SHIPPED FIX: 260527-x2q, commit 57d028c)

**File:** `src/lib/supabase/middleware.ts:8-25` (pre-fix)
**Severity:** P0 — invitation flow completely broken for new users
**How found:** Browser-automation fetch of `/accept-invite/00000000-...` was intercepted by middleware and redirected to `/sign-in?next=...` (the auth-redirect pattern) instead of the route handler's own `?error=invalid-invite` redirect. This proved the route handler never executed.

**Detail:**
- 260524-bpy shipped `/accept-invite/[token]/route.ts` as the public entry point — it validates the token via service-role and sets the `altus_invite_token` httpOnly cookie before redirecting to `/sign-in`.
- But the route was never added to `PUBLIC_PATHS`.
- Unauthenticated users (the common case — invitees don't have sessions yet) hit middleware → redirect → cookie never set → `/auth/callback` finds no cookie → fresh-org bootstrap fires → invitee lands in their own brand-new org, NOT the inviter's.

**Why all 4 code reviews + /security-review missed it:** each looked at the route handler in isolation; none cross-checked the middleware allowlist. Browser-automation walk caught it.

**Fix:** Added `/accept-invite` to `PUBLIC_PATHS`. The `startsWith` matcher correctly accepts `/accept-invite/[any-token]`.

**Post-fix verification required:** After Vercel auto-deploys `57d028c`, re-fetch `/accept-invite/{invalid-token}` and confirm it redirects to `/sign-in?error=invalid-invite` (NOT `/sign-in?next=...`).

## High-priority issues (should fix, document if deferred)

None surfaced by the URL-fetch pass.

## Medium / nice-to-haves (deferred to post-UAT)

These were flagged by upstream reviews and aren't blocking UAT; they should still be addressed before customer demo.

- **260524-iav WR-01** — stale `&invite=1` appended in `/accept-invite/[token]/route.ts:56`. Now dead code (consumer removed in B2). Cosmetic; also leaks "was invited" via address bar + Referer header.
- **260524-iav WR-02** — `.replace(/\/$/, '')` single-pass trailing-slash strip in `resolveOrigin`. Operator typo `https://app.example.com//` (passes Zod `.url()` validation) produces `//accept-invite/...` in outbound email.
- **260524-cjl WR-01** — Dashboard empty branch lost its `<h1>` (heading-hierarchy break).
- **260524-cjl WR-02** — Jobs empty body says "client-first" but primary CTA is "spec call" — mixed signal.
- **260524-cjl WR-04** — Source-attribution empty CTA → `/pipeline` is wrong when user has placements outside the date window; DateFilter is the right next action.
- **260524-cwd HI-01** — `placements_by_recruiter_quarter` + `commission_summary_by_recruiter` inner-join on users via `coalesce(owner_user_id, created_by)`. Rows where both are NULL (deleted recruiter) silently dropped.
- **260524-cwd HI-02** — `pipeline_value_sparkline` reads `status='open'` as current state per bucket, not as-of-bucket-date. Trend is a back-projection of today.
- **260524-cwd HI-03** — `time_to_fill_by_sector` doesn't filter out negative durations (`placed_at < created_at`).
- **260524-b6v H-1** — Feedback `page_url` capture includes `window.location.search`, so submitting from `/candidates?q=John%20Smith` leaks candidate name to dev's Gmail inbox.

## Flows verified clean

| Flow | Method | Result |
|---|---|---|
| Production deploy state | `list_deployments` | READY on `54f0f8f` |
| Runtime errors (24h) | `get_runtime_logs` `level=error,fatal` | 0 entries |
| `/sign-in` renders | URL fetch + HTML inspect | 200, SignInForm `inviteMode: false` |
| `/sign-in?invite=1&email=victim@example.com` — **B2 spam-vector test** | URL fetch + HTML inspect | 200, SignInForm `inviteMode: false` (URL param does NOT flip server-derived flag — B2 working in production) |
| `/sign-up` renders | URL fetch | 200, prerendered |
| Static asset bundling (font preload, Recharts code-split) | HTML link/script inspection | OK; Recharts not in initial page chunk |

## Not verifiable via URL-fetch (requires authenticated session — these become human UAT items)

These flows could not be exercised by the Vercel MCP fetch tool (no session). They were code-reviewed clean, but live behaviour still needs human verification:

1. Feedback FAB visibility on authenticated routes; invisibility on /sign-in/sign-up/error
2. Feedback submit end-to-end with body validation (empty / 2050 chars / valid)
3. Settings → Team page renders members + pending invites
4. Org invite send → email arrives via Resend → click link → cookie set → magic-link sign-in → land in inviter's org (will work post-x2q fix)
5. Expired/revoked token → /sign-in?error=expired-invite
6. Buyer-value dashboard renders 5 cards with real data
7. Pipeline value marquee renders `£X,XXX,XXX` with separators (Intl.NumberFormat)
8. Date-filter preset clicks (30/90/365) re-render page
9. Custom date range with from > to graceful fallback
10. Empty-state polish on /candidates (no orphan secondary CTA)
11. Mobile responsive on /reports/buyer-value at 375px (table → card stack)
12. Console hydration warnings for Recharts (should be zero)

## Pipeline recap

| Gate | Verdict | Blockers |
|---|---|---|
| /gsd-code-review on 260524-iav (security fixes) | PASS-WITH-NITS | 0 |
| /gsd-code-review on 260524-is2 (UX fixes) | PASS-WITH-NITS | 0 |
| /gsd-code-review on 260525-ucn (ssr build fix) | PASS | 0 |
| /security-review on invite + security-fix surface | PASS | 0 (No HIGH/MEDIUM findings) |
| Browser-automation smoke on Vercel | **BLOCK** | 1 (B1 above — fixed in 260527-x2q) |

The browser-automation step is what HARD RULE #1 says is "not optional for any feature involving a form, an email send, a public-token flow, or a payment." It's the only gate that caught the P0. Vindicates the rule.
