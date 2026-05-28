// Quick task 260528-wdz (W6 fix-queue item): HTML escape, URL allow-list, hex-colour
// validator used by branded transactional email renderer.
//
// Pure string functions only — safe to import from both server routes and
// client components. No DOM / Node-specific APIs.

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Reject dangerous URL schemes on button hrefs and image srcs. Customer-
// supplied data reaches us via merge tags (e.g. {{customer_email}}) plus
// operator-authored template URLs, so neither input is trusted.
// Allow-list: http(s), mailto, tel, and the "#" sentinel. Anything else
// (javascript:, data:, vbscript:, file:, ...) collapses to "#".
export function sanitiseUrl(rawUrl: string | null | undefined): string {
  if (rawUrl == null) return '#'
  const url = String(rawUrl).trim()
  if (url === '' || url === '#') return '#'
  if (/^(https?|mailto|tel):/i.test(url)) return url
  return '#'
}

// branding.primaryColor is interpolated raw into style="background:${pc}"
// across the codebase. It's operator-controlled (saved via Settings) but
// still XSS-class — a malicious or compromised operator account could embed
// `;background:url(javascript:...)` or close the attribute and inject events.
// Validate as a strict 6-digit hex colour, otherwise fall back to brand
// default. Accepts optional leading `#`.
const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/
const DEFAULT_BRAND_HEX = '#5DCAA5'

export function safeHexColor(
  raw: string | null | undefined,
  fallback: string = DEFAULT_BRAND_HEX,
): string {
  if (raw == null) return fallback
  const trimmed = String(raw).trim()
  if (!HEX_COLOR_RE.test(trimmed)) return fallback
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}
