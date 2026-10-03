/**
 * @vitest-environment node
 *
 * 2026-09-10 incident: the Anthropic API org ran out of prepaid credits and
 * every Claude call failed with a 400 "credit balance is too low" — surfaced
 * only as the generic "Parsing failed" copy for three weeks. These tests pin
 * the account-level classification (isAIProviderUnavailable) and the single
 * fatal Sentry alert runWithLogging files for it.
 *
 * Same mocked-SDK idiom as cv-parse-truncation.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CV_AI_UNAVAILABLE_MESSAGE,
  isBudgetCapped,
  isUnretryableParseFailure,
} from '@/lib/cv/parse-messages'

vi.mock('server-only', () => ({}))

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  addBreadcrumb: vi.fn(),
}))

let recordedRpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      recordedRpcCalls.push({ fn, args })
      return { data: null, error: null }
    }),
  }),
}))

vi.mock('@/lib/stripe/cap-enforcement', () => ({
  checkCap: vi.fn(async () => ({ allow: true, mode: 'normal', bucket: 'cv_parse' })),
  CapExceededError: class CapExceededError extends Error {},
}))

vi.mock('@/lib/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'sk-ant-test-fake',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake',
  },
}))

class MockAPIError extends Error {
  constructor(
    public status: number | undefined,
    message: string,
    public type: string | null = null,
  ) {
    super(message)
  }
}

let nextError: unknown = null
const messagesCreate = vi.fn(async () => {
  throw nextError
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: messagesCreate }
    static APIError = MockAPIError
  },
}))

const { isAIProviderUnavailable, parseCV } = await import('@/lib/ai/claude')

const CREDIT_MESSAGE =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'

beforeEach(() => {
  recordedRpcCalls = []
  messagesCreate.mockClear()
  captureException.mockClear()
})

describe('isAIProviderUnavailable', () => {
  it('flags the out-of-credits 400', () => {
    expect(isAIProviderUnavailable(new MockAPIError(400, CREDIT_MESSAGE))).toBe(true)
  })

  it('flags auth, billing and permission failures', () => {
    expect(isAIProviderUnavailable(new MockAPIError(401, 'invalid x-api-key'))).toBe(true)
    expect(isAIProviderUnavailable(new MockAPIError(402, 'payment required'))).toBe(true)
    expect(isAIProviderUnavailable(new MockAPIError(403, 'forbidden'))).toBe(true)
    expect(isAIProviderUnavailable(new MockAPIError(400, 'x', 'billing_error'))).toBe(true)
  })

  it('does not flag request-specific or transient errors', () => {
    expect(isAIProviderUnavailable(new MockAPIError(400, 'max_tokens: must be positive'))).toBe(
      false,
    )
    expect(isAIProviderUnavailable(new MockAPIError(429, 'rate limited'))).toBe(false)
    expect(isAIProviderUnavailable(new MockAPIError(500, 'api error'))).toBe(false)
    expect(isAIProviderUnavailable(new Error('credit balance is too low'))).toBe(false)
    expect(isAIProviderUnavailable(null)).toBe(false)
  })
})

describe('runWithLogging on an unusable account', () => {
  it('rethrows without retrying, logs one _failed usage row, and files one fatal alert', async () => {
    nextError = new MockAPIError(400, CREDIT_MESSAGE)

    await expect(parseCV({ cvText: 'a CV', organizationId: 'org-1' })).rejects.toBe(nextError)

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(recordedRpcCalls).toHaveLength(1)
    expect(recordedRpcCalls[0]?.args.p_purpose).toBe('cv_parse_failed')

    expect(captureException).toHaveBeenCalledTimes(1)
    const [error, context] = captureException.mock.calls[0] as [
      Error,
      { level: string; fingerprint: string[]; tags: Record<string, string> },
    ]
    expect(error.message).toBe('AIProviderUnavailable: 400')
    // R4: the SDK message (which can carry prompt fragments) never reaches Sentry.
    expect(error.message).not.toContain('credit balance')
    expect(context.level).toBe('fatal')
    expect(context.fingerprint).toEqual(['ai-provider-unavailable'])
    expect(context.tags).toMatchObject({ alert: 'ai_provider_unavailable', purpose: 'cv_parse' })
  })

  it('does not file the alert for an ordinary request error', async () => {
    nextError = new MockAPIError(400, 'messages: text content blocks must be non-empty')

    await expect(parseCV({ cvText: 'a CV', organizationId: 'org-1' })).rejects.toBe(nextError)

    expect(captureException).not.toHaveBeenCalled()
    expect(recordedRpcCalls[0]?.args.p_purpose).toBe('cv_parse_failed')
  })
})

describe('CV_AI_UNAVAILABLE_MESSAGE', () => {
  it('stays retryable and out of the budget-cap auto-resume path', () => {
    expect(isUnretryableParseFailure(CV_AI_UNAVAILABLE_MESSAGE)).toBe(false)
    expect(isBudgetCapped(CV_AI_UNAVAILABLE_MESSAGE)).toBe(false)
  })
})
