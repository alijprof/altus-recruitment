'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  generateAdWithInclusivity,
  scoreInclusivityOnly,
  type GenerateAdResult,
  type InclusivityDimensions,
  type InclusivitySuggestion,
  type ScoreOnlyResult,
} from '@/lib/ai/ad-generate'
import { createJobAd, deleteJobAd } from '@/lib/db/job-ads'
import { getJob } from '@/lib/db/jobs'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Plan 03-04 Task D.2 — server actions for the ad-panel feature.
//
// Three actions:
//   - generateAdAction({ jobId }) — synchronous Sonnet call (~3s). Acceptable
//     inline per D3-25; if p95 > 5s, lift to Inngest behind an
//     `ad/generate-requested` event (escape hatch noted in the plan risks).
//   - scoreInclusivityAction({ adText, jobId? }) — pasted-ad scorer.
//     Ephemeral by default (D3-14 / D3-31); does NOT persist.
//   - saveJobAdAction({ jobId, ...result }) — persists a generated (or
//     pasted-then-scored) ad to job_ads. Per D3-33, every save is a new row.
//
// Pattern per PATTERNS §5 / src/app/(app)/jobs/[id]/actions.ts:
//   1. Zod parse first
//   2. await createClient() + auth.getUser() defensive check
//   3. Wrap Sonnet call in Sentry transaction span (D3-25 measurability)
//   4. Sentry-capture err.name only (parse-cv.ts R4 — never raw error)
//   5. revalidatePath on save
//   6. Return discriminated { ok: true; data } | { ok: false; error }
// ---------------------------------------------------------------------------

const uuid = z.string().uuid()

// ---------------------------------------------------------------------------
// generateAdAction
// ---------------------------------------------------------------------------

const generateSchema = z.object({ jobId: uuid })

export type GenerateAdActionResult =
  | { ok: true; data: GenerateAdResult }
  | { ok: false; error: string }

export async function generateAdAction(
  rawInput: unknown,
): Promise<GenerateAdActionResult> {
  const parsed = generateSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid job id.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const jobResult = await getJob(supabase, parsed.data.jobId)
  if (!jobResult.ok) {
    return { ok: false, error: 'Job not found.' }
  }
  const job = jobResult.data

  // D3-25: Sentry transaction span so latency is measurable from day one.
  // If p95 consistently exceeds 5s in production, file a follow-up to lift
  // to Inngest behind an `ad/generate-requested` event.
  return Sentry.startSpan(
    { name: 'ad-generate', op: 'ai.sonnet' },
    async (): Promise<GenerateAdActionResult> => {
      try {
        const result = await generateAdWithInclusivity({
          organizationId: job.organization_id,
          userId: user.id,
          jobSummary: {
            title: job.title,
            description: job.description,
            location: job.location,
            job_type: job.job_type,
            salary_min: job.salary_min,
            salary_max: job.salary_max,
            currency: job.currency,
          },
        })
        return { ok: true, data: result }
      } catch (err) {
        // R4: capture name + (status if Anthropic.APIError-shaped). Never
        // pass the raw error — Anthropic SDK errors can echo prompt
        // fragments in `error.message`.
        const e = err as { name?: string; status?: number }
        Sentry.captureException(new Error(`${e.name ?? 'Error'}: ${e.status ?? 'no-status'}`), {
          tags: { phase: 'p3', layer: 'action', helper: 'generateAdAction' },
        })
        return { ok: false, error: 'Could not generate ad. Please retry.' }
      }
    },
  )
}

// ---------------------------------------------------------------------------
// scoreInclusivityAction — D3-14 pasted-ad scorer (ephemeral by default)
// ---------------------------------------------------------------------------

// Plain text cap — 50k chars matches the spec_drafts.transcript cap; an ad is
// typically a small fraction of that. Defensive against payload-bomb-via-paste.
const scoreSchema = z.object({
  adText: z.string().trim().min(20, 'Paste a longer ad to score.').max(50_000),
  jobId: uuid.optional().nullable(),
})

export type ScoreInclusivityActionResult =
  | { ok: true; data: ScoreOnlyResult }
  | { ok: false; error: string }

export async function scoreInclusivityAction(
  rawInput: unknown,
): Promise<ScoreInclusivityActionResult> {
  const parsed = scoreSchema.safeParse(rawInput)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Invalid input.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // Resolve org from the user's profile via a one-row read against the users
  // table — RLS scopes to the caller's row. (Same shape as other actions.)
  type UserOrgRow = { organization_id: string | null }
  const profileResult = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle<UserOrgRow>()
  const organizationId = profileResult.data?.organization_id
  if (!organizationId) return { ok: false, error: 'Organization not found.' }

  return Sentry.startSpan(
    { name: 'ad-score', op: 'ai.sonnet' },
    async (): Promise<ScoreInclusivityActionResult> => {
      try {
        const result = await scoreInclusivityOnly({
          organizationId,
          userId: user.id,
          adText: parsed.data.adText,
        })
        return { ok: true, data: result }
      } catch (err) {
        const e = err as { name?: string; status?: number }
        Sentry.captureException(
          new Error(`${e.name ?? 'Error'}: ${e.status ?? 'no-status'}`),
          { tags: { phase: 'p3', layer: 'action', helper: 'scoreInclusivityAction' } },
        )
        return { ok: false, error: 'Could not score ad. Please retry.' }
      }
    },
  )
}

// ---------------------------------------------------------------------------
// saveJobAdAction — persist a generated ad to job_ads (D3-33: no dedup)
// ---------------------------------------------------------------------------

const dimensionShape = z.object({
  score: z.number().int().min(0).max(100),
  flagged_phrases: z.array(z.string()),
  rationale: z.string(),
})

const dimensionsShape = z.object({
  gender: dimensionShape,
  age: dimensionShape,
  jargon: dimensionShape,
  accessibility: dimensionShape,
  salary_transparency: dimensionShape,
})

const suggestionShape = z.object({
  original: z.string(),
  improved: z.string(),
  reason: z.string(),
})

const saveSchema = z.object({
  jobId: uuid,
  bodyMarkdown: z.string().min(1).max(50_000),
  inclusivityScore: z.number().int().min(0).max(100).optional().nullable(),
  inclusivityDimensions: dimensionsShape.optional().nullable(),
  inclusivitySuggestions: z.array(suggestionShape).optional().nullable(),
  model: z.string().min(1),
  costPence: z.number().int().min(0),
})

export type SaveJobAdActionResult =
  | { ok: true; adId: string }
  | { ok: false; error: string }

export async function saveJobAdAction(
  rawInput: unknown,
): Promise<SaveJobAdActionResult> {
  const parsed = saveSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid save payload.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const result = await createJobAd(supabase, {
    job_id: parsed.data.jobId,
    body_markdown: parsed.data.bodyMarkdown,
    inclusivity_score: parsed.data.inclusivityScore ?? null,
    inclusivity_dimensions:
      (parsed.data.inclusivityDimensions ?? null) as InclusivityDimensions | null,
    inclusivity_suggestions:
      (parsed.data.inclusivitySuggestions ?? null) as InclusivitySuggestion[] | null,
    model: parsed.data.model,
    cost_pence: parsed.data.costPence,
    created_by: user.id,
  })

  if (!result.ok) {
    return { ok: false, error: 'Could not save ad. Please retry.' }
  }

  revalidatePath(`/jobs/${parsed.data.jobId}`)
  return { ok: true, adId: result.data.id }
}

// ---------------------------------------------------------------------------
// deleteJobAdAction — hard-delete a saved ad row (UAT-260523-AD-SAVE-UX Test 6).
//
// Mirrors removeApplicationAction in src/app/(app)/jobs/[id]/actions.ts:
//   1. Zod-parse the input (adId + jobId both UUIDs).
//   2. Auth check.
//   3. deleteJobAd helper (read-then-delete via RLS `tenant delete` policy).
//   4. Audit via record_audit RPC — failure is Sentry-captured but MUST NOT
//      block the success return (the row is already gone).
//   5. revalidatePath so the list refreshes on the next server render.
//
// entity_type 'job_ad': recruiter-owned artefact, not candidate PII. The audit
// entry is belt-and-suspenders; the primary audit requirement (GDPR) targets
// candidate reads. If the DB CHECK constraint on entity_type rejects 'job_ad',
// the Sentry capture will surface it and the delete still succeeds.
// ---------------------------------------------------------------------------

const deleteAdSchema = z.object({
  adId: uuid,
  jobId: uuid,
})

export type DeleteJobAdActionResult = { ok: true } | { ok: false; error: string }

export async function deleteJobAdAction(
  rawInput: unknown,
): Promise<DeleteJobAdActionResult> {
  const parsed = deleteAdSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid ad or job id.' }
  }

  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const res = await deleteJobAd(supabase, { adId: parsed.data.adId })
  if (!res.ok) {
    if (res.code === 'not_found') return { ok: false, error: 'Ad already removed.' }
    return { ok: false, error: 'Could not delete ad.' }
  }

  // Write an audit_log row — failure must not block the success path.
  const supabaseUntyped = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  }
  const { error: auditErr } = await supabaseUntyped.rpc('record_audit', {
    p_action: 'delete',
    p_entity_type: 'job_ad',
    p_entity_id: res.data.id,
    p_metadata: { job_id: res.data.job_id, via: 'saved_ads_list_row_action' },
  })
  if (auditErr) {
    Sentry.captureException(auditErr, {
      tags: { layer: 'action', helper: 'deleteJobAdAction', subop: 'audit' },
    })
    // Don't block — the row is already deleted and the request was authorised.
  }

  revalidatePath(`/jobs/${parsed.data.jobId}`)
  return { ok: true }
}
