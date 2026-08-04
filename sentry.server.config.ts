import * as Sentry from '@sentry/nextjs'

// PII scrub — CLAUDE.md forbids logging CV text or candidate emails. The
// implementation lives in src/lib/observability/sentry-scrub.ts so the client
// SDK config (instrumentation-client.ts) applies the identical rules; the two
// used to differ, which is review 2026-08-04 M7.
import { scrub } from '@/lib/observability/sentry-scrub'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Belt-and-braces: do not auto-capture IPs, cookies, headers.
  sendDefaultPii: false,

  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies
    if (event.user?.email) delete event.user.email
    if (event.extra) event.extra = scrub(event.extra) as typeof event.extra
    if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts
    return event
  },
})
