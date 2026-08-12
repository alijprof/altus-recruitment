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
import { readFileSync, readdirSync } from 'node:fs'
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
const BRANDED_CVS_VERIFY_RENAME_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260812160000_branded_cvs_verify_same_org_rename.sql',
)
const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations')

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
    ).toMatch(
      /organization_id uuid not null references public\.organizations\(id\) on delete cascade/,
    )
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
    const policyMatches = [
      ...code.matchAll(/create policy "[^"]+" on public\.candidate_branded_cvs/g),
    ]
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

  // NOTE: this migration's own `create trigger candidate_branded_cvs_same_org_check`
  // statement is DELIBERATELY not pinned here. It names the trigger
  // `candidate_branded_cvs_same_org_check`, which sorts alphabetically BEFORE
  // `candidate_branded_cvs_set_org` ("same" < "set") — the exact ordering bug
  // `20260518213836_fix_same_org_trigger_order.sql` already fixed once for
  // contacts/jobs/applications/candidate_cvs. Pinning that trigger name here
  // would actively cement the bug (Phase 8 review RESID-01). The corrected,
  // FINAL effective trigger name is asserted below against the follow-up
  // rename migration (20260812160000), and the repo-wide invariant describe
  // block at the bottom of this file asserts no guard trigger family is ever
  // left on a bare `_same_org_check` name.
})

describe('candidate_branded_cvs guard trigger rename migration (Phase 08 review RESID-01)', () => {
  const raw = readFileSync(BRANDED_CVS_VERIFY_RENAME_PATH, 'utf8')
  const code = stripCommentLines(raw)

  it('drops the wrongly-named pre-fix trigger left by 20260812150000, for re-push safety', () => {
    expect(
      code,
      '20260812150000 (append-only, never edited) created the trigger as ' +
        '`candidate_branded_cvs_same_org_check` — this rename migration must clean that name up',
    ).toMatch(
      /drop trigger if exists candidate_branded_cvs_same_org_check\s+on public\.candidate_branded_cvs/,
    )
  })

  it('is idempotent against itself — also drops the verify_ name before recreating it', () => {
    expect(code).toMatch(
      /drop trigger if exists candidate_branded_cvs_verify_same_org_check\s+on public\.candidate_branded_cvs/,
    )
  })

  it('targets the right names: the rename migration is the source of the FINAL effective trigger name, and it is the verify_ one', () => {
    expect(
      code,
      'must fire on both candidate_id and organization_id changes — an UPDATE that repoints ' +
        'either column must be re-validated, not just the initial INSERT — and must sort AFTER ' +
        'candidate_branded_cvs_set_org so NEW.organization_id is populated before the guard runs',
    ).toMatch(
      /create trigger candidate_branded_cvs_verify_same_org_check\s+before insert or update of candidate_id, organization_id on public\.candidate_branded_cvs\s+for each row execute function public\.candidate_branded_cvs_same_org_guard\(\)/,
    )
  })

  it('reuses the existing guard function rather than redefining it — only the trigger name moves', () => {
    expect(
      code,
      'the assert_same_org() body lives solely in 20260812150000 (append-only); this migration ' +
        'must not redeclare candidate_branded_cvs_same_org_guard()',
    ).not.toMatch(/create (or replace )?function public\.candidate_branded_cvs_same_org_guard/)
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

describe('cross-tenant same-org guard trigger naming invariant (repo-wide, Phase 08 review RESID-01)', () => {
  /**
   * The repo-wide version of the RESID-01 fix: no `<table>_same_org_guard()`
   * trigger family may be left, at the end of migration history, on a bare
   * `_same_org_check` name — that name sorts BEFORE `<table>_set_org`
   * ("same" < "set") and fires before organization_id is populated. The
   * correct convention (established by 20260518213836) is
   * `<table>_verify_same_org_check` ("verify" > "set").
   *
   * This scans every migration file in chronological order (the timestamp
   * filename prefix IS chronological order), extracts every
   * `create trigger <name> ... execute function public.<fn>_same_org_guard()`
   * statement, and — per guard function (i.e. per guarded table) — keeps
   * only the LAST trigger name created for it. A table's guard is allowed to
   * be created with the bad name and later renamed (that's exactly what
   * 20260518213836 and 20260812160000 do); what must never happen is the
   * bad name being the final state after all migrations replay in order.
   */
  function findFinalTriggerNamePerGuard(): Map<string, { triggerName: string; file: string }> {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    const finalByGuardFn = new Map<string, { triggerName: string; file: string }>()

    for (const file of files) {
      const code = stripCommentLines(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'))
      // [^;]*? (not [\s\S]*?) deliberately bounds each match to a single SQL
      // statement (up to its terminating semicolon) — an unbounded scan can
      // anchor on an EARLIER, unrelated `create trigger` (e.g. `<table>_set_org`,
      // which has no _same_org_guard call of its own) and lazily skip over it
      // to reach a LATER guard trigger's `execute function`, misattributing the
      // wrong trigger name to the guard.
      const triggerRegex =
        /create trigger (\w+)[^;]*?execute function public\.(\w+_same_org_guard)\(\)/g
      for (const match of code.matchAll(triggerRegex)) {
        const triggerName = match[1]
        const guardFn = match[2]
        if (!triggerName || !guardFn) continue
        // Overwrite on every match — files are processed in chronological
        // order, so the last write per guardFn is the final effective state.
        finalByGuardFn.set(guardFn, { triggerName, file })
      }
    }

    return finalByGuardFn
  }

  it('finds at least the known guard families (sanity check the scan itself works)', () => {
    const finalByGuardFn = findFinalTriggerNamePerGuard()
    expect(
      [...finalByGuardFn.keys()].sort(),
      'if this list shrinks, the scan regex broke silently and every assertion below is vacuous',
    ).toEqual(
      [
        'ai_summaries_same_org_guard',
        'applications_same_org_guard',
        'candidate_branded_cvs_same_org_guard',
        'candidate_cvs_same_org_guard',
        'contacts_same_org_guard',
        'job_ads_same_org_guard',
        'jobs_same_org_guard',
        'spec_drafts_same_org_guard',
      ].sort(),
    )
  })

  it('no guard trigger family is left, as the FINAL migration-history state, on a bare _same_org_check name', () => {
    const finalByGuardFn = findFinalTriggerNamePerGuard()
    for (const [guardFn, { triggerName, file }] of finalByGuardFn) {
      expect(
        triggerName.endsWith('_verify_same_org_check'),
        `${guardFn}'s final trigger name is "${triggerName}" (last set in ${file}) — it must end ` +
          'with _verify_same_org_check ("verify" > "set" alphabetically) so it fires AFTER the ' +
          "table's _set_org trigger. A bare _same_org_check name fires before organization_id " +
          'is populated and raises on every insert (this exact bug shipped twice: ' +
          '20260517204500 -> fixed by 20260518213836; 20260812150000 -> fixed by 20260812160000).',
      ).toBe(true)
    }
  })

  it('candidate_branded_cvs specifically resolves to the rename migration, not the original guard migration', () => {
    const finalByGuardFn = findFinalTriggerNamePerGuard()
    const result = finalByGuardFn.get('candidate_branded_cvs_same_org_guard')
    expect(result).toBeDefined()
    expect(result?.triggerName).toBe('candidate_branded_cvs_verify_same_org_check')
    expect(result?.file).toBe('20260812160000_branded_cvs_verify_same_org_rename.sql')
  })
})
