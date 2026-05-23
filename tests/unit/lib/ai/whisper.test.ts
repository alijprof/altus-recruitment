/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub `server-only` — whisper.ts is server-only but the test exercises the
// pure transcribe() function with mocked SDK + service client.
vi.mock('server-only', () => ({}))

// Capture per-test the args passed to record_ai_usage. The mock service
// client returns a thenable rpc() so we can spy on the call shape without
// hitting Supabase.
let recordedRpcCalls: Array<{ fn: string; args: unknown }> = []

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: vi.fn(async (fn: string, args: unknown) => {
      recordedRpcCalls.push({ fn, args })
      return { data: null, error: null }
    }),
  }),
}))

// Mock the OpenAI SDK so transcribe() doesn't hit the network. Whisper's
// verbose_json response returns `{ text, duration, language, segments }`;
// the wrapper reads `text` + `duration`. Tests can override the resolved
// value per-case to assert different duration behaviours.
const createTranscription = vi.fn(async () => ({
  text: 'Hello world, this is a spec call.',
  duration: 123,
}))

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      audio = { transcriptions: { create: createTranscription } }
    },
    toFile: async (buffer: Buffer | Uint8Array, filename: string, opts: { type: string }) => ({
      buffer,
      filename,
      type: opts.type,
    }),
  }
})

// env.ts dereferences process.env at module load. Provide the minimum needed.
vi.mock('@/lib/env', () => ({
  env: {
    OPENAI_API_KEY: 'sk-test-fake',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake',
  },
}))

beforeEach(() => {
  recordedRpcCalls = []
  createTranscription.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('transcribe()', () => {
  it('logs ai_usage with purpose=spec_transcribe and the Whisper-reported duration', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    const buffer = Buffer.from('fake-audio-bytes', 'utf8')
    const result = await transcribe({
      organizationId: 'org-abc',
      userId: 'user-xyz',
      purpose: 'spec_transcribe',
      audioBuffer: buffer,
      mimeType: 'audio/webm',
    })

    expect(result.text).toContain('spec call')
    expect(result.durationSeconds).toBe(123)
    expect(recordedRpcCalls).toHaveLength(1)
    expect(recordedRpcCalls[0]?.fn).toBe('record_ai_usage')

    const rpcArgs = recordedRpcCalls[0]?.args as Record<string, unknown>
    expect(rpcArgs.p_purpose).toBe('spec_transcribe')
    expect(rpcArgs.p_organization_id).toBe('org-abc')
    expect(rpcArgs.p_user_id).toBe('user-xyz')
    expect(rpcArgs.p_input_tokens).toBe(123)
    expect(rpcArgs.p_output_tokens).toBe(0)
    expect(rpcArgs.p_model).toBe('whisper-1')
  })

  it('rounds the Whisper duration to the nearest second for cost logging', async () => {
    createTranscription.mockResolvedValueOnce({
      text: 'hi',
      duration: 123.4,
    })
    const { transcribe } = await import('@/lib/ai/whisper')
    const result = await transcribe({
      organizationId: 'org',
      purpose: 'spec_transcribe',
      audioBuffer: Buffer.from('x', 'utf8'),
      mimeType: 'audio/webm',
    })
    expect(result.durationSeconds).toBe(123)
    const rpcArgs = recordedRpcCalls[0]?.args as Record<string, unknown>
    expect(rpcArgs.p_input_tokens).toBe(123)
  })

  it('clamps a missing/zero duration to 1 so cost logging never writes 0', async () => {
    // Defensive: if Whisper ever returns a malformed verbose_json without
    // duration, we'd rather log 1s than skip the row entirely.
    createTranscription.mockResolvedValueOnce({ text: 'hi', duration: 0 })
    const { transcribe } = await import('@/lib/ai/whisper')
    const result = await transcribe({
      organizationId: 'org',
      purpose: 'spec_transcribe',
      audioBuffer: Buffer.from('x', 'utf8'),
      mimeType: 'audio/webm',
    })
    expect(result.durationSeconds).toBe(1)
  })

  it('throws on empty audio buffer', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    await expect(
      transcribe({
        organizationId: 'org',
        purpose: 'spec_transcribe',
        audioBuffer: Buffer.alloc(0),
        mimeType: 'audio/webm',
      }),
    ).rejects.toThrow('empty audio buffer')
  })

  it('passes UK English prompt + verbose_json to the SDK', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    await transcribe({
      organizationId: 'org',
      purpose: 'spec_transcribe',
      audioBuffer: Buffer.from('x'),
      mimeType: 'audio/webm',
    })
    expect(createTranscription).toHaveBeenCalledOnce()
    const allCalls = createTranscription.mock.calls as unknown as Array<Array<Record<string, unknown>>>
    const callArgs = allCalls[0]?.[0]
    if (!callArgs) throw new Error('createTranscription was not called')
    expect(callArgs.language).toBe('en')
    expect(callArgs.response_format).toBe('verbose_json')
    expect((callArgs.prompt as string).toLowerCase()).toContain('uk')
    expect(callArgs.prompt).toContain('GBP')
  })
})
