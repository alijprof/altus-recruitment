/**
 * Plan 03-01 Task A.1 — extension service worker.
 *
 * Receives `CAPTURE_PROFILE` messages from the popup, then:
 *   1. Enforces a per-tab rate limit (1 capture / 5 seconds) — D3-01
 *      mitigation per RESEARCH §"Security Domain" LinkedIn TOS row.
 *   2. Injects `scrapeLinkedInProfile(tab.url)` into the active LinkedIn
 *      tab via chrome.scripting.executeScript.
 *   3. Reads the recruiter's Supabase auth cookie from the Altus origin
 *      (RESEARCH §Pattern 1) — split-cookie aware per §Pitfall 1.
 *   4. POSTs the scraped payload to `${ALTUS_ORIGIN}/api/linkedin/ingest`
 *      with `Authorization: Bearer <access_token>` and an
 *      `X-Altus-Extension-Version` header (PATTERNS §8).
 *
 * Storage:
 *   - `chrome.storage.sync` holds the configured Altus origin so the
 *     recruiter can flip between local dev and production without
 *     reinstalling. Defaults to the production origin.
 */

import { scrapeLinkedInProfile } from '../content/scrape-profile'
import {
  ScrapedProfilePayloadSchema,
  type ScrapedProfilePayload,
} from '../shared/scraped-profile-schema'

const DEFAULT_ALTUS_ORIGIN = 'https://altus-recruitment.vercel.app'

const RATE_LIMIT_MS = 5_000
const lastFiredAt = new Map<number, number>()

type CaptureMessage = {
  type: 'CAPTURE_PROFILE'
  tabId: number
  url: string
}

type CaptureResponse =
  | { ok: true; candidate_id: string; updated: boolean }
  | { ok: false; error: string }

async function getConfiguredOrigin(): Promise<string> {
  const stored = await chrome.storage.sync.get('altus_origin')
  const value = stored.altus_origin
  return typeof value === 'string' && value.startsWith('http')
    ? value
    : DEFAULT_ALTUS_ORIGIN
}

/**
 * Read the Supabase access token from an open Altus tab by injecting a
 * script that reads localStorage + document.cookie in the page's own
 * context.
 *
 * Why not chrome.cookies API? Chrome 147+ has inconsistent behaviour for
 * chrome.cookies.getAll on hosts that sit on the Public Suffix List
 * (vercel.app is a PSL entry). hostOnly cookies on such hosts are visible
 * to chrome.cookies.get({url,name}) but invisible to getAll() — we
 * verified this empirically. Page-context execution sidesteps the
 * cookies API entirely.
 *
 * Returns:
 *   - access_token string if a session is found
 *   - null if no Altus tab is open OR no session in storage
 *
 * Requires:
 *   - "scripting" permission (already declared)
 *   - host_permission matching the Altus origin (already declared)
 */
async function readSupabaseAccessToken(origin: string): Promise<string | null> {
  const url = new URL(origin)
  // Match any path under the Altus origin so /dashboard, /candidates, etc.
  // all qualify as "an Altus tab".
  const tabs = await chrome.tabs.query({ url: `${url.origin}/*` })
  if (tabs.length === 0) return null

  for (const tab of tabs) {
    if (!tab.id) continue
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractAltusAccessTokenFromPage,
        world: 'MAIN',
      })
      const token = result?.result
      if (typeof token === 'string' && token.length > 0) {
        return token
      }
    } catch {
      // executeScript can fail for restricted pages (chrome://, blocked
      // by enterprise policy, etc.) — try the next tab.
      continue
    }
  }
  return null
}

/**
 * Runs inside the Altus page's MAIN world. Reads the Supabase access_token
 * from localStorage first (the @supabase/ssr browser client writes there);
 * falls back to document.cookie if localStorage is empty (cookies are
 * httpOnly=false so the page can read them).
 *
 * Must be self-contained — no closure references, no imports — because
 * chrome.scripting serialises this function and re-creates it in the
 * target page.
 */
function extractAltusAccessTokenFromPage(): string | null {
  function tryParseSession(raw: string): string | null {
    let decoded = raw
    if (raw.startsWith('base64-')) {
      try {
        decoded = atob(raw.slice('base64-'.length))
      } catch {
        return null
      }
    }
    let obj: unknown = null
    try {
      obj = JSON.parse(decoded)
    } catch {
      try {
        obj = JSON.parse(decodeURIComponent(decoded))
      } catch {
        return null
      }
    }
    if (
      obj &&
      typeof obj === 'object' &&
      'access_token' in obj &&
      typeof (obj as { access_token: unknown }).access_token === 'string'
    ) {
      return (obj as { access_token: string }).access_token
    }
    return null
  }

  // 1. localStorage (preferred — single key, no fragmentation)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('sb-') || !k.includes('-auth-token')) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const token = tryParseSession(raw)
      if (token) return token
    }
  } catch {
    // localStorage may be unavailable in some contexts; fall through
  }

  // 2. document.cookie (fallback — handles fragmented sb-*-auth-token.N)
  try {
    const groups = new Map<string, Array<{ idx: number; value: string }>>()
    for (const entry of document.cookie.split('; ')) {
      const eq = entry.indexOf('=')
      if (eq <= 0) continue
      const name = entry.slice(0, eq).trim()
      const value = decodeURIComponent(entry.slice(eq + 1))
      if (!name.startsWith('sb-') || !name.includes('-auth-token')) continue
      const m = name.match(/^(.+?)(?:\.(\d+))?$/)
      if (!m) continue
      const base = m[1] ?? name
      const idx = m[2] ? parseInt(m[2], 10) : 0
      const arr = groups.get(base) ?? []
      arr.push({ idx, value })
      groups.set(base, arr)
    }
    for (const [, fragments] of groups) {
      fragments.sort((a, b) => a.idx - b.idx)
      const joined = fragments.map((f) => f.value).join('')
      const token = tryParseSession(joined)
      if (token) return token
    }
  } catch {
    // document.cookie may be blocked by Permissions-Policy in some embedded
    // contexts; fall through
  }

  return null
}

/**
 * Inject the scraper into the page and return the result. We can't pass a
 * function reference across the chrome.scripting boundary directly — the
 * function gets serialised then deserialised in the target frame, so we
 * inline the call to the bundled `scrapeLinkedInProfile` symbol.
 */
async function runScraper(tabId: number, url: string): Promise<ScrapedProfilePayload> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeProfileInPage,
    args: [url],
    world: 'MAIN',
  })
  const value = result?.result as unknown
  // Re-validate at the boundary: the scraper returns the same shape as the
  // Zod schema except for the Extracted<> wrappers, so we flatten here.
  const flat = flattenScraped(value)
  const parsed = ScrapedProfilePayloadSchema.safeParse(flat)
  if (!parsed.success) {
    throw new Error(`scraper output failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  return parsed.data
}

/**
 * Mirror of `scrapeLinkedInProfile` for injection. We re-implement the
 * shape inline because `chrome.scripting.executeScript({ func })`
 * serialises the function — the imported symbol from `../content/scrape-profile`
 * is bundled into the worker, not injected. The build step emits
 * a separate `content-script.js` artifact that's referenced by manifest's
 * `content_scripts` so the actual implementation runs in the page.
 *
 * For Phase 3 we use the popup-only UX (D3-28) — the content_scripts manifest
 * entry registers the scraper as a script; the popup messages the worker
 * which calls executeScript with a thin wrapper that calls the global
 * `window.__altusScrape` function set up by the content script.
 */
function scrapeProfileInPage(url: string): unknown {
  const g = globalThis as unknown as { __altusScrape?: (u: string) => unknown }
  if (typeof g.__altusScrape === 'function') {
    return g.__altusScrape(url)
  }
  // Content script not yet loaded — return a minimal shape so the popup
  // surfaces a clear "couldn't read profile" message.
  return {
    name: { value: null, confidence: 'low', strategy_used: null },
    headline: { value: null, confidence: 'low', strategy_used: null },
    current_role: { value: null, confidence: 'low', strategy_used: null },
    current_company: { value: null, confidence: 'low', strategy_used: null },
    location: { value: null, confidence: 'low', strategy_used: null },
    about: { value: null, confidence: 'low', strategy_used: null },
    work_experience: [],
    education: [],
    skills: [],
    linkedin_url: url,
    capture_confidence: 0,
  }
}

type ScrapedExtractedShape = { value: string | null }

function flattenExtracted(v: unknown): string | null {
  if (v && typeof v === 'object' && 'value' in v) {
    const val = (v as ScrapedExtractedShape).value
    return typeof val === 'string' && val.length > 0 ? val : null
  }
  return null
}

/**
 * Flatten the Extracted<> wrapper objects into bare string|null fields for
 * the POST payload. The Zod schema on both sides accepts the flattened
 * shape per Task A.2.
 */
function flattenScraped(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  return {
    name: flattenExtracted(r.name) ?? '',
    headline: flattenExtracted(r.headline),
    current_role: flattenExtracted(r.current_role),
    current_company: flattenExtracted(r.current_company),
    location: flattenExtracted(r.location),
    about: flattenExtracted(r.about),
    work_experience: Array.isArray(r.work_experience) ? r.work_experience : [],
    education: Array.isArray(r.education) ? r.education : [],
    skills: Array.isArray(r.skills) ? r.skills : [],
    linkedin_url: typeof r.linkedin_url === 'string' ? r.linkedin_url : '',
    capture_confidence:
      typeof r.capture_confidence === 'number' ? r.capture_confidence : 0,
  }
}

async function handleCapture(msg: CaptureMessage): Promise<CaptureResponse> {
  // Rate-limit: at most one capture every RATE_LIMIT_MS per tab.
  const now = Date.now()
  const last = lastFiredAt.get(msg.tabId) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return {
      ok: false,
      error: `Slow down — wait ${Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000)}s.`,
    }
  }
  lastFiredAt.set(msg.tabId, now)

  const origin = await getConfiguredOrigin()

  const token = await readSupabaseAccessToken(origin)
  if (!token) {
    return {
      ok: false,
      error:
        'No Altus session found. Open ' +
        new URL(origin).hostname +
        ' in a tab, sign in, then retry.',
    }
  }

  let payload: ScrapedProfilePayload
  try {
    payload = await runScraper(msg.tabId, msg.url)
  } catch (err) {
    const m = err instanceof Error ? err.message : 'scrape failed'
    return { ok: false, error: m }
  }

  const version = chrome.runtime.getManifest().version
  let res: Response
  try {
    res = await fetch(`${origin}/api/linkedin/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-altus-extension-version': version,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const m = err instanceof Error ? err.message : 'network error'
    return { ok: false, error: `Network: ${m}` }
  }

  if (res.status === 401) {
    return { ok: false, error: 'Session expired — sign in to Altus again.' }
  }
  if (res.status === 426) {
    return {
      ok: false,
      error: 'Extension is out of date. Update it from the README.',
    }
  }
  if (!res.ok) {
    return { ok: false, error: `Ingest failed (${res.status}).` }
  }
  const body = (await res.json()) as { candidate_id?: string; updated?: boolean }
  if (!body.candidate_id) {
    return { ok: false, error: 'Ingest returned no candidate id.' }
  }
  return { ok: true, candidate_id: body.candidate_id, updated: !!body.updated }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (
    msg &&
    typeof msg === 'object' &&
    'type' in msg &&
    (msg as { type: unknown }).type === 'CAPTURE_PROFILE'
  ) {
    handleCapture(msg as CaptureMessage)
      .then(sendResponse)
      .catch((err: unknown) => {
        const m = err instanceof Error ? err.message : 'unknown error'
        sendResponse({ ok: false, error: m } satisfies CaptureResponse)
      })
    return true // keep the message channel open for async sendResponse
  }
  return false
})

// Re-export the scraper so the content script bundle can set the global
// `__altusScrape` hook. The content_scripts entry in manifest.json points at
// a tiny shim file that assigns this function to `globalThis`.
export { scrapeLinkedInProfile }
