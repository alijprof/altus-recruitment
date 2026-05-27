---
quick_id: 260527-x2q
slug: p0-fix-add-accept-invite-to-middleware-p
date: 2026-05-27
status: complete
commits:
  - 57d028c
files_modified:
  - src/lib/supabase/middleware.ts
---

# Quick 260527-x2q — Summary

**P0 fix:** added `/accept-invite` to `src/lib/supabase/middleware.ts` `PUBLIC_PATHS`.

**Discovered by:** Pre-UAT browser-automation pipeline against `https://altus-recruitment.vercel.app` (per global CLAUDE.md HARD RULE #1).

**Single commit:** `57d028c fix(260527-x2q): add /accept-invite to middleware PUBLIC_PATHS (P0 invite-flow blocker)`

**Verification:**
- `pnpm typecheck` — passes
- `pnpm exec eslint src/lib/supabase/middleware.ts` — clean
- Post-deploy verification: after Vercel auto-deploys `57d028c`, re-fetch `/accept-invite/{any-token}` and confirm the response now reflects the route handler's own redirect logic (`?error=invalid-invite` for unknown tokens, `?email=...` for valid tokens with cookie set), NOT the middleware's `?next=...` redirect.

**Lessons:**
1. HARD RULE #1's mandatory browser-automation pre-smoke against the deployed URL is the only gate that caught this. All 4 prior code reviews + /security-review focused on the route handler in isolation; none cross-checked the middleware allowlist.
2. Future invite/public-token shipments must include the middleware allowlist update in the same atomic commit as the route handler. Consider a project rule or test: "for every new file under `src/app/*/route.ts` that handles unauthenticated traffic, the public-path matcher in middleware MUST be updated in the same PR."
