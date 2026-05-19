import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { VoyageAIClient } from 'voyageai'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Voyage AI wrapper. Mirrors src/lib/ai/claude.ts:
//   * Single SDK instance (one-`new VoyageAIClient`-instance grep invariant)
//   * Mandatory `record_ai_usage` write on every embed call (CLAUDE.md
//     non-negotiable)
//   * Hard-coded approved model + pricing table; any model change requires
//     a schema migration (halfvec dimensionality) and a re-embed.
//
// Differences from claude.ts: Voyage's SDK exposes built-in exponential
// backoff (`maxRetries`), so we DO NOT roll our own retry loop. Voyage
// rate-limit / overload surface is less consistent than Anthropic's 429/529;
// `maxRetries: 3` covers it.
// ---------------------------------------------------------------------------

// Locked to voyage-3 to match the halfvec(1024) schema on candidates + jobs.
// Any model change requires a schema migration AND a re-embed of every row.
export type ApprovedEmbeddingModel = 'voyage-3'

const PRICING_PENCE_PER_MTOK_INPUT: Record<ApprovedEmbeddingModel, number> = {
  // verified 2026-05-18 against docs.voyageai.com/docs/pricing
  // $0.06 / MTok input → 4.7p / MTok at ~78p/$. Round up to 5.
  // Embeddings have no output token cost.
  'voyage-3': 5,
}

function calcEmbedCostPence(model: ApprovedEmbeddingModel, totalTokens: number): number {
  return Math.ceil((PRICING_PENCE_PER_MTOK_INPUT[model] * totalTokens) / 1_000_000)
}

// Singleton SDK client. Constructed at module load — the env key is .optional()
// in the Zod schema (Plan 0 boots in dev without it). At call time, an absent
// key surfaces as an SDK auth error from `embed()`, captured to Sentry by the
// caller; no special boot-time handling needed here.
//
// reason: VoyageAIClient ctor requires `apiKey: string`. env.VOYAGE_API_KEY is
// `string | undefined` because the Zod field is .optional() — at runtime the
// SDK errors clearly if undefined makes it through to a real embed call. We
// coerce via `?? ''` so the type narrows; an empty string fails the first
// API request with a recognisable auth error.
export const voyageClient = new VoyageAIClient({
  apiKey: env.VOYAGE_API_KEY ?? '',
  // Match the retry posture of claude.ts. SDK default is 2; we set 3.
  maxRetries: 3,
})

type EmbedPurpose = 'candidate_embed' | 'job_embed' | 'search_query_embed'

export type EmbedArgs = {
  organizationId: string
  userId?: string | null
  purpose: EmbedPurpose
  inputType: 'document' | 'query'
  // 1..128 strings, each ≤ ~30k chars (well inside Voyage's 32k token limit).
  inputs: string[]
}

export type EmbedResult = {
  vectors: number[][]
  inputTokens: number
}

/**
 * Embed an array of strings via voyage-3. Logs cost to ai_usage per tenant.
 *
 * Guards:
 *   - Empty input array → returns `{ vectors: [], inputTokens: 0 }` with no
 *     API call (Voyage rejects empty arrays).
 *   - > 128 inputs → throws (Voyage's per-call batch cap).
 *
 * Cost-logging failure is non-fatal: the SDK result is returned even if
 * the `record_ai_usage` RPC throws, but the failure is captured to Sentry
 * so per-tenant cost gaps are surfaced.
 */
export async function embed(args: EmbedArgs): Promise<EmbedResult> {
  if (args.inputs.length === 0) {
    return { vectors: [], inputTokens: 0 }
  }
  if (args.inputs.length > 128) {
    throw new Error(`voyage embed: batch size ${args.inputs.length} exceeds 128`)
  }

  const started = Date.now()
  const response = await voyageClient.embed({
    input: args.inputs,
    model: 'voyage-3',
    inputType: args.inputType,
    outputDimension: 1024,
    outputDtype: 'float',
  })

  const vectors = (response.data ?? []).map((d) => d.embedding ?? [])
  const totalTokens = response.usage?.totalTokens ?? 0

  // Fire-and-forget cost log. Never let a logging failure break the embed
  // write — the caller still gets the vectors back.
  try {
    const supabase = createServiceClient()
    await supabase.rpc('record_ai_usage', {
      p_organization_id: args.organizationId,
      p_model: 'voyage-3',
      p_purpose: args.purpose,
      p_input_tokens: totalTokens,
      p_output_tokens: 0,
      p_cost_pence: calcEmbedCostPence('voyage-3', totalTokens),
      p_latency_ms: Date.now() - started,
      ...(args.userId ? { p_user_id: args.userId } : {}),
    })
  } catch (logErr) {
    Sentry.captureException(logErr, {
      tags: { layer: 'ai', helper: 'record_ai_usage', model: 'voyage-3' },
    })
  }

  return { vectors, inputTokens: totalTokens }
}
