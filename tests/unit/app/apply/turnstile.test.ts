/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub server-only and env so the helper can be imported in node test env.
vi.mock('server-only', () => ({}))

const FIXED_SECRET = 'test-secret'
vi.mock('@/lib/env', () => ({
  env: { TURNSTILE_SECRET_KEY: FIXED_SECRET },
}))

describe('verifyTurnstileToken', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns success: true when Cloudflare responds with success: true', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const { verifyTurnstileToken } = await import('@/lib/integrations/turnstile')
    const result = await verifyTurnstileToken('valid-token', '203.0.113.5')
    expect(result.success).toBe(true)
  })

  it('returns success: false with error-codes from Cloudflare', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const { verifyTurnstileToken } = await import('@/lib/integrations/turnstile')
    const result = await verifyTurnstileToken('bogus-token')
    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('invalid-input-response')
  })

  it('returns network-error code on fetch throw', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch

    const { verifyTurnstileToken } = await import('@/lib/integrations/turnstile')
    const result = await verifyTurnstileToken('whatever')
    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('network-error')
  })

  it('returns http-<status> when Cloudflare returns non-200', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Bad Request', { status: 400 })
    }) as unknown as typeof fetch

    const { verifyTurnstileToken } = await import('@/lib/integrations/turnstile')
    const result = await verifyTurnstileToken('any')
    expect(result.success).toBe(false)
    expect(result.errorCodes?.[0]).toBe('http-400')
  })

  it('returns missing-config when secret is absent', async () => {
    vi.resetModules()
    vi.doMock('@/lib/env', () => ({ env: {} }))
    const { verifyTurnstileToken } = await import('@/lib/integrations/turnstile')
    const result = await verifyTurnstileToken('any')
    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('missing-config')
  })
})
