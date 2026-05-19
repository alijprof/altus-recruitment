/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-02 executor replaces `.todo` with real
// `.it` bodies once src/lib/ai/jd-extract.ts (Sonnet JD-extract wrapper) lands.

describe('src/lib/ai/jd-extract.extractJobDescription (SPEC-02)', () => {
  it.todo('returns null (not undefined, not invented) for undiscussed salary')
  it.todo('returns null (not invented) for undiscussed working pattern (hybrid/remote/onsite)')
  it.todo('returns null for undiscussed location')
  it.todo('uses claude-sonnet-4-6 model (no Opus without justification)')
  it.todo('logs ai_usage with purpose=spec_structure')
  it.todo('treats transcript text as untrusted user input (triple-quote fenced)')
  it.todo('Sentry tags include phase: p3, layer: ai-wrapper, helper: extractJobDescription')
})
