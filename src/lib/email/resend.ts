// Best-effort Resend wrapper. No `resend` SDK installed — we POST directly to
// the REST endpoint with `fetch`. Generalise this further if other email use
// cases land (e.g. magic-link, placement notifications). Today's only caller
// is the feedback server action (260524-b6v).
//
// CONTRACT: this helper NEVER throws. Callers treat outbound email as
// fire-and-forget — the DB row is canonical, the email is a bonus. Callers
// should still `try/catch` for defence in depth (e.g. fetch promise rejection
// from a transport error) and log via Sentry.

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
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        ...(input.html !== undefined ? { html: input.html } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
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
