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
    const step = Math.max(800, Math.floor(window.innerHeight * 0.9))
    // Scroll in passes — each pass may reveal more content (the page grows
    // as lazy-loads land). 15 steps × 800px covers ~12000px which is more
    // than any realistic profile page.
    let pos = 0
    for (let i = 0; i < 15; i++) {
      pos += step
      if (pos > scroller.scrollHeight) pos = scroller.scrollHeight
      window.scrollTo({ top: pos, behavior: 'instant' as ScrollBehavior })
      await sleep(250)
      if (pos >= scroller.scrollHeight) break
    }
    // Back to top so the user's view isn't disturbed
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    await sleep(300)
  }

  await forceLazyMount()

  // Live UAT (Tony Wilson capture, 2026-05-22) showed LinkedIn shipped a DOM
  // where section anchor ids (#experience etc.) are gone and class names are
  // hashed (`._6d2dbe5a`, `._81841adb`) — they change every deploy and are
  // useless as selectors. The only stable signals left:
  //   - <h2> heading text ("Experience", "Education", "Skills", "About")
  //   - <span aria-hidden="true"> for visible entry text
  //   - <li> elements as entry containers
  // So everything below uses h2-text + structural traversal.
  function findSectionByH2(headingText: string): Element | null {
    const wanted = headingText.toLowerCase()
    const headings = [...document.querySelectorAll('h2')]
    for (const h of headings) {
      const t = (h.textContent ?? '').trim().toLowerCase()
      if (t !== wanted) continue
      // Walk up to the nearest <section> (LinkedIn's current top-level
      // section container). Fall back to climbing 4 levels if no <section>.
      const section = h.closest('section')
      if (section) return section
      let el: Element | null = h.parentElement
      for (let i = 0; i < 4 && el; i++) {
        if (el.tagName === 'SECTION') return el
        if (el.querySelector('ul li')) return el
        el = el.parentElement
      }
      return h.parentElement
    }
    return null
  }

  // Top-level entries within a section. LinkedIn's modern profile DOM
  // (Tony Wilson capture v0.1.5) showed two failure modes:
  //   - Experience section has <li>s but no aria-hidden spans inside.
  //   - Education / Skills sections have NO <li>s at all.
  // So entries are now sourced by two strategies tried in order:
  //   1. <li> elements (top-level only — sub-bullets filtered out)
  //   2. anchor-based fallback: each unique entry container holding a
  //      content-bearing <a> (company/school link, or any non-/details/ link)
  function getEntries(
    section: Element | null,
    hrefHint: 'company' | 'school' | 'any',
  ): Element[] {
    if (!section) return []

    const lis = [...section.querySelectorAll('li')].filter((li) => {
      const ancestor = li.parentElement?.closest('li')
      const isTopLevel = !ancestor || ancestor === li
      if (!isTopLevel) return false
      const t = (li.textContent ?? '').trim()
      return t.length > 0
    })
    if (lis.length > 0) return lis

    // Anchor-based fallback. Pick anchors matching the section type, skip
    // section-internal nav (Show all <N> at /details/...).
    const selectors: string[] = []
    if (hrefHint === 'company') selectors.push('a[href*="/company/"]')
    if (hrefHint === 'school') selectors.push('a[href*="/school/"]', 'a[href*="/company/"]')
    selectors.push('a[href]')

    let anchors: HTMLAnchorElement[] = []
    for (const sel of selectors) {
      anchors = [...section.querySelectorAll(sel)].filter((a) => {
        const href = (a as HTMLAnchorElement).getAttribute('href') || ''
        if (!href || href === '#') return false
        if (/\/details\//.test(href)) return false
        const t = (a.textContent ?? '').trim()
        return t.length > 0
      }) as HTMLAnchorElement[]
      if (anchors.length > 0) break
    }

    // Group anchors by their nearest sibling-level container — climb the
    // anchor's ancestor chain until we hit an element whose parent has
    // multiple children (i.e., it's one of N siblings = an entry).
    const containers = new Set<Element>()
    for (const a of anchors) {
      let el: Element | null = a
      for (let i = 0; i < 6 && el && el !== section; i++) {
        const parentEl: HTMLElement | null = el.parentElement
        if (!parentEl || parentEl === section) break
        if (parentEl.children.length > 1) break
        el = parentEl
      }
      if (el && el !== section && el !== a) {
        containers.add(el)
      } else {
        // Last resort: the anchor itself counts as the entry container
        containers.add(a)
      }
    }
    return [...containers]
  }

  // Walk all visible text nodes inside an entry. Skips text inside
  // visually-hidden / sr-only spans (these are screen-reader duplicates).
  // De-dupes adjacent and identical strings.
  function readEntryText(entry: Element): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement
        while (p && p !== entry) {
          const cls = String((p as HTMLElement).className || '')
          if (/visually-hidden|sr-only/i.test(cls)) return NodeFilter.FILTER_REJECT
          p = p.parentElement
        }
        const t = (node.textContent ?? '').trim()
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })
    let n: Node | null = walker.nextNode()
    while (n) {
      const t = (n.textContent ?? '').trim()
      if (t.length > 0 && !seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
      n = walker.nextNode()
    }
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
  // The top card has no usable class names anymore (CSS-Modules-style hashed
  // classes change every deploy). Anchor by the h2 whose text matches the
  // captured name, walk to the top card container, then text-walk for the
  // first two leaf strings that aren't the name and aren't button/counter
  // chrome.
  let headline: string | null = null
  let location: string | null = null
  if (name) {
    let nameH2: Element | null = null
    for (const h of document.querySelectorAll('h2')) {
      if ((h.textContent ?? '').trim() === name) {
        nameH2 = h
        break
      }
    }
    const topCard = nameH2?.closest('section') ?? nameH2?.parentElement?.parentElement ?? null
    if (topCard) {
      // Collect leaf text nodes in DOM order, dedup, then classify.
      const seen = new Set<string>()
      const leafTexts: string[] = []
      const walker = document.createTreeWalker(topCard, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const t = (node.textContent ?? '').trim()
        if (t && t.length >= 2 && t.length <= 300 && !seen.has(t)) {
          seen.add(t)
          leafTexts.push(t)
        }
        node = walker.nextNode()
      }
      // Reject obvious chrome. Strip leading separator/whitespace first
      // because LinkedIn renders degree badges as "· 2nd" (middle-dot
      // U+00B7 + space + ordinal).
      const reject = (raw: string): boolean => {
        const t = raw.replace(/^[\s·•|]+/, '').trim()
        if (!t || t === name) return true
        if (/^\d+(\.\d+)?[KM]?\+?\s*(followers|connections|mutual|reactions|views?|connection)/i.test(t)) return true
        if (/^(contact info|message|connect|follow|following|more|see contact info|verified|open to work|hiring|share profile|edit profile|save|see all)$/i.test(t)) return true
        if (/^(he\/him|she\/her|they\/them|he\/his|she\/her\/hers)/i.test(t)) return true
        if (/^\d+(st|nd|rd|th)\+?(\s|$)/i.test(t)) return true
        if (/^[·•|\-]+$/.test(t)) return true
        if (/^(available|active|online|now)$/i.test(t)) return true
        return false
      }
      // Also strip leading separators from candidates so the chosen value
      // isn't "· 2nd" — we want clean text.
      const clean = (raw: string): string => raw.replace(/^[\s·•|]+/, '').trim()
      const candidates = leafTexts.filter((t) => !reject(t)).map(clean)

      // Classification heuristics. A location looks like "City, Country" or
      // mentions "Area" / "Region" — and crucially does NOT contain company
      // or school suffixes. A company/school line is the "Acme Ltd · The
      // University of X" subtitle LinkedIn shows below the headline.
      const looksLikeCompanySchool = (t: string): boolean =>
        /\b(ltd|inc|llc|gmbh|co\.|corp|university|college|school|academy|institute|plc)\b/i.test(t)
      const looksLikeLocation = (t: string): boolean => {
        if (looksLikeCompanySchool(t)) return false
        if (t.includes(',')) return true
        if (/\b(area|region|county|metropolitan)\b/i.test(t)) return true
        return false
      }

      // Pick the first candidate as headline (LinkedIn renders it directly
      // under the name). Then pick the first location-looking candidate
      // among the rest. If no location candidate matches, fall back to the
      // first remaining non-company/school line.
      if (candidates[0]) headline = candidates[0]
      const rest = candidates.slice(1)
      for (const t of rest) {
        if (looksLikeLocation(t)) {
          location = t
          break
        }
      }
      if (!location) {
        for (const t of rest) {
          if (!looksLikeCompanySchool(t)) {
            location = t
            break
          }
        }
      }
    }
  }

  // ---- about ------------------------------------------------------------
  let about: string | null = null
  const aboutSection = findSectionByH2('About')
  if (aboutSection) {
    // Take the longest text node in the section — the actual about body is
    // invariably the longest text. Text-walker (skips visually-hidden) so
    // we don't rely on aria-hidden spans being present.
    const texts = readEntryText(aboutSection)
      .filter((t) => t.length > 20 && t.toLowerCase() !== 'about')
      .sort((a, b) => b.length - a.length)
    if (texts[0]) about = texts[0]
  }

  // ---- work experience --------------------------------------------------
  type WE = { title: string; company: string | null; dates: string | null }
  const experience: WE[] = []
  const expSection = findSectionByH2('Experience')
  for (const entry of getEntries(expSection, 'company')) {
    const spans = readEntryText(entry)
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
  const eduSection = findSectionByH2('Education')
  for (const entry of getEntries(eduSection, 'school')) {
    const spans = readEntryText(entry)
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
  const skillsSection = findSectionByH2('Skills')
  for (const entry of getEntries(skillsSection, 'any')) {
    const spans = readEntryText(entry)
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

