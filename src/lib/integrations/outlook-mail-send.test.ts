/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-05 executor replaces `.todo` with real
// `.it` bodies once Mail.Send incremental consent flow lands in
// src/lib/integrations/outlook.ts.

describe('outlook Mail.Send incremental consent (REPEAT-01)', () => {
  it.todo('returns { ok: false, error: "needs_consent", consentUrl } when scope is missing')
  it.todo('returns { ok: false, error: "needs_consent" } on 403 insufficient_scope from Graph')
  it.todo('successfully sends mail when Mail.Send scope is granted')
  it.todo('NEVER auto-grants the scope at deploy time (D3-20)')
  it.todo('activity log row updates kind from email_draft to email on successful send')
  it.todo('Sentry capture wraps err.name only (no recipient PII)')
  it.todo('Sentry tags include phase: p3, layer: integrations or action, helper: sendMail')
})
