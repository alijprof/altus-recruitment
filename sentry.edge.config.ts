import * as Sentry from '@sentry/nextjs'

// Same PII scrub as the server config — middleware and edge routes can capture
// the same shape of payloads.
const PII_KEYS = ['email', 'phone', 'cv_text', 'extracted_data', 'candidate_email', 'full_name']

function scrub(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(scrub)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.includes(k)) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = scrub(v)
    }
  }
  return out
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies
    if (event.user?.email) delete event.user.email
    if (event.extra) event.extra = scrub(event.extra) as typeof event.extra
    if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts
    return event
  },
})
