// Next 16 builds with Turbopack by default, which never loads the old
// Webpack-era browser Sentry config file — that entrypoint is dead code.
// This file, at the repo root (sibling of instrumentation.ts, NOT inside
// src/), is the Turbopack-compatible entrypoint for the browser Sentry SDK —
// see SF-7 in the 2026-07-31 Steele Charles feature review.

import * as Sentry from '@sentry/nextjs'

import { scrub, stripQueryString } from '@/lib/observability/sentry-scrub'

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

  // PII rule: org_id / user_id tags only, never PII.
  //
  // Review 2026-08-04 M7: this used to delete only cookies + user.email, on
  // the stated grounds that "the client SDK never sends our own
  // extra/contexts payloads". That was wrong — client components capture raw
  // error objects (manage-billing-button.tsx, start-checkout-button.tsx), so
  // the recursive scrub() the server has always run is needed here too. Both
  // configs now import the same implementation.
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies
    if (event.user?.email) delete event.user.email
    if (event.request?.url) event.request.url = stripQueryString(event.request.url)
    if (event.extra) event.extra = scrub(event.extra) as typeof event.extra
    if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts
    return event
  },

  // Browser breadcrumbs record every fetch and route change. `/candidates?q=`
  // and `/search?q=` carry recruiter-entered search terms, which CLAUDE.md
  // forbids sending anywhere. The path itself is kept (it is what makes a
  // breadcrumb useful); only the query string and fragment are dropped.
  beforeBreadcrumb(breadcrumb) {
    const data = breadcrumb.data
    if (data) {
      for (const key of ['url', 'from', 'to']) {
        const value = data[key]
        if (typeof value === 'string') data[key] = stripQueryString(value)
      }
    }
    return breadcrumb
  },
})

// Instruments client-side router transitions (Next.js App Router).
// Verified present in the installed SDK:
// node_modules/@sentry/nextjs/build/types/client/index.d.ts
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
