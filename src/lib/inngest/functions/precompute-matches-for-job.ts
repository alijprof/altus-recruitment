import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { buildMatchInputs, scoreCandidateForJob } from '@/lib/ai/match'
import {
  getOrgMatchSpendThisMonth,
  getMatchSummary,
  upsertMatchSummary,
} from '@/lib/db/ai-summaries'
import { getCandidateForEmbedding } from '@/lib/db/candidates'
import {
  getCandidateEmbeddingVersion,
  getTopCandidatesForJob,
} from '@/lib/db/embeddings'
import { getJobForEmbedding } from '@/lib/db/jobs'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// precompute-matches-for-job — Plan 2 Task 2.1.
//
// Triggered on `job/score-top-candidates`. The event is fired from
// `embed-job-on-jd-change` after a successful embed (NOT directly from
// createJobAction — the embed must be in place before scoring or the
// vector lookup returns nothing).
//
// Pipeline:
//   1. Tenant-boundary check (event payload is untrusted; service-role
//      bypasses RLS so this is the only barrier).
//   2. read-job-context — load the job + month-to-date Sonnet spend.
//      If spend >= ceiling, emit a Sentry warning and exit (NO retries —
//      the cache stays as-is; recruiter sees vector-only matches).
//   3. select-top-candidates — `getTopCandidatesForJob`, up to 10.
//   4. For each candidate: cache lookup, then (on miss) Sonnet call +
//      upsert. Each candidate is its OWN step.run so Inngest retries
//      a single transient failure independently.
//
// Concurrency `{ limit: 2, key: 'event.data.organization_id' }` — tighter
// than embed-job (5) because each invocation does up to 10 Sonnet calls.
//
// Cost guard: env.MAX_MONTHLY_MATCH_SPEND_PENCE (default £100) is
// per-org/per-calendar-month. Exceeding it surfaces a Sentry warning, not
// an error — runaway spend is a product signal, not a bug.
// ---------------------------------------------------------------------------

type JobScoreEventData = {
  organization_id: string
  job_id: string
  user_id: string | null
}

function asJobScoreData(value: unknown): JobScoreEventData {
  // reason: Inngest typings are deliberately wide; the only producers are
  // server actions and chained step.sendEvent calls in this codebase. The
  // tenant-boundary check below catches any forged payload.
  return value as JobScoreEventData
}

// Defensive estimate when we can't observe Anthropic's actual token usage.
// runWithLogging records the authoritative number in ai_usage; the value
// here only feeds ai_summaries.cost_pence (display-side bookkeeping).
const MATCH_COST_ESTIMATE_PENCE = 1

const TOP_N_PER_JOB = 10

export const precomputeMatchesForJob = inngest.createFunction(
  {
    id: 'precompute-matches-for-job',
    triggers: [{ event: 'job/score-top-candidates' }],
    concurrency: { limit: 2, key: 'event.data.organization_id' },
    retries: 3,
    onFailure: async ({ event, error }) => {
      const originalData = asJobScoreData(event.data.event.data)
      Sentry.captureException(
        formatErrorForSentry(error, 'precompute-matches onFailure:'),
        {
          tags: {
            layer: 'inngest',
            function: 'precompute-matches-for-job',
            handler: 'onFailure',
            job_id: originalData.job_id ?? 'unknown',
          },
        },
      )
    },
  },
  async ({ event, step }) => {
    const data = asJobScoreData(event.data)
    const { organization_id, job_id, user_id } = data

    // ------------------------------------------------------------------
    // Tenant boundary checks — MUST run before any step.run so a forged
    // payload fails fast without spending an Inngest attempt. RESEARCH
    // §17 + Phase 1 LEARNINGS "Service-role usage ONLY in Inngest
    // functions with explicit tenant boundary check".
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
      // Step 1: load job (verifying tenant) + month-to-date spend.
      const context = await step.run('read-job-context', async () => {
        const supabase = createServiceClient()

        const jobResult = await getJobForEmbedding(supabase, job_id)
        if (!jobResult.ok) {
          throw new NonRetriableError(`getJobForEmbedding: ${jobResult.code}`)
        }
        // CRITICAL: service-role bypasses RLS so this comparison is the
        // ONLY thing standing between a forged event and a cross-tenant
        // read. Same pattern as embed-job-on-jd-change.ts.
        if (jobResult.data.organization_id !== organization_id) {
          throw new NonRetriableError('job not in claimed organization')
        }

        const spendResult = await getOrgMatchSpendThisMonth(supabase, organization_id)
        if (!spendResult.ok) {
          // Treat as 0 — better to over-spend by one batch than to
          // permanently block scoring when the aggregate read flakes.
          Sentry.captureException(
            new Error('precompute-matches: spend lookup failed'),
            {
              tags: {
                layer: 'inngest',
                function: 'precompute-matches-for-job',
                subop: 'spend-lookup',
                organization_id,
              },
            },
          )
          return { spendPence: 0, jobEmbeddingVersion: jobResult.data.embedding_version ?? 0 }
        }
        return {
          spendPence: spendResult.data,
          jobEmbeddingVersion: jobResult.data.embedding_version ?? 0,
        }
      })

      // Cost-ceiling check — Sentry warning, NOT throw. RESEARCH §B.8:
      // recruiter retains the vector-only fallback while a real human
      // investigates.
      if (context.spendPence >= env.MAX_MONTHLY_MATCH_SPEND_PENCE) {
        Sentry.captureMessage(
          `match scoring spend ceiling reached for org ${organization_id}`,
          {
            level: 'warning',
            tags: {
              layer: 'inngest',
              function: 'precompute-matches-for-job',
              organization_id,
            },
            extra: {
              month_to_date_pence: context.spendPence,
              ceiling_pence: env.MAX_MONTHLY_MATCH_SPEND_PENCE,
            },
          },
        )
        return { stopped: 'cost-ceiling', spend_pence: context.spendPence }
      }

      // Step 2: select top-N candidates by vector similarity. Empty result
      // is a valid outcome — job hasn't been embedded yet OR no candidates
      // have embeddings yet.
      //
      // Phase 2 review C1 fix: pass `organization_id` explicitly so the
      // RPC filters by org. Service-role bypasses RLS, so this is the
      // load-bearing tenant guard. The RPC also asserts the job lives in
      // this org and raises if not — defence in depth against forged
      // event payloads.
      const topCandidates = await step.run('select-top-candidates', async () => {
        const supabase = createServiceClient()
        const result = await getTopCandidatesForJob(supabase, {
          jobId: job_id,
          organizationId: organization_id,
          limit: TOP_N_PER_JOB,
        })
        if (!result.ok) {
          throw new Error(`getTopCandidatesForJob: ${result.code}`)
        }
        return result.data.map((c) => ({ id: c.id }))
      })

      if (topCandidates.length === 0) {
        Sentry.addBreadcrumb({
          category: 'inngest',
          message: 'precompute-matches: no candidates to score',
          level: 'info',
          data: { job_id, organization_id },
        })
        return { scored: 0, cache_hits: 0 }
      }

      // Step 3: score each candidate in its own step.run for independent
      // retry semantics. Sequential within the step loop (NOT
      // Promise.all) — bounds Anthropic concurrency and the runtime tx
      // budget per Inngest invocation.
      let cacheHits = 0
      let scored = 0
      for (const candidate of topCandidates) {
        await step.run(`score-${candidate.id}`, async () => {
          const supabase = createServiceClient()

          // Phase 2 review C1 — belt-and-braces post-RPC check. The
          // RPC's `where c.organization_id = p_organization_id` filter
          // (migration 20260519130000) should make this impossible to
          // fail, but service-role bypasses RLS so a defence-in-depth
          // re-check before the Sonnet call costs one extra read and
          // closes the leak if the RPC ever regresses. Fail closed:
          // log + skip the candidate (no Sonnet call, no ai_usage row).
          const candForVerifyResult = await getCandidateForEmbedding(
            supabase,
            candidate.id,
          )
          if (!candForVerifyResult.ok) {
            return
          }
          if (
            candForVerifyResult.data.organization_id !== organization_id
          ) {
            Sentry.captureException(
              new Error('precompute-matches: cross-tenant candidate in top-N'),
              {
                tags: {
                  layer: 'inngest',
                  function: 'precompute-matches-for-job',
                  subop: 'cross-tenant-guard',
                  organization_id,
                },
              },
            )
            return
          }

          const candVersionResult = await getCandidateEmbeddingVersion(supabase, candidate.id)
          if (!candVersionResult.ok) {
            // Candidate vanished or read failed — skip (sweep / next
            // invocation re-evaluates).
            return
          }
          const candidateEmbeddingVersion = candVersionResult.data
          const jobEmbeddingVersion = context.jobEmbeddingVersion

          const cacheResult = await getMatchSummary(supabase, {
            candidateId: candidate.id,
            jobId: job_id,
            candidateEmbeddingVersion,
            jobEmbeddingVersion,
          })
          if (cacheResult.ok && cacheResult.data) {
            cacheHits++
            return
          }

          const inputs = await buildMatchInputs(supabase, {
            candidateId: candidate.id,
            jobId: job_id,
          })
          if (!inputs.ok) {
            // Candidate or job vanished between top-N selection and now;
            // skip without throwing.
            return
          }

          const score = await scoreCandidateForJob({
            candidateSummary: inputs.data.candidateSummary,
            jobSummary: inputs.data.jobSummary,
            organizationId: organization_id,
            userId: user_id,
          })

          const upsertResult = await upsertMatchSummary(supabase, {
            candidateId: candidate.id,
            jobId: job_id,
            candidateEmbeddingVersion,
            jobEmbeddingVersion,
            content: score,
            model: 'claude-sonnet-4-6',
            costPence: MATCH_COST_ESTIMATE_PENCE,
            // Job's org, already verified against the claimed org at
            // read-job-context (line ~120). Required so the service-role
            // insert satisfies set_organization_id() instead of RAISE-ing
            // on a NULL org — which silently failed every match insert.
            organizationId: organization_id,
          })
          if (!upsertResult.ok) {
            // Unique-violation = concurrent worker already inserted; no-op.
            // Any other failure is logged in upsertMatchSummary's Sentry
            // capture. Don't rethrow — the score row is best-effort
            // bookkeeping; ai_usage is the authoritative ledger.
            return
          }
          scored++
        })
      }

      return { scored, cache_hits: cacheHits, top_n: topCandidates.length }
    } catch (err) {
      Sentry.captureException(formatErrorForSentry(err), {
        tags: {
          layer: 'inngest',
          function: 'precompute-matches-for-job',
          job_id,
        },
      })
      throw err
    }
  },
)
