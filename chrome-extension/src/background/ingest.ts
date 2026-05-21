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
  // ISOLATED world is the safer choice — MAIN world risks the page's own
  // scripts mutating our return value. The scraper only reads the DOM,
  // which is fully accessible from ISOLATED.
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeProfileInPage,
    args: [url],
    world: 'ISOLATED',
  })
  const value = result?.result as unknown
  // The scraper returns the flat shape directly — no Extracted<> wrapping
  // to flatten. Surface the actual name-extraction failure with a clear
  // message instead of letting Zod fail on '' with a generic error.
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as { name?: unknown }).name !== 'string' ||
    ((value as { name: string }).name).length === 0
  ) {
    throw new Error(
      "Couldn't read the profile name from the page. The DOM may have changed " +
        '— open DevTools on this LinkedIn tab and check the page console for ' +
        '[Altus capture] output.',
    )
  }
  const parsed = ScrapedProfilePayloadSchema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    throw new Error(`scraper output failed validation — ${issues}`)
  }
  return parsed.data
}

/**
 * Self-contained LinkedIn profile scraper. Runs in the target tab's
 * ISOLATED world via chrome.scripting.executeScript. Must be pure — no
 * closures, no imports — because chrome.scripting serialises this
 * function as source code and re-creates it in the target context.
 *
 * Previously this function delegated to a `globalThis.__altusScrape`
 * hook set by a content_scripts entry. That added a dependency on the
 * content script having actually run in the tab, which is fragile (new
 * extension reloads, tab opened before extension install, world
 * mismatches). Inlining the scraper eliminates that entire failure mode.
 *
 * Returns the flat payload shape that `ScrapedProfilePayloadSchema`
 * validates against — no Extracted<> wrappers, no flatten step needed.
 *
 * Stage strategy (RESEARCH §Pattern 2): try the most-stable selector
 * first, fall through to more fragile fallbacks. Logs to the page
 * console so issues are diagnosable from LinkedIn-tab DevTools.
 */
function scrapeProfileInPage(url: string): unknown {
  function txt(el: Element | null | undefined): string | null {
    if (!el) return null
    const t = (el.textContent ?? '').trim()
    return t.length === 0 ? null : t
  }

  // ---- name -------------------------------------------------------------
  // LinkedIn's profile name is in an <h1>. Multiple fallbacks because
  // LinkedIn's class names churn.
  let name: string | null = null
  const nameSelectors = [
    'main h1',
    'h1.text-heading-xlarge',
    'section.pv-text-details__left-panel h1',
    'h1',
  ]
  for (const sel of nameSelectors) {
    const v = txt(document.querySelector(sel))
    if (v) {
      name = v
      break
    }
  }

  // ---- headline ---------------------------------------------------------
  let headline: string | null = null
  const headlineSelectors = [
    '[data-test-id="profile-headline"]',
    '.pv-text-details__left-panel .text-body-medium',
    'main h1 + div',
    '.text-body-medium.break-words',
  ]
  for (const sel of headlineSelectors) {
    const v = txt(document.querySelector(sel))
    if (v) {
      headline = v
      break
    }
  }

  // ---- location ---------------------------------------------------------
  let location: string | null = null
  const locationSelectors = [
    '[data-test-id="profile-location"]',
    '[aria-label="Location"]',
    '.text-body-small.inline.t-black--light.break-words',
  ]
  for (const sel of locationSelectors) {
    const v = txt(document.querySelector(sel))
    if (v) {
      location = v
      break
    }
  }

  // ---- about ------------------------------------------------------------
  let about: string | null = null
  const aboutSection =
    document.querySelector('[data-view-name="profile-component-entity-about"]') ??
    document.querySelector('#about')?.parentElement ??
    document.querySelector('#about')
  if (aboutSection) {
    const span = aboutSection.querySelector(
      '.inline-show-more-text span, .pv-shared-text-with-see-more span',
    )
    about = txt(span)
  }

  // ---- work experience --------------------------------------------------
  type WE = { title: string; company: string | null; dates: string | null }
  const experience: WE[] = []
  const expSection =
    document.querySelector('[data-view-name="profile-component-entity-experience"]') ??
    document.querySelector('#experience')?.parentElement ??
    document.querySelector('#experience')
  if (expSection) {
    const entries = expSection.querySelectorAll(
      '[data-view-name="profile-component-entity-experience-entry"], li.pvs-list__item--line-separated, li.artdeco-list__item',
    )
    entries.forEach((entry) => {
      const spans = entry.querySelectorAll('span[aria-hidden="true"]')
      const t = txt(spans[0])
      if (!t) return
      const rawCompany = txt(spans[1])
      const company = rawCompany ? rawCompany.split('·')[0]?.trim() ?? null : null
      experience.push({
        title: t,
        company: company && company.length > 0 ? company : null,
        dates: txt(spans[2]) ?? null,
      })
    })
  }

  // ---- education --------------------------------------------------------
  type ED = { school: string; degree: string | null; dates: string | null }
  const education: ED[] = []
  const eduSection =
    document.querySelector('[data-view-name="profile-component-entity-education"]') ??
    document.querySelector('#education')?.parentElement ??
    document.querySelector('#education')
  if (eduSection) {
    const entries = eduSection.querySelectorAll(
      '[data-view-name="profile-component-entity-education-entry"], li.pvs-list__item--line-separated, li.artdeco-list__item',
    )
    entries.forEach((entry) => {
      const spans = entry.querySelectorAll('span[aria-hidden="true"]')
      const s = txt(spans[0])
      if (!s) return
      education.push({
        school: s,
        degree: txt(spans[1]) ?? null,
        dates: txt(spans[2]) ?? null,
      })
    })
  }

  // ---- skills -----------------------------------------------------------
  const skills: string[] = []
  const skillsSection =
    document.querySelector('[data-view-name="profile-component-entity-skills"]') ??
    document.querySelector('#skills')?.parentElement ??
    document.querySelector('#skills')
  if (skillsSection) {
    const entries = skillsSection.querySelectorAll(
      '[data-view-name="profile-component-entity-skill-entry"]',
    )
    entries.forEach((entry) => {
      const span = entry.querySelector('span[aria-hidden="true"]')
      const v = txt(span)
      if (v) skills.push(v)
    })
  }

  // ---- current role + company ------------------------------------------
  let current_role: string | null = null
  let current_company: string | null = null
  if (experience[0]) {
    current_role = experience[0].title
    current_company = experience[0].company
  }
  // Fallback: explicit aria-label on the right-panel button
  if (!current_company) {
    const btn = document.querySelector('button[aria-label^="Current company:"]')
    const aria = btn?.getAttribute('aria-label') ?? ''
    const m = aria.match(/^Current company:\s*(.+)$/i)
    if (m && m[1]) current_company = m[1].trim()
  }

  // ---- confidence -------------------------------------------------------
  const weights = {
    name: name ? 0.25 : 0,
    current_role: current_role ? 0.2 : 0,
    current_company: current_company ? 0.15 : 0,
    headline: headline ? 0.1 : 0,
    location: location ? 0.05 : 0,
    about: about ? 0.05 : 0,
    skills: skills.length > 0 ? 0.15 : 0,
    experience: experience.length > 0 ? 0.05 : 0,
  }
  const capture_confidence = Object.values(weights).reduce((a, b) => a + b, 0)

  // ---- diagnostics ------------------------------------------------------
  // Log to the page's own console so the user can debug from LinkedIn
  // tab DevTools if scraping fails.
  // eslint-disable-next-line no-console
  console.log('[Altus capture]', {
    name,
    headline,
    location,
    work_count: experience.length,
    education_count: education.length,
    skill_count: skills.length,
    confidence: capture_confidence,
  })

  return {
    name: name ?? '',
    headline,
    current_role,
    current_company,
    location,
    about,
    work_experience: experience,
    education,
    skills,
    linkedin_url: url,
    capture_confidence,
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

