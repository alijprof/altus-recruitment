import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as Sentry from '@sentry/nextjs'

import { getFfmpegBinaryPath } from '@/lib/ai/ffmpeg'
import { inngest } from '@/lib/inngest/client'

// Phase 3 Task 0.2 — Wave-0 ffmpeg availability probe.
//
// `@ffmpeg-installer/ffmpeg` ships a Linux-x64 static binary that should run
// inside Vercel's Node runtime AND inside a self-hosted Inngest worker. This
// one-shot function lets us confirm the binary is exec-able from the
// production runtime BEFORE Plan 2 lands the spec-audio path that depends
// on it. Trigger manually from the Inngest dashboard:
//
//   inngest.send({ name: 'ops/probe-ffmpeg', data: {} })
//
// Success emits a Sentry breadcrumb (`level: 'info'`) so a deploy-time gate
// can be wired to alert if the breadcrumb stops appearing.
//
// Pattern source: `refresh-outlook-subscription.ts` heartbeat shape
// (lines 49–55) — Sentry captureMessage with `level: 'info'` and required
// Phase 3 tag set (phase, layer, function).

const execFileP = promisify(execFile)

export const probeFfmpeg = inngest.createFunction(
  {
    id: 'probe-ffmpeg',
    triggers: [{ event: 'ops/probe-ffmpeg' }],
    retries: 0,
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const versionLine = await step.run('probe', async () => {
      const binaryPath = getFfmpegBinaryPath()
      const { stdout } = await execFileP(binaryPath, ['-version'])
      // The first line of `ffmpeg -version` output looks like:
      //   ffmpeg version N-0.0.0-static https://...
      // We log only that line so the probe payload stays small.
      return stdout.split('\n')[0]?.trim() ?? '(empty)'
    })

    Sentry.captureMessage('phase3:ffmpeg:probe:ok', {
      level: 'info',
      tags: {
        phase: 'p3',
        layer: 'inngest',
        function: 'probe-ffmpeg',
      },
      // The version string itself is safe to log — it carries no PII and
      // we want it visible in Sentry breadcrumbs for the platform team.
      extra: { version: versionLine },
    })

    return { ok: true, version: versionLine }
  },
)
