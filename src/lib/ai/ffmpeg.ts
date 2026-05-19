import 'server-only'

import { PassThrough, Writable } from 'node:stream'

import * as Sentry from '@sentry/nextjs'

// reason: @ffmpeg-installer/ffmpeg has no DefinitelyTyped definitions;
// `(installer as { path: string }).path` is the documented runtime shape.
// fluent-ffmpeg is typed via @types/fluent-ffmpeg.
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import fluentFfmpeg from 'fluent-ffmpeg'

// ---------------------------------------------------------------------------
// ffmpeg wrapper. Mirrors src/lib/ai/voyage.ts:
//   * Single-purpose helpers (`recompressToOpus`, `probeDurationSeconds`)
//   * `import 'server-only'` so the heavy native binary never leaks into a
//     client bundle
//   * Singleton path resolution at module load time via @ffmpeg-installer
//   * Sentry captures wrap `err.name` only — never raw error message
//     (parse-cv.ts "VERIFICATION R4" — Anthropic/Voyage/FFmpeg error
//     strings can echo input fragments, bypassing the Sentry beforeSend
//     PII scrub)
//
// Phase 3 Plan 2 (spec audio + JD) consumes both helpers:
//   * recompressToOpus → drops 50 MiB m4a to ≤24 MiB mono Opus before
//     Whisper upload (Whisper's hard 25 MiB cap)
//   * probeDurationSeconds → CRITICAL-2 fix: derives the cost-basis input
//     for ai_usage.record_ai_usage(p_input_tokens, ...) on every Whisper
//     call (Whisper bills per minute, not per token; ai_usage stores
//     duration seconds in p_input_tokens so /settings/usage can report
//     per-tenant spend)
// ---------------------------------------------------------------------------

const ffmpegPath = (ffmpegInstaller as unknown as { path: string }).path

// Module-level setter (sets the binary path for every command this process
// constructs). fluent-ffmpeg lets us pass the path per-command too; doing it
// once at load avoids the chance of forgetting on a future call site.
fluentFfmpeg.setFfmpegPath(ffmpegPath)

// ---------------------------------------------------------------------------
// recompressToOpus
// ---------------------------------------------------------------------------

export type RecompressOptions = {
  // Opus bitrate string fluent-ffmpeg accepts: '32k', '64k', etc.
  // 32 kbps mono is the recommended floor for intelligible voice on Whisper.
  bitrate: string
  // 1 = mono, 2 = stereo. Spec calls are single-speaker recordings so 1
  // halves the file size with no information loss.
  channels: number
}

/**
 * Recompress an audio buffer to Opus inside an Ogg container.
 *
 * Asserts the exact codec flags (`-c:a libopus -b:a <bitrate> -ac <channels>`)
 * required to land under Whisper's 25 MiB request cap. Returns the encoded
 * Ogg buffer. On error, captures `err.name` only to Sentry — NEVER the raw
 * error (R4 invariant).
 */
export async function recompressToOpus(
  input: Buffer,
  opts: RecompressOptions,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const inputStream = new PassThrough()
    inputStream.end(input)

    const chunks: Buffer[] = []
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        cb()
      },
    })
    sink.on('finish', () => resolve(Buffer.concat(chunks)))

    fluentFfmpeg(inputStream)
      .audioCodec('libopus')
      .audioBitrate(opts.bitrate)
      .audioChannels(opts.channels)
      .format('ogg')
      .on('error', (err: { name?: string }) => {
        Sentry.captureException(
          new Error(`ffmpeg.recompressToOpus: ${err?.name ?? 'UnknownError'}`),
          { tags: { phase: 'p3', layer: 'ai-wrapper', helper: 'recompressToOpus' } },
        )
        reject(new Error('ffmpeg recompress failed'))
      })
      .on('end', () => {
        // sink resolves once `finish` fires after `end()` propagates
      })
      .pipe(sink)
  })
}

// ---------------------------------------------------------------------------
// probeDurationSeconds (CRITICAL-2 fix — required by Plan B Task B.2)
// ---------------------------------------------------------------------------

/**
 * Probe the duration of an audio buffer in seconds, rounded to the nearest
 * integer. Used to populate `ai_usage.p_input_tokens` for Whisper calls so
 * per-tenant spend reporting is accurate (Whisper bills per audio minute).
 *
 * Failures are surfaced as a generic error to the caller and a Sentry
 * capture with `err.name` only.
 */
export async function probeDurationSeconds(input: Buffer): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const inputStream = new PassThrough()
    inputStream.end(input)

    fluentFfmpeg(inputStream).ffprobe((err: Error | null, data: unknown) => {
      if (err) {
        const e = err as { name?: string }
        Sentry.captureException(
          new Error(`ffmpeg.probeDurationSeconds: ${e?.name ?? 'UnknownError'}`),
          { tags: { phase: 'p3', layer: 'ai-wrapper', helper: 'probeDurationSeconds' } },
        )
        reject(new Error('ffprobe failed'))
        return
      }
      // reason: fluent-ffmpeg's typed `FfprobeData` has `format.duration` as
      // `number | undefined`. We coerce defensively — an unprobeable file
      // resolves to 0 seconds (caller treats as a degenerate input).
      const d = data as { format?: { duration?: number } }
      const seconds = Math.round(d.format?.duration ?? 0)
      resolve(seconds)
    })
  })
}

/**
 * Exported for diagnostic / probe-ffmpeg Inngest function. Resolves to the
 * static binary path baked into @ffmpeg-installer at install time.
 */
export function getFfmpegBinaryPath(): string {
  return ffmpegPath
}
