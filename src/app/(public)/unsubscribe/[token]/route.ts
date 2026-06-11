// PECR one-click unsubscribe route — Quick task 260612-0f4.
//
// STRUCTURE: exactly ONE file in this directory. Do NOT add page.tsx here —
// page.tsx and route.ts CANNOT coexist at the same App Router path (build error).
// The GET handler returns inline HTML via new Response(...) so no React component
// or separate page file is needed.
//
// SECURITY NOTE — service-role read is justified here:
//   * Recipients carry no Supabase session cookie (they followed a link in an email).
//   * The only lookup is by the per-recipient unsubscribe_token — an unguessable
//     32-byte base64url value (~256 bits entropy, T-0f4-BRUTE).
//   * The service-role client is used for the token lookup and suppression write,
//     mirroring the apply-form pattern (Plan 3 Task 3.1 SECURITY NOTE).
//   * No PII is logged anywhere in this file; Sentry tags are fixed strings.
//
// GET: safe idempotent read — returns a confirm page showing the masked email
//   and an "Unsubscribe" button that POSTs to the same URL. Email link scanners
//   (Gmail, Outlook) pre-fetch GET links; we MUST NOT suppress on GET (T-0f4-PREFETCH).
//
// POST: handles BOTH the confirm-form submit (Content-Type: application/x-www-form-urlencoded)
//   AND the RFC 8058 one-click POST (List-Unsubscribe=One-Click body). Both arrive at
//   the same URL — which is exactly what RFC 8058 requires (the header URL IS the POST URL).
//   suppressByToken is awaited to completion BEFORE returning the 2xx (RFC 8058 §3).
//
// Rate limiting: T-0f4-BRUTE — the token is unguessable (>=32 bytes), so
// rate-limiting is an ACCEPTED RISK per the locked threat-model decision.
// Worst case: attacker who guesses a token only unsubscribes one candidate
// (no data read, no privilege escalation). No rate-limit added.

import { type NextRequest } from 'next/server'

import { maskEmail, suppressByToken } from '@/lib/email/unsubscribe'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// HTML helpers — inline HTML/CSS only, no React (no page.tsx to collide with)
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const BASE_STYLES = `
  body { font-family: sans-serif; background: #f4f6f8; margin: 0; padding: 0; }
  .card { max-width: 480px; margin: 80px auto; background: #fff; border-radius: 8px;
          padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 1.4rem; color: #0a3d5c; margin-bottom: 12px; }
  p { color: #555; font-size: 0.95rem; line-height: 1.5; }
  .email { font-weight: 600; color: #0a3d5c; }
  button { background: #0a3d5c; color: #fff; border: none; border-radius: 6px;
           padding: 12px 32px; font-size: 1rem; cursor: pointer; margin-top: 24px; }
  button:hover { background: #0d4e78; }
  .muted { color: #9ca3af; font-size: 0.875rem; margin-top: 16px; }
`.trim()

function htmlPage(body: string, title: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/** Constant generic page for unknown / expired tokens — leaks no information (T-0f4-ENUM). */
function invalidTokenPage(): Response {
  return htmlPage(
    `<h1>This link is no longer valid</h1>
     <p>The unsubscribe link you followed may have already been used or may have expired.</p>
     <p class="muted">If you continue to receive unwanted emails, please contact us directly.</p>`,
    'Unsubscribe',
  )
}

/** Confirm page shown to the recipient before they submit the form. */
function confirmPage(maskedEmail: string, token: string): Response {
  const safeToken = encodeURIComponent(token)
  const safeMasked = escapeHtml(maskedEmail)
  return htmlPage(
    `<h1>Unsubscribe from marketing emails</h1>
     <p>You are about to unsubscribe <span class="email">${safeMasked}</span> from our marketing
        email list. You will no longer receive campaign emails from us.</p>
     <form method="POST" action="/unsubscribe/${safeToken}">
       <button type="submit">Unsubscribe</button>
     </form>
     <p class="muted">If this wasn't you, you can safely close this page.</p>`,
    'Unsubscribe',
  )
}

/** Confirmation page returned after suppression (or if already suppressed). */
function confirmedPage(): Response {
  return htmlPage(
    `<h1>You have been unsubscribed</h1>
     <p>You won't receive further marketing emails from us.</p>
     <p class="muted">If you have any questions, please contact us directly.</p>`,
    'Unsubscribed',
  )
}

// ---------------------------------------------------------------------------
// Narrowed recipient shape for the token lookup (columns not yet in generated types)
// ---------------------------------------------------------------------------

type RecipientLookup = {
  email: string | null
}

// reason: unsubscribe_token column not yet in generated Database type (added by
// migration 20260612000000, regenerated in Task 4). Cast to narrowed shape.
type TokenLookupClient = {
  from: (table: 'email_campaign_recipients') => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: RecipientLookup | null
          error: { message?: string } | null
        }>
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GET — confirm page (SAFE: no side effects; email scanners pre-fetch GET links)
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  if (!token) {
    return invalidTokenPage()
  }

  const supabase = createServiceClient()

  // Look up recipient by token. Service-role bypasses RLS — only the indexed
  // unsubscribe_token column is trusted here (no caller-supplied tenant ID).
  const sb = supabase as unknown as TokenLookupClient
  const { data: recipient, error } = await sb
    .from('email_campaign_recipients')
    .select('email')
    .eq('unsubscribe_token', token)
    .maybeSingle()

  if (error || !recipient) {
    // Unknown / invalid token — render constant generic copy (T-0f4-ENUM).
    // Return 200 (NOT 404) so there is no status-code oracle for token validity.
    return invalidTokenPage()
  }

  const masked = maskEmail(recipient.email ?? '')
  return confirmPage(masked, token)
}

// ---------------------------------------------------------------------------
// POST — suppression handler (form submit AND RFC 8058 one-click, same URL)
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  if (!token) {
    // Missing token must NOT claim success — same constant invalid copy as GET
    // (CR-01: a tokenless POST previously rendered the "unsubscribed" page).
    return invalidTokenPage()
  }

  const supabase = createServiceClient()

  // suppressByToken is awaited to COMPLETION before returning 2xx (RFC 8058 §3).
  // It never throws — both "not found" and "DB error" return ok:false, and we
  // render the same constant confirmation copy either way (T-0f4-ENUM).
  await suppressByToken(supabase, token)

  // Return the SAME constant confirmation HTML regardless of outcome (T-0f4-ENUM):
  // never reveal whether the token was valid, already used, or unknown.
  return confirmedPage()
}
