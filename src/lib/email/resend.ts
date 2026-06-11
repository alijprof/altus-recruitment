// Best-effort Resend wrapper. No `resend` SDK installed — we POST directly to
// the REST endpoint with `fetch`. Generalise this further if other email use
// cases land (e.g. magic-link, placement notifications). Today's only caller
// is the feedback server action (260524-b6v).
//
// CONTRACT: this helper NEVER throws. Callers treat outbound email as
// fire-and-forget — the DB row is canonical, the email is a bonus. Callers
// should still `try/catch` for defence in depth (e.g. fetch promise rejection
// from a transport error) and log via Sentry.
//
// assembleCampaignHtml — server-side email assembly (Plan 04-04).
// Combines Sonnet-written intro + outro with the recruiter's body_template.
// The body_template NEVER passes through Sonnet (D4-07, T-04-14). All
// interpolated strings are HTML-escaped to prevent XSS in email clients.

import 'server-only'

import { env } from '@/lib/env'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Altus <feedback@updates.altus.app>'

export type ResendSendInput = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  /**
   * Resend Idempotency-Key header. Pass a stable per-logical-send key
   * (e.g. `${campaignId}:${recipientId}`) so a retried request after a
   * crash cannot double-send the same email.
   */
  idempotencyKey?: string
  /** Extra SMTP headers (e.g. List-Unsubscribe) forwarded to Resend. */
  headers?: Record<string, string>
}

export type ResendSendResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'no_api_key' }
  | { ok: false; reason: 'http_error'; status?: number; message?: string }

export async function sendResendEmail(input: ResendSendInput): Promise<ResendSendResult> {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'no_api_key' }
  }

  const from = input.from ?? env.RESEND_FROM ?? DEFAULT_FROM
  const to = Array.isArray(input.to) ? input.to : [input.to]

  let res: Response
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey !== undefined
          ? { 'Idempotency-Key': input.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        ...(input.html !== undefined ? { html: input.html } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.headers !== undefined ? { headers: input.headers } : {}),
      }),
    })
  } catch (err) {
    // Transport-level failure (DNS, TLS, network). Surface as http_error so
    // callers can log it without distinguishing transport vs application errors.
    const message = err instanceof Error ? err.message : 'fetch_failed'
    return { ok: false, reason: 'http_error', message }
  }

  if (!res.ok) {
    let message: string | undefined
    try {
      const text = await res.text()
      message = text.slice(0, 500)
    } catch {
      // ignore — message stays undefined
    }
    return { ok: false, reason: 'http_error', status: res.status, message }
  }

  // Resend returns { id: '...' } on success. Read defensively.
  let id = ''
  try {
    const json = (await res.json()) as { id?: unknown }
    if (typeof json.id === 'string') id = json.id
  } catch {
    // 2xx but unparseable body — still treat as success.
  }
  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// assembleCampaignHtml — campaign email HTML builder (Plan 04-04 / MARKET-01)
//
// Assembles the final HTML for a campaign email from:
//   - Sonnet-written intro paragraph (personalised to the recipient)
//   - Recruiter-authored bodyTemplate (interpolated verbatim, NOT through AI)
//   - Sonnet-written outro paragraph (personalised to the recipient)
//   - A mandatory PECR-compliant unsubscribe footer (UK PECR / Research Pitfall 6)
//
// All interpolated values are HTML-escaped so candidate data in the personalised
// paragraphs cannot inject HTML or script tags into the email body.
// ---------------------------------------------------------------------------

/** Minimal HTML escape for values interpolated into email HTML. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type AssembleCampaignHtmlInput = {
  /** Recipient's first name — rendered as the greeting line (WR-09) */
  recipientFirstName: string
  /** Sonnet-written 2-3 sentence intro personalised to the recipient */
  intro: string
  /** Recruiter-authored body template — NOT modified by AI */
  bodyTemplate: string
  /** Sonnet-written 2-3 sentence outro personalised to the recipient */
  outro: string
  /** Recruiter name for the sign-off block (WR-09) */
  senderName: string
  /** Organisation name rendered under the sender's name (may be empty) */
  organizationName: string
  /** Candidate-specific unsubscribe URL (UK PECR mandatory) */
  unsubscribeUrl: string
}

/**
 * Assemble the full HTML for a campaign email.
 *
 * The recruiter's body_template is included verbatim between the personalised
 * intro and outro — it is never passed through the AI model (D4-07).
 * The unsubscribe link is mandatory for PECR compliance.
 */
export function assembleCampaignHtml(input: AssembleCampaignHtmlInput): string {
  const {
    recipientFirstName,
    intro,
    bodyTemplate,
    outro,
    senderName,
    organizationName,
    unsubscribeUrl,
  } = input

  // WR-09: the Sonnet prompts explicitly promise "the template handles"
  // the greeting and sign-off — so the template MUST render them.
  const safeFirstName = escapeHtml(recipientFirstName)
  const safeSender = escapeHtml(senderName)
  const orgLine = organizationName ? `<br>${escapeHtml(organizationName)}` : ''
  const safeIntro = escapeHtml(intro)
  const safeOutro = escapeHtml(outro)
  // bodyTemplate is written by the recruiter (trusted) — escape it the same
  // way for defence in depth, but wrap in its own paragraph to preserve whitespace.
  const safeBody = escapeHtml(bodyTemplate)
  // escapeHtml after encodeURI: encodeURI leaves '&' untouched, which would
  // break the href attribute if a query string ever appears in the URL (WR-03).
  const safeUnsubUrl = escapeHtml(encodeURI(unsubscribeUrl))

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="margin:0 0 16px">Hi ${safeFirstName},</p>
  <p style="margin:0 0 16px">${safeIntro}</p>
  <p style="margin:0 0 16px;white-space:pre-wrap">${safeBody}</p>
  <p style="margin:0 0 16px">${safeOutro}</p>
  <p style="margin:0 0 32px">Best regards,<br>${safeSender}${orgLine}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#6b7280;margin:0">
    You are receiving this email because you are registered in our candidate database.
    If you no longer wish to receive emails from us, you can
    <a href="${safeUnsubUrl}" style="color:#6b7280">unsubscribe here</a>.
  </p>
</body>
</html>`
}
