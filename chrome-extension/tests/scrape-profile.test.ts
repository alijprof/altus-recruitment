/**
 * @vitest-environment jsdom
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-01 executor replaces `.todo` with real
// `.it` bodies once chrome-extension/ package + scrape implementation lands.
// The fixture file (linkedin-profile-2026-05-19.html) is empty for now;
// Plan 03-01 captures an anonymized real LinkedIn profile DOM snapshot.

describe('chrome-extension scrape-profile (LINKEDIN-01)', () => {
  it.todo('extracts name + headline + location from canonical LinkedIn profile')
  it.todo('handles missing About section gracefully (no exception)')
  it.todo('handles missing work-experience section gracefully')
  it.todo('handles missing education section gracefully')
  it.todo('handles missing skills section gracefully')
  it.todo('uses aria/data-test/h2 anchors — not class-name selectors')
})
