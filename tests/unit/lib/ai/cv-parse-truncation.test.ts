/**
 * @vitest-environment node
 *
 * RED test for the max_tokens truncation class (06-RESEARCH.md rank 6;
 * 06-05-PLAN.md Task 3). `CVParseTruncatedError` does not exist yet — plan
 * 06-06 adds it. This file imports it BY NAME (via a dynamic
 * `await import('@/lib/ai/claude')`, matching the mocked-SDK convention
 * already used by tests/unit/lib/ai/whisper.test.ts) precisely so that
 * referencing it stays RED until 06-06 lands, while the other, unrelated
 * behaviours in this file (unaffected by the missing export, since a
 * dynamic import's destructured binding for a genuinely-missing name is
 * simply `undefined` rather than a module-load failure) can still prove
 * `parseCV` / `parseCVDetailed` don't regress today.
 *
 * The exact export plan 06-06 must add, so this file turns green:
 *   export class CVParseTruncatedError extends Error {
 *     name = 'CVParseTruncatedError'
 *   }
 *
 * RED CONTRACT:
 *   - "exports CVParseTruncatedError" — RED today: `CVParseTruncatedError`
 *     is `undefined` (the module genuinely does not export it).
 *   - "rejects ... empty/unusable tool input" — RED today for a DIFFERENT,
 *     more meaningful reason: `parseCV` has no truncation guard at all yet
 *     (src/lib/ai/claude.ts:361-371 casts `toolUse.input` unconditionally),
 *     so it RESOLVES with an empty profile instead of REJECTING — the exact
 *     Tier-3 "silent complete with empty profile" violation this class
 *     exists to prevent (06-CONTEXT.md).
 *   - "resolves normally when ... substantively populated" and "stop_reason
 *     tool_use — unaffected" are NOT red — they document behaviour that must
 *     keep working once the guard lands, proven directly against today's
 *     code (06-RESEARCH.md Pitfall 2: sanitising blindly must not break
 *     what already works).
 *
 * pnpm typecheck note: this file's dynamic import destructures a property
 * TypeScript knows @/lib/ai/claude does not (yet) export —
 * `pnpm typecheck` therefore reports exactly one new error class here. This
 * is the "one expected error class" the plan-level <verification> in
 * 06-05-PLAN.md documents; Task 3's own <verify> step deliberately does not
 * run `pnpm typecheck` because of it. `vitest run` uses esbuild transforms
 * that strip types without type-checking, so the file executes fine despite
 * the TS error.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the SDK, not the wrapper — server-only / Sentry / service client /
// cap-enforcement / env all need mocking too, same idiom as
// tests/unit/lib/ai/whisper.test.ts.
vi.mock('server-only', () => ({}))
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

let recordedRpcCalls: Array<{ fn: string; args: unknown }> = []
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: vi.fn(async (fn: string, args: unknown) => {
      recordedRpcCalls.push({ fn, args })
      return { data: null, error: null }
    }),
  }),
}))

vi.mock('@/lib/stripe/cap-enforcement', () => ({
  checkCap: vi.fn(async () => ({ allow: true, mode: 'normal', bucket: 'cv_parse' })),
  CapExceededError: class CapExceededError extends Error {
    constructor(
      public bucket: string,
      public purpose: string,
      public organizationId: string,
    ) {
      super('AI cap exceeded')
      this.name = 'CapExceededError'
    }
  },
}))

vi.mock('@/lib/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'sk-ant-test-fake',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake',
  },
}))

// Scripted Anthropic response — overridden per test. Shape matches exactly
// what src/lib/ai/claude.ts's parseCVDetailed reads off the SDK response:
// content[].{type,name,input}, stop_reason, usage.{input_tokens,output_tokens}.
type ScriptedMessage = {
  stop_reason: string
  content: Array<{ type: string; name?: string; input?: unknown }>
  usage: { input_tokens: number; output_tokens: number }
}

let scriptedResponse: ScriptedMessage = {
  stop_reason: 'tool_use',
  content: [
    { type: 'tool_use', name: 'extract_cv_fields', input: { name: 'Jane Doe', confidence_per_field: {} } },
  ],
  usage: { input_tokens: 100, output_tokens: 50 },
}

const messagesCreate = vi.fn(async () => scriptedResponse)

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status?: number
  }
  return {
    default: class MockAnthropic {
      messages = { create: messagesCreate }
      static APIError = MockAPIError
    },
  }
})

// Dynamic import, mirroring 06-05-PLAN.md <action> and the harness's own
// `await import('@/lib/db/candidate-cvs')` pattern: vi.mock() calls above
// are hoisted regardless, but a dynamic import here also means
// `CVParseTruncatedError` being genuinely absent from the module resolves
// to `undefined` rather than aborting collection of this whole file — which
// is what lets the "must not regress" tests below still run meaningfully.
const { CVParseTruncatedError, parseCV, parseCVDetailed } = await import('@/lib/ai/claude')

beforeEach(() => {
  recordedRpcCalls = []
  messagesCreate.mockClear()
})

describe('CV parse truncation (max_tokens) — C6', () => {
  it('exports CVParseTruncatedError from @/lib/ai/claude (RED until plan 06-06 adds it)', () => {
    expect(CVParseTruncatedError).toBeDefined()
  })

  it('rejects with CVParseTruncatedError when max_tokens truncation yields an empty/unusable tool input (RED — no guard exists yet)', async () => {
    scriptedResponse = {
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', name: 'extract_cv_fields', input: {} }],
      usage: { input_tokens: 500, output_tokens: 2048 },
    }

    await expect(
      parseCV({ cvText: 'a very long CV that got cut off mid-field', organizationId: 'org-1' }),
    ).rejects.toBeInstanceOf(CVParseTruncatedError)

    // Truncation must not cost us the cost record — logged exactly once.
    expect(recordedRpcCalls).toHaveLength(1)
    expect(recordedRpcCalls[0]?.fn).toBe('record_ai_usage')
  })

  it('resolves normally when max_tokens truncation still yields a substantively populated tool input; parseCVDetailed still reports stopReason max_tokens (must not regress)', async () => {
    scriptedResponse = {
      stop_reason: 'max_tokens',
      content: [
        {
          type: 'tool_use',
          name: 'extract_cv_fields',
          input: {
            name: 'Jane Doe',
            email: 'jane@example.com',
            skills: ['python', 'sql'],
            confidence_per_field: { name: 'high' },
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 2048 },
    }

    const detailed = await parseCVDetailed({
      cvText: 'a dense but substantively-captured CV',
      organizationId: 'org-1',
    })
    expect(detailed.stopReason).toBe('max_tokens')

    const parsed = await parseCV({ cvText: 'a dense but substantively-captured CV', organizationId: 'org-1' })
    expect(parsed).toMatchObject({ name: 'Jane Doe', email: 'jane@example.com' })

    expect(recordedRpcCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('stop_reason tool_use — unaffected by the truncation guard (must not regress)', async () => {
    scriptedResponse = {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'extract_cv_fields',
          input: { name: 'Jane Doe', confidence_per_field: {} },
        },
      ],
      usage: { input_tokens: 400, output_tokens: 300 },
    }

    const parsed = await parseCV({ cvText: 'a short, complete CV', organizationId: 'org-1' })
    expect(parsed).toMatchObject({ name: 'Jane Doe' })

    const detailed = await parseCVDetailed({ cvText: 'a short, complete CV', organizationId: 'org-1' })
    expect(detailed.stopReason).toBe('tool_use')

    expect(recordedRpcCalls).toHaveLength(2)
    expect(recordedRpcCalls.every((c) => c.fn === 'record_ai_usage')).toBe(true)
  })
})
