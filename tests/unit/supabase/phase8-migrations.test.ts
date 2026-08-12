/**
 * @vitest-environment node
 *
 * Phase 8 migration regression pins (08-01).
 *
 * Source inspection via node:fs, rather than applying the migrations to a
 * real database, is deliberate: this unit suite has no live Postgres to
 * apply SQL against (that requires `pnpm test:integration` against a real
 * Supabase instance), and the invariants this test protects — RLS enabled,
 * the tenant policy quad present, cascade FKs, the single-current-copy
 * unique constraint, the private/mime-restricted bucket shape — are all
 * structural properties of the SQL text itself. This mirrors the
 * source-inspection pattern established in Phase 07 Plan 05
 * (tests/unit/lib/inngest/cron-hardening.test.ts): pin the invariant a
 * future edit could silently drop, without needing the heavier machinery
 * a live-database test would require.
 *
 * Both migrations are append-only once committed — do not edit them to
 * make this test pass. Fix schema issues in a new migration file instead.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Strip full-line `--` comments so a future comment merely MENTIONING a
 * pinned token in prose cannot make an assertion pass without the real
 * clause being present. Only lines that are ENTIRELY a `--` comment after
 * trimming are removed.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

const CANDIDATE_BRANDED_CVS_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260812120000_candidate_branded_cvs.sql',
)

describe('candidate_branded_cvs migration (Phase 08 Plan 01)', () => {
  const raw = readFileSync(CANDIDATE_BRANDED_CVS_PATH, 'utf8')
  const code = stripCommentLines(raw)

  it('creates the candidate_branded_cvs table', () => {
    expect(code).toMatch(/create table if not exists public\.candidate_branded_cvs/)
  })

  it('cascades on both organization_id and candidate_id FKs', () => {
    expect(
      code,
      'organization_id must reference organizations(id) on delete cascade — GDPR org erasure ' +
        'must remove this row automatically',
    ).toMatch(/organization_id uuid not null references public\.organizations\(id\) on delete cascade/)
    expect(
      code,
      'candidate_id must reference candidates(id) on delete cascade — GDPR candidate erasure ' +
        'must remove this row automatically, mirroring candidate_cvs/ai_summaries',
    ).toMatch(/candidate_id uuid not null references public\.candidates\(id\) on delete cascade/)
  })

  it('enforces exactly one current branded copy per candidate via a named unique constraint', () => {
    expect(
      code,
      'the BCV-06 single-current-copy invariant must be a named constraint on candidate_id, ' +
        'so the 08-07 upsert can target it unambiguously',
    ).toMatch(/constraint candidate_branded_cvs_candidate_id_key unique \(candidate_id\)/)
  })

  it('enables row level security', () => {
    expect(code).toMatch(/alter table public\.candidate_branded_cvs enable row level security/)
  })

  it('declares exactly four tenant policies, each keyed on current_organization_id()', () => {
    const policyMatches = [...code.matchAll(/create policy "[^"]+" on public\.candidate_branded_cvs/g)]
    expect(
      policyMatches.length,
      'expected exactly four create policy statements (select/insert/update/delete) — ' +
        'a missing policy silently reopens a tenant-isolation gap',
    ).toBe(4)

    // Every policy clause block must reference current_organization_id() —
    // check by isolating each policy's SQL block up to its terminating semicolon.
    const blocks = code.split(/create policy "[^"]+" on public\.candidate_branded_cvs/).slice(1)
    expect(blocks.length).toBe(4)
    for (const block of blocks) {
      const clause = block.split(';')[0] ?? ''
      expect(
        clause,
        'every policy predicate must key off current_organization_id() — this is the single ' +
          'RLS primitive every tenant table in this project relies on',
      ).toMatch(/current_organization_id\(\)/)
    }
  })

  it('installs both the set_organization_id and set_updated_at triggers', () => {
    expect(code).toMatch(
      /create trigger candidate_branded_cvs_set_org before insert on public\.candidate_branded_cvs\s+for each row execute function public\.set_organization_id\(\)/,
    )
    expect(code).toMatch(
      /create trigger candidate_branded_cvs_set_updated_at before update on public\.candidate_branded_cvs\s+for each row execute function public\.set_updated_at\(\)/,
    )
  })

  it('is idempotent — guards the table, policies, and triggers for re-push safety', () => {
    expect(code).toMatch(/create table if not exists/)
    expect((code.match(/drop policy if exists/g) ?? []).length).toBe(4)
    expect((code.match(/drop trigger if exists/g) ?? []).length).toBe(2)
  })
})
