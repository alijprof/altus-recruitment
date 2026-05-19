import 'server-only'

// ---------------------------------------------------------------------------
// Plan 03-01 Task A.2 — CORS helper for /api/linkedin/ingest.
//
// CRITICAL-1 fix (plan-check 2026-05-19): the extension's fetch originates
// from `chrome-extension://<id>` (the background service worker), NOT from
// `https://www.linkedin.com`. The Allow-Origin echo must therefore match
// the chrome-extension scheme. We allowlist:
//   1. The pinned ID from env `LINKEDIN_EXTENSION_ID` (manifest "key" pins
//      this across reloads — see chrome-extension/README.md), if present.
//   2. Any `chrome-extension://<32-char-id>` origin matching Chrome's
//      a-p[32] pattern — kept as a soft fallback for dev, where the
//      developer may side-load with a generated key. Production should
//      always set LINKEDIN_EXTENSION_ID.
//
// Defence-in-depth: CORS is just to round-trip a legitimate extension's
// preflight + fetch. The real auth gate is `supabase.auth.getUser(token)`
// in the route handler — even if a browser bypassed CORS, an unauthenticated
// request gets 401.
// ---------------------------------------------------------------------------

// Chrome extension IDs are 32 chars from a-p (case-insensitive, but Chrome
// emits lowercase). Anchor for full match — never a substring.
const EXTENSION_ID_RE = /^chrome-extension:\/\/[a-p]{32}$/i

export function isAllowedExtensionOrigin(
  origin: string | null,
  pinnedExtensionId?: string,
): boolean {
  if (!origin) return false
  if (pinnedExtensionId) {
    if (origin === `chrome-extension://${pinnedExtensionId.toLowerCase()}`) {
      return true
    }
  }
  return EXTENSION_ID_RE.test(origin)
}

export function corsHeadersFor(
  origin: string | null,
  pinnedExtensionId?: string,
): Headers {
  const headers = new Headers()
  if (isAllowedExtensionOrigin(origin, pinnedExtensionId) && origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.set('access-control-allow-methods', 'POST, OPTIONS')
    headers.set(
      'access-control-allow-headers',
      'authorization, content-type, x-altus-extension-version, origin',
    )
    headers.set('vary', 'Origin')
  }
  return headers
}

/**
 * Naive semver-ish compare for the extension-version gate. We only need
 * `actual >= required` semantics; we never deal with prerelease suffixes
 * for an internal extension. Accepts strings like `0.1.0`, `1.0`, `2`.
 */
export function versionGte(actual: string, required: string): boolean {
  const a = actual.split('.').map((n) => parseInt(n, 10) || 0)
  const r = required.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(a.length, r.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const rv = r[i] ?? 0
    if (av > rv) return true
    if (av < rv) return false
  }
  return true // equal
}
