import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'
import { checkCap, CapExceededError } from '@/lib/stripe/cap-enforcement'

import { coerceParsedCV, type ParsedCV } from './parsed-cv-schema'

// Re-export CapExceededError so callers don't need to import cap-enforcement.
export { CapExceededError }

// ParsedCV moved to ./parsed-cv-schema (the coercion boundary owns the shape
// it produces). Re-exported here so every existing
// `import type { ParsedCV } from '@/lib/ai/claude'` keeps working.
export type { ParsedCV } from './parsed-cv-schema'

// Hard-coded model IDs from CLAUDE.md. Any new model needs explicit approval
// (and a pricing entry below); the TS layer refuses unknown IDs.
export type ApprovedModel = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-7'

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
// WR-07: 3 retries total = 4 attempts (initial + 3). The previous `attempt <= 3`
// guard allowed a 5th call which the docs/wrappers don't expect; the explicit
// MAX_ATTEMPTS constant makes the contract unambiguous.
const MAX_ATTEMPTS = 4 // 1 initial + 3 retries

type LogUsageArgs = {
  model: ApprovedModel
  organizationId: string
  userId?: string | null
  purpose: string
  inputTokens: number
  outputTokens: number
  costPence: number
  latencyMs: number
}

/**
 * Write one ai_usage row. Never throws — a cost-logging failure must never
 * break the caller's AI result (success path) or mask the underlying error
 * (failure path, below). Factored out of runWithLogging so both the
 * success-path log and the SF-... `_failed` telemetry (2026-07-31 Steele
 * Charles feature review) share one write path.
 */
async function logUsage(args: LogUsageArgs): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { error: logError } = await supabase.rpc('record_ai_usage', {
      p_organization_id: args.organizationId,
      p_model: args.model,
      p_purpose: args.purpose,
      p_input_tokens: args.inputTokens,
      p_output_tokens: args.outputTokens,
      p_cost_pence: args.costPence,
      p_latency_ms: args.latencyMs,
      ...(args.userId ? { p_user_id: args.userId } : {}),
    })
    if (logError) {
      // supabase.rpc() resolves with { error } on a DB failure — it does
      // NOT throw. Without this check a dropped cost row is invisible and
      // the founder under-counts per-tenant spend (non-negotiable,
      // CLAUDE.md). Wrap to code only — never pass the raw error (PII).
      Sentry.captureException(new Error(`record_ai_usage:${logError.code ?? 'rpc_error'}`), {
        tags: {
          layer: 'ai',
          helper: 'record_ai_usage',
          model: args.model,
          purpose: args.purpose,
        },
      })
    }
  } catch (logErr) {
    const name = logErr instanceof Error ? logErr.name : 'UnknownError'
    Sentry.captureException(new Error(`record_ai_usage:${name}`), {
      tags: { layer: 'ai', helper: 'record_ai_usage', model: args.model, purpose: args.purpose },
    })
  }
}

export async function runWithLogging(args: RunArgs): Promise<Anthropic.Message> {
  // Cap enforcement — check BEFORE the Anthropic call (05-01 Task 1.4).
  // Fail open: if checkCap throws, we let the call proceed rather than
  // blocking all AI on a billing error. CapExceededError is propagated so
  // callers can handle cached-only / queue paths.
  try {
    const capResult = await checkCap(args.organizationId, args.purpose)
    if (!capResult.allow) {
      // Hard cap: throw CapExceededError. Callers (match scoring, cv_parse
      // Inngest) catch this and fall back to cached results or queue.
      // NEVER throw for purposes that don't have on-demand fallbacks — those
      // callers must handle the error (see precompute-matches-for-job).
      throw new CapExceededError(capResult.bucket, args.purpose, args.organizationId)
    }
    // soft mode: call proceeds normally; email already queued by checkCap.
  } catch (err) {
    // CapExceededError is intentional — re-throw. Deliberately NOT logged as
    // a `_failed` ai_usage row below — no API call was attempted, so this is
    // a cap DECISION, not a failed attempt (see the outer try/catch below).
    if (err instanceof CapExceededError) throw err
    // Any other checkCap error: fail open (log via Sentry inside checkCap).
  }

  const started = Date.now()
  let attempt = 0
  let lastError: unknown
  // Outer try/catch: every terminal exit from the retry loop below (the
  // non-retriable 4xx throw, the "unknown error" throw, and retry-budget
  // exhaustion) lands here exactly once — never inside the loop's `continue`
  // branches — so this logs exactly ONE `_failed` ai_usage row per failed
  // runWithLogging invocation, not one per retry attempt.
  try {
    while (attempt < MAX_ATTEMPTS) {
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
        await logUsage({
          model: args.model,
          organizationId: args.organizationId,
          userId: args.userId,
          purpose: args.purpose,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          costPence: cost,
          latencyMs: Date.now() - started,
        })
        return response
      } catch (err) {
        lastError = err
        if (err instanceof Anthropic.APIError) {
          // 429 = rate limit; 529 = overloaded. Both retry with exponential
          // backoff; 429 honours the retry-after header if present.
          if (err.status === 429 || err.status === 529) {
            const retryAfterRaw = (err.headers as Record<string, string> | undefined)?.[
              'retry-after'
            ]
            const retryAfter = Number(retryAfterRaw)
            const waitMs =
              Number.isFinite(retryAfter) && retryAfter > 0
                ? // Honour the server-supplied Retry-After but bound it (audit
                  // min-19 + review finding 6). Clamping too low retries before
                  // Anthropic's window reopens (drawing another 429); not clamping
                  // at all lets a pathological header hang a request to the
                  // function timeout. 60s covers Anthropic's typical windows while
                  // keeping the worst case (4 attempts) within the 300s budget.
                  Math.min(60_000, retryAfter * 1000)
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
  } catch (terminalErr) {
    await logUsage({
      model: args.model,
      organizationId: args.organizationId,
      userId: args.userId,
      purpose: `${args.purpose}_failed`,
      inputTokens: 0,
      outputTokens: 0,
      costPence: 0,
      latencyMs: Date.now() - started,
    })
    throw terminalErr
  }
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
      // Bounds are advisory to the model, not a substitute for the coercion
      // boundary in parsed-cv-schema.ts — a tool schema constrains what
      // Claude is ASKED for, never what it can actually return. Both layers
      // are required (06-RESEARCH.md Pitfall 2).
      salary_current_estimate: {
        type: 'integer',
        description: 'Annual GBP salary as a whole number, e.g. 45000. No symbols or separators.',
        minimum: 0,
        maximum: 2000000,
      },
      salary_expectation: {
        type: 'integer',
        description: 'Annual GBP salary as a whole number, e.g. 45000. No symbols or separators.',
        minimum: 0,
        maximum: 2000000,
      },
      seniority_level: {
        type: 'string',
        enum: ['junior', 'mid', 'senior', 'lead', 'principal', 'manager', 'director'],
      },
      // Previously `{ type: 'number' }` with no description and no bounds —
      // the weakest-specified field in the whole tool, and the most likely
      // source of the 12 production write failures: a graduation year read
      // as a duration overflows candidates.years_experience numeric(4,1).
      years_experience_total: {
        type: 'number',
        description:
          'Total years of professional experience as a DURATION, e.g. 12.5 — never a calendar year.',
        minimum: 0,
        maximum: 60,
      },
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

/**
 * Thrown when Claude's response was cut off at max_tokens AND the coerced
 * result carries nothing usable. Storing that as a successful parse would be
 * a Tier-3 violation (06-CONTEXT.md): a candidate silently marked 'complete'
 * with an empty profile, behind a retry button the recruiter has no reason
 * to press.
 */
export class CVParseTruncatedError extends Error {
  name = 'CVParseTruncatedError'

  constructor(message = 'CV parse was truncated at max_tokens with no usable fields') {
    super(message)
  }
}

export type ParseCVDetailed = {
  parsed: unknown // RAW tool input — deliberately NOT cast to ParsedCV
  stopReason: string | null
  inputTokens: number
  outputTokens: number
}

/**
 * `purpose` lets out-of-band diagnostics (e.g. the plan 06-02 forensic
 * replay) bill and label their Claude calls separately from real recruiter
 * parses, WITHOUT duplicating the tool schema / model / max_tokens here.
 * Callers passing a custom `purpose` MUST pass an `organizationId` they are
 * entitled to bill — this function does not enforce that; the caller's
 * guard rails do (see tests/forensics/cv-parse-replay.forensic.ts).
 */
export async function parseCVDetailed(args: {
  cvText: string
  organizationId: string
  userId?: string | null
  purpose?: string
}): Promise<ParseCVDetailed> {
  const response = await runWithLogging({
    model: 'claude-haiku-4-5-20251001',
    organizationId: args.organizationId,
    userId: args.userId,
    purpose: args.purpose ?? 'cv_parse',
    request: {
      // Raised from 2048 (plan 06-06). 2048 output tokens is tight for a
      // dense CV with long work_history[].summary strings, and a truncated
      // parse is a Tier-3 violation, not a degraded result. At Haiku's 400p
      // per MTok output rate the worst-case extra 2048 tokens costs about
      // 0.08p per CV — the headroom is far cheaper than one lost back-book
      // upload. 06-FORENSICS.md recorded no max_tokens stop reasons among
      // the 12 real failures (its AI half was not run), so this is
      // precautionary: the guard below is what makes truncation loud, and
      // the headroom is what makes it rare.
      max_tokens: 4096,
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
  return {
    parsed: toolUse.input,
    stopReason: response.stop_reason ?? null,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}

/**
 * True when the coerced parse carries at least one fact worth storing.
 * `confidence_per_field` never counts — it is metadata about fields, and
 * Claude emits it even when it captured nothing. Empty strings and empty
 * arrays do not count either: they are the shape of "nothing", not content.
 */
function hasUsableField(parsed: ParsedCV): boolean {
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'confidence_per_field') continue
    if (Array.isArray(value)) {
      if (value.length > 0) return true
      continue
    }
    if (typeof value === 'string') {
      if (value.trim().length > 0) return true
      continue
    }
    if (value !== undefined && value !== null) return true
  }
  return false
}

export async function parseCV(args: {
  cvText: string
  organizationId: string
  userId?: string | null
}): Promise<ParsedCV> {
  const d = await parseCVDetailed(args)
  // THE COERCION BOUNDARY. Everything downstream — parse-cv.ts,
  // reconcile-cv-parses.ts, acceptCVFieldsAction — inherits this one call:
  // Claude's raw tool output never reaches a typed consumer or a Postgres
  // column again. (parseCVDetailed still returns the RAW input on purpose;
  // forensics must be able to see what the model actually said.)
  const parsed = coerceParsedCV(d.parsed)

  // A response cut off at max_tokens that yielded nothing usable is a
  // FAILURE, not an empty-but-successful parse. Thrown here rather than in
  // parseCVDetailed so the ai_usage cost row (already written by
  // runWithLogging) is kept — we paid for those tokens.
  if (d.stopReason === 'max_tokens' && !hasUsableField(parsed)) {
    throw new CVParseTruncatedError()
  }

  return parsed
}
