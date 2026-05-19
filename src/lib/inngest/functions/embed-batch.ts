import * as Sentry from '@sentry/nextjs'

import { candidateEmbeddingText, jobEmbeddingText } from '@/lib/ai/embed-text'
import { embed } from '@/lib/ai/voyage'
import {
  bumpCandidateEmbedding,
  type CandidateForEmbedding,
} from '@/lib/db/candidates'
import { bumpJobEmbedding, type JobForEmbedding } from '@/lib/db/jobs'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// embed-batch — scheduled sweep AND event-driven org-scoped backfill.
//
// Two triggers (one function, per Plan 1 Task 1.1 recommendation — keeps the
// Inngest function count down):
//   * Cron every 10 min (Europe/London): sweep across all orgs for rows
//     with NULL embeddings. Picks up candidates / jobs whose `invalidate_*`
//     trigger NULLed their embedding after a material column change.
//   * Event `embed/backfill-org`: one-shot sweep scoped to a single
//     organization_id. Wired from /settings/integrations (Plan 1 Task 1.3).
//
// Voyage allows ≤ 128 inputs per call. We process up to 256 candidates +
// 256 jobs per run (LIMIT 256) and group by organization_id so each
// `ai_usage` row carries the correct tenant attribution. NEVER mix orgs in
// a single Voyage call — that would smear cost across tenants.
// ---------------------------------------------------------------------------

const PER_RUN_ROW_CAP = 256
const VOYAGE_BATCH_CAP = 128

type CandidateRowFromDB = CandidateForEmbedding

type JobRowFromDB = JobForEmbedding

type EmbedBatchEventData = {
  // Optional: when present, restrict the sweep to this org only.
  organization_id?: string
  user_id?: string | null
}

function isEmbedBatchEvent(data: unknown): data is EmbedBatchEventData {
  return typeof data === 'object' && data !== null
}

/**
 * Chunk a list into runs of at most `size`. The Voyage SDK rejects >128
 * inputs per call; we slice deterministically to mirror that limit.
 */
function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size))
  }
  return out
}

function groupByOrg<T extends { organization_id: string }>(
  rows: T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const list = out.get(r.organization_id) ?? []
    list.push(r)
    out.set(r.organization_id, list)
  }
  return out
}

export const embedBatch = inngest.createFunction(
  {
    id: 'embed-batch',
    triggers: [
      // Cron — TZ scoped to Europe/London for predictable run times in
      // the anchor's working day. Inngest treats the entire string as a
      // standard 5-field cron with TZ= prefix.
      { cron: 'TZ=Europe/London */10 * * * *' },
      // Event — recruiter-initiated backfill from /settings/integrations.
      { event: 'embed/backfill-org' },
    ],
    // Global single-runner: cron has no org payload, and event-driven
    // runs are infrequent. No starvation risk with limit=1.
    concurrency: { limit: 1 },
    // Failures recover on the next 10-min run — no aggressive retry.
    retries: 1,
  },
  async ({ event, step }) => {
    const eventData = isEmbedBatchEvent(event.data) ? event.data : {}
    const scopeOrgId =
      typeof eventData.organization_id === 'string' && eventData.organization_id.length > 0
        ? eventData.organization_id
        : null
    const scopeUserId =
      typeof eventData.user_id === 'string' && eventData.user_id.length > 0
        ? eventData.user_id
        : null

    // ------------------------------------------------------------------
    // Step A: candidates sweep.
    // ------------------------------------------------------------------
    await step.run('sweep-candidates', async () => {
      const supabase = createServiceClient()

      let query = supabase
        .from('candidates')
        .select(
          'id, organization_id, full_name, current_role_title, current_company, location, skills, seniority_level, years_experience, sector_tags, embedding_version',
        )
        .is('candidate_embedding', null)
        .limit(PER_RUN_ROW_CAP)
      if (scopeOrgId) {
        query = query.eq('organization_id', scopeOrgId)
      }

      const { data: rawRows, error } = await query
      if (error) {
        Sentry.captureException(error, {
          tags: { layer: 'inngest', function: 'embed-batch', subop: 'select-candidates' },
        })
        return
      }
      const rows = (rawRows ?? []) as unknown as CandidateRowFromDB[]
      if (rows.length === 0) return

      const byOrg = groupByOrg(rows)
      for (const [orgId, orgRows] of byOrg) {
        // Per-org batching keeps ai_usage.organization_id truthful — never
        // mix orgs in a single Voyage call.
        try {
          for (const batch of chunk(orgRows, VOYAGE_BATCH_CAP)) {
            const inputs = batch.map((r) => candidateEmbeddingText(r, null))
            // Defensive: drop rows that produced an empty input string
            // (shouldn't happen — at minimum the row has a full_name).
            const usable = batch
              .map((r, idx) => ({ row: r, text: inputs[idx] ?? '' }))
              .filter((p) => p.text.trim().length > 0)
            if (usable.length === 0) continue

            const { vectors } = await embed({
              organizationId: orgId,
              userId: scopeOrgId === orgId ? scopeUserId : null,
              purpose: 'candidate_embed',
              inputType: 'document',
              inputs: usable.map((p) => p.text),
            })

            for (let i = 0; i < usable.length; i++) {
              const pair = usable[i]
              const vector = vectors[i]
              if (!pair || !vector || vector.length === 0) continue
              await bumpCandidateEmbedding(supabase, {
                candidateId: pair.row.id,
                embedding: vector,
                embeddingVersion: (pair.row.embedding_version ?? 0) + 1,
              })
            }
          }
        } catch (err) {
          const name = err instanceof Error ? err.name : 'UnknownError'
          const status = readStatus(err)
          Sentry.captureException(new Error(`${name}: ${status}`), {
            tags: {
              layer: 'inngest',
              function: 'embed-batch',
              subop: 'embed-candidates-org',
              org_id: orgId,
            },
          })
          // Continue to next org — one bad org shouldn't block the rest.
        }
      }
    })

    // ------------------------------------------------------------------
    // Step B: jobs sweep.
    // ------------------------------------------------------------------
    await step.run('sweep-jobs', async () => {
      const supabase = createServiceClient()

      let query = supabase
        .from('jobs')
        .select(
          'id, organization_id, title, location, job_type, hiring_context, salary_min, salary_max, currency, description, embedding_version',
        )
        .is('job_embedding', null)
        .limit(PER_RUN_ROW_CAP)
      if (scopeOrgId) {
        query = query.eq('organization_id', scopeOrgId)
      }

      const { data: rawRows, error } = await query
      if (error) {
        Sentry.captureException(error, {
          tags: { layer: 'inngest', function: 'embed-batch', subop: 'select-jobs' },
        })
        return
      }
      const rows = (rawRows ?? []) as unknown as JobRowFromDB[]
      if (rows.length === 0) return

      const byOrg = groupByOrg(rows)
      for (const [orgId, orgRows] of byOrg) {
        try {
          for (const batch of chunk(orgRows, VOYAGE_BATCH_CAP)) {
            const usable = batch
              .map((r) => ({ row: r, text: jobEmbeddingText(r) }))
              .filter((p) => p.text.trim().length > 0)
            if (usable.length === 0) continue

            const { vectors } = await embed({
              organizationId: orgId,
              userId: scopeOrgId === orgId ? scopeUserId : null,
              purpose: 'job_embed',
              inputType: 'document',
              inputs: usable.map((p) => p.text),
            })

            for (let i = 0; i < usable.length; i++) {
              const pair = usable[i]
              const vector = vectors[i]
              if (!pair || !vector || vector.length === 0) continue
              await bumpJobEmbedding(supabase, {
                jobId: pair.row.id,
                embedding: vector,
                embeddingVersion: (pair.row.embedding_version ?? 0) + 1,
              })
            }
          }
        } catch (err) {
          const name = err instanceof Error ? err.name : 'UnknownError'
          const status = readStatus(err)
          Sentry.captureException(new Error(`${name}: ${status}`), {
            tags: {
              layer: 'inngest',
              function: 'embed-batch',
              subop: 'embed-jobs-org',
              org_id: orgId,
            },
          })
        }
      }
    })
  },
)
