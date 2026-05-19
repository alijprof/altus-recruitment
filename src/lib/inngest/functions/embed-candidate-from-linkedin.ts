import * as Sentry from '@sentry/nextjs'
import { NonRetriableError } from 'inngest'

import { candidateEmbeddingText } from '@/lib/ai/embed-text'
import { embed } from '@/lib/ai/voyage'
import { bumpCandidateEmbedding, getCandidateForEmbedding } from '@/lib/db/candidates'
import { inngest } from '@/lib/inngest/client'
import { readStatus } from '@/lib/observability/inngest'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Plan 03-01 Task A.3 — embed-candidate-from-linkedin
//
// Triggered by `linkedin/captured` (emitted from /api/linkedin/ingest after
// the upsert). Runs Voyage's candidate-embed step on the freshly-captured
// candidate so they're semantically searchable within ~10 seconds of the
// recruiter clicking the extension button.
//
// LinkedIn captures have NO PDF/DOCX — the structured fields (full_name,
// current_role_title, current_company, location, skills) ARE the embed
// source. We pass an empty string for the cv-text tail to
// candidateEmbeddingText, which already handles the empty-tail case by
// returning just the structured-fields block (verified — no extension to
// the helper needed; PATTERNS §2 guidance: "verify the helper handles
// empty input; if it doesn't, extend it with a guard").
//
// PHASE 1+2 LEARNINGS BUG CLASS: service-role bypasses RLS. Every write
// MUST pass organization_id explicitly in BOTH the SET clause AND the
// WHERE clause. bumpCandidateEmbedding only takes candidateId, so the
// tenant boundary is enforced by the explicit equality check below
// BEFORE we make the embed call.
//
// purpose='linkedin_candidate_embed' is a NEW value extending the
// `ai_usage.purpose` text field (RESEARCH A5 — the column is `text`, not
// an enum, so no schema migration). The /settings/usage reader will pick
// this up as a new row category automatically.
// ---------------------------------------------------------------------------

type LinkedInCapturedEventData = {
  organization_id: string
  candidate_id: string
  user_id: string | null
}

function asLinkedInCapturedData(value: unknown): LinkedInCapturedEventData {
  // reason: Inngest typings are deliberately wide. The only producer of
  // this event is /api/linkedin/ingest — the explicit cross-tenant check
  // below catches forged payloads regardless.
  return value as LinkedInCapturedEventData
}

const FN_TAGS = {
  phase: 'p3',
  layer: 'inngest',
  function: 'embed-candidate-from-linkedin',
} as const

export const embedCandidateFromLinkedIn = inngest.createFunction(
  {
    id: 'embed-candidate-from-linkedin',
    triggers: [{ event: 'linkedin/captured' }],
    // Concurrency mirrors parse-cv-on-upload: at most 5 in-flight embeds
    // per organization. 5 × ~3s = a 15s peak burst, well within Voyage's
    // 50 RPM tier-1 default and Inngest's free-tier runner caps.
    concurrency: { limit: 5, key: 'event.data.organization_id' },
    retries: 2,
  },
  async ({ event, step }) => {
    const data = asLinkedInCapturedData(event.data)
    const { organization_id, candidate_id, user_id } = data

    if (
      typeof organization_id !== 'string' ||
      organization_id.length === 0 ||
      typeof candidate_id !== 'string' ||
      candidate_id.length === 0
    ) {
      throw new NonRetriableError('missing required event fields')
    }

    try {
      // Step 1: fetch the candidate via service-role. The cross-tenant
      // guard runs INSIDE the step.run so the assertion is captured in
      // Inngest's step history (easier to debug a forged-event incident).
      const candidate = await step.run('fetch-candidate', async () => {
        const supabase = createServiceClient()
        const result = await getCandidateForEmbedding(supabase, candidate_id)
        if (!result.ok) {
          throw new NonRetriableError(`candidate not found: ${result.code}`)
        }
        // CRITICAL — tenant boundary check. Service-role bypasses RLS, so
        // this is the only thing between a forged `linkedin/captured`
        // payload (organization_id pointed at another tenant's candidate)
        // and a cross-tenant read. RESEARCH §17 + Phase 1+2 LEARNINGS.
        if (result.data.organization_id !== organization_id) {
          throw new NonRetriableError(
            'candidate not in claimed organization (cross-tenant event)',
          )
        }
        return result.data
      })

      // Step 2: build the embed text. No CV body; pass '' so
      // candidateEmbeddingText returns just the structured-fields block.
      const text = await step.run('build-embed-text', async () =>
        candidateEmbeddingText(candidate, ''),
      )
      if (!text || text.trim().length === 0) {
        // Degenerate candidate (no fields populated). The scheduled batch
        // sweep won't pick this up either — log and bail. The recruiter
        // can manually edit the candidate page to add details and the
        // invalidate-embedding trigger will re-queue.
        Sentry.captureMessage('linkedin-embed: no fields to embed', {
          level: 'warning',
          tags: { ...FN_TAGS, candidate_id },
        })
        return
      }

      // Step 3: Voyage embed. Logs cost to ai_usage automatically (D3-24
      // non-negotiable). purpose='linkedin_candidate_embed' separates
      // these from CV-driven embeds in the /settings/usage view.
      const { vectors } = await step.run('voyage-embed', async () =>
        embed({
          organizationId: organization_id,
          userId: user_id,
          purpose: 'linkedin_candidate_embed' as never,
          inputType: 'document',
          inputs: [text],
        }),
      )
      const vector = vectors[0]
      if (!vector || vector.length === 0) {
        throw new Error('voyage embed returned no vector')
      }

      // Step 4: persist. bumpCandidateEmbedding writes via the same
      // service-role client. The candidate row's organization_id is
      // unchanged by this UPDATE — we only touch candidate_embedding,
      // embedding_version, embedded_at. RLS would normally guard the
      // WHERE clause too; with service-role we rely on the candidate_id
      // we just fetched (which we verified is in `organization_id`).
      await step.run('persist-embedding', async () => {
        const supabase = createServiceClient()
        const result = await bumpCandidateEmbedding(supabase, {
          candidateId: candidate_id,
          embedding: vector,
          embeddingVersion: (candidate.embedding_version ?? 0) + 1,
        })
        if (!result.ok) {
          throw new Error(`bumpCandidateEmbedding: ${result.code}`)
        }
      })
    } catch (err) {
      // VERIFICATION R4: wrap name + status only — Voyage SDK errors can
      // echo input fragments in error.message which would bypass the
      // global Sentry beforeSend PII scrub.
      const name = err instanceof Error ? err.name : 'UnknownError'
      const status = readStatus(err)
      Sentry.captureException(new Error(`${name}: ${status}`), {
        tags: { ...FN_TAGS, candidate_id },
      })
      throw err
    }
  },
)
