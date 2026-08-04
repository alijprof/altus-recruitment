// Shared PII scrubbing for BOTH Sentry SDKs (server + browser).
//
// NO `import 'server-only'` — instrumentation-client.ts imports this to run in
// the browser. The module is pure: no Supabase client, no env access, no
// Node built-ins.
//
// Review 2026-08-04 M7: the client beforeSend deleted only request.cookies and
// user.email, with an in-file justification that "the client SDK never sends
// our own extra/contexts payloads". That is not accurate — client components
// DO capture raw error objects (settings/billing/manage-billing-button.tsx,
// start-checkout-button.tsx), and browser breadcrumbs record fetch and
// navigation URLs, so `/candidates?q=<recruiter search terms>` was reachable.
// CLAUDE.md forbids exactly that. Both configs now share one implementation so
// the two can no longer drift.

/** Object keys whose values are replaced wholesale. */
export const PII_KEYS = [
  'email',
  'phone',
  'cv_text',
  'extracted_data',
  'candidate_email',
  'full_name',
]

/** Recursively redact PII_KEYS anywhere in a structured payload. */
export function scrub(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(scrub)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.includes(k)) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = scrub(v)
    }
  }
  return out
}

/**
 * Drop the query string and fragment from a URL, keeping the path.
 *
 * Recruiter search terms travel in `?q=` on /candidates and /search, and a
 * candidate/job id in the PATH is not PII (it is an opaque uuid, and the
 * audit log records those deliberately) — but the query string is where the
 * free text lives. Relative and absolute URLs are both handled without
 * `new URL()`, which throws on relative inputs and is unavailable in some
 * older browser targets.
 */
export function stripQueryString(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}
