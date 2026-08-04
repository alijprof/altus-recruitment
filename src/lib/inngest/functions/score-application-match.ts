import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { buildMatchInputs, scoreCandidateForJob } from '@/lib/ai/match'
import { CapExceededError } from '@/lib/ai/claude'
import { isProfileEffectivelyEmpty } from '@/lib/ai/profile-completeness'
import {
  getOrgMatchSpendThisMonth,
  getMatchSummary,
  upsertMatchSummary,
} from '@/lib/db/ai-summaries'
import { getCandidateForEmbedding } from '@/lib/db/candidates'
import { getCandidateEmbeddingVersion, getJobEmbeddingVersion } from '@/lib/db/embeddings'
import { getJobForEmbedding } from '@/lib/db/jobs'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { formatErrorForSentry } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// score-application-match — SF-3 (Steele Charles feature review 2026-07-31,
// Batch 2 Task 1).
//
// Triggered on `application/score-match`, fired by
// enqueueApplicationMatchScore from all four application-create paths
// (add-to-job, add-to-shortlist, promote-shortlist-to-application,
// add-float — the last is a permanent no-op today since floats have
// job_id=null). Unlike precompute-matches-for-job (which scores the top-10
// vector candidates for a JOB), this scores exactly ONE candidate x job
// pair the moment a recruiter puts them together, so the score lands on
// the screens the recruiter actually works from (the job's applications
// table + both pipeline surfaces) instead of only the separate /matches
// page.
//
// Pipeline:
//   1. Tenant-boundary check on the raw event payload (untrusted) — runs
//      before any step.run so a forged payload costs no attempt.
//   2. verify-and-load — service-role load of BOTH parents, tenant
//      re-check against the claimed org (the only barrier under
//      service-role — mirrors precompute-matches-for-job.ts:118-123).
//   3. Empty-profile skip (SF-1 contamination guard, shared predicate —
//      reuses Batch 1's isProfileEffectivelyEmpty rather than a second
//      definition).
//   4. Idempotency guard — a fresh cached summary for the exact identity
//      tuple short-circuits before any spend. The ai_summaries unique
//      constraint is the concurrent-double-fire backstop: a 23505 from the
//      upsert maps to 'duplicate' (see upsertMatchSummary) and is treated
//      as success, not an error.
//   5. Spend ceiling + AI cap, same rationale as precompute.
//   6. Sonnet call + cost-logged upsert.
//
// Concurrency `{ limit: 2, key: 'event.data.organization_id' }` matches
// precompute-matches-for-job — generous here since a single candidate x
// job pair costs one Sonnet call, not up to ten.
// ---------------------------------------------------------------------------

type ScoreMatchEventData = {
  organization_id: string
  application_id: string
  candidate_id: string
  job_id: string
  user_id: string | null
}

function asScoreMatchData(value: unknown): ScoreMatchEventData {
  // reason: Inngest typings are deliberately wide; the only producer is
  // enqueueApplicationMatchScore. The tenant-boundary check below catches
  // any forged payload.
  return value as ScoreMatchEventData
}

// Defensive estimate when we can't observe Anthropic's actual token usage.
// runWithLogging records the authoritative number in ai_usage; the value
// here only feeds ai_summaries.cost_pence (display-side bookkeeping).
const MATCH_COST_ESTIMATE_PENCE = 1

export const scoreApplicationMatch = inngest.createFunction(
  {
    id: 'score-application-match',
    triggers: [{ event: 'application/score-match' }],
    concurrency: { limit: 2, key: 'event.data.organization_id' },
    retries: 3,
    onFailure: async ({ event, error }) => {
      const originalData = asScoreMatchData(event.data.event.data)
      Sentry.captureException(
        formatErrorForSentry(error, 'score-application-match onFailure:'),
        {
          tags: {
            layer: 'inngest',
            function: 'score-application-match',
            handler: 'onFailure',
            application_id: originalData.application_id ?? 'unknown',
          },
        },
      )
    },
  },
  async ({ event, step }) => {
    const data = asScoreMatchData(event.data)
    const { organization_id, candidate_id, job_id, user_id } = data

    // ------------------------------------------------------------------
    // Tenant boundary checks — MUST run before any step.run so a forged
    // payload fails fast without spending an Inngest attempt.
    // ------------------------------------------------------------------
    if (
      typeof organization_id !== 'string' ||
      organization_id.length === 0 ||
      typeof candidate_id !== 'string' ||
      candidate_id.length === 0 ||
      typeof job_id !== 'string' ||
      job_id.length === 0
    ) {
      throw new NonRetriableError('missing required fields')
    }

    try {
      // Step 1: load both parents (verifying tenant) + their embedding
      // versions, which form part of the cache-key identity tuple.
      const verified = await step.run('verify-and-load', async () => {
        const supabase = createServiceClient()

        const candidateResult = await getCandidateForEmbedding(supabase, candidate_id)
        if (!candidateResult.ok) {
          throw new NonRetriableError(`getCandidateForEmbedding: ${candidateResult.code}`)
        }
        const jobResult = await getJobForEmbedding(supabase, job_id)
        if (!jobResult.ok) {
          throw new NonRetriableError(`getJobForEmbedding: ${jobResult.code}`)
        }

        // CRITICAL: service-role bypasses RLS so this comparison is the
        // ONLY thing standing between a forged event and a cross-tenant
        // read/spend. Same pattern as precompute-matches-for-job.ts.
        if (
          candidateResult.data.organization_id !== organization_id ||
          jobResult.data.organization_id !== organization_id
        ) {
          throw new NonRetriableError('candidate or job not in claimed organization')
        }

        const candVersionResult = await getCandidateEmbeddingVersion(supabase, candidate_id)
        const jobVersionResult = await getJobEmbeddingVersion(supabase, job_id)

        return {
          candidate: candidateResult.data,
          candidateEmbeddingVersion: candVersionResult.ok ? candVersionResult.data : 0,
          jobEmbeddingVersion: jobVersionResult.ok ? jobVersionResult.data : 0,
        }
      })

      // SF-1 contamination guard: a candidate with no real profile content
      // (Haiku returned nothing usable, or the CV merge never landed)
      // should never get a Sonnet-scored match explanation — there's no
      // signal to explain and no ai_usage spend is justified. Skip before
      // the cache lookup so we never even check for a stale cached score
      // to refresh. Reuses Batch 1's single source of truth for "empty" —
      // do NOT write a second predicate.
      if (isProfileEffectivelyEmpty(verified.candidate)) {
        Sentry.addBreadcrumb({
          category: 'inngest',
          message: 'score-application-match: skipped effectively-empty profile',
          level: 'info',
          data: { candidate_id, job_id },
        })
        return { skipped: 'empty-profile' }
      }

      // Step 2: idempotency guard (fixes the 07-07 double-fire, audit
      // SF-3). On a hit, return before spending anything.
      const cached = await step.run('cache-lookup', async () => {
        const supabase = createServiceClient()
        return getMatchSummary(supabase, {
          candidateId: candidate_id,
          jobId: job_id,
          candidateEmbeddingVersion: verified.candidateEmbeddingVersion,
          jobEmbeddingVersion: verified.jobEmbeddingVersion,
        })
      })
      if (cached.ok && cached.data) {
        return { skipped: 'cached' }
      }

      // Step 3: month-to-date spend ceiling — Sentry warning, NOT throw
      // (same rationale as precompute: the recruiter still sees the
      // applications table without a score while a human investigates).
      const spendResult = await step.run('spend-check', async () => {
        const supabase = createServiceClient()
        return getOrgMatchSpendThisMonth(supabase, organization_id)
      })
      const spendPence = spendResult.ok ? spendResult.data : 0
      if (spendPence >= env.MAX_MONTHLY_MATCH_SPEND_PENCE) {
        Sentry.captureMessage(`match scoring spend ceiling reached for org ${organization_id}`, {
          level: 'warning',
          tags: {
            layer: 'inngest',
            function: 'score-application-match',
            organization_id,
          },
          extra: {
            month_to_date_pence: spendPence,
            ceiling_pence: env.MAX_MONTHLY_MATCH_SPEND_PENCE,
          },
        })
        return { stopped: 'cost-ceiling', spend_pence: spendPence }
      }

      // Step 4: score + cache-write, combined in one step so a transient
      // retry after a failed upsert doesn't silently skip the Sonnet call
      // (mirrors precompute-matches-for-job's per-candidate step shape).
      const outcome = await step.run('score-and-cache', async () => {
        const supabase = createServiceClient()

        const inputs = await buildMatchInputs(supabase, {
          candidateId: candidate_id,
          jobId: job_id,
        })
        if (!inputs.ok) {
          // Candidate or job vanished between verify-and-load and now;
          // skip without throwing.
          return { scored: false as const, reason: 'inputs-unavailable' }
        }

        let score
        try {
          score = await scoreCandidateForJob({
            candidateSummary: inputs.data.candidateSummary,
            jobSummary: inputs.data.jobSummary,
            organizationId: organization_id,
            userId: user_id,
          })
        } catch (scoreErr) {
          // Hard AI cap reached. Mirror the existing spend-ceiling bail —
          // Sentry warning, exit, no retries (the call can never succeed
          // until the month resets).
          if (scoreErr instanceof CapExceededError) {
            Sentry.captureMessage(`match scoring AI cap exceeded for org ${organization_id}`, {
              level: 'warning',
              tags: {
                layer: 'inngest',
                function: 'score-application-match',
                organization_id,
                bucket: scoreErr.bucket,
              },
            })
            return { scored: false as const, reason: 'cap-exceeded' }
          }
          throw scoreErr
        }

        const upsertResult = await upsertMatchSummary(supabase, {
          candidateId: candidate_id,
          jobId: job_id,
          candidateEmbeddingVersion: verified.candidateEmbeddingVersion,
          jobEmbeddingVersion: verified.jobEmbeddingVersion,
          content: score,
          model: 'claude-sonnet-4-6',
          costPence: MATCH_COST_ESTIMATE_PENCE,
          // Already-verified org — required so the service-role insert
          // satisfies set_organization_id() instead of RAISE-ing on a NULL
          // org (see the comment block at the top of
          // src/lib/db/ai-summaries.ts).
          organizationId: organization_id,
        })
        if (!upsertResult.ok) {
          // 'duplicate' = a concurrent worker already inserted — that IS
          // the desired end state, not a fault. Any other failure is
          // already Sentry-captured inside upsertMatchSummary. Don't
          // rethrow either way; the score row is best-effort bookkeeping
          // and ai_usage is the authoritative cost ledger.
          return { scored: false as const, reason: upsertResult.code }
        }
        return { scored: true as const }
      })

      return outcome
    } catch (err) {
      Sentry.captureException(formatErrorForSentry(err), {
        tags: {
          layer: 'inngest',
          function: 'score-application-match',
          candidate_id,
          job_id,
        },
      })
      throw err
    }
  },
)
