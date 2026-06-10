import 'server-only'

import OpenAI, { toFile } from 'openai'
import * as Sentry from '@sentry/nextjs'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// OpenAI Whisper wrapper. Mirrors src/lib/ai/voyage.ts:
//   * Single SDK instance (one-`new OpenAI`-instance grep invariant)
//   * Mandatory `record_ai_usage` write on every transcribe call
//     (CLAUDE.md non-negotiable)
//   * Hard-coded approved model + pricing table; any model change requires
//     a new entry below and a Sentry-warned migration of past callers.
//
// Differences from claude.ts: OpenAI's SDK has built-in retry (`maxRetries`)
// — we use the SDK default of 3 instead of rolling our own loop. Whisper
// rate-limit semantics are simple (429 + Retry-After) and the SDK handles
// them correctly.
//
// COST BASIS — Whisper is billed per AUDIO MINUTE, NOT per token. The
// ai_usage table's p_input_tokens column carries the audio duration in
// SECONDS (rounded up to the nearest int). p_output_tokens is always 0.
// /settings/usage interprets `spec_transcribe` rows accordingly when
// computing per-tenant cost summaries.
// ---------------------------------------------------------------------------

export type ApprovedTranscriptionModel = 'whisper-1'

// Pricing in pence per audio minute. Derived from OpenAI's live pricing.
//
// verified 2026-05-19 against https://openai.com/api/pricing:
//   whisper-1: $0.006 / minute → 0.468p / min at ~78p/$. Round UP to 0.48p
//              (cost-conservative; small over-report is safer than under).
//
// Reverify against the pricing page on or before 2026-08-19; pricing-drift
// bug class per Phase 1 LEARNINGS R-pricing. If a future reverification
// finds a delta, do NOT backfill historical ai_usage rows — they stay at
// their then-prevailing rate (verifier guidance).
const PRICING_PENCE_PER_MINUTE: Record<ApprovedTranscriptionModel, number> = {
  'whisper-1': 0.48,
}

function calcTranscribeCostPence(
  model: ApprovedTranscriptionModel,
  durationSeconds: number,
): number {
  return Math.ceil((PRICING_PENCE_PER_MINUTE[model] * durationSeconds) / 60)
}

// Singleton SDK client. Constructed at module load. env.OPENAI_API_KEY is
// .optional() in the Zod schema (the app boots in dev without it); a missing
// key surfaces as an SDK auth error from the first transcribe() call.
//
// reason: OpenAI ctor's apiKey type is `string | undefined`; we coerce to
// '' so the type narrows and the SDK fails with a recognisable auth error
// at call time rather than at module load.
export const openaiClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY ?? '',
  // Match the retry posture of voyage.ts. SDK default is 2; we set 3.
  maxRetries: 3,
})

// Phase 4 (04-01-PLAN.md): voice_note_transcribe added — shares the specMinutes
// cap bucket with spec_transcribe (same Whisper meter, different use case).
export type TranscribePurpose = 'spec_transcribe' | 'voice_note_transcribe'

export type TranscribeArgs = {
  organizationId: string
  userId?: string | null
  purpose: TranscribePurpose
  audioBuffer: Buffer | Uint8Array
  mimeType: string
}

export type TranscribeResult = {
  text: string
  // Duration in seconds, as reported by Whisper itself in its verbose_json
  // response. This was previously probed via ffmpeg/ffprobe BEFORE the
  // call, but ffprobe doesn't work reliably with stream input on Vercel
  // serverless (well-known fluent-ffmpeg limitation — ffprobe needs to seek
  // for the moov atom). Whisper already knows the duration after decoding
  // the file, so we get it for free without a second binary call.
  durationSeconds: number
  costPence: number
}

/**
 * Transcribe an audio buffer via OpenAI Whisper. Logs cost to ai_usage
 * per tenant.
 *
 * Guards:
 *   - Empty buffer → throws (caller must catch — degenerate input is a bug)
 *   - durationSeconds <= 0 → throws (probe returned malformed/no duration)
 *
 * UK-anchor prompt locked in via the `prompt:` arg: tells Whisper to expect
 * UK English with recruitment-domain vocabulary (GBP £, IR35, limited
 * company, perm/contract). RESEARCH §Pitfall 4 — Whisper hallucinates US
 * spellings + dollar amounts when the language signal is weak.
 *
 * Cost-logging failure is non-fatal: the transcript is returned even if
 * the `record_ai_usage` RPC throws, but the failure is captured to Sentry
 * so per-tenant cost gaps are surfaced.
 */
export async function transcribe(args: TranscribeArgs): Promise<TranscribeResult> {
  if (args.audioBuffer.byteLength === 0) {
    throw new Error('whisper: empty audio buffer')
  }

  const started = Date.now()
  // Pick a filename hint matching the mime type — OpenAI uses the extension
  // to pick a decoder. webm covers our recompressed Opus output; the rest
  // match the upload allowlist in submitSpecCallAction.
  // Accept the same MIME variants the upload action allows. OpenAI uses the
  // file extension to pick a decoder, so map every variant to the canonical
  // extension Whisper recognises.
  const filename =
    args.mimeType === 'audio/mpeg' || args.mimeType === 'audio/mp3'
      ? 'audio.mp3'
      : args.mimeType === 'audio/wav' ||
          args.mimeType === 'audio/wave' ||
          args.mimeType === 'audio/x-wav'
        ? 'audio.wav'
        : args.mimeType === 'audio/mp4' ||
            args.mimeType === 'audio/m4a' ||
            args.mimeType === 'audio/x-m4a' ||
            args.mimeType === 'audio/aac'
          ? 'audio.m4a'
          : 'audio.webm'

  const file = await toFile(args.audioBuffer, filename, { type: args.mimeType })
  // response_format: 'verbose_json' returns `duration` (seconds, float)
  // alongside the text. We use this as the source of truth for ai_usage
  // cost-tracking and any caller that needs it. The latency overhead vs
  // default 'json' is negligible compared to the transcribe step itself.
  const response = await openaiClient.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
    response_format: 'verbose_json',
    // Treat untrusted user audio as data, not instructions — the prompt
    // here ONLY influences Whisper's lexicon (not a Claude-style system
    // prompt). Locked vocabulary covers the most-frequent UK recruitment
    // terms so Whisper picks them over phonetic neighbours.
    prompt:
      'UK recruitment spec call. Roles, salaries in GBP £. Limited company, IR35, perm/contract.',
  })

  // reason: the OpenAI SDK's transcriptions.create() return type is a
  // discriminated union by response_format; verbose_json adds `duration`
  // and `segments` but the typed return narrows only when the format is a
  // literal at the call site. Cast here so we can read duration without
  // fighting the union.
  const verbose = response as unknown as { text: string; duration?: number }
  const durationSeconds = Math.max(1, Math.round(verbose.duration ?? 0))
  const costPence = calcTranscribeCostPence('whisper-1', durationSeconds)

  // Fire-and-forget cost log. Never let a logging failure break the
  // transcribe write — the caller still gets the transcript back.
  // NOTE: supabase.rpc() does NOT throw on RPC failure — it returns
  // { error }. Check it explicitly or cost-log gaps are invisible
  // (per-tenant cost logging is non-negotiable, CLAUDE.md).
  try {
    const supabase = createServiceClient()
    const { error: rpcErr } = await supabase.rpc('record_ai_usage', {
      p_organization_id: args.organizationId,
      p_model: 'whisper-1',
      p_purpose: args.purpose,
      // Whisper is priced per audio minute. We store SECONDS here (rounded
      // up by the caller); /settings/usage divides by 60 for display.
      p_input_tokens: durationSeconds,
      p_output_tokens: 0,
      p_cost_pence: costPence,
      p_latency_ms: Date.now() - started,
      ...(args.userId ? { p_user_id: args.userId } : {}),
    })
    if (rpcErr) {
      // Wrap to code only — never pass the raw error (may echo payload).
      Sentry.captureException(new Error(`record_ai_usage:${rpcErr.code ?? 'rpc_error'}`), {
        tags: { layer: 'ai', helper: 'record_ai_usage', model: 'whisper-1' },
      })
    }
  } catch (logErr) {
    // VERIFICATION R4 (Phase 1): never pass the raw error. Anthropic/Voyage
    // SDK errors can echo prompt fragments in error.message; the same
    // policy applies to OpenAI for consistency. Wrap to name only.
    const name = logErr instanceof Error ? logErr.name : 'UnknownError'
    Sentry.captureException(new Error(`record_ai_usage:${name}`), {
      tags: { layer: 'ai', helper: 'record_ai_usage', model: 'whisper-1' },
    })
  }

  return { text: verbose.text ?? '', durationSeconds, costPence }
}
