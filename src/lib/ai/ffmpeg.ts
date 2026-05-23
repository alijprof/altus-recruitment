import 'server-only'

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as Sentry from '@sentry/nextjs'

// reason: @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe have no
// DefinitelyTyped definitions; `(installer as { path: string }).path` is
// the documented runtime shape. fluent-ffmpeg is typed via
// @types/fluent-ffmpeg.
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import fluentFfmpeg from 'fluent-ffmpeg'

// ---------------------------------------------------------------------------
// ffmpeg wrapper for Phase 3 spec-audio processing.
//
// Key insight learned during UAT (2026-05-23): the original implementation
// piped the input buffer through a PassThrough stream and read the output
// off another stream. ffmpeg can do that for SOME formats, but m4a / mp4
// have their metadata (the moov atom) at the END of the file, so ffmpeg
// has to seek backwards to read it before it can decode anything. Streams
// aren't seekable. ffmpeg silently produced empty / garbage output without
// firing the 'error' event, and Whisper then rejected the file with
// "400 The audio file could not be decoded or its format is not supported".
//
// Fix: write the input buffer to /tmp first, then run ffmpeg against the
// file path. Vercel functions have a writable /tmp with 512 MB capacity,
// comfortably above the 100 MB upload cap. Clean up in a finally block.
// ---------------------------------------------------------------------------

const ffmpegPath = (ffmpegInstaller as unknown as { path: string }).path
const ffprobePath = (ffprobeInstaller as unknown as { path: string }).path

fluentFfmpeg.setFfmpegPath(ffmpegPath)
fluentFfmpeg.setFfprobePath(ffprobePath)

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

async function writeTempBuffer(input: Buffer, suffix: string): Promise<string> {
  const id = randomBytes(8).toString('hex')
  const path = join(tmpdir(), `altus-${id}.${suffix}`)
  await fs.writeFile(path, input)
  return path
}

/**
 * Recompress an audio buffer to Opus inside a WebM container.
 *
 * Asserts the exact codec flags (`-c:a libopus -b:a <bitrate> -ac <channels>`)
 * required to land under Whisper's 25 MiB request cap. Returns the encoded
 * WebM buffer.
 *
 * Pipeline uses /tmp files (not streams) so input formats requiring seek
 * — m4a, mp4, sometimes wav — decode correctly. Output is WebM-Opus, which
 * is in Whisper's accepted format list and matches the audio/webm MIME the
 * caller declares.
 *
 * Throws if the recompressed output is empty (defensive — catches the
 * silent-empty-output failure mode the previous stream-based pipeline had).
 * Error message includes the underlying ffmpeg detail (truncated, no PII
 * concern — ffmpeg errors are library internals like "ENOENT", "moov atom
 * not found", "Decoder not found").
 */
export async function recompressToOpus(
  input: Buffer,
  opts: RecompressOptions,
): Promise<Buffer> {
  if (input.byteLength === 0) {
    throw new Error('ffmpeg recompress: empty input buffer')
  }

  // Use a generic suffix — ffmpeg auto-detects the format from content.
  // We don't know the source extension at this layer and ffmpeg's content
  // sniff is more reliable than guessing from the input MIME anyway.
  const inPath = await writeTempBuffer(input, 'in')
  const outPath = join(tmpdir(), `altus-${randomBytes(8).toString('hex')}.webm`)

  try {
    await new Promise<void>((resolve, reject) => {
      fluentFfmpeg(inPath)
        .audioCodec('libopus')
        .audioBitrate(opts.bitrate)
        .audioChannels(opts.channels)
        .format('webm')
        .on('error', (err: { name?: string; message?: string }) => {
          const detail = (err?.message ?? err?.name ?? 'UnknownError').slice(0, 300)
          Sentry.captureException(
            new Error(`ffmpeg.recompressToOpus: ${detail}`),
            { tags: { phase: 'p3', layer: 'ai-wrapper', helper: 'recompressToOpus' } },
          )
          reject(new Error(`ffmpeg recompress failed: ${detail}`))
        })
        .on('end', () => resolve())
        .save(outPath)
    })

    const output = await fs.readFile(outPath)
    if (output.byteLength === 0) {
      throw new Error('ffmpeg recompress produced empty output (input may be corrupt or unsupported)')
    }
    return output
  } finally {
    // Best-effort cleanup. /tmp on Vercel is per-invocation but we tidy
    // anyway in case the Lambda is reused for another invocation in the
    // same warm-pool slot.
    await fs.unlink(inPath).catch(() => {})
    await fs.unlink(outPath).catch(() => {})
  }
}

/**
 * Exported for diagnostic / probe-ffmpeg Inngest function. Resolves to the
 * static binary path baked into @ffmpeg-installer at install time.
 */
export function getFfmpegBinaryPath(): string {
  return ffmpegPath
}

/**
 * Exported for diagnostics. Path to the @ffprobe-installer static binary.
 */
export function getFfprobeBinaryPath(): string {
  return ffprobePath
}
