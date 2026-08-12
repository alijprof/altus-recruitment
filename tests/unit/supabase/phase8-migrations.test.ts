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
const ORG_LOGOS_BUCKET_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260812120100_org_logos_bucket.sql',
)
const BRANDED_CVS_SAME_ORG_GUARD_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260812150000_branded_cvs_same_org_guard.sql',
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

describe('candidate_branded_cvs cross-tenant FK guard migration (Phase 08 review CR-02)', () => {
  const raw = readFileSync(BRANDED_CVS_SAME_ORG_GUARD_PATH, 'utf8')
  const code = stripCommentLines(raw)

  it('installs a guard function that calls assert_same_org against candidates', () => {
    expect(
      code,
      'the guard must reuse the existing assert_same_org() helper, same pattern as ' +
        'candidate_cvs_same_org_guard (20260518211005) — a plain FK does not enforce tenancy ' +
        'and RLS does not check it either',
    ).toMatch(
      /perform public\.assert_same_org\(\s*'public\.candidates'::regclass,\s*new\.candidate_id,\s*new\.organization_id\s*\)/,
    )
  })

  it('is idempotent — drops the trigger before recreating it, for re-push safety', () => {
    expect(code).toMatch(
      /drop trigger if exists candidate_branded_cvs_same_org_check\s+on public\.candidate_branded_cvs/,
    )
  })

  it('fires before insert or update of candidate_id/organization_id on candidate_branded_cvs', () => {
    expect(
      code,
      'must fire on both candidate_id and organization_id changes — an UPDATE that repoints ' +
        'either column must be re-validated, not just the initial INSERT',
    ).toMatch(
      /create trigger candidate_branded_cvs_same_org_check\s+before insert or update of candidate_id, organization_id on public\.candidate_branded_cvs\s+for each row execute function public\.candidate_branded_cvs_same_org_guard\(\)/,
    )
  })
})

describe('org-logos bucket migration (Phase 08 Plan 01)', () => {
  const raw = readFileSync(ORG_LOGOS_BUCKET_PATH, 'utf8')
  const code = stripCommentLines(raw)

  it('inserts a PRIVATE org-logos bucket (literal id/name/public tuple)', () => {
    expect(
      code,
      'Storage RLS does not apply to public buckets — this bucket must be created private, ' +
        "matching every other bucket in this project's deliberate policy",
    ).toMatch(/'org-logos',\s*\n?\s*'org-logos',\s*\n?\s*false/)
  })

  it('restricts uploads to PNG/JPEG only — no SVG', () => {
    expect(
      code,
      "@react-pdf/renderer's Image component has no SVG rasterisation — an SVG logo would " +
        'silently vanish from the branded PDF',
    ).toMatch(/array\['image\/png',\s*'image\/jpeg'\]/)
    expect(code.toLowerCase()).not.toMatch(/svg/)
  })

  it('caps the bucket file size at 2 MiB', () => {
    expect(code).toMatch(/2097152/)
  })

  it('declares exactly four storage.objects policies scoped to the org-logos bucket', () => {
    const policyMatches = [...code.matchAll(/create policy "[^"]+"\s*\n\s*on storage\.objects/g)]
    expect(
      policyMatches.length,
      'expected exactly four create policy statements (select/insert/update/delete) on storage.objects',
    ).toBe(4)
    expect((code.match(/bucket_id = 'org-logos'/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('adds organizations.logo_storage_path additively', () => {
    expect(code).toMatch(
      /alter table public\.organizations\s+add column if not exists logo_storage_path text/,
    )
  })

  it('is idempotent — guards the bucket insert, policies, and column addition for re-push safety', () => {
    expect(code).toMatch(/on conflict \(id\) do nothing/)
    expect((code.match(/drop policy if exists/g) ?? []).length).toBe(4)
    expect(code).toMatch(/add column if not exists/)
  })
})
