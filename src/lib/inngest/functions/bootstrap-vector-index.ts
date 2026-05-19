import * as Sentry from '@sentry/nextjs'

import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// bootstrap-vector-index — Plan 1 Task 1.3 (D2-05 + VERIFICATION M-1).
//
// VERIFICATION M-1 (manual-DDL path): pgvector's `CREATE INDEX CONCURRENTLY`
// cannot run inside a transaction. supabase-js does not expose raw DDL —
// adding a `pg` dependency JUST for this one statement (which runs once
// per cluster per table) is disproportionate. So this function:
//
//   1. Reads hnsw_build_state for the requested table.
//   2. Confirms the row count threshold (≥ 100 rows w/ embeddings).
//   3. Updates `last_attempt_at` + emits a Sentry breadcrumb tagged
//      `hnsw_build_requested` so the operator gets a clear signal.
//   4. Returns { ok: true, awaitingManualBuild: true }.
//
// The operator then runs the DDL manually via the Supabase Dashboard SQL
// editor following `docs/hnsw-build-runbook.md`, and updates `built_at` in
// hnsw_build_state to flip the UI from "Build" to "Built ✓".
//
// Event: { name: 'admin/build-vector-index', data: { table_name: 'candidates' | 'jobs' } }
// ---------------------------------------------------------------------------

const MIN_ROWS_FOR_BUILD = 100

type BuildIndexEventData = {
  table_name?: string
}

type HnswBuildStateRow = {
  table_name: string
  built_at: string | null
  last_attempt_at: string | null
  last_error: string | null
}

export const bootstrapVectorIndex = inngest.createFunction(
  {
    id: 'bootstrap-vector-index',
    triggers: [{ event: 'admin/build-vector-index' }],
    concurrency: { limit: 1 },
    retries: 0,
  },
  async ({ event, step }) => {
    const data = (event.data as BuildIndexEventData) ?? {}
    const tableName = data.table_name
    if (tableName !== 'candidates' && tableName !== 'jobs') {
      throw new Error(`invalid table_name: ${tableName ?? '(missing)'}`)
    }
    const embeddingColumn =
      tableName === 'candidates' ? 'candidate_embedding' : 'job_embedding'

    // ------------------------------------------------------------------
    // Step 1 — check-state. If built_at is set, return early.
    // ------------------------------------------------------------------
    const state = await step.run('check-state', async () => {
      const supabase = createServiceClient()
      // reason: hnsw_build_state isn't yet in the generated Database type
      // (Plan 0 migration 20260519092948 is post-regen). Cast at the .from
      // boundary; the SELECT shape is locally typed via HnswBuildStateRow.
      const untyped = supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              maybeSingle: () => Promise<{
                data: HnswBuildStateRow | null
                error: unknown
              }>
            }
          }
        }
      }
      const { data, error } = await untyped
        .from('hnsw_build_state')
        .select('table_name, built_at, last_attempt_at, last_error')
        .eq('table_name', tableName)
        .maybeSingle()
      if (error) {
        throw new Error(`read hnsw_build_state failed: ${readStatus(error)}`)
      }
      return data
    })

    if (state?.built_at) {
      return { ok: true, alreadyBuilt: true }
    }

    // ------------------------------------------------------------------
    // Step 2 — count rows with embeddings. Below threshold → record + exit.
    // ------------------------------------------------------------------
    const rowCount = await step.run('count-rows', async () => {
      const supabase = createServiceClient()
      const { count, error } = await supabase
        .from(tableName)
        .select('id', { count: 'exact', head: true })
        .not(embeddingColumn, 'is', null)
      if (error) {
        throw new Error(`count rows failed: ${readStatus(error)}`)
      }
      return count ?? 0
    })

    if (rowCount < MIN_ROWS_FOR_BUILD) {
      await step.run('record-too-few', async () => {
        const supabase = createServiceClient()
        const untyped = supabase as unknown as {
          from: (table: string) => {
            update: (patch: Record<string, unknown>) => {
              eq: (
                col: string,
                val: string,
              ) => Promise<{ error: unknown }>
            }
          }
        }
        const { error } = await untyped
          .from('hnsw_build_state')
          .update({
            last_attempt_at: new Date().toISOString(),
            last_error: `too few rows (${rowCount})`,
          })
          .eq('table_name', tableName)
        if (error) {
          Sentry.captureException(
            new Error(`update hnsw_build_state failed: ${readStatus(error)}`),
            {
              tags: {
                layer: 'inngest',
                function: 'bootstrap-vector-index',
                subop: 'record-too-few',
                table_name: tableName,
              },
            },
          )
        }
      })
      return { ok: true, awaitingManualBuild: false, rowCount }
    }

    // ------------------------------------------------------------------
    // Step 3 — signal build needed. Stamp last_attempt_at, clear last_error,
    // emit Sentry breadcrumb. Operator picks it up via the runbook.
    // ------------------------------------------------------------------
    await step.run('signal-build-needed', async () => {
      const supabase = createServiceClient()
      const untyped = supabase as unknown as {
        from: (table: string) => {
          update: (patch: Record<string, unknown>) => {
            eq: (
              col: string,
              val: string,
            ) => Promise<{ error: unknown }>
          }
        }
      }
      const { error } = await untyped
        .from('hnsw_build_state')
        .update({
          last_attempt_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('table_name', tableName)
      if (error) {
        Sentry.captureException(
          new Error(`update hnsw_build_state failed: ${readStatus(error)}`),
          {
            tags: {
              layer: 'inngest',
              function: 'bootstrap-vector-index',
              subop: 'signal-build-needed',
              table_name: tableName,
            },
          },
        )
      }
      // Breadcrumb so the operator sees a clear "BUILD ME" signal in
      // Sentry. Info-level — this is expected operational signalling,
      // not an error.
      Sentry.addBreadcrumb({
        category: 'hnsw',
        level: 'info',
        message: 'hnsw_build_requested',
        data: {
          action: 'hnsw_build_requested',
          table_name: tableName,
          row_count: rowCount,
        },
      })
      // Also capture a low-level event so the operator can find this in
      // Sentry's issue list (breadcrumbs don't surface on their own).
      Sentry.captureMessage(`HNSW build requested for ${tableName} (${rowCount} rows)`, {
        level: 'info',
        tags: {
          layer: 'inngest',
          function: 'bootstrap-vector-index',
          action: 'hnsw_build_requested',
          table_name: tableName,
        },
      })
    })

    return { ok: true, awaitingManualBuild: true, rowCount }
  },
)
