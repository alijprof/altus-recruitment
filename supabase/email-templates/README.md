# Supabase Auth email templates — Altus Recruit

These HTML files are paste-able into Supabase Dashboard → Project → Authentication → Email Templates. Each file matches one of Supabase's auth email slots; the table below maps them and gives suggested subjects.

| File | Supabase slot | Suggested Subject |
|------|---------------|-------------------|
| `magic-link.html` | Magic Link | Sign in to Altus Recruit |
| `recovery.html` | Reset Password | Reset your Altus Recruit password |
| `confirmation.html` | Confirm Signup | Confirm your email — Altus Recruit |
| `invite.html` | Invite User | You're invited to Altus Recruit |
| `change-email.html` | Change Email Address | Confirm your new email — Altus Recruit |

## Required Supabase config

Set Project Settings → Authentication → URL Configuration → Site URL to `https://altus-recruitment.vercel.app` (or your custom domain). The `{{ .SiteURL }}` merge tag in each template resolves to this — without it, the logo `<img>` will 404 and Gmail will show a broken-image placeholder.

## Logo asset

These templates assume `public/email/altus-recruit-logo.svg` exists on the deployed site. The repo ships this file in `public/email/`. Vercel serves it at `${SITE_URL}/email/altus-recruit-logo.svg` automatically.

## Why static HTML and not the renderer?

Supabase Auth templates are edited in the Supabase dashboard (not rendered by our server), so we ship paste-able HTML that mirrors the live renderer's output. If you change brand colours, the source of truth is `src/lib/email/render.ts` — update these files manually to match. See the BRAND constants at the top of render.ts.
