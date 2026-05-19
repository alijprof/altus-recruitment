/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Mock runWithLogging so we don't hit Anthropic. Capture the args for
// schema/system-prompt assertions, and return a canned tool-use response.
const runWithLoggingMock = vi.fn()

vi.mock('@/lib/ai/claude', () => ({
  runWithLogging: (...args: unknown[]) => runWithLoggingMock(...args),
}))

beforeEach(() => {
  runWithLoggingMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function cannedResponse(toolInput: unknown) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'extract_spec_call_jd',
        input: toolInput,
      },
    ],
    usage: { input_tokens: 500, output_tokens: 200 },
  }
}

describe('extractJdFromTranscript()', () => {
  it('passes purpose=spec_jd_extract to runWithLogging', async () => {
    runWithLoggingMock.mockResolvedValueOnce(
      cannedResponse({
        title: 'Senior Python Engineer',
        must_haves: ['Python', '5+ years'],
        nice_to_haves: [],
        confidence_per_field: {},
        ambiguities: [],
      }),
    )
    const { extractJdFromTranscript } = await import('@/lib/ai/jd-extract')
    await extractJdFromTranscript('Hello transcript', {
      organizationId: 'org-1',
      userId: 'user-1',
    })

    const callArgs = runWithLoggingMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArgs.purpose).toBe('spec_jd_extract')
    expect(callArgs.model).toBe('claude-sonnet-4-6')
    expect(callArgs.organizationId).toBe('org-1')
  })

  it('returns null (not undefined) for fields Sonnet omitted from the response', async () => {
    runWithLoggingMock.mockResolvedValueOnce(
      cannedResponse({
        title: 'Backend Engineer',
        // Sonnet was instructed to use null when the client didn't discuss
        // salary, so it returns nothing for those keys (the tool schema
        // marks them as nullable, so absence = null).
        must_haves: ['Go'],
        nice_to_haves: [],
        confidence_per_field: { title: 'high', must_haves: 'medium' },
        ambiguities: ['Did not specify salary'],
      }),
    )
    const { extractJdFromTranscript } = await import('@/lib/ai/jd-extract')
    const result = await extractJdFromTranscript('A spec transcript without salary.', {
      organizationId: 'org-1',
    })

    // Pitfall 8 — coerce missing keys to null, never undefined. The UI
    // pattern-matches on `=== null` to render "verify with client" badges,
    // so undefined would surprise the renderer.
    expect(result.salary_range_min).toBeNull()
    expect(result.salary_range_max).toBeNull()
    expect(result.currency).toBeNull()
    expect(result.seniority_level).toBeNull()
    expect(result.urgency).toBeNull()
    expect(result.title).toBe('Backend Engineer')
    expect(result.ambiguities).toEqual(['Did not specify salary'])
  })

  it('uses strict tool-use (tool_choice forces extract_spec_call_jd)', async () => {
    runWithLoggingMock.mockResolvedValueOnce(
      cannedResponse({
        title: 'X',
        must_haves: [],
        nice_to_haves: [],
        confidence_per_field: {},
        ambiguities: [],
      }),
    )
    const { extractJdFromTranscript } = await import('@/lib/ai/jd-extract')
    await extractJdFromTranscript('transcript', { organizationId: 'org' })

    const callArgs = runWithLoggingMock.mock.calls[0]?.[0] as Record<string, unknown>
    const request = callArgs.request as Record<string, unknown>
    const toolChoice = request.tool_choice as Record<string, unknown>
    expect(toolChoice.type).toBe('tool')
    expect(toolChoice.name).toBe('extract_spec_call_jd')

    // System prompt locks the "do NOT invent" guardrail and the triple-quote
    // prompt-injection fence — both are required for the wrapper to fulfill
    // its contract.
    const systemPrompt = request.system as string
    expect(systemPrompt).toMatch(/do not invent/i)
    expect(systemPrompt).toContain('triple quotes')
  })

  it('throws when Sonnet returns no tool_use block (defensive)', async () => {
    runWithLoggingMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I am not following instructions' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    })
    const { extractJdFromTranscript } = await import('@/lib/ai/jd-extract')
    await expect(
      extractJdFromTranscript('transcript', { organizationId: 'org' }),
    ).rejects.toThrow(/did not return tool_use/)
  })

  it('reports a positive costPence from the usage counters', async () => {
    runWithLoggingMock.mockResolvedValueOnce(
      cannedResponse({
        title: 'X',
        must_haves: [],
        nice_to_haves: [],
        confidence_per_field: {},
        ambiguities: [],
      }),
    )
    const { extractJdFromTranscript } = await import('@/lib/ai/jd-extract')
    const result = await extractJdFromTranscript('transcript', { organizationId: 'org' })
    // 500 input + 200 output tokens at sonnet-4-6 (240/1200 p/MTok)
    // = (240 * 500 + 1200 * 200) / 1_000_000 = 0.36p → ceil = 1
    expect(result.costPence).toBeGreaterThan(0)
  })
})
