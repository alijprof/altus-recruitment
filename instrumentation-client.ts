// Next 16 builds with Turbopack by default, which never loads the old
// Webpack-era browser Sentry config file — that entrypoint is dead code.
// This file, at the repo root (sibling of instrumentation.ts, NOT inside
// src/), is the Turbopack-compatible entrypoint for the browser Sentry SDK —
// see SF-7 in the 2026-07-31 Steele Charles feature review.

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  // Deliberate silent no-op when unset: the founder sets this in Vercel.
  // Sentry's SDK no-ops cleanly when `dsn` is undefined — no throw, no
  // warning, no required-env change here.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Browser-side replay is opt-in for Phase 1 — too easy to leak candidate
  // names into the recorded DOM. Revisit after GDPR self-service in Phase 3.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,

  // PII rule: org_id / user_id tags only, never PII. The client SDK never
  // sends our own `extra`/`contexts` payloads (those are server-only), so
  // mirroring the two deletes from sentry.server.config.ts's beforeSend is
  // sufficient here — no need to port the recursive scrub() helper.
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies
    if (event.user?.email) delete event.user.email
    return event
  },
})

// Instruments client-side router transitions (Next.js App Router).
// Verified present in the installed SDK:
// node_modules/@sentry/nextjs/build/types/client/index.d.ts
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
