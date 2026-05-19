import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { jobEmbeddingText } from '@/lib/ai/embed-text'
import { embed } from '@/lib/ai/voyage'
import { bumpJobEmbedding, getJobForEmbedding } from '@/lib/db/jobs'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// embed-job-on-jd-change — event-driven Voyage embed of a single job.
//
// Fired from server actions after a job is created or its embed-relevant
// columns change (title, location, job_type, hiring_context, salary, currency,
// description). The Plan 0 invalidate trigger NULLs the embedding on column
// change; this function re-populates it.
//
// Tenant boundary: the event payload is untrusted. The function rejects
// missing fields with NonRetriableError, then verifies the resolved job's
// organization_id matches the payload's claim BEFORE making the Voyage call.
// ---------------------------------------------------------------------------

type JobEmbedEventData = {
  organization_id: string
  job_id: string
  user_id: string | null
}

function asJobEmbedData(value: unknown): JobEmbedEventData {
  // reason: Inngest typings are deliberately wide; the only producers are
  // server actions in this codebase. RLS + the explicit tenant boundary
  // check below catch any forged payloads. Same pattern as parse-cv.ts.
  return value as JobEmbedEventData
}

export const embedJobOnJDChange = inngest.createFunction(
  {
    id: 'embed-job-on-jd-change',
    triggers: [{ event: 'job/embed' }],
    // Per-tenant concurrency cap mirrors parse-cv-on-upload.
    concurrency: { limit: 5, key: 'event.data.organization_id' },
    retries: 3,
  },
  async ({ event, step }) => {
    const data = asJobEmbedData(event.data)
    const { organization_id, job_id, user_id } = data

    // ------------------------------------------------------------------
    // Tenant boundary checks — MUST run before any step.run so a forged
    // payload fails fast without spending an Inngest attempt.
    // ------------------------------------------------------------------
    if (
      typeof organization_id !== 'string' ||
      organization_id.length === 0 ||
      typeof job_id !== 'string' ||
      job_id.length === 0
    ) {
      throw new NonRetriableError('missing required fields')
    }

    try {
      const job = await step.run('read-job', async () => {
        const supabase = createServiceClient()
        const result = await getJobForEmbedding(supabase, job_id)
        if (!result.ok) {
          throw new NonRetriableError(`getJobForEmbedding: ${result.code}`)
        }
        // CRITICAL: explicit cross-tenant guard. Service role bypasses RLS,
        // so this is the ONLY thing standing between a forged event and a
        // cross-tenant read. RESEARCH §17 + LEARNINGS Phase 1 R-pattern.
        if (result.data.organization_id !== organization_id) {
          throw new NonRetriableError('job not in claimed organization')
        }
        return result.data
      })

      const embeddingText = jobEmbeddingText(job)
      if (embeddingText.trim().length === 0) {
        // Defensive: a job with no title and no description is degenerate.
        // Skip — the scheduled sweep will re-evaluate it if needed.
        return
      }

      const { vectors } = await step.run('embed', async () => {
        return await embed({
          organizationId: organization_id,
          userId: user_id,
          purpose: 'job_embed',
          inputType: 'document',
          inputs: [embeddingText],
        })
      })

      const vector = vectors[0]
      if (!vector || vector.length === 0) {
        throw new Error('voyage embed returned no vector')
      }

      await step.run('persist', async () => {
        const supabase = createServiceClient()
        await bumpJobEmbedding(supabase, {
          jobId: job_id,
          embedding: vector,
          embeddingVersion: (job.embedding_version ?? 0) + 1,
        })
      })
    } catch (err) {
      // VERIFICATION R4: wrap name + status only — never pass the raw
      // error to Sentry (Voyage SDK error.message can include input
      // fragments that would bypass beforeSend PII scrub).
      const name = err instanceof Error ? err.name : 'UnknownError'
      const status = readStatus(err)
      Sentry.captureException(new Error(`${name}: ${status}`), {
        tags: {
          layer: 'inngest',
          function: 'embed-job-on-jd-change',
          job_id,
        },
      })
      throw err
    }
  },
)
