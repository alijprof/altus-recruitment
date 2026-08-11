'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { CapExceededError } from '@/lib/ai/claude'
import { buildMatchInputs, scoreCandidateForJob } from '@/lib/ai/match'
import {
  getOrgMatchSpendThisMonth,
  getMatchSummary,
  upsertMatchSummary,
} from '@/lib/db/ai-summaries'
import { getCandidateEmbeddingVersion, getJobEmbeddingVersion } from '@/lib/db/embeddings'
import { getJob } from '@/lib/db/jobs'
import { env } from '@/lib/env'
import { inngest } from '@/lib/inngest/client'
import { checkCap } from '@/lib/stripe/cap-enforcement'
import { ENTITLEMENT_BLOCKED_MESSAGE, requireEntitledOrg } from '@/lib/stripe/require-entitlement'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Plan 2 Task 2.2 — on-demand explain action.
//
// The matches page renders cached match_score rows for the top-10 vector
// candidates. When the cache is incomplete (precompute Inngest function
// hasn't finished yet, or a candidate was added after the last precompute
// run), the recruiter sees a "Not scored yet" badge + the
// <ExplainButton>. Clicking it calls this action, which:
//   1. authenticates + reads org via RLS
//   2. fetches embedding versions (cache key components)
//   3. cache-lookup: if hit, return immediately (refresh path)
//   4. cache-miss: call scoreCandidateForJob synchronously, upsert,
//      revalidate the matches page so the card upgrades on next render
//
// Defensive: every error path returns a flat
// `{ ok: false, error: string }` so the client component can render a
// toast without leaking server internals.
// ---------------------------------------------------------------------------

export type ExplainMatchActionResult = { ok: true } | { ok: false; error: string }

const inputSchema = z.object({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
})

/**
 * On-demand match explanation for a single candidate.
 *
 * SYNCHRONOUS SONNET EXCEPTION to CLAUDE.md "Never call Claude in a
 * synchronous request handler when it could take >2s." Justification: the
 * recruiter is actively waiting on the matches page with a `<Loader2
 * spinning />` indicator after clicking "Explain". The on-demand UX
 * requires the result inline — an Inngest + poll loop would feel laggy
 * and inconsistent with the precomputed cards on the same screen. 3-6s
 * wait is acceptable UX; >8s is not.
 *
 * Follow-up: if production p95 telemetry (Sentry traces) for this action
 * shows >8s, swap to Inngest send + poll. Tracker: planned for Phase 3
 * review if hit. The W-1 patch in `02-VERIFICATION.md` is the source of
 * record for this exception.
 */
export async function explainCandidateMatchAction(
  jobId: string,
  candidateId: string,
): Promise<ExplainMatchActionResult> {
  const parsed = inputSchema.safeParse({ jobId, candidateId })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.' }
  }

  // Entitlement gate — on-demand match scoring drives Sonnet spend; block
  // non-entitled orgs (audit blocker 1/2). checkCap is a backstop, but gating
  // here avoids the work and matches the action layer's error shape.
  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  try {
    const supabase = await createSupabaseClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      return { ok: false, error: 'Sign in to score matches.' }
    }
    const userId = userData.user.id

    // RLS gates the embedding-version reads — a cross-tenant id surfaces
    // as `not_found` (no row visible to this session). No service-role
    // here; this is the recruiter-facing path.
    const candidateVersionResult = await getCandidateEmbeddingVersion(
      supabase,
      parsed.data.candidateId,
    )
    if (!candidateVersionResult.ok) {
      return { ok: false, error: 'Candidate not found in your organisation.' }
    }
    const jobVersionResult = await getJobEmbeddingVersion(supabase, parsed.data.jobId)
    if (!jobVersionResult.ok) {
      return { ok: false, error: 'Job not found in your organisation.' }
    }

    // Cache lookup — second click on the same button after precompute
    // populated the cache hits this branch and skips the Sonnet call
    // entirely (MATCH-02 demonstrable).
    const cached = await getMatchSummary(supabase, {
      candidateId: parsed.data.candidateId,
      jobId: parsed.data.jobId,
      candidateEmbeddingVersion: candidateVersionResult.data,
      jobEmbeddingVersion: jobVersionResult.data,
    })
    if (cached.ok && cached.data) {
      revalidatePath(`/jobs/${parsed.data.jobId}/matches`)
      return { ok: true }
    }

    const inputs = await buildMatchInputs(supabase, {
      candidateId: parsed.data.candidateId,
      jobId: parsed.data.jobId,
    })
    if (!inputs.ok) {
      return { ok: false, error: 'Unable to load this candidate or job.' }
    }

    // We need the org id for the ai_usage write. Read it via the same
    // helper the listCandidates semantic branch uses.
    const orgResult = await supabase.rpc('current_organization_id')
    const organizationId = typeof orgResult.data === 'string' ? orgResult.data : null
    if (!organizationId) {
      return { ok: false, error: 'Could not resolve your organisation.' }
    }

    // Phase 2 review H2 fix — apply the same month-to-date spend ceiling
    // that protects the precompute Inngest path. A recruiter clicking
    // "Explain" repeatedly could otherwise burn through the £100/month
    // budget faster than the precompute batch loop's guard runs.
    const spendResult = await getOrgMatchSpendThisMonth(supabase, organizationId)
    if (spendResult.ok && spendResult.data >= env.MAX_MONTHLY_MATCH_SPEND_PENCE) {
      Sentry.captureMessage(
        `explainCandidateMatchAction: spend ceiling reached for org ${organizationId}`,
        {
          level: 'warning',
          tags: {
            layer: 'action',
            action: 'explainCandidateMatchAction',
            subop: 'cost-ceiling',
            organization_id: organizationId,
          },
          extra: {
            month_to_date_pence: spendResult.data,
            ceiling_pence: env.MAX_MONTHLY_MATCH_SPEND_PENCE,
          },
        },
      )
      return {
        ok: false,
        error:
          'Match scoring is paused this month — monthly spend limit reached. Contact the org owner to lift the limit.',
      }
    }

    // SYNCHRONOUS Sonnet — see JSDoc above for the documented exception.
    const score = await scoreCandidateForJob({
      candidateSummary: inputs.data.candidateSummary,
      jobSummary: inputs.data.jobSummary,
      organizationId,
      userId,
    })

    const upsertResult = await upsertMatchSummary(supabase, {
      candidateId: parsed.data.candidateId,
      jobId: parsed.data.jobId,
      candidateEmbeddingVersion: candidateVersionResult.data,
      jobEmbeddingVersion: jobVersionResult.data,
      content: score,
      model: 'claude-sonnet-4-6',
      // ai_usage is authoritative for cost (runWithLogging wrote it);
      // ai_summaries.cost_pence is bookkeeping for the matches page.
      costPence: 1,
      // The caller's own already-verified org. Passing it explicitly
      // keeps this write consistent with the service-role precompute path
      // and satisfies the same_org guard (the user client could also rely
      // on the trigger, but being explicit avoids any NULL-org surprises).
      organizationId,
    })
    if (!upsertResult.ok) {
      // Treat unique-violation gracefully — a concurrent precompute may
      // have inserted between our cache-miss and now.
      Sentry.addBreadcrumb({
        category: 'action',
        message: 'explain-match: upsert returned not-ok',
        level: 'warning',
      })
    }

    revalidatePath(`/jobs/${parsed.data.jobId}/matches`)
    return { ok: true }
  } catch (err) {
    // Hard AI cap (audit min-18, the "silent freeze" watch item). "Please try
    // again" is misleading — the call can NEVER succeed until the month resets,
    // so the recruiter retries in a loop and files a ticket instead of
    // upgrading. Return an honest, actionable message for the cap case.
    if (err instanceof CapExceededError) {
      return {
        ok: false,
        error: 'Monthly AI usage limit reached — upgrade your plan or wait for the reset.',
      }
    }
    // Wrap name + status only — Anthropic SDK error.message can echo
    // prompt fragments which would bypass the global beforeSend PII
    // scrub (Phase 1 R4).
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`explainCandidateMatchAction: ${name}`), {
      tags: {
        layer: 'action',
        action: 'explainCandidateMatchAction',
        job_id: parsed.data.jobId,
        candidate_id: parsed.data.candidateId,
      },
    })
    return { ok: false, error: 'Failed to score this candidate. Please try again.' }
  }
}

// ---------------------------------------------------------------------------
// Plan 07-07 Task 2 — bulk "Score all" action.
//
// Fires the SAME `job/score-top-candidates` event that
// embed-job-on-jd-change.ts, jobs/new/actions.ts, and
// clients/[id]/jobs/new/actions.ts already produce.
// `precompute-matches-for-job` (registered separately) does the actual
// work: tenant-boundary check, month-to-date spend ceiling, up to 10
// candidates, cache-lookup + Sonnet + upsert per candidate. This action
// does NOT re-implement the spend ceiling or the AI cap — precompute owns
// both and still enforces both; what it now does (WR-04) is READ them
// before sending, purely so a refusal can be explained to the recruiter
// instead of surfacing as a 90-second spinner over unchanged cards.
//
// Order of operations mirrors explainCandidateMatchAction:
//   1. validate jobId
//   2. entitlement gate (this path drives Sonnet spend)
//   3. auth
//   4. resolve organizationId
//   5. RLS-scoped getJob — fail fast on a forged/cross-tenant id so a
//      forged jobId never costs an Inngest attempt (same reasoning as
//      score-application-match.ts's tenant-boundary check, applied one
//      layer earlier). precompute re-checks tenancy server-side regardless.
//   6. inngest.send — never report success on a failed send.
// ---------------------------------------------------------------------------

export type ScoreAllMatchesActionResult = { ok: true } | { ok: false; error: string }

const scoreAllInputSchema = z.object({
  jobId: z.string().uuid(),
})

// Hour-granularity bucket for the "Score all" Inngest dedup id (WR-03).
// Same value and same reasoning as enqueue-match-score.ts's bucket and the
// reconciler's REQUEUE_BUCKET_MS: Inngest dedups on `id` for 24h, so a
// bucket is what keeps a collapsed double-click from becoming a day-long
// block on ever scoring this job again.
const SCORE_ALL_DEDUP_BUCKET_MS = 60 * 60 * 1000

export async function scoreAllMatchesAction(jobId: string): Promise<ScoreAllMatchesActionResult> {
  const parsed = scoreAllInputSchema.safeParse({ jobId })
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.' }
  }

  const gate = await requireEntitledOrg()
  if (!gate.ok) {
    return { ok: false, error: ENTITLEMENT_BLOCKED_MESSAGE }
  }

  const supabase = await createSupabaseClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    return { ok: false, error: 'Sign in to score matches.' }
  }
  const userId = userData.user.id

  const orgResult = await supabase.rpc('current_organization_id')
  const organizationId = typeof orgResult.data === 'string' ? orgResult.data : null
  if (!organizationId) {
    return { ok: false, error: 'Could not resolve your organisation.' }
  }

  // RLS-scoped read — a forged or cross-tenant jobId surfaces as not_found
  // here, before any Inngest attempt is spent. precompute-matches-for-job
  // re-checks the tenant boundary itself (service-role bypasses RLS), so
  // this is a fail-fast optimisation, not the only guard.
  const jobResult = await getJob(supabase, parsed.data.jobId)
  if (!jobResult.ok || jobResult.data.organization_id !== organizationId) {
    return { ok: false, error: 'Job not found in your organisation.' }
  }

  // WR-04 (review 2026-08-11) — READ-ONLY pre-flight, not a second
  // enforcement point. precompute-matches-for-job remains the authority on
  // both of these and still re-checks them; the problem this solves is that
  // when it bails, it does so SILENTLY — it writes no summary and returns.
  // The recruiter got a "Scoring started" toast, a 90-second spinner, the
  // same "Not scored yet" cards, and an ambiguous "may still be running"
  // message, with no path from this UI to "you have hit your AI budget" (a
  // documented live watch-list item: the £-cap silent freeze). They then
  // click again, and again.
  //
  // Mirrors what explainCandidateMatchAction already does on the same two
  // conditions, so the two scoring entry points give the same answer.
  const spendResult = await getOrgMatchSpendThisMonth(supabase, organizationId)
  if (spendResult.ok && spendResult.data >= env.MAX_MONTHLY_MATCH_SPEND_PENCE) {
    return {
      ok: false,
      error:
        'Match scoring is paused this month — monthly spend limit reached. Contact the org owner to lift the limit.',
    }
  }

  // checkCap is read-only and fails OPEN on any billing/DB error, so a
  // misconfiguration can never block scoring here — it only ever converts an
  // already-certain refusal into an honest message.
  const cap = await checkCap(organizationId, 'match_score')
  if (!cap.allow) {
    return {
      ok: false,
      error: 'Monthly AI usage limit reached — upgrade your plan or wait for the reset.',
    }
  }

  try {
    await inngest.send({
      // WR-03 (review 2026-08-11) — dedup id, mirroring the prior art in
      // enqueue-match-score.ts:58. Without one, an impatient double/triple
      // click during the 90-second poll started 2-3 concurrent
      // precompute-matches-for-job runs (per-org concurrency is 2), and the
      // scorer's cache guard only helps once a PRIOR run has finished
      // WRITING — so the same uncached candidates each bought 2-3 Sonnet
      // calls. That is the exact failure review 2026-08-04 M1 already paid
      // for on the other event.
      //
      // Hour-bucketed for the same reason as the match-score id: several
      // precompute outcomes write no summary (empty profile, spend ceiling,
      // AI cap), so a bare per-job key would turn a transient skip into a
      // 24h scoring blind spot. The bucket collapses the double-click
      // (seconds apart) while capping any blind spot at one hour.
      //
      // The other three producers of this event (jobs/new, clients/[id]/
      // jobs/new, embed-job-on-jd-change) deliberately send no id, so this
      // never dedups a legitimate JD-change or job-creation rescore.
      id: `score-top:${parsed.data.jobId}:${Math.floor(Date.now() / SCORE_ALL_DEDUP_BUCKET_MS)}`,
      name: 'job/score-top-candidates',
      data: {
        organization_id: organizationId,
        job_id: parsed.data.jobId,
        user_id: userId,
      },
    })
  } catch (err) {
    // Wrap name only, same PII-safe posture as the explain action's catch
    // block — never log the Inngest payload.
    const name = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(new Error(`scoreAllMatchesAction: ${name}`), {
      tags: {
        layer: 'action',
        action: 'scoreAllMatchesAction',
        subop: 'inngest.send',
        job_id: parsed.data.jobId,
      },
    })
    return { ok: false, error: 'Could not start scoring. Please try again.' }
  }

  revalidatePath(`/jobs/${parsed.data.jobId}/matches`)
  return { ok: true }
}
