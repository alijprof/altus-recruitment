/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub `server-only` so the wrapper can be imported in the Node test env.
// Matches the existing pattern in tests/unit/app/apply/turnstile.test.ts.
vi.mock('server-only', () => ({}))

// ---------------------------------------------------------------------------
// Mock @ffmpeg-installer/ffmpeg BEFORE the wrapper module is imported.
// The wrapper resolves the installer path at module load (singleton), so we
// must intercept the dynamic require result.
// ---------------------------------------------------------------------------

vi.mock('@ffmpeg-installer/ffmpeg', () => ({
  // The wrapper imports the default export (TS esModuleInterop wraps the
  // CJS `module.exports = { path, version }` into `{ default: ... }`).
  default: { path: '/mock/path/to/ffmpeg' },
  path: '/mock/path/to/ffmpeg',
}))

// ---------------------------------------------------------------------------
// Mock fluent-ffmpeg with a chainable command object recording every
// configuration call. The recompress test asserts the exact codec flags;
// the probe test asserts that ffprobe is invoked and its `format.duration`
// is rounded to the nearest integer.
// ---------------------------------------------------------------------------

type RecordedCall = { method: string; args: unknown[] }
type RecordedRef = { value: RecordedCall[] }

// Vitest hoists `vi.mock` factory invocations above all top-level
// `const`/`function` declarations in the test module. Anything the factory
// references at load-time MUST be hoist-safe — we stash mutable state on
// `globalThis` and access it lazily so the factory's body can run before
// the rest of the module body executes.
function getRecordedRef(): RecordedRef {
  const g = globalThis as unknown as { __ffmpegTestRecord?: RecordedRef }
  if (!g.__ffmpegTestRecord) g.__ffmpegTestRecord = { value: [] }
  return g.__ffmpegTestRecord
}

vi.mock('fluent-ffmpeg', () => {
  // Builder lives inside the factory closure so it is not hoist-dependent
  // on a top-level declaration of the test file.
  function buildMockCommand(recorded: RecordedCall[]) {
    // reason: chainable fluent-ffmpeg surface — `Record<string, unknown>`
    // is unavoidable because we add ad-hoc methods that the wrapper exercises.
    const cmd: Record<string, unknown> = {}
    // Capture the 'end' handler so save() can trigger it after writing
    // the stub output file.
    let endHandler: (() => void) | null = null

    const chain = (method: string) =>
      (...args: unknown[]) => {
        recorded.push({ method, args })
        return cmd
      }

    cmd.setFfmpegPath = chain('setFfmpegPath')
    cmd.input = chain('input')
    cmd.inputFormat = chain('inputFormat')
    cmd.audioCodec = chain('audioCodec')
    cmd.audioBitrate = chain('audioBitrate')
    cmd.audioChannels = chain('audioChannels')
    cmd.format = chain('format')
    cmd.outputOptions = chain('outputOptions')

    cmd.on = (event: string, handler: (...args: unknown[]) => void) => {
      recorded.push({ method: `on:${event}`, args: [] })
      if (event === 'end') {
        endHandler = handler as () => void
      }
      return cmd
    }

    cmd.save = (outPath: string) => {
      recorded.push({ method: 'save', args: [outPath] })
      // Write a stub WebM EBML header (0x1A 0x45 0xDF 0xA3) so the wrapper's
      // fs.readFile returns non-empty bytes and the size guard passes.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = require('node:fs') as typeof import('node:fs')
      realFs.writeFileSync(outPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      queueMicrotask(() => endHandler?.())
      return cmd
    }

    return cmd
  }

  function factory() {
    return buildMockCommand(getRecordedRef().value)
  }
  factory.setFfmpegPath = (_p: string) => {
    getRecordedRef().value.push({ method: 'module:setFfmpegPath', args: [_p] })
  }
  factory.setFfprobePath = (_p: string) => {
    getRecordedRef().value.push({ method: 'module:setFfprobePath', args: [_p] })
  }
  return { default: factory }
})

// Mock the new @ffprobe-installer/ffprobe package the same way as ffmpeg.
vi.mock('@ffprobe-installer/ffprobe', () => ({
  default: { path: '/mock/path/to/ffprobe' },
  path: '/mock/path/to/ffprobe',
}))

// ---------------------------------------------------------------------------
// Import the wrapper AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { recompressToOpus } from '@/lib/ai/ffmpeg'

beforeEach(() => {
  getRecordedRef().value = []
})

describe('src/lib/ai/ffmpeg.recompressToOpus', () => {
  it('passes -c:a libopus -b:a 32k -ac 1 -f webm (mono 32 kbps Opus in WebM)', async () => {
    const input = Buffer.from('fake-audio-input')
    const out = await recompressToOpus(input, { bitrate: '32k', channels: 1 })
    expect(Buffer.isBuffer(out)).toBe(true)
    // EBML header bytes the mock save() writes.
    expect(out.byteLength).toBeGreaterThan(0)

    const calls = getRecordedRef().value
    const codec = calls.find((c) => c.method === 'audioCodec')
    const bitrate = calls.find((c) => c.method === 'audioBitrate')
    const channels = calls.find((c) => c.method === 'audioChannels')
    const format = calls.find((c) => c.method === 'format')
    const save = calls.find((c) => c.method === 'save')

    expect(codec?.args[0]).toBe('libopus')
    expect(bitrate?.args[0]).toBe('32k')
    expect(channels?.args[0]).toBe(1)
    expect(format?.args[0]).toBe('webm')
    // Output path lives under tmpdir — assert .save() was called with one.
    expect(typeof save?.args[0]).toBe('string')
  })

  it('rejects an empty input buffer up front', async () => {
    await expect(
      recompressToOpus(Buffer.alloc(0), { bitrate: '32k', channels: 1 }),
    ).rejects.toThrow('empty input buffer')
  })
})
