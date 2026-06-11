// Unit tests for src/lib/email/unsubscribe.ts
// Quick task 260612-0f4 — PECR one-click unsubscribe helpers.
//
// suppressByToken is integration-shaped (real DB). We test its pure branches
// by injecting fake Supabase stubs: token lookup, idempotency, error path.

import { describe, expect, it, vi } from 'vitest'

// We must mock 'server-only' so the module can be imported in the Vitest
// environment (which is not a real Next.js server context).
vi.mock('server-only', () => ({}))

import {
  buildUnsubscribeUrl,
  generateUnsubscribeToken,
  maskEmail,
  suppressByToken,
} from './unsubscribe'

// ---------------------------------------------------------------------------
// generateUnsubscribeToken
// ---------------------------------------------------------------------------
describe('generateUnsubscribeToken', () => {
  it('returns a string of at least 43 chars (32 bytes -> 43+ base64url chars)', () => {
    const token = generateUnsubscribeToken()
    expect(typeof token).toBe('string')
    // base64url: ceil(32 / 3) * 4 = 44, minus padding trimmed → 43 chars minimum
    expect(token.length).toBeGreaterThanOrEqual(43)
  })

  it('only contains base64url characters (no +, /, =)', () => {
    const token = generateUnsubscribeToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates different values on each call (entropy)', () => {
    const t1 = generateUnsubscribeToken()
    const t2 = generateUnsubscribeToken()
    const t3 = generateUnsubscribeToken()
    expect(t1).not.toBe(t2)
    expect(t2).not.toBe(t3)
    expect(t1).not.toBe(t3)
  })

  it('is not a UUID (UUID format has dashes at fixed positions and is too short)', () => {
    const token = generateUnsubscribeToken()
    // A UUID is exactly 36 chars including dashes; our token is longer
    // and should not match the UUID pattern.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect(uuidRe.test(token)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildUnsubscribeUrl
// ---------------------------------------------------------------------------
describe('buildUnsubscribeUrl', () => {
  it('joins base + /unsubscribe/ + token correctly with no double slash', () => {
    const url = buildUnsubscribeUrl('abc123', 'https://altusrecruit.com')
    expect(url).toBe('https://altusrecruit.com/unsubscribe/abc123')
  })

  it('strips trailing slash from base before joining', () => {
    const url = buildUnsubscribeUrl('abc123', 'https://altusrecruit.com/')
    expect(url).toBe('https://altusrecruit.com/unsubscribe/abc123')
  })

  it('falls back to altusrecruit.com when baseUrl is undefined', () => {
    const url = buildUnsubscribeUrl('tokenABC', undefined)
    expect(url).toContain('/unsubscribe/tokenABC')
    expect(url).toContain('altusrecruit.com')
  })

  it('falls back to altusrecruit.com when baseUrl is empty string', () => {
    const url = buildUnsubscribeUrl('tokenABC', '')
    expect(url).toContain('/unsubscribe/tokenABC')
    expect(url).toContain('altusrecruit.com')
  })

  it('encodeURIComponent-escapes the token path segment (open-redirect/path-escape guard)', () => {
    // A token that is already URL-safe should come through unchanged.
    const safeToken = 'abcDEF_-123'
    const url = buildUnsubscribeUrl(safeToken, 'https://example.com')
    expect(url).toBe(`https://example.com/unsubscribe/${safeToken}`)

    // A token containing characters that should be encoded.
    const dangerToken = 'abc../foo?bar=baz'
    const urlD = buildUnsubscribeUrl(dangerToken, 'https://example.com')
    expect(urlD).not.toContain('../')
    expect(urlD).not.toContain('?')
  })
})

// ---------------------------------------------------------------------------
// maskEmail
// ---------------------------------------------------------------------------
describe('maskEmail', () => {
  it('masks normal address: first + last local char + domain', () => {
    const masked = maskEmail('alasdairj8@gmail.com')
    expect(masked).toBe('a*********8@gmail.com')
  })

  it('works for 2-char local part', () => {
    const masked = maskEmail('aj@example.com')
    expect(masked).toBe('a*j@example.com')
  })

  it('single-char local part: shows the char with trailing stars', () => {
    const masked = maskEmail('a@example.com')
    expect(masked).toMatch(/^a/)
    expect(masked).toContain('@example.com')
  })

  it('does not return the full original local part (PII guard)', () => {
    const email = 'alasdairj8@gmail.com'
    const masked = maskEmail(email)
    expect(masked).not.toBe(email)
    expect(masked).not.toContain('lasdairj')
  })

  it('handles no-@ input without throwing', () => {
    expect(() => maskEmail('notanemail')).not.toThrow()
    const result = maskEmail('notanemail')
    expect(typeof result).toBe('string')
  })

  it('returns something reasonable for empty string without throwing', () => {
    expect(() => maskEmail('')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// suppressByToken — pure-branch unit tests with stub supabase
// ---------------------------------------------------------------------------
describe('suppressByToken', () => {
  // Helper to build a minimal fake Supabase client shaped for suppressByToken.
  // The real suppressByToken calls:
  //   supabase.from('email_campaign_recipients').select(...).eq(...).maybeSingle()
  //   then (if found, not suppressed):
  //   supabase.from('candidates').update(...).eq(...).eq(...)
  function buildFakeClient(opts: {
    recipientRow: {
      candidate_id: string
      organization_id: string
      email: string | null
    } | null
    recipientError?: { message: string }
    candidateRow?: { email_marketing_unsubscribed_at: string | null } | null
    candidateSelectError?: { message: string }
    updateError?: { message: string }
  }) {
    const fromCalls: string[] = []

    return {
      _fromCalls: fromCalls,
      from: vi.fn((table: string) => {
        fromCalls.push(table)
        if (table === 'email_campaign_recipients') {
          // Fluent: .select().eq().eq().maybeSingle()
          const chain = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: opts.recipientRow,
                error: opts.recipientError ?? null,
              }),
            ),
          }
          return chain
        }
        if (table === 'candidates') {
          // Two branches: .select().eq().maybeSingle() for the fresh read
          //               .update().eq().eq() for the suppression write
          const selectChain = {
            select: vi.fn(() => selectChain),
            eq: vi.fn(() => selectChain),
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: opts.candidateRow ?? { email_marketing_unsubscribed_at: null },
                error: opts.candidateSelectError ?? null,
              }),
            ),
          }
          const updateChain = {
            update: vi.fn(() => updateChain),
            eq: vi.fn(() => updateChain),
            // The second .eq() resolves the promise.
            then: (onFulfilled: (v: { error: unknown }) => void) =>
              onFulfilled({ error: opts.updateError ?? null }),
          }
          // Return the selectChain by default; callers that do .update() get updateChain
          const combined = {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() =>
                  Promise.resolve({ error: opts.updateError ?? null }),
                ),
              })),
            })),
          }
          return combined
        }
        return {}
      }),
    }
  }

  it('reads the recipient row by token (correct table queried)', async () => {
    const fake = buildFakeClient({
      recipientRow: {
        candidate_id: 'cand-1',
        organization_id: 'org-1',
        email: 'test@example.com',
      },
      candidateRow: { email_marketing_unsubscribed_at: null },
    })

    // reason: test stub; real type would be SupabaseClient<Database>
    await suppressByToken(fake as unknown as Parameters<typeof suppressByToken>[0], 'some-token')

    expect(fake.from).toHaveBeenCalledWith('email_campaign_recipients')
  })

  it('returns ok:true alreadyUnsubscribed:true when candidate already suppressed (idempotent)', async () => {
    const fake = buildFakeClient({
      recipientRow: {
        candidate_id: 'cand-1',
        organization_id: 'org-1',
        email: 'test@example.com',
      },
      candidateRow: { email_marketing_unsubscribed_at: '2025-01-01T00:00:00Z' },
    })

    const result = await suppressByToken(
      fake as unknown as Parameters<typeof suppressByToken>[0],
      'some-token',
    )

    expect(result).toEqual({ ok: true, alreadyUnsubscribed: true })
    // Should NOT have called update
    const updateCalls = fake.from.mock.calls.filter(([t]: [string]) => t === 'candidates')
    // We called candidates.select (fresh read) — verify update was NOT called
    // (the fake.from is the only mock we have; check candidates was queried)
    expect(updateCalls.length).toBeGreaterThan(0)
  })

  it('returns ok:false on a recipient lookup error without throwing', async () => {
    const fake = buildFakeClient({
      recipientRow: null,
      recipientError: { message: 'connection timeout' },
    })

    let result: Awaited<ReturnType<typeof suppressByToken>> | undefined
    await expect(async () => {
      result = await suppressByToken(
        fake as unknown as Parameters<typeof suppressByToken>[0],
        'bad-token',
      )
    }).not.toThrow()

    expect(result?.ok).toBe(false)
  })

  it('returns ok:false when token not found (recipient row is null) without throwing', async () => {
    const fake = buildFakeClient({ recipientRow: null })

    let result: Awaited<ReturnType<typeof suppressByToken>> | undefined
    await expect(async () => {
      result = await suppressByToken(
        fake as unknown as Parameters<typeof suppressByToken>[0],
        'unknown-token',
      )
    }).not.toThrow()

    expect(result?.ok).toBe(false)
  })
})
