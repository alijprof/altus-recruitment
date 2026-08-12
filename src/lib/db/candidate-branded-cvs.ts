import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { failureDetail } from './failure-detail'
import { isMissingTableError } from './postgrest-errors'
import type { DbResult } from './types'

// candidate_branded_cvs row helper — Phase 8 Plan 07 (BCV-01/06/07).
//
// Phase 8 Plan 01: candidate_branded_cvs was added by migration
// 20260812120000_candidate_branded_cvs.sql, which is NOT YET PUSHED to
// production as of this plan — this project's migrations are applied by the
// founder running `pnpm exec supabase db push --linked` manually. The
// generated Database type has no knowledge of this table at all, so every
// query below goes through an untyped view of the client (see `untyped`
// below) rather than SupabaseClient<Database>'s typed `.from()`, and the row
// shape is declared locally and cast at the boundary — the same cast-
// boundary discipline `organizations.ts` uses for `logo_storage_path`.
//
// MIGRATION-TOLERANT BY DESIGN: `getBrandedCvState` is a TRI-STATE resolver
// (`ready` / `none` / `unavailable`), not a DbResult, because the UI needs to
// tell "no branded copy generated yet" apart from "this feature doesn't
// exist on this database yet" — the latter must render NOTHING
// (branded-cv-panel.tsx returns null), not an empty/error state. `unavailable`
// deliberately does NOT widen the shared `DbResult` union (src/lib/db/types.ts)
// — it lives only on `BrandedCvState`, so no existing DbResult consumer's
// exhaustiveness changes.

export type BrandedCvRow = {
  id: string
  organization_id: string
  candidate_id: string
  storage_path: string
  file_size_bytes: number | null
  generated_by: string | null
  generated_at: string
  created_at: string
  updated_at: string
}

export type BrandedCvState =
  | { kind: 'ready'; row: BrandedCvRow }
  | { kind: 'none' }
  | { kind: 'unavailable' }

// reason: candidate_branded_cvs is not in the generated Database type yet
// (see header comment above) — every query on this table goes through this
// deliberately narrow, untyped view of the client rather than the typed
// SupabaseClient<Database>.from(). Only the methods this module actually
// calls are declared. RLS still enforces tenancy server-side regardless of
// the client-side type gap.
type UntypedTableClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      }
    }
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: unknown; error: unknown }>
      }
    }
    update: (payload: Record<string, unknown>) => {
      eq: (
        col: string,
        val: string,
      ) => {
        select: (cols: string) => {
          single: () => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  }
}

function untyped(supabase: SupabaseClient<Database>): UntypedTableClient {
  return supabase as unknown as UntypedTableClient
}

const SELECT_COLUMNS =
  'id, organization_id, candidate_id, storage_path, file_size_bytes, generated_by, generated_at, created_at, updated_at'

/**
 * Fetch the current branded-CV row for a candidate, DbResult-shaped. Returns
 * `not_found` (never throws) both when no row exists AND when the table
 * itself is missing — callers that must tell those two apart (the UI) use
 * `getBrandedCvState` instead.
 */
export async function getBrandedCvForCandidate(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<DbResult<BrandedCvRow>> {
  const { data, error } = await untyped(supabase)
    .from('candidate_branded_cvs')
    .select(SELECT_COLUMNS)
    .eq('candidate_id', candidateId)
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) return { ok: false, code: 'not_found' }
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getBrandedCvForCandidate' },
    })
    return {
      ok: false,
      code: 'internal',
      detail: failureDetail(error, 'candidate_branded_cvs.select'),
    }
  }
  if (!data) return { ok: false, code: 'not_found' }
  // reason: candidate_branded_cvs has no generated type yet — cast at the
  // boundary; SELECT_COLUMNS above is the source of truth for the shape.
  return { ok: true, data: data as unknown as BrandedCvRow }
}

/**
 * The tri-state resolver the UI reads (branded-cv-panel.tsx, the candidate
 * detail page). NEVER throws: any read error OTHER than "table missing"
 * still degrades to `unavailable` rather than surfacing, because a broken
 * branded-CV read must never crash the candidate detail page — the same
 * "never block the rest of the page" posture the page already takes for
 * `listApplicationsForCandidate` / `listCandidateActivities`. A genuine
 * fault is still captured to Sentry (PII-free: error object + a fixed
 * subop/helper tag only); a missing-table read is an EXPECTED pre-migration
 * state and is not captured as an exception, mirroring
 * `updateCandidateCVParse`'s breadcrumb-only treatment of the same class of
 * expected condition.
 */
export async function getBrandedCvState(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<BrandedCvState> {
  const { data, error } = await untyped(supabase)
    .from('candidate_branded_cvs')
    .select(SELECT_COLUMNS)
    .eq('candidate_id', candidateId)
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) {
      Sentry.addBreadcrumb({
        category: 'branded-cv',
        message: 'candidate_branded_cvs table missing from schema cache — degraded to unavailable',
        level: 'info',
      })
      return { kind: 'unavailable' }
    }
    Sentry.captureException(error, {
      tags: { layer: 'db', helper: 'getBrandedCvState' },
    })
    return { kind: 'unavailable' }
  }
  if (!data) return { kind: 'none' }
  return { kind: 'ready', row: data as unknown as BrandedCvRow }
}

export type UpsertBrandedCvInput = {
  candidateId: string
  storagePath: string
  fileSizeBytes: number | null
  generatedBy: string | null
}

export type UpsertBrandedCvResult = {
  row: BrandedCvRow
  previousStoragePath: string | null
}

/**
 * Explicit read-then-update-or-insert (deliberately NOT a PostgREST upsert):
 * the caller needs the PREVIOUS storage_path back so it can clean up the old
 * Storage object (write-new-then-delete-old, BCV-06), and an explicit branch
 * keeps the single-row-per-candidate invariant readable rather than implicit
 * in an upsert's conflict target. NEVER sets organization_id from an
 * argument — the candidate_branded_cvs_set_org BEFORE INSERT trigger
 * (migration 20260812120000) owns it, exactly like createCandidateCV.
 *
 * A concurrent-insert unique violation (23505, on
 * candidate_branded_cvs_candidate_id_key) is recovered by re-reading and
 * updating rather than surfaced as an error — two racing "Generate" clicks
 * resolve to exactly one current row, not a 500 for whichever request loses
 * the race.
 */
export async function upsertBrandedCv(
  supabase: SupabaseClient<Database>,
  input: UpsertBrandedCvInput,
): Promise<DbResult<UpsertBrandedCvResult>> {
  const client = untyped(supabase)

  const { data: existing, error: readError } = await client
    .from('candidate_branded_cvs')
    .select(SELECT_COLUMNS)
    .eq('candidate_id', input.candidateId)
    .maybeSingle()

  if (readError) {
    // Deliberately NOT captured via Sentry.captureException when the table is
    // missing — an expected pre-migration state, not a fault. The caller
    // (generateBrandedCvAction) inspects `detail`'s leading SQLSTATE/PostgREST
    // code (the format failureDetail always produces: "CODE (subop)") to
    // return its own plain "not available yet" message instead of a generic
    // failure — see the action's own comment on this branch.
    if (isMissingTableError(readError)) {
      return {
        ok: false,
        code: 'internal',
        detail: failureDetail(readError, 'candidate_branded_cvs.select'),
      }
    }
    Sentry.captureException(readError, {
      tags: { layer: 'db', helper: 'upsertBrandedCv', subop: 'read' },
    })
    return {
      ok: false,
      code: 'internal',
      detail: failureDetail(readError, 'candidate_branded_cvs.select'),
    }
  }

  const existingRow = existing as unknown as BrandedCvRow | null

  if (!existingRow) {
    const insertPayload = {
      candidate_id: input.candidateId,
      storage_path: input.storagePath,
      file_size_bytes: input.fileSizeBytes,
      generated_by: input.generatedBy,
      generated_at: new Date().toISOString(),
    }
    const { data: inserted, error: insertError } = await client
      .from('candidate_branded_cvs')
      .insert(insertPayload)
      .select(SELECT_COLUMNS)
      .single()

    if (insertError) {
      // Concurrent-insert race: another request won the unique(candidate_id)
      // constraint between our read above and this insert. Recover by
      // re-reading and updating instead of surfacing a 500 to the loser.
      if ((insertError as { code?: string }).code === '23505') {
        return updateExisting(client, input)
      }
      Sentry.captureException(insertError, {
        tags: { layer: 'db', helper: 'upsertBrandedCv', subop: 'insert' },
      })
      return {
        ok: false,
        code: 'internal',
        detail: failureDetail(
          insertError,
          'candidate_branded_cvs.insert',
          Object.keys(insertPayload),
        ),
      }
    }
    return {
      ok: true,
      data: { row: inserted as unknown as BrandedCvRow, previousStoragePath: null },
    }
  }

  return updateExisting(client, input, existingRow.storage_path)
}

/**
 * Shared UPDATE path for both the normal "existing row" branch and the
 * 23505-recovered concurrent-insert race. `knownPreviousStoragePath` is
 * passed when the caller already has the prior row in hand (the normal
 * branch); the race-recovery caller omits it, so this re-reads first to
 * report an honest previousStoragePath rather than null.
 */
async function updateExisting(
  client: UntypedTableClient,
  input: UpsertBrandedCvInput,
  knownPreviousStoragePath?: string,
): Promise<DbResult<UpsertBrandedCvResult>> {
  let previousStoragePath = knownPreviousStoragePath ?? null
  if (previousStoragePath === null) {
    const { data: reread } = await client
      .from('candidate_branded_cvs')
      .select(SELECT_COLUMNS)
      .eq('candidate_id', input.candidateId)
      .maybeSingle()
    previousStoragePath = (reread as unknown as BrandedCvRow | null)?.storage_path ?? null
  }

  const updatePayload = {
    storage_path: input.storagePath,
    file_size_bytes: input.fileSizeBytes,
    generated_by: input.generatedBy,
    generated_at: new Date().toISOString(),
  }
  const { data: updated, error: updateError } = await client
    .from('candidate_branded_cvs')
    .update(updatePayload)
    .eq('candidate_id', input.candidateId)
    .select(SELECT_COLUMNS)
    .single()

  if (updateError) {
    Sentry.captureException(updateError, {
      tags: { layer: 'db', helper: 'upsertBrandedCv', subop: 'update' },
    })
    return {
      ok: false,
      code: 'internal',
      detail: failureDetail(
        updateError,
        'candidate_branded_cvs.update',
        Object.keys(updatePayload),
      ),
    }
  }

  return {
    ok: true,
    data: { row: updated as unknown as BrandedCvRow, previousStoragePath },
  }
}
