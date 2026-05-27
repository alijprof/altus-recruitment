---
quick_id: 260528-0rd
slug: p1-fix-extend-middleware-matcher-to-excl
date: 2026-05-28
status: complete
files_modified:
  - src/middleware.ts
---

# Quick 260528-0rd — Summary

**P1 fix:** extended `src/middleware.ts` matcher to exclude PWA + SEO well-known files.

**Discovered by:** Pre-UAT Agent B (HTTP-level deep smoke) per global CLAUDE.md HARD RULE #1.

## The bug

The original matcher excluded `_next/static`, `_next/image`, `favicon.ico`, and image extensions (svg/png/jpg/jpeg/gif/webp). It did NOT exclude:

- `/manifest.webmanifest` (PWA install manifest)
- `/icon` (Next.js metadata file route — dynamically generated PNG)
- `/apple-icon` (same)
- `/robots.txt` (SEO crawler hint)
- `/sitemap.xml` (SEO sitemap)
- `.ico` extension generally

All five paths were therefore intercepted by `updateSession()`, redirected to `/sign-in?next=/...`, breaking:
- iOS/Android "Add to home screen" PWA install (silently fails — browser fetches the manifest URL, gets HTML, gives up)
- Browser-fetched app-defined icon set (users see default favicon only)
- Future SEO crawler indexing (every URL becomes a redirect to sign-in)

Particularly relevant given the anchor's mobile-first focus (260523-ret mobile UX overhaul).

## Fix

Extended the negative lookahead in the matcher pattern with explicit literal exclusions for each well-known file, and added `ico` to the extension list. `icon$` and `apple-icon$` use end-anchors so future `/icons/*` app routes aren't accidentally excluded.

## Verification

- `pnpm typecheck` — passes
- Post-deploy: re-fetch `/manifest.webmanifest` and confirm response is the actual JSON manifest with `content-type: application/manifest+json`, NOT the sign-in HTML.

## Commit

Single commit covering the matcher edit.

## Why all prior reviews missed it

- 4 original code reviews focused on per-task source files; the middleware allowlist wasn't in scope for any of them.
- /security-review focused on auth-sensitive code paths; PWA/SEO files were below its severity threshold.
- The earlier 260527-x2q P0 fix added `/accept-invite` to `PUBLIC_PATHS` but didn't audit the matcher itself for unrelated public files.
- HTTP-level smoke (Agent B) was the only gate that systematically probed the public-asset surface and found the gap.

## Deferred (out of scope here, captured for follow-up)

- **H1 from Agent B:** Unsigned `PUT /api/inngest` returns 200 "Successfully registered". Likely expected Inngest behaviour (registration is intentionally signature-less; only invocation requires it). Worth verifying against Inngest docs before changing.
- **H2 from Agent B:** No CSP / X-Frame-Options / Referrer-Policy / Permissions-Policy / X-Content-Type-Options headers. Pure hardening; bundle into a single `next.config.ts` `headers()` block pre-customer-demo.
- **H3 from Agent B:** `x-powered-by: Next.js` advertised. Trivial `poweredByHeader: false`. Bundle with H2.
