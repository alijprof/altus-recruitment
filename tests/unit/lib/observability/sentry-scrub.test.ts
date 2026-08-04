/**
 * @vitest-environment node
 *
 * Shared Sentry PII scrubbing — review 2026-08-04 M7.
 *
 * The client SDK's beforeSend used to be materially weaker than the server's
 * (cookies + user.email only, no recursive scrub, no breadcrumb handling)
 * while client components do capture raw error objects and browser
 * breadcrumbs do record fetch/navigation URLs. `/candidates?q=<search terms>`
 * is exactly what CLAUDE.md forbids sending. Both configs now import this
 * module; these tests pin its behaviour.
 */
import { describe, expect, it } from 'vitest'

import { PII_KEYS, scrub, stripQueryString } from '@/lib/observability/sentry-scrub'

describe('scrub', () => {
  it('redacts every PII key at the top level', () => {
    const input = Object.fromEntries(PII_KEYS.map((k) => [k, 'sensitive']))
    const out = scrub(input) as Record<string, unknown>
    for (const key of PII_KEYS) {
      expect(out[key]).toBe('[REDACTED]')
    }
  })

  it('redacts PII nested inside objects and arrays', () => {
    const out = scrub({
      org_id: 'org-1',
      payload: { candidates: [{ full_name: 'Jane Doe', email: 'jane@example.com', id: 'c1' }] },
    }) as { org_id: string; payload: { candidates: Array<Record<string, unknown>> } }

    expect(out.org_id).toBe('org-1')
    const candidate = out.payload.candidates[0]!
    expect(candidate.full_name).toBe('[REDACTED]')
    expect(candidate.email).toBe('[REDACTED]')
    expect(candidate.id).toBe('c1')
  })

  it('passes primitives and null through unchanged', () => {
    expect(scrub(null)).toBeNull()
    expect(scrub(undefined)).toBeUndefined()
    expect(scrub('plain')).toBe('plain')
    expect(scrub(42)).toBe(42)
  })
})

describe('stripQueryString', () => {
  it('drops recruiter search terms from a relative URL', () => {
    expect(stripQueryString('/candidates?q=senior%20python%20offshore%20wind')).toBe('/candidates')
    expect(stripQueryString('/search?q=acme+ltd&mode=semantic')).toBe('/search')
  })

  it('drops the query string from an absolute URL, keeping the path', () => {
    expect(stripQueryString('https://altusrecruit.com/candidates?q=jane')).toBe(
      'https://altusrecruit.com/candidates',
    )
  })

  it('drops fragments too', () => {
    expect(stripQueryString('/candidates/abc#notes')).toBe('/candidates/abc')
  })

  it('leaves a clean path alone', () => {
    expect(stripQueryString('/jobs/123')).toBe('/jobs/123')
    expect(stripQueryString('')).toBe('')
  })
})
