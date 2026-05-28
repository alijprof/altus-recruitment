---
phase: 260528-wdz-altus-recruit-branded-transactional-emai
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/email/escape.ts
  - src/lib/email/render.ts
  - public/email/altus-recruit-logo.svg
  - supabase/email-templates/magic-link.html
  - supabase/email-templates/recovery.html
  - supabase/email-templates/confirmation.html
  - supabase/email-templates/invite.html
  - supabase/email-templates/change-email.html
  - supabase/email-templates/README.md
  - src/app/(app)/_actions/submit-feedback.ts
  - src/app/(app)/settings/team/actions.ts
autonomous: true
requirements:
  - W6
must_haves:
  truths:
    - "Feedback emails sent from /feedback render with Altus Recruit branded HTML (Midnight header band + Mint button + Cloud footer) in Gmail/Apple Mail"
    - "Org invitation emails sent from /settings/team render with the same Altus Recruit branded HTML and include a working 'Accept invitation' button"
    - "Plain-text fallback is always set alongside the HTML body (multipart/alternative) so client-stripped/HTML-disabled views still read cleanly"
    - "All five Supabase Auth template HTML files exist and use {{ .ConfirmationURL }} / {{ .SiteURL }} merge tags ready for paste into the Supabase dashboard"
    - "Brand colours, font, and the logo path are defined as module-level constants in render.ts — a single edit anywhere in that file rebrands every outbound email"
    - "Untrusted strings (inviter name, org name, feedback body) are HTML-escaped before interpolation; button URLs go through sanitiseUrl then escapeHtml"
    - "When NEXT_PUBLIC_SITE_URL is unset, the header degrades to a text 'ALTUS Recruit' wordmark instead of a broken-image icon"
  artifacts:
    - path: "src/lib/email/escape.ts"
      provides: "Pure escapeHtml / sanitiseUrl / safeHexColor helpers — Altus Recruit brand-default hex"
      exports: ["escapeHtml", "sanitiseUrl", "safeHexColor"]
    - path: "src/lib/email/render.ts"
      provides: "renderTransactionalEmail + renderTransactionalEmailText for Altus Recruit branded transactional sends"
      exports: ["TransactionalEmail", "renderTransactionalEmail", "renderTransactionalEmailText"]
    - path: "public/email/altus-recruit-logo.svg"
      provides: "Altus Recruit horizontal-dark logo served by Vercel for <img src> in branded emails"
    - path: "supabase/email-templates/magic-link.html"
      provides: "Paste-able Supabase Magic Link auth template"
      contains: "{{ .ConfirmationURL }}"
    - path: "supabase/email-templates/recovery.html"
      provides: "Paste-able Supabase Reset Password auth template"
      contains: "{{ .ConfirmationURL }}"
    - path: "supabase/email-templates/confirmation.html"
      provides: "Paste-able Supabase Confirm Signup auth template"
      contains: "{{ .ConfirmationURL }}"
    - path: "supabase/email-templates/invite.html"
      provides: "Paste-able Supabase Invite User auth template"
      contains: "{{ .ConfirmationURL }}"
    - path: "supabase/email-templates/change-email.html"
      provides: "Paste-able Supabase Change Email auth template"
      contains: "{{ .ConfirmationURL }}"
    - path: "supabase/email-templates/README.md"
      provides: "Operator paste-into-dashboard guide + subject lines + Site URL note"
    - path: "src/app/(app)/_actions/submit-feedback.ts"
      provides: "Feedback action sends HTML+text via renderTransactionalEmail/Text"
    - path: "src/app/(app)/settings/team/actions.ts"
      provides: "inviteMemberAction + resendInviteAction send HTML+text via renderTransactionalEmail/Text"
  key_links:
    - from: "src/app/(app)/_actions/submit-feedback.ts"
      to: "src/lib/email/render.ts"
      via: "renderTransactionalEmail + renderTransactionalEmailText import"
      pattern: "renderTransactionalEmail"
    - from: "src/app/(app)/settings/team/actions.ts"
      to: "src/lib/email/render.ts"
      via: "renderTransactionalEmail + renderTransactionalEmailText import"
      pattern: "renderTransactionalEmail"
    - from: "src/lib/email/render.ts"
      to: "src/lib/email/escape.ts"
      via: "escapeHtml + sanitiseUrl import"
      pattern: "from './escape'"
    - from: "src/lib/email/render.ts"
      to: "public/email/altus-recruit-logo.svg"
      via: "img src built from env.NEXT_PUBLIC_SITE_URL + /email/altus-recruit-logo.svg"
      pattern: "/email/altus-recruit-logo.svg"
    - from: "supabase/email-templates/*.html"
      to: "public/email/altus-recruit-logo.svg"
      via: "{{ .SiteURL }}/email/altus-recruit-logo.svg merge-tag"
      pattern: "{{ .SiteURL }}/email/altus-recruit-logo.svg"
---

<objective>
Port the Altus Move email-rendering approach to this repo, brand it for Altus Recruit (Midnight `#0A3D5C` / Mint `#5DCAA5` / Cloud `#F4F6F8` / system font stack), then wire the two existing Resend code paths (in-app feedback + org invitations) to send HTML+text instead of text-only. Ship paste-able Supabase Auth template HTML for the dashboard so all auth emails (magic link, recovery, confirmation, invite, change-email) also become branded.

Purpose: Resolves UAT fix-queue item W6 (2026-05-28 run) — emails currently arrive as default unstyled Resend payloads. This makes feedback, invites, and Supabase auth emails brand-consistent for the anchor customer's UAT.

Output: Two new pure modules (`escape.ts` + `render.ts`), one static logo asset, five Supabase template HTML files, a README guide, and rewires of `submit-feedback.ts` + `inviteMemberAction` + `resendInviteAction`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/lib/email/resend.ts
@src/lib/env.ts
@src/app/(app)/_actions/submit-feedback.ts
@src/app/(app)/settings/team/actions.ts

# Reference implementations (READ as inspiration — DO NOT copy verbatim, adapt to Altus Recruit colour palette + simpler TransactionalEmail input shape)
@/Users/aj_mac/altus-move/src/lib/email/escape.ts
@/Users/aj_mac/altus-move/src/lib/email/render.ts

# Brand source
@/tmp/altus-design-system/altus-recruit-handoff/handoff.md

<interfaces>
<!-- Contracts the executor will create + consume. Embedded so no codebase scavenger hunt is needed. -->

NEW EXPORT from src/lib/email/escape.ts:
```ts
export function escapeHtml(s: string | null | undefined): string
export function sanitiseUrl(rawUrl: string | null | undefined): string  // allow-list: http(s), mailto, tel, '#'
export function safeHexColor(raw: string | null | undefined, fallback?: string): string
// Module-level: const DEFAULT_BRAND_HEX = '#5DCAA5'  // Altus Recruit mint
```

NEW EXPORT from src/lib/email/render.ts:
```ts
export type TransactionalEmail = {
  preheader: string                          // inbox preview snippet (<90 chars), HTML-escaped
  heading: string                            // H1, HTML-escaped
  paragraphs: string[]                       // each becomes <p>, each HTML-escaped
  button?: { label: string; url: string }   // optional CTA
  footerNote?: string                        // optional small note above boilerplate signoff
}
export function renderTransactionalEmail(input: TransactionalEmail): string          // full <!DOCTYPE html> document
export function renderTransactionalEmailText(input: TransactionalEmail): string      // plain-text companion
```

EXISTING (DO NOT MODIFY) src/lib/email/resend.ts:
```ts
export type ResendSendInput = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
}
export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'no_api_key' }
  | { ok: false; reason: 'http_error'; status?: number; message?: string }
export async function sendResendEmail(input: ResendSendInput): Promise<ResendSendResult>
```

EXISTING env keys consumed (DO NOT add new ones):
- env.NEXT_PUBLIC_SITE_URL (optional) — used to build absolute logo src in render.ts. When unset, render.ts MUST degrade to a text-only ALTUS Recruit wordmark in the header band (no broken image).
- env.RESEND_FEEDBACK_RECIPIENT (optional) — feedback action's send target; fail-open if unset (existing behaviour, preserve).
</interfaces>

<brand_constants>
<!-- Hard-coded constants in src/lib/email/render.ts. Mirror EXACTLY into supabase/email-templates/*.html static HTML. -->
const MIDNIGHT       = '#0A3D5C'   // header band background, primary heading
const MINT           = '#5DCAA5'   // button bg, link colour, accent
const WHITE          = '#FFFFFF'   // body background
const CLOUD          = '#F4F6F8'   // outer page bg + footer bg
const BORDER         = '#E5E7EB'   // divider lines
const MUTED_TEXT     = '#6B7280'   // footer body text
const BODY_TEXT      = '#1A1A1A'   // paragraph copy

const FONT_STACK     = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const BRAND_NAME     = 'ALTUS Recruit'                                              // for text-fallback header + footer line 1
const FOOTER_TAGLINE = 'Altus Recruit — AI-powered recruitment CRM'
const FOOTER_LOCATION = 'Built in the UK'
const FOOTER_DISCLAIMER = "If you weren't expecting this email, you can safely ignore it."
const LOGO_PATH      = '/email/altus-recruit-logo.svg'
</brand_constants>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Port escape.ts + build render.ts + drop in logo asset</name>
  <files>src/lib/email/escape.ts, src/lib/email/render.ts, public/email/altus-recruit-logo.svg</files>
  <action>
1) Create src/lib/email/escape.ts by porting /Users/aj_mac/altus-move/src/lib/email/escape.ts verbatim with two surgical edits: replace the `DEFAULT_BRAND_HEX = "#0F6E56"` constant with `DEFAULT_BRAND_HEX = "#5DCAA5"` (Altus Recruit mint), and replace the top-of-file "Wave 3b" comment block with a one-line provenance comment referencing this task: "Quick task 260528-wdz (W6 fix-queue item): HTML escape, URL allow-list, hex-colour validator used by branded transactional email renderer.". All three exports (`escapeHtml`, `sanitiseUrl`, `safeHexColor`) keep their existing signatures and logic. This file has no side effects, no React imports, and is safe to import from both server actions and (later) Inngest functions.

2) Create src/lib/email/render.ts implementing the TransactionalEmail contract documented in <interfaces>. Module structure:

   - Top of file: `import 'server-only'` (defence — render.ts reads env.NEXT_PUBLIC_SITE_URL via @/lib/env which is server-only)
   - `import { env } from '@/lib/env'`
   - `import { escapeHtml, sanitiseUrl } from './escape'`
   - Module-level brand constants from <brand_constants> above (MIDNIGHT, MINT, WHITE, CLOUD, BORDER, MUTED_TEXT, BODY_TEXT, FONT_STACK, BRAND_NAME, FOOTER_TAGLINE, FOOTER_LOCATION, FOOTER_DISCLAIMER, LOGO_PATH).
   - Exported type `TransactionalEmail` (4 required + 2 optional fields per the interfaces block).
   - Exported function `renderTransactionalEmail(input)` — composes the HTML body fragments (heading + paragraphs + optional button + optional footerNote) then calls private `renderEmailShell(bodyHtml, preheader)` to wrap in the full document.
   - Exported function `renderTransactionalEmailText(input)` — plain-text companion.
   - Private function `renderEmailShell(bodyHtml: string, preheader: string): string` returning the full <!DOCTYPE html> document.

Shell HTML rules (mirror Altus Move verify-email.html aesthetic, swap colours to Altus Recruit):
- Hidden preheader: `<div style="display:none;overflow:hidden;line-height:1;opacity:0;max-height:0;max-width:0">${escapeHtml(preheader)}</div>` immediately inside <body>.
- Outer table: width 100%, background:${CLOUD}. Inner table: max-width:600px, padding:32px 16px on outer cell.
- Header band: `<td style="background:${MIDNIGHT};padding:32px 32px;border-radius:8px 8px 0 0">`. If `env.NEXT_PUBLIC_SITE_URL` is a non-empty string, emit `<img src="${escapeHtml(env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '') + LOGO_PATH)}" alt="Altus Recruit" height="40" style="height:40px;width:auto;display:block;border:0">`. If `env.NEXT_PUBLIC_SITE_URL` is unset/empty, fall back to text wordmark: `<span style="font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${WHITE}">ALTUS</span> <span style="font-size:20px;font-weight:500;color:${MINT}">Recruit</span>` (NO broken image).
- White body: `<td style="background:${WHITE};padding:40px 32px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER}">`. H1: `<h1 style="margin:0 0 16px;font-size:24px;font-weight:600;color:${MIDNIGHT};line-height:1.3">${escapeHtml(input.heading)}</h1>`. Each paragraph: `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BODY_TEXT}">${escapeHtml(p)}</p>`. Empty-string paragraphs render as a `<p>&nbsp;</p>` for visual spacing.
- Button (when present): mirror Move's <table> button pattern with MSO conditional comment for Outlook desktop padding. Background ${MINT}, color ${WHITE}, padding 14px 28px, border-radius 8px, font-weight 600, font-size 15px, text-decoration:none. `target="_blank" rel="noopener noreferrer"`. URL: `escapeHtml(sanitiseUrl(input.button.url))` (sanitise THEN escape — same order as Move render.ts). Label: `escapeHtml(input.button.label)`.
- Footer: `<td style="background:${CLOUD};padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid ${BORDER};border-top:none">`. If input.footerNote: emit `<p style="margin:0 0 14px;font-size:13px;color:${BODY_TEXT};line-height:1.5">${escapeHtml(input.footerNote)}</p>` (above boilerplate). Then boilerplate three lines: `<p style="margin:0 0 6px;font-size:12px;color:${MUTED_TEXT};line-height:1.5">${FOOTER_TAGLINE}</p><p style="margin:0 0 6px;font-size:12px;color:${MUTED_TEXT};line-height:1.5">${FOOTER_LOCATION}</p><p style="margin:0;font-size:12px;color:${MUTED_TEXT};line-height:1.5">${FOOTER_DISCLAIMER}</p>`. The three boilerplate strings are HARD-CODED constants (not user input) — no escapeHtml needed but harmless if you wrap them.
- `<html lang="en">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width,initial-scale=1">`, `<title>${escapeHtml(input.heading)}</title>`.
- Body element: `<body style="margin:0;padding:0;background:${CLOUD};font-family:${FONT_STACK}">`.

renderTransactionalEmailText(input) shape:
- No preheader.
- Line 1: `input.heading`
- Blank line
- input.paragraphs joined with `\n\n` (preserve order; empty strings stay as blank paragraphs)
- If input.button: blank line + `${input.button.label}: ${sanitiseUrl(input.button.url)}`
- If input.footerNote: blank line + input.footerNote
- Blank line + `${FOOTER_TAGLINE}` + `\n${FOOTER_LOCATION}` + `\n${FOOTER_DISCLAIMER}`
- Plain text fields not HTML-escaped (text/plain has no XSS surface). URL still sanitised.

3) Copy /tmp/altus-design-system/altus-recruit-handoff/altus-recruit-horizontal-dark.svg to /Users/aj_mac/altus-recruitment/public/email/altus-recruit-logo.svg. Create the public/email/ directory first if needed (it does not currently exist). Use `mkdir -p public/email && cp /tmp/altus-design-system/altus-recruit-handoff/altus-recruit-horizontal-dark.svg public/email/altus-recruit-logo.svg`. Verify the copy succeeded with `ls -la public/email/altus-recruit-logo.svg` showing a non-zero file size.

Do NOT install any new npm packages. Do NOT modify src/lib/email/resend.ts. Do NOT touch src/lib/env.ts.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint --max-warnings=10 -- src/lib/email/escape.ts src/lib/email/render.ts && test -s public/email/altus-recruit-logo.svg && grep -q "5DCAA5" src/lib/email/render.ts && grep -q "0A3D5C" src/lib/email/render.ts && grep -q "DEFAULT_BRAND_HEX = \"#5DCAA5\"" src/lib/email/escape.ts && grep -q "renderTransactionalEmail" src/lib/email/render.ts && grep -q "renderTransactionalEmailText" src/lib/email/render.ts</automated>
  </verify>
  <done>escape.ts ports cleanly with Altus Recruit mint as default brand hex; render.ts exports TransactionalEmail + renderTransactionalEmail + renderTransactionalEmailText with all colours as module-level constants; logo SVG sits at public/email/altus-recruit-logo.svg; pnpm typecheck + lint pass.</done>
</task>

<task type="auto">
  <name>Task 2: Author 5 Supabase Auth template HTML files + dashboard README</name>
  <files>supabase/email-templates/magic-link.html, supabase/email-templates/recovery.html, supabase/email-templates/confirmation.html, supabase/email-templates/invite.html, supabase/email-templates/change-email.html, supabase/email-templates/README.md</files>
  <action>
Create the supabase/email-templates/ directory (it does not currently exist). Then write FIVE static HTML documents using the SAME shell structure produced by `renderEmailShell` in src/lib/email/render.ts (same Midnight `#0A3D5C` header band, Mint `#5DCAA5` button, Cloud `#F4F6F8` outer + footer, BODY_TEXT `#1A1A1A`, MUTED_TEXT `#6B7280`, BORDER `#E5E7EB`, system FONT_STACK). The difference from render.ts output: these files use Supabase merge tags instead of resolved values. Specifically:

- Logo `<img src>` becomes `{{ .SiteURL }}/email/altus-recruit-logo.svg` (NOT env.NEXT_PUBLIC_SITE_URL). Keep the same `alt="Altus Recruit"`, height=40, style. No text-fallback branch needed because operators MUST set Supabase Project → URL Configuration → Site URL — note this in README.md instead.
- Button href becomes `{{ .ConfirmationURL }}`.
- Below the button, emit a "paste this link" fallback paragraph: `<p style="margin:16px 0 0;font-size:12px;color:#6B7280;line-height:1.5;word-break:break-all">If the button doesn't work, paste this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#5DCAA5">{{ .ConfirmationURL }}</a></p>`. Place this INSIDE the white body cell, after the button table.

Per-file content:

magic-link.html
- preheader: "Tap to sign in to Altus Recruit. The link is good for 60 minutes."
- heading: "Sign in to Altus Recruit"
- paragraph: "Tap the button below to sign in. The link is good for 60 minutes."
- button label: "Sign in"
- footer note (above boilerplate, 13px BODY_TEXT): "If you didn't request this, you can ignore this email."

recovery.html
- preheader: "Reset your password on Altus Recruit. Link expires in 60 minutes."
- heading: "Reset your password"
- paragraph: "Tap the button below to set a new password. The link is good for 60 minutes."
- button label: "Reset password"
- footer note: "If you didn't request this, you can ignore this email."

confirmation.html
- preheader: "Welcome to Altus Recruit — confirm your email to finish setting up."
- heading: "Confirm your email"
- paragraph: "Welcome to Altus Recruit. Tap the button below to finish setting up your account."
- button label: "Confirm email"
- footer note: "If you didn't sign up, you can ignore this email."

invite.html (Supabase's NATIVE invite slot — distinct from our org-invite flow)
- preheader: "You've been invited to Altus Recruit. Tap to accept."
- heading: "You're invited to Altus Recruit"
- paragraph: "Tap the button below to accept the invitation and create your account."
- button label: "Accept invitation"
- footer note: "Link expires soon. If you weren't expecting this, you can ignore it."

change-email.html
- preheader: "Confirm your new email address on Altus Recruit."
- heading: "Confirm your new email"
- paragraph: "Tap the button below to confirm your new email address on Altus Recruit."
- button label: "Confirm new email"
- footer note: "If you didn't request this, you can ignore this email."

All five files MUST share the same shell structure. Recommended: write the shell once mentally with a `{{HEADING}}`/`{{PARAGRAPH}}`/`{{BUTTON_LABEL}}`/`{{PREHEADER}}`/`{{FOOTER_NOTE}}` placeholder pattern in your head, then emit five concrete files where those are filled in. Boilerplate footer three lines ("Altus Recruit — AI-powered recruitment CRM" / "Built in the UK" / "If you weren't expecting this email, you can safely ignore it.") match render.ts EXACTLY.

Also create supabase/email-templates/README.md with:
1. H1: "Supabase Auth email templates — Altus Recruit"
2. One-paragraph intro: "These HTML files are paste-able into Supabase Dashboard → Project → Authentication → Email Templates. Each file matches one of Supabase's auth email slots; the table below maps them and gives suggested subjects."
3. A markdown table with columns: File | Supabase slot | Suggested Subject — with rows:
   - magic-link.html | Magic Link | Sign in to Altus Recruit
   - recovery.html | Reset Password | Reset your Altus Recruit password
   - confirmation.html | Confirm Signup | Confirm your email — Altus Recruit
   - invite.html | Invite User | You're invited to Altus Recruit
   - change-email.html | Change Email Address | Confirm your new email — Altus Recruit
4. H2 "Required Supabase config": "Set Project Settings → Authentication → URL Configuration → Site URL to `https://altus-recruitment.vercel.app` (or your custom domain). The `{{ .SiteURL }}` merge tag in each template resolves to this — without it, the logo `<img>` will 404 and Gmail will show a broken-image placeholder."
5. H2 "Logo asset": "These templates assume `public/email/altus-recruit-logo.svg` exists on the deployed site. The repo ships this file in `public/email/`. Vercel serves it at `${SITE_URL}/email/altus-recruit-logo.svg` automatically."
6. H2 "Why static HTML and not the renderer?": one paragraph explaining Supabase Auth templates are edited in the Supabase dashboard (not rendered by our server), so we ship paste-able HTML that mirrors the live renderer's output. Cross-reference: "If you change brand colours, the source of truth is `src/lib/email/render.ts` — update these files manually to match. See the BRAND constants at the top of render.ts."

Do NOT add automation that rewrites these files from render.ts (out of scope). Do NOT commit them in a way that hooks into Supabase deploy — they are operator-paste artifacts only.
  </action>
  <verify>
    <automated>test -d supabase/email-templates && ls supabase/email-templates/magic-link.html supabase/email-templates/recovery.html supabase/email-templates/confirmation.html supabase/email-templates/invite.html supabase/email-templates/change-email.html supabase/email-templates/README.md && for f in supabase/email-templates/*.html; do grep -q "{{ .ConfirmationURL }}" "$f" && grep -q "5DCAA5" "$f" && grep -q "0A3D5C" "$f" && grep -q "{{ .SiteURL }}/email/altus-recruit-logo.svg" "$f" || { echo "FAIL: $f"; exit 1; }; done && grep -q "Sign in to Altus Recruit" supabase/email-templates/README.md</automated>
  </verify>
  <done>Five HTML files exist with Altus Recruit branding, all contain the Supabase merge tags ({{ .ConfirmationURL }} and {{ .SiteURL }}), all share the same shell structure; README.md maps file→Supabase-slot→subject and documents the Site URL requirement.</done>
</task>

<task type="auto">
  <name>Task 3: Rewire submit-feedback.ts to send HTML+text via renderTransactionalEmail</name>
  <files>src/app/(app)/_actions/submit-feedback.ts</files>
  <action>
Modify the email-send try-block (currently lines ~90-147) in src/app/(app)/_actions/submit-feedback.ts:

1) Add a named import at top of file alongside the existing `sendResendEmail` import: `import { renderTransactionalEmail, renderTransactionalEmailText, type TransactionalEmail } from '@/lib/email/render'`.

2) Replace the `const text = [...].join('\n')` construction with a TransactionalEmail object. Specifically, build `emailInput: TransactionalEmail` after computing `fullName`, `userEmail`, `orgName`, `pageUrl`:

   - `preheader: \`New feedback from ${fullName} (${orgName ?? 'unknown org'})\`` (raw — the renderer escapes; renderer also escapes in plain text? NO — plain text fields aren't escaped, but preheader is HTML-only so escaping inside renderTransactionalEmail handles it).
   - `heading: 'New feedback'`
   - `paragraphs:` array built as: `[\`From: ${fullName} <${userEmail}>\`, \`Org: ${orgName ?? '(unknown)'}\`, \`Page: ${pageUrl}\`, '', ...parsed.data.body.split('\\n')]`. Note: keep the empty-string entry between metadata and body — that creates a visual gap. Consecutive `\n`s in user input naturally yield empty strings in the array; do NOT filter them (they preserve paragraph spacing in the rendered email).
   - NO button.
   - NO footerNote.

3) Then call:
```ts
const html = renderTransactionalEmail(emailInput)
const text = renderTransactionalEmailText(emailInput)
const result = await sendResendEmail({
  to: env.RESEND_FEEDBACK_RECIPIENT,
  subject: `Altus feedback — ${orgName ?? 'unknown org'}`,
  html,
  text,
})
```

4) Preserve EVERYTHING else in the try-block: the `if (!env.RESEND_FEEDBACK_RECIPIENT)` fail-open guard + `Sentry.captureMessage('resend_send_skipped', ...)` branch, the `if (!result.ok && result.reason === 'http_error')` Sentry capture, the outer `try/catch` around the email block, the PII comment "Plaintext only — never populate `html` with user-controlled strings." → REPLACE this comment with: "HTML payload is safe: every interpolated field (fullName, orgName, userEmail, pageUrl, parsed.data.body) passes through escapeHtml inside renderTransactionalEmail. T-260524-b6v-05 mitigation upgraded for branded HTML (260528-wdz)."

5) Update the file's header comment block (lines 1-13) to add a one-line note: "260528-wdz: emails now sent as multipart HTML+text via renderTransactionalEmail. HTML interpolation safety guaranteed by escapeHtml inside the renderer."

Do NOT change the zod schema. Do NOT change the function signature or return shape. Do NOT touch the DB insert path. Do NOT log feedback body text to Sentry.
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint --max-warnings=10 -- "src/app/(app)/_actions/submit-feedback.ts" && grep -q "renderTransactionalEmail" "src/app/(app)/_actions/submit-feedback.ts" && grep -q "renderTransactionalEmailText" "src/app/(app)/_actions/submit-feedback.ts" && grep -q "html," "src/app/(app)/_actions/submit-feedback.ts" && grep -q "text," "src/app/(app)/_actions/submit-feedback.ts"</automated>
  </verify>
  <done>submit-feedback.ts imports renderTransactionalEmail + renderTransactionalEmailText, builds a TransactionalEmail input with preheader/heading/paragraphs derived from profile + form data, passes both html + text to sendResendEmail; fail-open guard preserved; Sentry PII guard preserved; pnpm typecheck + lint pass.</done>
</task>

<task type="auto">
  <name>Task 4: Rewire team/actions.ts (invite + resend) to send HTML+text + visual sanity verify</name>
  <files>src/app/(app)/settings/team/actions.ts</files>
  <action>
Modify BOTH `inviteMemberAction` (lines ~68-189) AND `resendInviteAction` (lines ~237-355) in src/app/(app)/settings/team/actions.ts. Both share the same email-build pattern — apply identical changes to both.

1) Add import alongside existing `sendResendEmail` import: `import { renderTransactionalEmail, renderTransactionalEmailText, type TransactionalEmail } from '@/lib/email/render'`.

2) For each function, locate the email-build block (currently a `const text = [...].join('\n')` builder followed by a `sendResendEmail({ ..., text })` call). Replace with:

   a) Inline preheader helper (define once at module-scope, BEFORE inviteMemberAction): `function buildInvitePreheader(inviterName: string, orgName: string): string { const raw = \`${inviterName} invited you to ${orgName} on Altus Recruit\`; return raw.length > 90 ? raw.slice(0, 89) + '…' : raw }`. Place this function above inviteMemberAction, after the existing `resolveOrigin` helper.

   b) Inside each action, after computing `inviterName`, `orgName`, `acceptUrl`, build:
   ```ts
   const emailInput: TransactionalEmail = {
     preheader: buildInvitePreheader(inviterName, orgName),
     heading: `You're invited to ${orgName}`,
     paragraphs: [`${inviterName} invited you to join their team on Altus Recruit — the AI-first recruitment CRM.`],
     button: { label: 'Accept invitation', url: acceptUrl },
     footerNote: "Link expires in 7 days. If you weren't expecting this, you can ignore it.",
   }
   const html = renderTransactionalEmail(emailInput)
   const text = renderTransactionalEmailText(emailInput)
   ```

   c) Replace the `sendResendEmail({ to: ..., subject: ..., text })` call with:
   ```ts
   const result = await sendResendEmail({
     to: inserted.email, // or existing.email in resendInviteAction — match existing code
     subject: `${inviterName} invited you to Altus Recruit`,  // tightened: drop the trailing " on " + orgName per task_spec
     html,
     text,
   })
   ```

3) Preserve EVERYTHING else: the `resolveOrigin()` call + null-handling, the org-name fallback (`orgName = org?.name ?? 'their team'`), the `inviterName` fallback chain (`me.full_name?.trim() || me.email || 'A teammate'`), the Sentry `resend_send_failed` capture with `tags: { feature: 'invitations', step: 'resend' }`, the outer `try/catch` around the email block, the `revalidatePath('/settings/team')` calls, the existing security comments (R8 ordering, T-260524-bpy-06 mitigation reference).

4) Update the T-260524-bpy-06 mitigation comment near the plaintext line (currently "Plaintext only — never populate `html` with user-controlled strings"). Replace with: "HTML payload is safe: inviterName + orgName + acceptUrl pass through escapeHtml/sanitiseUrl inside renderTransactionalEmail. T-260524-bpy-06 mitigation upgraded for branded HTML (260528-wdz)."

5) Visual sanity check (do this AFTER the code changes above land and pnpm typecheck passes):

   a) Write a small temporary script `scripts/render-email-samples.mjs` (or .ts if `tsx` is available — check with `which tsx || pnpm dlx tsx --version 2>/dev/null`). If `tsx` works, write TypeScript that imports `renderTransactionalEmail` + `renderTransactionalEmailText` from `../src/lib/email/render` and produces two sample emails:

      - Sample 1 (feedback): preheader "New feedback from Jane Smith (Anchor Recruitment)", heading "New feedback", paragraphs `['From: Jane Smith <jane@example.com>', 'Org: Anchor Recruitment', 'Page: https://altus-recruitment.vercel.app/candidates/123', '', 'The candidate filter is great but the date range picker resets when I click "Save".', 'Repro:', '1. Open filters', '2. Pick a date range', '3. Click Save', '4. Filters reset']`. No button. No footerNote.

      - Sample 2 (invite): preheader "Jane Smith invited you to Anchor Recruitment on Altus Recruit", heading "You're invited to Anchor Recruitment", paragraphs ["Jane Smith invited you to join their team on Altus Recruit — the AI-first recruitment CRM."], button { label: "Accept invitation", url: "https://altus-recruitment.vercel.app/accept-invite/abc-def-ghi" }, footerNote: "Link expires in 7 days. If you weren't expecting this, you can ignore it."

      Write each rendered HTML output to `/tmp/altus-recruit-email-sample-feedback.html` and `/tmp/altus-recruit-email-sample-invite.html`. Run the script: `pnpm dlx tsx scripts/render-email-samples.ts` (or equivalent).

   b) If tsx is not installable / takes too long, FALL BACK to: write a `.mjs` script that hard-codes the rendered HTML output by literally calling the renderer via a node-side ESM import. If even that is faff, FALL BACK further to: simply trust the per-Task type-checked output and skip the visual sample (this is acceptable — the in-prod UAT visual check will catch any rendering regression). Document the chosen approach in the final commit message.

   c) If samples were rendered, open both files (`open /tmp/altus-recruit-email-sample-feedback.html /tmp/altus-recruit-email-sample-invite.html`) and visually confirm:
      - Header band is Midnight (#0A3D5C); since NEXT_PUBLIC_SITE_URL is unset in dev, expect the text fallback "ALTUS Recruit" wordmark (NOT a broken image icon).
      - Button (invite sample) is Mint (#5DCAA5) with white text, rounded corners.
      - Footer is Cloud (#F4F6F8) with grey muted text.
      - No raw `&amp;` or `&lt;` showing in the rendered output (they should appear as `&` / `<` after browser decode).
      - Layout doesn't break — paragraphs flow, button doesn't overflow.

   d) DELETE the temporary script (`rm scripts/render-email-samples.*`) after verification. Do NOT commit it. The scripts/ directory may or may not exist — if you create it, also remove the empty dir on cleanup.

6) Run the full autonomous gate: `pnpm typecheck && pnpm lint && pnpm build`. The pre-existing lint warning in `src/app/(app)/candidates/[id]/cv-review-panel.tsx:98` may still exist — that's deferred per prior tasks and not in this plan's `files_modified`. The `pnpm build` step is REQUIRED (260525-ucn lesson: tsc misses production-build issues; email modules are pure server-only so build should pass cleanly).
  </action>
  <verify>
    <automated>pnpm typecheck && pnpm lint --max-warnings=15 -- "src/app/(app)/settings/team/actions.ts" && pnpm build && grep -q "renderTransactionalEmail" "src/app/(app)/settings/team/actions.ts" && grep -q "renderTransactionalEmailText" "src/app/(app)/settings/team/actions.ts" && grep -q "buildInvitePreheader" "src/app/(app)/settings/team/actions.ts" && grep -c "html," "src/app/(app)/settings/team/actions.ts" | awk '$1 >= 2 { exit 0 } { exit 1 }' && grep -c "text," "src/app/(app)/settings/team/actions.ts" | awk '$1 >= 2 { exit 0 } { exit 1 }' && ! ls scripts/render-email-samples.* 2>/dev/null</automated>
  </verify>
  <done>Both inviteMemberAction and resendInviteAction import renderTransactionalEmail + renderTransactionalEmailText, share a buildInvitePreheader helper at module scope, build a TransactionalEmail with heading/paragraphs/button/footerNote, send html + text via sendResendEmail with tightened subject line; Sentry PII guards preserved; R8 ordering preserved; visual sanity check completed (or documented skip); temp scripts removed; pnpm typecheck + lint + build all pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user→server action input | Feedback body text + invitee email arrive from authenticated browser; both are user-controlled |
| org member→email recipient | inviterName + orgName are operator-controlled strings interpolated into outbound HTML |
| server action→Resend HTTP | HTML body sent to a third-party SaaS — could be logged in their dashboard |
| operator dashboard→Supabase Auth templates | HTML pasted into Supabase admin UI is sent unchanged to candidate inboxes |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260528-wdz-01 | Tampering | renderTransactionalEmail HTML output | mitigate | All interpolated strings (heading, paragraphs, preheader, footerNote, button label) pass through escapeHtml inside renderTransactionalEmail before insertion. Button URL passes through sanitiseUrl (http/https/mailto/tel/# allow-list) THEN escapeHtml for attribute safety — same order as Move's render.ts. Upgrades the existing T-260524-b6v-05 / T-260524-bpy-06 plaintext-only mitigation to safe-HTML-interpolation. |
| T-260528-wdz-02 | Information Disclosure | Supabase template HTML in repo | accept | The five supabase/email-templates/*.html files contain only Supabase merge tags ({{ .ConfirmationURL }} / {{ .SiteURL }}) — no real tokens or secrets. They are paste-into-dashboard artifacts. Public repo exposure is acceptable. |
| T-260528-wdz-03 | Spoofing | Logo asset path | mitigate | The `<img src>` uses env.NEXT_PUBLIC_SITE_URL (server-controlled at deploy time) + a hard-coded path constant LOGO_PATH. Cannot be spoofed by user input. When NEXT_PUBLIC_SITE_URL is unset, renderer degrades to text wordmark — no broken image, no attacker-controlled fallback URL. |
| T-260528-wdz-04 | Information Disclosure | Sentry PII guard | mitigate | submit-feedback.ts Sentry capture remains body-text-free (only tags + error object). team/actions.ts Sentry capture remains invitee-email-free. Same guards as the existing code paths — preserved verbatim, just wrapping new HTML+text payload. |
| T-260528-wdz-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed. All work uses existing dependencies (`server-only` already present, `@/lib/env` already present, escapeHtml is a pure 5-line function). Package legitimacy audit not required. |
| T-260528-wdz-05 | Denial of Service | sendResendEmail call | accept | Existing fail-open pattern preserved: missing env.RESEND_API_KEY returns ok:false without throwing; missing env.RESEND_FEEDBACK_RECIPIENT skips with a Sentry warning; DB row is canonical. No new failure surface introduced by switching from text-only to html+text. |
| T-260528-wdz-06 | Tampering | Supabase merge-tag injection | accept | {{ .ConfirmationURL }} resolved by Supabase server-side — they are responsible for safely interpolating into our HTML. We treat their output as trusted infrastructure. The static HTML files quote the merge tags in `href=""` and visible text in identical form to the Move repo's verify-email.html (which has shipped to candidates without incident). |
</threat_model>

<verification>
**Autonomous code gates (REQUIRED — run after Task 4):**
- `pnpm typecheck` passes with zero new errors
- `pnpm lint` passes (pre-existing warning in candidates/[id]/cv-review-panel.tsx:98 is deferred and not in this plan's scope — ignore)
- `pnpm build` passes (catches production-build issues that tsc misses, per 260525-ucn lesson)

**Mechanical review gate (REQUIRED per HARD RULE #1):**
- Run `/gsd-code-review` against the four code files in this plan:
  - src/lib/email/escape.ts
  - src/lib/email/render.ts
  - src/app/(app)/_actions/submit-feedback.ts
  - src/app/(app)/settings/team/actions.ts
- Specifically look for: silent-fail mutations (none expected — sendResendEmail wrapper never throws); fire-and-forget mutations missing onError (the outer try/catch is intentional fail-open per resend.ts CONTRACT); schema-column mismatches (no DB writes in this plan); HTML-escape bypasses (every interpolation should route through escapeHtml or be a hard-coded module constant).

**Visual sanity (CONDITIONAL — see Task 4 step 5):**
- If sample HTML files were rendered to /tmp, both samples open in a browser with Midnight header band (or text wordmark fallback), Mint button (invite only), Cloud footer, no raw escape sequences visible.
- If tsx setup was too faff and samples were skipped, the in-prod functional smoke (below) is the visual gate.

**Functional smoke (DEFERRED to post-deploy — out of scope for this plan):**
- User triggers one feedback submission in production; screenshots the Gmail/Apple Mail render.
- User triggers one org invite in production; screenshots the Gmail/Apple Mail render.
- User pastes the five Supabase auth templates into the Supabase dashboard (per supabase/email-templates/README.md) and triggers one magic-link email; screenshots the render.
</verification>

<success_criteria>
- `pnpm typecheck` passes
- `pnpm lint` passes (modulo the pre-existing cv-review-panel.tsx warning)
- `pnpm build` passes
- src/lib/email/escape.ts exists with `DEFAULT_BRAND_HEX = "#5DCAA5"` and exports escapeHtml/sanitiseUrl/safeHexColor
- src/lib/email/render.ts exists with module-level Altus Recruit brand constants and exports TransactionalEmail + renderTransactionalEmail + renderTransactionalEmailText
- public/email/altus-recruit-logo.svg is a non-empty file copied from /tmp/altus-design-system/altus-recruit-handoff/altus-recruit-horizontal-dark.svg
- All five supabase/email-templates/*.html files exist, contain {{ .ConfirmationURL }} + {{ .SiteURL }} merge tags, and use the same Midnight/Mint/Cloud shell as render.ts
- supabase/email-templates/README.md maps file → Supabase slot → subject and documents the Site URL requirement
- submit-feedback.ts calls renderTransactionalEmail + renderTransactionalEmailText and passes both html + text to sendResendEmail
- team/actions.ts (both inviteMemberAction + resendInviteAction) call renderTransactionalEmail + renderTransactionalEmailText, share a buildInvitePreheader helper, and pass html + text to sendResendEmail
- All existing security comments + Sentry PII guards + fail-open env-var guards preserved
- No new npm packages installed
- No changes to src/lib/email/resend.ts, src/lib/env.ts, or any UI/test/migration code
- No temporary scripts/files left in the repo
- Commit message references 260528-wdz and W6 fix-queue item
</success_criteria>

<output>
Create `.planning/quick/260528-wdz-altus-recruit-branded-transactional-emai/260528-wdz-SUMMARY.md` when done. Summary must record:
- Final list of files created vs modified (10 paths total)
- Whether tsx-based visual sample rendering was performed or skipped (and why)
- Any deviation from the brand colour constants (should be none)
- Confirmation that pnpm typecheck + lint + build all passed
- Confirmation that /gsd-code-review was run against the four code files and the result
- Reminder to the user: paste the five supabase/email-templates/*.html files into Supabase Dashboard → Project → Authentication → Email Templates and set the matching subject lines from README.md, and confirm Site URL is set in URL Configuration
</output>
