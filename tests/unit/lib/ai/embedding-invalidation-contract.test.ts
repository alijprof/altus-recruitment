/**
 * Plan 07-03 Task 3 — the embedding-invalidation sync contract.
 *
 * THIS TEST IS THE ENTIRE REASON PLAN 07-03 WRITES NO INVALIDATION CODE.
 *
 * The BEFORE UPDATE trigger `invalidate_candidate_embedding`
 * (supabase/migrations/20260519092951_invalidate_embeddings_triggers.sql:
 * 38-63) NULLs `candidate_embedding` + `embedded_at` whenever any column it
 * compares changes. `candidateEmbeddingText` (src/lib/ai/embed-text.ts) is
 * the exact field set the embed-batch sweep reads to build the embedding
 * input text — the comment at embed-text.ts:25-27 records that these two
 * lists must be kept in sync BY HAND, because nothing in Postgres or
 * TypeScript enforces it structurally (a SQL trigger and a TS `Pick<>` type
 * cannot reference each other).
 *
 * This file is that enforcement, in both directions:
 *   1. Parses the migration SQL from disk (read-only, no DB) and extracts
 *      every column named in the trigger's `new.X is distinct from old.X`
 *      comparisons.
 *   2. Compares that set to the field list of `candidateEmbeddingText`'s
 *      parameter type. Any mismatch fails loudly, naming the drifting
 *      column(s) and what to do about it.
 *   3. Separately asserts the six non-search fields Plan 07-03 makes
 *      editable (salary_current_estimate, salary_expectation, headline,
 *      about, work_experience, education) appear in NEITHER set — adding
 *      any of them to either list would make an edit to that field buy an
 *      org a Voyage call for a byte-identical embedding vector.
 *
 * `CandidateEmbedFields` (the Pick<> type inside embed-text.ts) is
 * deliberately NOT exported — embed-text.ts is a frozen file for this plan
 * (not in files_modified). This test binds to its shape structurally via
 * `Parameters<typeof candidateEmbeddingText>[0]` instead, the same pattern
 * already used by embed-text.test.ts:18.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

// Stub `server-only` — embed-text.ts is server-only but candidateEmbeddingText
// is a pure function (same stub as embed-text.test.ts:7).
vi.mock('server-only', () => ({}))

import { candidateEmbeddingText } from '@/lib/ai/embed-text'

// --- Structural binding to embed-text.ts's field set (no import of the
// unexported `CandidateEmbedFields` type) ----------------------------------

type CandidateEmbedFieldsShape = Parameters<typeof candidateEmbeddingText>[0]

// A `Record<keyof CandidateEmbedFieldsShape, true>` object literal is a TRUE
// compile-time exhaustiveness assertion in both directions: TypeScript's
// excess-property check on object literals means this fails to typecheck if
// `CandidateEmbedFieldsShape` ever gains OR loses a field, forcing whoever
// changes embed-text.ts's Pick<> to update this list in the same PR (rather
// than only failing here at runtime, or worse, not failing at all until the
// trigger silently drifts out of sync).
const CANDIDATE_EMBED_FIELD_MEMBERSHIP: Record<keyof CandidateEmbedFieldsShape, true> = {
  full_name: true,
  current_role_title: true,
  current_company: true,
  location: true,
  skills: true,
  seniority_level: true,
  years_experience: true,
  sector_tags: true,
}

const CANDIDATE_EMBED_FIELD_LIST = Object.keys(CANDIDATE_EMBED_FIELD_MEMBERSHIP).sort()

// --- Parse the trigger's column list straight out of the migration SQL ----

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase/migrations/20260519092951_invalidate_embeddings_triggers.sql',
)

function extractCandidateTriggerColumns(): string[] {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const fnMarker = 'create or replace function public.invalidate_candidate_embedding()'
  const fnStart = sql.indexOf(fnMarker)
  if (fnStart === -1) {
    throw new Error(
      `embedding-invalidation-contract: could not find "${fnMarker}" in ${MIGRATION_PATH}. ` +
        'The migration file structure changed — update this test\'s parser to match.',
    )
  }
  // The function body's own closing delimiter is the first `$$;` after
  // fnStart (the opening `as $$` has no trailing semicolon, so it can never
  // match this substring).
  const bodyEndIdx = sql.indexOf('$$;', fnStart)
  const body = sql.slice(fnStart, bodyEndIdx === -1 ? undefined : bodyEndIdx)

  // Backreference (`\1`) requires the SAME column name on both sides of
  // `is distinct from`, matching e.g.
  // `new.current_role_title is distinct from old.current_role_title`.
  const columnPattern = /new\.(\w+)\s+is distinct from\s+old\.\1/g
  const columns = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = columnPattern.exec(body)) !== null) {
    const col = match[1]
    if (col) columns.add(col)
  }
  return Array.from(columns).sort()
}

// The six non-search fields Plan 07-03 makes editable that must NEVER
// appear in either list — see the file header.
const NON_SEARCH_EDITABLE_FIELDS = [
  'salary_current_estimate',
  'salary_expectation',
  'headline',
  'about',
  'work_experience',
  'education',
] as const

function formatColumnList(cols: readonly string[]): string {
  return cols.length > 0 ? cols.join(', ') : '(none)'
}

describe('embedding-invalidation contract: trigger columns == CandidateEmbedFields', () => {
  it('the two sets are IDENTICAL — no extras on either side', () => {
    const triggerColumns = extractCandidateTriggerColumns()
    const embedFields = CANDIDATE_EMBED_FIELD_LIST

    const triggerSet = new Set(triggerColumns)
    const embedSet = new Set(embedFields)

    const inTriggerOnly = triggerColumns.filter((c) => !embedSet.has(c))
    const inEmbedOnly = embedFields.filter((c) => !triggerSet.has(c))

    const message =
      'DRIFT DETECTED between invalidate_candidate_embedding (SQL trigger, ' +
      `supabase/migrations/20260519092951_invalidate_embeddings_triggers.sql) and ` +
      'candidateEmbeddingText (src/lib/ai/embed-text.ts).\n' +
      `  Columns in the SQL trigger but NOT in candidateEmbeddingText: ${formatColumnList(inTriggerOnly)}\n` +
      `  Fields in candidateEmbeddingText but NOT in the SQL trigger: ${formatColumnList(inEmbedOnly)}\n` +
      'Fix: add a NEW append-only migration updating the trigger, OR update ' +
      'CandidateEmbedFields in embed-text.ts — never change one without the other ' +
      '(see the sync-contract comment at embed-text.ts:25-27).'

    expect(inTriggerOnly, message).toEqual([])
    expect(inEmbedOnly, message).toEqual([])
  })

  it('names the specific columns compared (regression pin, not just set equality)', () => {
    // Belt-and-braces: pins the exact list so a future edit that swaps one
    // column for another same-size set (which the set-equality check above
    // could theoretically miss if done to BOTH sides in the same commit)
    // still gets a concrete diff to read.
    expect(extractCandidateTriggerColumns()).toEqual([
      'current_company',
      'current_role_title',
      'full_name',
      'location',
      'sector_tags',
      'seniority_level',
      'skills',
      'years_experience',
    ])
  })
})

describe('embedding-invalidation contract: non-search fields stay OUT', () => {
  it.each(NON_SEARCH_EDITABLE_FIELDS)(
    '%s is absent from the SQL trigger column list',
    (field) => {
      const triggerColumns = extractCandidateTriggerColumns()
      expect(
        triggerColumns,
        `${field} must NOT be in invalidate_candidate_embedding's column list — it is not part ` +
          'of candidateEmbeddingText, so invalidating on it would buy an org a Voyage call for a ' +
          'byte-identical embedding vector (real spend, zero benefit).',
      ).not.toContain(field)
    },
  )

  it.each(NON_SEARCH_EDITABLE_FIELDS)('%s is absent from CandidateEmbedFields', (field) => {
    expect(
      CANDIDATE_EMBED_FIELD_LIST,
      `${field} must NOT be part of the candidateEmbeddingText input set — it plays no role in ` +
        'search/match relevance, so embedding on it would waste Voyage spend for no benefit.',
    ).not.toContain(field)
  })
})
