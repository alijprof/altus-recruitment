/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-05 executor replaces `.todo` with real
// `.it` bodies once src/lib/ai/outreach-draft.ts lands. Sonnet stub will
// return canned drafts for fixture client + last-placement payloads.

describe('src/lib/ai/outreach-draft.draftOutreachEmail (REPEAT-01)', () => {
  it.todo('personalizes draft with client name and last placement title')
  it.todo('produces both subject and body fields (not just one blob)')
  it.todo('uses claude-sonnet-4-6 (default, no Opus justification)')
  it.todo('treats client name + placement summary as untrusted user input (fenced)')
  it.todo('logs ai_usage with purpose=outreach_draft')
  it.todo('Sentry tags include phase: p3, layer: ai-wrapper, helper: draftOutreachEmail')
  it.todo('NEVER returns a "send" instruction in the body — recruiter approves only')
})
