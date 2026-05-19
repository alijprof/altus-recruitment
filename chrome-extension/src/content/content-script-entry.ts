/**
 * Plan 03-01 Task A.1 — content script entry.
 *
 * Runs in the MAIN world of every `https://www.linkedin.com/in/*` page
 * (per manifest's `content_scripts` entry). Exposes the scraper as a
 * global so the background worker can call it via chrome.scripting
 * (D3-28: popup-only UX, no DOM injection beyond this hook).
 *
 * Per HARD RULE 7: host_permissions are LinkedIn-only — this entry never
 * runs anywhere else.
 */

import { scrapeLinkedInProfile } from './scrape-profile'

declare global {
  var __altusScrape: typeof scrapeLinkedInProfile | undefined
}

globalThis.__altusScrape = scrapeLinkedInProfile
