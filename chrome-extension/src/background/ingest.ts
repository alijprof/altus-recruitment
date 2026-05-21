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
 * Read the Supabase auth cookie from the Altus origin. Supabase splits
 * long cookies into `sb-<projectref>-auth-token.0`, `.1`, etc. We
 * concatenate fragments in numeric order before base64-decoding the JSON
 * envelope to extract `access_token`. Returns null when no session.
 */
async function readSupabaseAccessToken(origin: string): Promise<string | null> {
  // Chrome 147+ has a quirk where `chrome.cookies.getAll({ url })` returns
  // empty for hostOnly cookies on public-suffix-list hosts (e.g. *.vercel.app).
  // `chrome.cookies.get({ url, name })` and `chrome.cookies.getAll({ domain })`
  // both work. Use domain filter as the primary path; the URL-derived host
  // is the canonical Altus origin.
  const host = new URL(origin).hostname
  const cookies = await chrome.cookies.getAll({ domain: host })
  if (cookies.length === 0) return null

  // Find the `sb-<projectref>-auth-token` cookie family. Sort fragments
  // by trailing `.N`; concatenate before decoding.
  const family = cookies.filter(
    (c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'),
  )
  if (family.length === 0) return null

  // Group by base name (strip trailing .0/.1/.N if present).
  const groups = new Map<string, Array<{ idx: number; value: string }>>()
  for (const c of family) {
    const m = c.name.match(/^(.+?)(?:\.(\d+))?$/)
    if (!m) continue
    const base = m[1] ?? c.name
    const idx = m[2] ? parseInt(m[2], 10) : 0
    const arr = groups.get(base) ?? []
    arr.push({ idx, value: c.value })
    groups.set(base, arr)
  }

  for (const [, fragments] of groups) {
    fragments.sort((a, b) => a.idx - b.idx)
    const joined = fragments.map((f) => f.value).join('')
    // Supabase stores either a JSON object directly or base64-prefixed
    // (`base64-<payload>`). Try both.
    let payload: unknown = null
    try {
      const decoded = joined.startsWith('base64-')
        ? atob(joined.slice('base64-'.length))
        : joined
      payload = JSON.parse(decoded)
    } catch {
      // Some Supabase versions URL-encode the JSON value.
      try {
        payload = JSON.parse(decodeURIComponent(joined))
      } catch {
        continue
      }
    }
    if (
      payload &&
      typeof payload === 'object' &&
      'access_token' in payload &&
      typeof (payload as { access_token: unknown }).access_token === 'string'
    ) {
      return (payload as { access_token: string }).access_token
    }
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
      error: 'Not signed in to Altus. Open the app, sign in, then retry.',
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
