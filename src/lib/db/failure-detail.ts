/**
 * Shared PII-FREE failure-detail builder for `DbResult.detail`.
 *
 * Lifted out of candidate-cvs.ts (review 2026-08-09 ME-03) so every write
 * helper can report a root cause in the same shape, instead of each one
 * either re-implementing it or — as the LinkedIn ingest and createCandidate
 * did — returning a bare `{ ok: false, code: 'internal' }` that tells an
 * operator nothing about WHY a deterministic failure keeps happening.
 *
 * Produces e.g. `22P05 (candidates.insert: full_name, about)`.
 *
 * NEVER `err.message`: PostgREST echoes the offending value back
 * ('invalid input syntax for type integer: "£45,000"'), so a message can
 * carry a candidate's salary, email or name straight into an operator-
 * visible field (ASVS V7, threat T-06-21). Codes and column names only.
 */
export function failureDetail(error: unknown, subop: string, columns?: string[]): string {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? ((error as { code?: string }).code ?? 'unknown')
      : 'unknown'
  const where = columns?.length ? `${subop}: ${columns.join(', ')}` : subop
  return `${code} (${where})`
}
