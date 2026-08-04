import * as Sentry from '@sentry/nextjs'

import { inngest } from '@/lib/inngest/client'

// ---------------------------------------------------------------------------
// enqueueApplicationMatchScore — single fire-point for the application-create
// paths that lead to a rendered score (SF-3, Steele Charles feature review
// 2026-07-31 Batch 2 Task 1): add-to-job and promote-shortlist-to-application.
//
// NOT called from add-to-shortlist — review 2026-08-04 H4. A shortlist is a
// large working set and no shortlist surface renders a score badge, so every
// add was buying an invisible Sonnet call; promotion fires the event at the
// moment the score first has somewhere to go.
//
// A float has no job to score against (job_id is null by design — see
// addFloatAction in candidates/[id]/floats/actions.ts), so this no-ops
// rather than sending a malformed event. A future float-with-job path
// gets match scoring for free once this helper is wired in.
//
// Never throws: the caller has already committed the application row
// before this fires, and the match score is an enhancement, not the
// deliverable — a scoring hiccup must not fail "add candidate to job".
// Mirrors the inngest.send try/catch pattern in
// src/app/(app)/jobs/new/actions.ts:69-90.
// ---------------------------------------------------------------------------

export async function enqueueApplicationMatchScore(args: {
  organizationId: string
  applicationId: string
  candidateId: string
  jobId: string | null
  userId: string | null
}): Promise<void> {
  if (!args.jobId || !args.organizationId || !args.candidateId) {
    return
  }

  try {
    await inngest.send({
      // Review 2026-08-04 M1 — dedup key. The scorer's cache guard only helps
      // once a PRIOR run has finished writing, so a double-clicked "Add to
      // job", or a shortlist promoted seconds after it was added, produced two
      // concurrent runs that both missed the cache, both paid Sonnet, and left
      // the loser taking a 23505. Inngest dedups on `id` for 24h.
      //
      // Keyed on the PAIR, not the application id: the pair is what the cached
      // summary is keyed on, and two application rows for the same pair should
      // not buy two identical explanations.
      //
      // Re-review 2026-08-04 RR-1 — hour-bucketed, mirroring the reconciler's
      // requeue ids. Several scorer outcomes (empty-profile skip, cost
      // ceiling, cap exceeded, inputs unavailable) write NO summary, so a
      // bare pair key turned those transient skips into a 24h scoring blind
      // spot — most reachably: candidate added to a job pre-parse, healed by
      // the reconciler minutes later, never scored. The hour bucket keeps the
      // double-click / fast-promote collapse (seconds apart) while capping
      // any blind spot at one hour.
      id: `score-match:${args.candidateId}:${args.jobId}:${Math.floor(Date.now() / 3_600_000)}`,
      name: 'application/score-match',
      data: {
        organization_id: args.organizationId,
        application_id: args.applicationId,
        candidate_id: args.candidateId,
        job_id: args.jobId,
        user_id: args.userId,
      },
    })
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'UnknownError'
    Sentry.captureException(
      new Error(`${errName}: inngest.send application/score-match failed`),
      {
        tags: {
          layer: 'lib',
          helper: 'enqueueApplicationMatchScore',
          subop: 'inngest.send',
        },
      },
    )
  }
}
