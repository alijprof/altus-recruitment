// Discriminated result type returned by every db helper. Helpers never leak
// a raw PostgrestError — they capture the underlying error to Sentry and
// surface a friendly discriminant code the UI can pattern-match on.
//
// `detail` carries a PII-FREE technical root cause: the SQLSTATE (or the
// PostgREST code, e.g. PGRST102, for errors rejected before Postgres is
// reached) plus the column or sub-operation that produced it — for example
// '22P05 (candidate_cvs.update: parsing_status, extracted_data)'.
//
// It MUST NEVER carry `err.message`. PostgREST echoes the offending VALUE in
// its messages ('invalid input syntax for type integer: "£45,000"'), so a
// message from a failed candidate write can contain a name, an email or a
// salary — and this field is written to candidate_cvs.parse_error_detail and
// read by operators (ASVS V7). Codes and column names only.
//
// The field is OPTIONAL, so widening the failure variant needed no changes
// at any existing call site.
export type DbResult<T> =
  | { ok: true; data: T; noop?: boolean }
  | { ok: false; code: 'not_found' | 'internal' | 'duplicate'; detail?: string }
