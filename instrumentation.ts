// Next.js instrumentation hook. Runs once per server (and once per edge
// runtime) at startup — the canonical place to wire Sentry server SDKs in
// the @sentry/nextjs v9+ era.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Next.js looks for an `onRequestError` export from instrumentation.ts;
// Sentry 10 exposes this as `captureRequestError` and the build pipeline
// asserts the file contains the literal string `onRequestError`.
export { captureRequestError as onRequestError } from '@sentry/nextjs'
