// Discriminated result type returned by every db helper. Helpers never leak
// a raw PostgrestError — they capture the underlying error to Sentry and
// surface a friendly discriminant code the UI can pattern-match on.
export type DbResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'not_found' | 'internal' }
