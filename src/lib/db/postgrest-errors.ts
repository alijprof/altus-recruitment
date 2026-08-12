// Shared PostgREST error predicates.
//
// NO `import 'server-only'` — this is a pure predicate over an error shape,
// and it is imported by a Next.js route handler, an Inngest function and a
// db helper. Adding a server-only guard would buy nothing and constrain
// placement.
//
// Review 2026-08-04 L9: `isMissingColumnError` existed in three places —
// src/app/api/stripe/webhook/route.ts, src/lib/inngest/functions/
// stripe-reconcile.ts (verbatim copies) and src/lib/db/candidate-cvs.ts (a
// looser variant that also substring-matched error.message). All three are
// load-bearing pre/post-migration guards on a LIVE database where migrations
// are pushed manually, so a drift between them would silently change which
// deploys degrade gracefully. One implementation, one place.

/**
 * True when a PostgREST/Postgres error says the referenced column does not
 * exist yet — i.e. this code is deployed AHEAD of its migration.
 *
 *   PGRST204 — PostgREST schema-cache write miss ("column not found in the
 *              schema cache"), raised on INSERT/UPDATE payloads.
 *   42703    — Postgres `undefined_column`, surfaced on reads.
 *
 * `column` is optional and only relaxes the check: when supplied, an error
 * whose MESSAGE mentions that column also counts. That variant exists because
 * `updateCandidateCVParse` needs to catch shapes PostgREST reports without a
 * machine-readable code; it is opt-in so the Stripe ledger guards keep their
 * strict code-only behaviour and can never be fooled by an unrelated message
 * that happens to contain the column name.
 */
export function isMissingColumnError(err: unknown, column?: string): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  if (code === 'PGRST204' || code === '42703') return true
  if (!column) return false
  const message = (err as { message?: string }).message
  return typeof message === 'string' && message.includes(column)
}

/**
 * True when a PostgREST/Postgres error says the referenced TABLE does not
 * exist yet — i.e. this code is deployed AHEAD of its migration (this
 * project's migrations are pushed to production by hand; see the module
 * header above). Distinct from `isMissingColumnError`, which fires for a
 * KNOWN table that is missing one new column — this fires when the whole
 * table is absent.
 *
 *   42P01    — Postgres `undefined_table`, surfaced when a query reaches
 *              Postgres directly for a table that was never created.
 *   PGRST205 — PostgREST schema-cache TABLE miss ("Could not find the table
 *              '...' in the schema cache").
 *
 * One implementation, one place — same rationale as `isMissingColumnError`
 * above (review 2026-08-04 L9). Introduced for Phase 8 Plan 07:
 * candidate_branded_cvs (migration 20260812120000) may reach production code
 * before the founder's manual `db push` applies it, and every consumer of
 * this table must degrade to "feature unavailable" rather than a 500.
 */
export function isMissingTableError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === '42P01' || code === 'PGRST205'
}
