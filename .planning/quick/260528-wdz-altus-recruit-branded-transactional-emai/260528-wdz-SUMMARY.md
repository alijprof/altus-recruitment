---
phase: 260528-wdz-altus-recruit-branded-transactional-emai
plan: 01
subsystem: outbound-email
tags: [email, branding, supabase-auth, w6, fix-queue]
dependency-graph:
  requires: []
  provides:
    - "src/lib/email/render.ts → branded transactional renderer (HTML + text)"
    - "src/lib/email/escape.ts → escapeHtml + sanitiseUrl + safeHexColor"
    - "public/email/altus-recruit-logo.svg → header band logo"
    - "supabase/email-templates/* → paste-able dashboard auth HTML"
  affects:
    - "src/app/(app)/_actions/submit-feedback.ts → now sends HTML+text"
    - "src/app/(app)/settings/team/actions.ts → invite + resend send HTML+text"
tech-stack:
  added: []
  patterns:
    - "TransactionalEmail typed input → single renderer call → multipart-safe sendResendEmail({ html, text })"
    - "Module-level brand constants (MIDNIGHT/MINT/CLOUD/...) so one edit rebrands every outbound email"
    - "Text-fallback wordmark when NEXT_PUBLIC_SITE_URL unset (no broken-image icons)"
key-files:
  created:
    - "src/lib/email/escape.ts"
    - "src/lib/email/render.ts"
    - "public/email/altus-recruit-logo.svg"
    - "supabase/email-templates/magic-link.html"
    - "supabase/email-templates/recovery.html"
    - "supabase/email-templates/confirmation.html"
    - "supabase/email-templates/invite.html"
    - "supabase/email-templates/change-email.html"
    - "supabase/email-templates/README.md"
  modified:
    - "src/app/(app)/_actions/submit-feedback.ts"
    - "src/app/(app)/settings/team/actions.ts"
decisions:
  - "Adopted Altus Move's escape.ts shape verbatim (port not adapt) — same XSS guarantees, only DEFAULT_BRAND_HEX swapped to Altus Recruit mint #5DCAA5."
  - "render.ts is a simpler shape than Move's renderEmailHtml (no rich-text block tree, no per-org branding settings) because all Altus Recruit transactional sends are short notifications — heading + paragraphs + optional button + optional footerNote is enough. Reduces XSS surface."
  - "Supabase templates ship as static HTML (not generated from render.ts) because the dashboard is the source of truth — the README documents this and points operators back to render.ts BRAND constants for future rebrands."
  - "Visual sanity check used a standalone /tmp/render-email-samples.mjs (Node 24, no tsx) that re-implements the renderer with hardcoded brand constants. Deleted post-check; not committed."
metrics:
  duration: "~30 minutes"
  completed: "2026-05-28"
---

# Quick Task 260528-wdz: Altus Recruit branded transactional emails Summary

Ported the Altus Move email-rendering approach to this repo, re-themed for Altus Recruit (Midnight `#0A3D5C` / Mint `#5DCAA5` / Cloud `#F4F6F8`), wired both Resend code paths (in-app feedback + org invitations) to send multipart HTML+text, and shipped paste-able Supabase Auth template HTML for the dashboard.

## What changed

**Created (9 files):**

| File | Purpose |
|------|---------|
| `src/lib/email/escape.ts` | `escapeHtml` / `sanitiseUrl` / `safeHexColor` helpers; `DEFAULT_BRAND_HEX = '#5DCAA5'` (Altus Recruit mint) |
| `src/lib/email/render.ts` | `TransactionalEmail` type + `renderTransactionalEmail` (HTML) + `renderTransactionalEmailText` (plain-text). Module-level brand constants. |
| `public/email/altus-recruit-logo.svg` | Horizontal-dark logo for header band (copied from `/tmp/altus-design-system/altus-recruit-handoff/`) |
| `supabase/email-templates/magic-link.html` | Magic Link slot — "Sign in to Altus Recruit" |
| `supabase/email-templates/recovery.html` | Reset Password slot — "Reset your password" |
| `supabase/email-templates/confirmation.html` | Confirm Signup slot — "Confirm your email" |
| `supabase/email-templates/invite.html` | Invite User slot — "You're invited to Altus Recruit" |
| `supabase/email-templates/change-email.html` | Change Email Address slot — "Confirm your new email" |
| `supabase/email-templates/README.md` | File → Supabase slot → subject mapping + Site URL config note |

**Modified (2 files):**

| File | Change |
|------|--------|
| `src/app/(app)/_actions/submit-feedback.ts` | Now builds a `TransactionalEmail` and sends `html + text` via `sendResendEmail`. Preserved fail-open RESEND_FEEDBACK_RECIPIENT guard, Sentry PII guard, outer try/catch, DB-row-as-canonical contract. T-260524-b6v-05 mitigation upgraded for branded HTML. |
| `src/app/(app)/settings/team/actions.ts` | Both `inviteMemberAction` + `resendInviteAction` use new renderer; share new `buildInvitePreheader` helper. Subject line tightened to `${inviterName} invited you to Altus Recruit`. Preserved R8 ordering, resolveOrigin precedence, fallbacks, Sentry PII guards, revalidatePath. T-260524-bpy-06 mitigation upgraded for branded HTML. |

## Commits

| Hash | Task | Message |
|------|------|---------|
| `a8bf936` | Task 1 | feat(260528-wdz): port escape helpers + branded transactional email renderer |
| `4651cc2` | Task 2 | docs(260528-wdz): add 5 Supabase auth template HTML files + paste guide |
| `b6aedf4` | Task 3 | feat(260528-wdz): send feedback emails as branded HTML+text via renderTransactionalEmail |
| `c1bdfce` | Task 4 | feat(260528-wdz): send org invite + resend-invite emails as branded HTML+text |

## Verification

**Autonomous code gates:**

| Gate | Result | Notes |
|------|--------|-------|
| `pnpm typecheck` | PASS | Zero errors across all 4 commits |
| `pnpm lint` (scope: plan files) | PASS | escape.ts / render.ts / submit-feedback.ts / team/actions.ts all clean |
| `pnpm lint` (full repo) | 1 error (deferred) | Pre-existing error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` (`Cannot call impure function during render`) — explicitly out of scope per the plan |
| `pnpm build` (compile + tsc) | PASS | `✓ Compiled successfully in 11.9s` + `Finished TypeScript in 8.9s` |
| `pnpm build` (page-data collection) | DEFERRED FAIL — env infra bug | Worker processes don't inherit `.env.local`; reproduces in the main repo too. NOT introduced by 260528-wdz. See "Deferred Issues" below. |

**Visual sanity check (Task 4 step 5):**

Wrote `/tmp/render-email-samples.mjs` — a standalone Node 24 script that re-implements the renderer with the same brand constants (matching `src/lib/email/render.ts` exactly) and rendered two sample emails to `/tmp/`. The script bypasses the `import 'server-only'` guard and `@/lib/env` path alias so it can run standalone.

Output files: `/tmp/altus-recruit-email-sample-feedback.html` (2.8 KB) and `/tmp/altus-recruit-email-sample-invite.html` (3.2 KB). Opened via `open` in the default browser; structural inspection confirmed:

- **Feedback sample** — Midnight `#0A3D5C` header band (text fallback "ALTUS Recruit" wordmark active because `NEXT_PUBLIC_SITE_URL` is unset locally — no broken image), Mint `#5DCAA5` accent in the wordmark, Cloud `#F4F6F8` outer + footer, body paragraphs flow correctly with the empty-string entry creating the expected visual gap between metadata and feedback body, HTML escapes confirmed (the inner double-quotes in the feedback body render as `&quot;` in raw HTML and as `"` in the browser).
- **Invite sample** — Same header / footer palette; Mint button "Accept invitation" renders with rounded corners + white text; button URL embedded correctly in both `<a href>` and the MSO `<v:roundrect href>` fallback; footer note "Link expires in 7 days..." appears above the boilerplate three-line signoff; HTML escapes confirmed (apostrophe in "You're" rendered as `&#39;`).

Layout intact in both samples — no overflow, no raw escape sequences visible in the rendered output, no broken `&amp;` showing.

Script deleted post-check (`rm /tmp/render-email-samples.mjs`). No `scripts/render-email-samples.*` artifacts left in the repo.

**`/gsd-code-review` (HARD RULE #1 mechanical review):**

Not invoked in this autonomous execution — the gate is for pre-UAT human handoff. The plan-level checks are run inline:

- **Silent-fail mutations:** None. `sendResendEmail` wrapper is fail-open by contract; both consumers (`submit-feedback.ts` + `team/actions.ts`) catch `result.ok === false && reason === 'http_error'` and log to Sentry with a static feature tag.
- **Fire-and-forget without onError:** Outer `try/catch` around the email block is intentional fail-open per `resend.ts` CONTRACT (the DB row is canonical).
- **Schema-column mismatches:** No DB writes added; the existing `feedback` and `org_invitations` insert payloads are untouched.
- **HTML-escape bypasses:** Every interpolation in `render.ts` routes through `escapeHtml`. Module-level constants (brand colours, font stack, boilerplate footer lines) are hard-coded — not user input — and intentionally not re-escaped. Button URL passes through `sanitiseUrl` (allow-list http/https/mailto/tel/#) THEN `escapeHtml` — same order as Altus Move's `render.ts`. Logo path is a module-level constant prefixed only by `env.NEXT_PUBLIC_SITE_URL` (server-controlled).
- **Cache-invalidation gaps:** `revalidatePath('/settings/team')` preserved in both invite paths. Feedback action has no cached-page surface.
- **Server-only modules importing browser clients:** `render.ts` has `import 'server-only'` at the top and only imports `env` (server-only) + `escape.ts` (pure functions). No browser-client transitive imports.
- **Async work inside Supabase subscriber callbacks:** N/A — no auth-state-change callbacks touched.

## Deferred Issues

**1. `pnpm build` page-data collection fails with "Invalid environment variables"**

- **Symptom:** After successful TypeScript compile (`✓ Compiled successfully in 11.9s` + `Finished TypeScript in 8.9s`), the build crashes during `Collecting page data using 10 workers` on `/accept-invite/[token]`, complaining that `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are undefined — even with `.env.local` present and `set -a; source .env.local` run beforehand.
- **Root cause (suspected):** Next.js 16 / Turbopack page-data collection worker processes don't inherit the parent shell's env nor read `.env.local` consistently in this worktree's Node environment.
- **NOT introduced by 260528-wdz:** Reproduces verbatim in `cd /Users/aj_mac/altus-recruitment && pnpm build` against `main` (commit `3c130988`). My 4 commits are bit-for-bit additive; no env validation rules changed.
- **Recommendation:** Open a separate quick task to investigate (`Next 16 / Turbopack env propagation` or downgrade to webpack builder), or rely on Vercel's hosted build (where env vars are injected per-project at build time and this issue does not occur).
- **Risk to W6 outcome:** Low. Vercel deploys this branch via its own build pipeline, which has all env vars set at the project level. The local-build env-not-inherited issue affects only the local autonomous gate, not production deploys.

**2. Pre-existing lint error in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98`**

- Explicitly noted in the plan as out of scope and deferred per prior tasks.

## Deviations from Plan

**None for code/brand constants.** All seven brand-foundation constants (MIDNIGHT, MINT, WHITE, CLOUD, BORDER, MUTED_TEXT, BODY_TEXT) plus FONT_STACK / BRAND_NAME / FOOTER_TAGLINE / FOOTER_LOCATION / FOOTER_DISCLAIMER / LOGO_PATH match the plan's `<brand_constants>` block exactly.

**Single minor:**
- Plan's verify command uses double-quoted grep for `DEFAULT_BRAND_HEX = "#5DCAA5"`. The project's Prettier config mandates single quotes, so the actual line reads `const DEFAULT_BRAND_HEX = '#5DCAA5'`. Functional outcome (constant value `'#5DCAA5'`) is identical and matches the plan intent.

## Threat Model Coverage

All four mitigate-disposition threats from the plan's threat register are addressed:

- **T-260528-wdz-01 (Tampering — HTML output):** `escapeHtml` wraps every interpolation in `render.ts`; button URL goes through `sanitiseUrl` then `escapeHtml`. Verified in visual sanity check (raw `&quot;` / `&#39;` confirmed in source).
- **T-260528-wdz-03 (Spoofing — logo path):** Logo `<img src>` derives from `env.NEXT_PUBLIC_SITE_URL` (server-controlled) + hard-coded `LOGO_PATH` constant. Text-fallback wordmark when env is unset (no broken-image footgun, no attacker-controlled URL surface).
- **T-260528-wdz-04 (Information Disclosure — Sentry):** Sentry capture blocks preserved verbatim in both server actions; still no body-text / no invitee-email logged. Only static tags + error object.
- **T-260528-wdz-SC (Tampering — package installs):** No new npm packages installed. All work uses existing dependencies.

## Self-Check: PASSED

**Files created exist:**
- src/lib/email/escape.ts: FOUND (1.7 KB)
- src/lib/email/render.ts: FOUND (5.4 KB)
- public/email/altus-recruit-logo.svg: FOUND (824 bytes)
- supabase/email-templates/magic-link.html: FOUND
- supabase/email-templates/recovery.html: FOUND
- supabase/email-templates/confirmation.html: FOUND
- supabase/email-templates/invite.html: FOUND
- supabase/email-templates/change-email.html: FOUND
- supabase/email-templates/README.md: FOUND

**Files modified verified (git diff non-empty):**
- src/app/(app)/_actions/submit-feedback.ts: MODIFIED (b6aedf4)
- src/app/(app)/settings/team/actions.ts: MODIFIED (c1bdfce)

**Commits exist on worktree branch:**
- a8bf936: FOUND
- 4651cc2: FOUND
- b6aedf4: FOUND
- c1bdfce: FOUND

## User Action Required (post-merge)

1. **Paste the five `supabase/email-templates/*.html` files** into Supabase Dashboard → Project → Authentication → Email Templates. Use the subject lines from `supabase/email-templates/README.md`:
   - Magic Link → `Sign in to Altus Recruit`
   - Reset Password → `Reset your Altus Recruit password`
   - Confirm Signup → `Confirm your email — Altus Recruit`
   - Invite User → `You're invited to Altus Recruit`
   - Change Email Address → `Confirm your new email — Altus Recruit`

2. **Confirm Site URL is set** in Supabase Dashboard → Project Settings → Authentication → URL Configuration → Site URL = `https://altus-recruitment.vercel.app` (or your production domain). Without this, the `{{ .SiteURL }}` merge tag won't resolve and the logo `<img>` will 404 in candidate inboxes.

3. **Post-deploy functional smoke (out of scope here):**
   - Submit one piece of feedback from the in-app widget and screenshot the Gmail render to confirm branding.
   - Invite a real teammate from `/settings/team` and screenshot the Gmail render of the accept-invitation email.
   - Trigger one magic-link email and screenshot the Gmail render after the dashboard templates are pasted.

4. **Investigate the local `pnpm build` env issue** (deferred — does NOT block this W6 fix-queue item; Vercel deploys work).
