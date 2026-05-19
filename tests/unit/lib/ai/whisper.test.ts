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
// SDK returns `{ text: string }` from audio.transcriptions.create — that's
// all the wrapper consumes.
const createTranscription = vi.fn(async () => ({ text: 'Hello world, this is a spec call.' }))

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
  it('logs ai_usage with purpose=spec_transcribe, p_input_tokens=duration_seconds, p_output_tokens=0', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    const buffer = Buffer.from('fake-audio-bytes', 'utf8')
    const result = await transcribe({
      organizationId: 'org-abc',
      userId: 'user-xyz',
      purpose: 'spec_transcribe',
      audioBuffer: buffer,
      mimeType: 'audio/webm',
      durationSeconds: 123,
    })

    expect(result.text).toContain('spec call')
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

  it('rounds duration UP for cost logging (123.4s -> 124 input tokens)', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    const buffer = Buffer.from('x', 'utf8')
    await transcribe({
      organizationId: 'org',
      purpose: 'spec_transcribe',
      audioBuffer: buffer,
      mimeType: 'audio/webm',
      // Whisper wrapper expects an already-rounded integer (caller probes
      // with ffmpeg's probeDurationSeconds which uses Math.ceil). Verify
      // Math.ceil is still applied defensively inside the wrapper so a
      // non-integer doesn't slip into ai_usage.
      durationSeconds: 123.4,
    })
    const rpcArgs = recordedRpcCalls[0]?.args as Record<string, unknown>
    expect(rpcArgs.p_input_tokens).toBe(124)
  })

  it('throws on empty audio buffer', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    await expect(
      transcribe({
        organizationId: 'org',
        purpose: 'spec_transcribe',
        audioBuffer: Buffer.alloc(0),
        mimeType: 'audio/webm',
        durationSeconds: 10,
      }),
    ).rejects.toThrow('empty audio buffer')
  })

  it('throws on durationSeconds <= 0', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    await expect(
      transcribe({
        organizationId: 'org',
        purpose: 'spec_transcribe',
        audioBuffer: Buffer.from('x'),
        mimeType: 'audio/webm',
        durationSeconds: 0,
      }),
    ).rejects.toThrow('durationSeconds must be > 0')
  })

  it('passes UK English prompt to the SDK for accent + currency anchoring', async () => {
    const { transcribe } = await import('@/lib/ai/whisper')
    await transcribe({
      organizationId: 'org',
      purpose: 'spec_transcribe',
      audioBuffer: Buffer.from('x'),
      mimeType: 'audio/webm',
      durationSeconds: 10,
    })
    expect(createTranscription).toHaveBeenCalledOnce()
    // mock.calls is `[][]` — index in via unknown so the empty-tuple
    // overload doesn't trip noUncheckedIndexedAccess.
    const allCalls = createTranscription.mock.calls as unknown as Array<Array<Record<string, unknown>>>
    const callArgs = allCalls[0]?.[0]
    if (!callArgs) throw new Error('createTranscription was not called')
    expect(callArgs.language).toBe('en')
    expect((callArgs.prompt as string).toLowerCase()).toContain('uk')
    expect(callArgs.prompt).toContain('GBP')
  })
})
