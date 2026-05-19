/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-02 executor replaces `.todo` with real
// `.it` bodies once src/lib/ai/whisper.ts (Whisper wrapper) lands.
// Mocking strategy will mirror src/lib/ai/ffmpeg.test.ts (vi.mock on the
// 'openai' SDK module with a hoist-safe globalThis ref for recorded calls).

describe('src/lib/ai/whisper.transcribe (SPEC-01)', () => {
  it.todo('calls openai.audio.transcriptions.create with model whisper-1')
  it.todo('logs to ai_usage via record_ai_usage with purpose=spec_transcribe')
  it.todo('ai_usage.p_input_tokens carries duration in seconds (not token count)')
  it.todo('ai_usage.p_output_tokens is 0 (Whisper bills per minute)')
  it.todo('handles 25 MiB hard cap rejection from OpenAI with a friendly error')
  it.todo('captures err.name only to Sentry — never the raw error message')
  it.todo('Sentry tags include phase: p3, layer: ai-wrapper, helper: transcribe')
})

describe('Whisper recompression integration (SPEC-01)', () => {
  it.todo('50 MiB m4a fixture recompressed to ≤24 MiB via ffmpeg.recompressToOpus')
})
