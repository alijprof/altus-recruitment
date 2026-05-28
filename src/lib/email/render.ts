// Quick task 260528-wdz (W6 fix-queue item): Altus Recruit branded transactional
// email renderer. Produces multipart-safe HTML + plain-text bodies for outbound
// Resend sends. All brand colours and the logo path are module-level constants
// here — a single edit anywhere in this file rebrands every outbound email.
//
// HTML safety: every interpolated value (heading, paragraphs, preheader,
// footerNote, button label, button URL) passes through escapeHtml /
// sanitiseUrl below before reaching the output. Module-level constants are
// trusted (hard-coded) so they are not escaped — they are colour values, the
// font stack, and short English boilerplate strings.

import 'server-only'

import { env } from '@/lib/env'

import { escapeHtml, sanitiseUrl } from './escape'

// --- Brand constants — Altus Recruit ---------------------------------------
const MIDNIGHT = '#0A3D5C' // header band background, primary heading
const MINT = '#5DCAA5' // button bg, link colour, accent
const WHITE = '#FFFFFF' // body background
const CLOUD = '#F4F6F8' // outer page bg + footer bg
const BORDER = '#E5E7EB' // divider lines
const MUTED_TEXT = '#6B7280' // footer body text
const BODY_TEXT = '#1A1A1A' // paragraph copy

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const BRAND_NAME = 'ALTUS Recruit' // for text-fallback header + footer line 1
const FOOTER_TAGLINE = 'Altus Recruit — AI-powered recruitment CRM'
const FOOTER_LOCATION = 'Built in the UK'
const FOOTER_DISCLAIMER = "If you weren't expecting this email, you can safely ignore it."
const LOGO_PATH = '/email/altus-recruit-logo.svg'

// --- Public contract --------------------------------------------------------
export type TransactionalEmail = {
  preheader: string // inbox preview snippet (<90 chars), HTML-escaped
  heading: string // H1, HTML-escaped
  paragraphs: string[] // each becomes <p>, each HTML-escaped
  button?: { label: string; url: string } // optional CTA
  footerNote?: string // optional small note above boilerplate signoff
}

export function renderTransactionalEmail(input: TransactionalEmail): string {
  const headingHtml = `<h1 style="margin:0 0 16px;font-size:24px;font-weight:600;color:${MIDNIGHT};line-height:1.3">${escapeHtml(input.heading)}</h1>`

  const paragraphsHtml = input.paragraphs
    .map((p) => {
      if (p === '') {
        return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BODY_TEXT}">&nbsp;</p>`
      }
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BODY_TEXT}">${escapeHtml(p)}</p>`
    })
    .join('')

  let buttonHtml = ''
  if (input.button) {
    const url = escapeHtml(sanitiseUrl(input.button.url))
    const label = escapeHtml(input.button.label)
    // Outer table + MSO conditional comment for Outlook desktop padding parity.
    buttonHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
<tr><td align="left" style="border-radius:8px;background:${MINT}">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:200px;" arcsize="17%" strokecolor="${MINT}" fillcolor="${MINT}">
<w:anchorlock/>
<center style="color:${WHITE};font-family:Arial,sans-serif;font-size:15px;font-weight:600;">${label}</center>
</v:roundrect>
<![endif]-->
<a href="${url}" target="_blank" rel="noopener noreferrer" style="background:${MINT};border-radius:8px;color:${WHITE};display:inline-block;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:1;padding:14px 28px;text-decoration:none;mso-hide:all">${label}</a>
</td></tr>
</table>`
  }

  const footerNoteHtml = input.footerNote
    ? `<p style="margin:0 0 14px;font-size:13px;color:${BODY_TEXT};line-height:1.5">${escapeHtml(input.footerNote)}</p>`
    : ''

  const bodyHtml = `${headingHtml}${paragraphsHtml}${buttonHtml}`

  return renderEmailShell(bodyHtml, input.preheader, footerNoteHtml, input.heading)
}

export function renderTransactionalEmailText(input: TransactionalEmail): string {
  const lines: string[] = []
  lines.push(input.heading)
  lines.push('')
  lines.push(input.paragraphs.join('\n\n'))
  if (input.button) {
    lines.push('')
    lines.push(`${input.button.label}: ${sanitiseUrl(input.button.url)}`)
  }
  if (input.footerNote) {
    lines.push('')
    lines.push(input.footerNote)
  }
  lines.push('')
  lines.push(FOOTER_TAGLINE)
  lines.push(FOOTER_LOCATION)
  lines.push(FOOTER_DISCLAIMER)
  return lines.join('\n')
}

// --- Private shell ----------------------------------------------------------
function renderEmailShell(
  bodyHtml: string,
  preheader: string,
  footerNoteHtml: string,
  titleText: string,
): string {
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim() ?? ''
  const hasSiteUrl = siteUrl.length > 0
  const logoSrc = hasSiteUrl ? siteUrl.replace(/\/$/, '') + LOGO_PATH : ''

  const headerInner = hasSiteUrl
    ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(BRAND_NAME)}" height="40" style="height:40px;width:auto;display:block;border:0">`
    : `<span style="font-size:20px;font-weight:700;letter-spacing:-0.3px;color:${WHITE}">ALTUS</span> <span style="font-size:20px;font-weight:500;color:${MINT}">Recruit</span>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(titleText)}</title>
</head>
<body style="margin:0;padding:0;background:${CLOUD};font-family:${FONT_STACK}">
<div style="display:none;overflow:hidden;line-height:1;opacity:0;max-height:0;max-width:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CLOUD}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

<!-- Header -->
<tr><td style="background:${MIDNIGHT};padding:32px 32px;border-radius:8px 8px 0 0">
${headerInner}
</td></tr>

<!-- Body -->
<tr><td style="background:${WHITE};padding:40px 32px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER}">
${bodyHtml}
</td></tr>

<!-- Footer -->
<tr><td style="background:${CLOUD};padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid ${BORDER};border-top:none">
${footerNoteHtml}<p style="margin:0 0 6px;font-size:12px;color:${MUTED_TEXT};line-height:1.5">${FOOTER_TAGLINE}</p>
<p style="margin:0 0 6px;font-size:12px;color:${MUTED_TEXT};line-height:1.5">${FOOTER_LOCATION}</p>
<p style="margin:0;font-size:12px;color:${MUTED_TEXT};line-height:1.5">${FOOTER_DISCLAIMER}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}
