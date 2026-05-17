import 'server-only'

import * as Sentry from '@sentry/nextjs'

// Sets the per-request Sentry scope. Call once per request after the user +
// organization are resolved (i.e. inside the (app) layout and at the top of
// every server action that touches the DB).
//
// CLAUDE.md rule: never log candidate emails to Sentry. We capture user id
// only — no email — and tag the organization_id so we can slice errors by
// tenant without exposing PII.
export function setRequestScope(userId: string | null, organizationId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null)
  Sentry.setTag('organization_id', organizationId ?? 'unknown')
}
