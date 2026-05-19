import 'server-only'

/**
 * Extract a numeric `status` off an unknown error in a type-safe way.
 * Returns `'unknown'` when not present. Used only for tagging Sentry
 * payloads (PII-safe wrapping per Phase 1 R4: never pass the original
 * error to Sentry — wrap `name + status` in a fresh Error so any prompt
 * fragments embedded in `error.message` can't bypass the beforeSend
 * scrub).
 *
 * Lifted out of `src/lib/inngest/functions/parse-cv.ts` so the Plan 1
 * embed functions can share it without duplicating the predicate.
 */
export function readStatus(err: unknown): number | 'unknown' {
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    return (err as { status: number }).status
  }
  return 'unknown'
}

/**
 * Wrap an unknown error in a fresh Error whose message is `name: status`
 * (and optionally a leading prefix). The original error is NEVER passed to
 * Sentry — Anthropic / Voyage SDK errors can echo prompt fragments in
 * `error.message`, which would bypass the global beforeSend PII scrub.
 *
 * Plan 1 used this pattern inline in every Inngest function; Plan 2 lifts
 * it here so the precompute / cleanup functions can stay terse.
 */
export function formatErrorForSentry(err: unknown, prefix?: string): Error {
  const name = err instanceof Error ? err.name : 'UnknownError'
  const status = readStatus(err)
  const body = `${name}: ${status}`
  return new Error(prefix ? `${prefix} ${body}` : body)
}
