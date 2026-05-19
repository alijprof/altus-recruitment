import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

// Hard-coded model IDs from CLAUDE.md. Any new model needs explicit approval
// (and a pricing entry below); the TS layer refuses unknown IDs.
export type ApprovedModel =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'

export const claudeClient = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  // We own the retry loop in runWithLogging — disable the SDK's built-in
  // retry to avoid double-retry compounding.
  maxRetries: 0,
})

// Pricing in pence per million tokens, derived from Anthropic's live pricing
// page (USD per MTok) and converted at a steady-state GBP rate of ~78p / $1.
//
// verified 2026-05-19 against https://www.anthropic.com/pricing (Plan 2):
//   Haiku 4.5:   $1 input  / $5 output  -> 78p / 390p (round to 80 / 400)
//   Sonnet 4.6:  $3 input  / $15 output -> 234p / 1170p (round to 240 / 1200)
//   Opus 4.7:    $5 input  / $25 output -> 390p / 1950p
// (Opus dropped from the historical $15/$75 — old constants here were 3x too
// high. Re-verify before next major launch.)
//
// Pricing-drift note (Plan 2 reverification): no change vs Plan 5's
// 2026-05-18 capture — date stamp bumped to match the reverification
// cadence. If a future reverification finds a delta, do NOT backfill
// ai_usage.cost_pence — historical rows stay at their then-prevailing
// rate (verifier guidance, Section D row 5).
const PRICING_PENCE_PER_MTOK: Record<ApprovedModel, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 80, output: 400 },
  'claude-sonnet-4-6': { input: 240, output: 1200 },
  'claude-opus-4-7': { input: 390, output: 1950 },
}

function calcCostPence(model: ApprovedModel, inputTokens: number, outputTokens: number): number {
  const p = PRICING_PENCE_PER_MTOK[model]
  return Math.ceil((p.input * inputTokens + p.output * outputTokens) / 1_000_000)
}

type RunArgs = {
  model: ApprovedModel
  organizationId: string
  userId?: string | null
  purpose: string
  request: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model' | 'stream'>
}

// Exported so wrappers in sibling files (src/lib/ai/match.ts, etc.) can run
// the same retry + cost-logging path WITHOUT instantiating Anthropic. This
// preserves the `grep -rn "new Anthropic" src/` = ONE line invariant.
export async function runWithLogging(args: RunArgs): Promise<Anthropic.Message> {
  const started = Date.now()
  let attempt = 0
  let lastError: unknown
  while (attempt <= 3) {
    try {
      const response = await claudeClient.messages.create({
        model: args.model,
        ...args.request,
      })
      const cost = calcCostPence(
        args.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      )
      try {
        const supabase = createServiceClient()
        await supabase.rpc('record_ai_usage', {
          p_organization_id: args.organizationId,
          p_model: args.model,
          p_purpose: args.purpose,
          p_input_tokens: response.usage.input_tokens,
          p_output_tokens: response.usage.output_tokens,
          p_cost_pence: cost,
          p_latency_ms: Date.now() - started,
          ...(args.userId ? { p_user_id: args.userId } : {}),
        })
      } catch (logErr) {
        Sentry.captureException(logErr, {
          tags: { layer: 'ai', helper: 'record_ai_usage' },
        })
      }
      return response
    } catch (err) {
      lastError = err
      if (err instanceof Anthropic.APIError) {
        // 429 = rate limit; 529 = overloaded. Both retry with exponential
        // backoff; 429 honours the retry-after header if present.
        if (err.status === 429 || err.status === 529) {
          const retryAfterRaw = (err.headers as Record<string, string> | undefined)?.['retry-after']
          const retryAfter = Number(retryAfterRaw)
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(30_000, 1000 * 2 ** attempt)
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          attempt++
          continue
        }
        if (err.status !== undefined && err.status >= 400 && err.status < 500) {
          // Non-retriable 4xx (other than 429).
          throw err
        }
        if (err.status !== undefined && err.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
          attempt++
          continue
        }
      }
      // Unknown error — do not retry.
      throw err
    }
  }
  throw lastError
}

// CV PARSE TOOL — D-05 schema. Single tool call extracts all fields plus a
// confidence-per-field map so the recruiter knows what to verify.
const cvParseTool: Anthropic.Tool = {
  name: 'extract_cv_fields',
  description:
    'Extract structured candidate data from a CV. Provide a confidence value per field (high/medium/low) so the recruiter knows what to verify.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      location: { type: 'string' },
      current_role: { type: 'string' },
      current_company: { type: 'string' },
      work_history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company: { type: 'string' },
            role: { type: 'string' },
            start_date: { type: 'string' },
            end_date: { type: 'string' },
            summary: { type: 'string' },
          },
        },
      },
      skills: { type: 'array', items: { type: 'string' } },
      education: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            institution: { type: 'string' },
            qualification: { type: 'string' },
            year: { type: 'string' },
          },
        },
      },
      salary_current_estimate: { type: 'integer', description: 'Annual GBP estimate.' },
      salary_expectation: { type: 'integer', description: 'Annual GBP estimate.' },
      seniority_level: {
        type: 'string',
        enum: ['junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'director'],
      },
      years_experience_total: { type: 'number' },
      sector_tags: { type: 'array', items: { type: 'string' } },
      confidence_per_field: {
        type: 'object',
        description: 'Map of field name to high|medium|low.',
        additionalProperties: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
    required: ['name', 'confidence_per_field'],
  },
}

export type ParsedCV = {
  name: string
  email?: string
  phone?: string
  location?: string
  current_role?: string
  current_company?: string
  work_history?: Array<{
    company?: string
    role?: string
    start_date?: string
    end_date?: string
    summary?: string
  }>
  skills?: string[]
  education?: Array<{ institution?: string; qualification?: string; year?: string }>
  salary_current_estimate?: number
  salary_expectation?: number
  seniority_level?: string
  years_experience_total?: number
  sector_tags?: string[]
  confidence_per_field: Record<string, 'high' | 'medium' | 'low'>
}

export async function parseCV(args: {
  cvText: string
  organizationId: string
  userId?: string | null
}): Promise<ParsedCV> {
  const response = await runWithLogging({
    model: 'claude-haiku-4-5-20251001',
    organizationId: args.organizationId,
    userId: args.userId,
    purpose: 'cv_parse',
    request: {
      max_tokens: 2048,
      tools: [cvParseTool],
      tool_choice: { type: 'tool', name: 'extract_cv_fields' },
      messages: [
        {
          role: 'user',
          content:
            'Extract structured fields from the following CV. Be conservative — assign "low" confidence when uncertain. CV follows:\n\n' +
            args.cvText,
        },
      ],
    },
  })
  const toolUse = response.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return tool_use block')
  }
  return toolUse.input as ParsedCV
}
