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
async function scrapeProfileInPage(url: string): Promise<unknown> {
  function txt(el: Element | null | undefined): string | null {
    if (!el) return null
    const t = (el.textContent ?? '').trim()
    return t.length === 0 ? null : t
  }

  // LinkedIn lazy-loads the experience / education / skills sections via
  // intersection observers. If we scrape right after the user clicks the
  // popup, those sections may not be in the DOM yet — they only mount when
  // scrolled into view. Force-mount them by scrolling the entire page bottom
  // and back, with a short wait between each step to give React time to
  // render.
  async function forceLazyMount(): Promise<void> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const scroller = document.scrollingElement ?? document.documentElement
    const totalHeight = scroller.scrollHeight
    const step = Math.max(800, Math.floor(window.innerHeight * 0.8))
    let pos = 0
    for (let i = 0; i < 12 && pos < totalHeight; i++) {
      pos += step
      window.scrollTo({ top: pos, behavior: 'instant' as ScrollBehavior })
      await sleep(150)
    }
    // Back to top so the user's view isn't disturbed
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    await sleep(200)
  }

  await forceLazyMount()

  // Find a section by:
  //   1. document.getElementById(anchorId) — LinkedIn keeps these for jump-nav
  //   2. closest('section') from the anchor — survives DOM class rewrites
  //   3. heading-text fallback — find <h2> matching "Experience" etc.
  function findSection(anchorId: string, headingText: string): Element | null {
    const anchor = document.getElementById(anchorId)
    if (anchor) {
      const section = anchor.closest('section')
      if (section) return section
      // No <section> ancestor — climb two levels which typically wraps content
      const granny = anchor.parentElement?.parentElement
      if (granny) return granny
    }
    // Heading-text fallback. LinkedIn often wraps the heading text in
    // span[aria-hidden="true"] inside the <h2>; match either.
    const headings = document.querySelectorAll('h2')
    for (const h of headings) {
      const t = (h.textContent ?? '').trim().toLowerCase()
      if (t === headingText.toLowerCase() || t.startsWith(headingText.toLowerCase())) {
        const section = h.closest('section')
        if (section) return section
        if (h.parentElement) return h.parentElement
      }
    }
    return null
  }

  // Pull entry list items from a section. LinkedIn renders entries as <li>
  // under a <ul>. Find the first <ul> whose direct children carry visible
  // spans (filters out nav lists, dropdown menus, etc.).
  function getEntries(section: Element | null): Element[] {
    if (!section) return []
    const uls = section.querySelectorAll('ul')
    for (const ul of uls) {
      const directLis = [...ul.querySelectorAll(':scope > li')].filter((li) =>
        li.querySelector('span[aria-hidden="true"]'),
      )
      if (directLis.length > 0) return directLis
    }
    // Last resort: any LI with an aria-hidden span
    return [...section.querySelectorAll('li')].filter((li) =>
      li.querySelector('span[aria-hidden="true"]'),
    )
  }

  // Read every aria-hidden span text inside an entry, in document order.
  // De-duplicates exact-repeat adjacent strings (LinkedIn sometimes renders
  // both visually-hidden and aria-hidden copies of the same text).
  function readVisibleSpans(entry: Element): string[] {
    const out: string[] = []
    const spans = entry.querySelectorAll('span[aria-hidden="true"]')
    spans.forEach((sp) => {
      const t = (sp.textContent ?? '').trim()
      if (t.length === 0) return
      if (out.length > 0 && out[out.length - 1] === t) return
      out.push(t)
    })
    return out
  }

  // LinkedIn date strings look like "Jan 2020 - Present · 3 yrs",
  // "2018 - 2022", "Sep 2019 - Aug 2023 · 4 yrs", etc.
  function looksLikeDateRange(s: string): boolean {
    return /\b(19|20)\d{2}\b/.test(s) && (/[-–—]/.test(s) || /present|current/i.test(s))
  }
  // Employment-type / location chips: "Full-time", "Part-time", "Remote", "Hybrid",
  // "On-site", "Contract" — often appear separated by " · " with the company.
  function isEmploymentMeta(s: string): boolean {
    return /^(full[- ]time|part[- ]time|contract|temporary|internship|freelance|self[- ]employed|remote|hybrid|on[- ]site)$/i.test(
      s.trim(),
    )
  }

  // ---- name -------------------------------------------------------------
  // Primary: <title> tag. LinkedIn formats it as "<Name> | LinkedIn" on every
  // profile page and this is the most stable signal we have — survives every
  // LinkedIn DOM rewrite. Fallback to DOM selectors if title parsing fails.
  let name: string | null = null
  const titleText = document.title || ''
  const titleMatch = titleText.match(/^\s*([^|]+?)\s*\|\s*(?:.*?LinkedIn|LinkedIn)/i)
  if (titleMatch && titleMatch[1] && titleMatch[1].trim().length > 0) {
    const candidate = titleMatch[1].trim()
    if (!/^\(\d+\+?\)/.test(candidate) && candidate.toLowerCase() !== 'feed') {
      name = candidate
    }
  }
  // DOM fallback — try a wide spread of selectors covering recent rewrites.
  if (!name) {
    const nameSelectors = [
      '[data-anonymize="person-name"]',
      'main h1',
      'h1.text-heading-xlarge',
      'main [aria-label*="name" i]',
      'h1',
    ]
    for (const sel of nameSelectors) {
      const v = txt(document.querySelector(sel))
      if (v && v.length < 100) {
        name = v
        break
      }
    }
  }

  // ---- top card (headline + location) -----------------------------------
  // The top card is the first <section> inside <main>. Headline is the first
  // text-body-medium element; location is the first text-body-small that
  // isn't a follower/connection count or "Contact info" button.
  let headline: string | null = null
  let location: string | null = null
  const topCard =
    document.querySelector('main section:first-of-type') ??
    document.querySelector('main section')
  if (topCard) {
    // Headline: scan candidate elements for the first non-name text body.
    const headlineCandidates = topCard.querySelectorAll(
      '.text-body-medium, div[class*="text-body-medium"]',
    )
    for (const el of headlineCandidates) {
      const t = (el.textContent ?? '').trim()
      if (!t || t === name) continue
      // Skip nav-bar bits & button labels
      if (/^\d+\s+(followers|connections|mutual)/i.test(t)) continue
      if (/^(contact info|message|connect|follow|more)$/i.test(t)) continue
      if (t.length > 0 && t.length < 300) {
        headline = t
        break
      }
    }
    // Location: smaller text body. Often the first .text-body-small without
    // follower/connection wording.
    const locCandidates = topCard.querySelectorAll(
      '.text-body-small, span[class*="text-body-small"]',
    )
    for (const el of locCandidates) {
      const t = (el.textContent ?? '').trim()
      if (!t || t === name || t === headline) continue
      if (/contact info|followers|connections|mutual|verifications?/i.test(t)) continue
      if (t.length > 0 && t.length < 200) {
        location = t
        break
      }
    }
  }

  // ---- about ------------------------------------------------------------
  let about: string | null = null
  const aboutSection = findSection('about', 'About')
  if (aboutSection) {
    // Take the longest aria-hidden span — the actual about body is invariably
    // the longest text in the section.
    const spans = [...aboutSection.querySelectorAll('span[aria-hidden="true"]')]
      .map((s) => (s.textContent ?? '').trim())
      .filter((t) => t.length > 20 && t.toLowerCase() !== 'about')
      .sort((a, b) => b.length - a.length)
    if (spans[0]) about = spans[0]
  }

  // ---- work experience --------------------------------------------------
  type WE = { title: string; company: string | null; dates: string | null }
  const experience: WE[] = []
  const expSection = findSection('experience', 'Experience')
  for (const entry of getEntries(expSection)) {
    const spans = readVisibleSpans(entry)
    if (spans.length === 0) continue
    const title = spans[0]
    if (!title) continue
    let company: string | null = null
    let dates: string | null = null
    for (let i = 1; i < spans.length; i++) {
      const s = spans[i]
      if (!s) continue
      if (!dates && looksLikeDateRange(s)) {
        dates = s
        continue
      }
      if (!company && !looksLikeDateRange(s)) {
        // Strip "· Full-time", "· Contract" suffixes
        const head = s.split('·')[0]?.trim() ?? s
        if (head.length > 0 && head.length < 200 && !isEmploymentMeta(head)) {
          company = head
        }
      }
    }
    experience.push({ title, company, dates })
    if (experience.length >= 30) break
  }

  // ---- education --------------------------------------------------------
  type ED = { school: string; degree: string | null; dates: string | null }
  const education: ED[] = []
  const eduSection = findSection('education', 'Education')
  for (const entry of getEntries(eduSection)) {
    const spans = readVisibleSpans(entry)
    if (spans.length === 0) continue
    const school = spans[0]
    if (!school) continue
    let degree: string | null = null
    let dates: string | null = null
    for (let i = 1; i < spans.length; i++) {
      const s = spans[i]
      if (!s) continue
      if (!dates && looksLikeDateRange(s)) {
        dates = s
        continue
      }
      if (!degree && !looksLikeDateRange(s) && s.length > 0 && s.length < 200) {
        degree = s
      }
    }
    education.push({ school, degree, dates })
    if (education.length >= 15) break
  }

  // ---- skills -----------------------------------------------------------
  const skills: string[] = []
  const skillsSection = findSection('skills', 'Skills')
  for (const entry of getEntries(skillsSection)) {
    const spans = readVisibleSpans(entry)
    const skill = spans[0]
    // Skip "Endorsed by N connections" type strings
    if (skill && skill.length < 100 && !/^endorsed by/i.test(skill)) {
      skills.push(skill)
      if (skills.length >= 100) break
    }
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
  // Log a compact summary first, then a rich diagnostic dump that helps us
  // iterate selectors when extraction misses. The dump deliberately avoids
  // raw outerHTML (could contain PII) and instead reports structural signals.
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

  // Helper for the dump: collect up to N tag+class signatures of elements
  // matching a selector. Skips text/PII so we can paste this safely.
  function signatures(selector: string, n: number): string[] {
    const out: string[] = []
    const nodes = document.querySelectorAll(selector)
    for (let i = 0; i < nodes.length && out.length < n; i++) {
      const el = nodes[i]
      if (!el) continue
      const cls = String((el as HTMLElement).className || '').split(/\s+/).slice(0, 3).join('.')
      out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`)
    }
    return out
  }
  // Just the heading text for h2s (low PII risk — these are section titles)
  function h2Texts(): string[] {
    return [...document.querySelectorAll('h2')]
      .map((h) => (h.textContent ?? '').trim().slice(0, 60))
      .filter((t) => t.length > 0)
      .slice(0, 20)
  }
  // Probe whether the section anchors exist in any form
  function anchorPresence(): Record<string, boolean> {
    const ids = ['about', 'experience', 'education', 'skills', 'licenses_and_certifications']
    const out: Record<string, boolean> = {}
    for (const id of ids) {
      out[`#${id}`] = !!document.getElementById(id)
    }
    return out
  }
  // Detect anchors LinkedIn uses for "Show all" deep links — these are very
  // stable URL patterns (e.g. /in/<id>/details/experience).
  function detailsLinks(): string[] {
    const hits = [...document.querySelectorAll('a[href*="/details/"]')]
      .map((a) => (a as HTMLAnchorElement).getAttribute('href') || '')
      .map((h) => h.replace(/^.*\/details\//, 'details/').slice(0, 60))
    return [...new Set(hits)].slice(0, 10)
  }

  // eslint-disable-next-line no-console
  console.log('[Altus diagnostics]', {
    pathname: window.location.pathname,
    main_exists: !!document.querySelector('main'),
    h1_count: document.querySelectorAll('h1').length,
    h2_count: document.querySelectorAll('h2').length,
    section_count: document.querySelectorAll('section').length,
    main_section_count: document.querySelectorAll('main section').length,
    anchor_presence: anchorPresence(),
    h2_texts: h2Texts(),
    details_links: detailsLinks(),
    top_card_first_main_section: signatures('main section:first-of-type > div', 5),
    text_body_medium_count: document.querySelectorAll('.text-body-medium').length,
    text_body_small_count: document.querySelectorAll('.text-body-small').length,
    aria_hidden_span_count: document.querySelectorAll('span[aria-hidden="true"]').length,
    pvs_list_item_count: document.querySelectorAll('li.pvs-list__item--line-separated').length,
    artdeco_list_item_count: document.querySelectorAll('li.artdeco-list__item').length,
    sections_above_main: signatures('main > section', 8),
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

