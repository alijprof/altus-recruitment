/**
 * Fail-closed precondition for the layer-2 integration suite.
 *
 * Review 2026-08-09 HI-01. `pnpm test:integration` used to exit 0 with "22
 * skipped" when the local Supabase stack was down: the suite gates on
 * `describe.skipIf(!up)` with a console.warn, and a warning on stdout does
 * not fail a build. So the one layer that exercises the REAL write path —
 * the layer described as "the layer that would have caught the 12" — could
 * report success having asserted nothing against a real Postgres. That is
 * the phase's own defect class (a silent pass masking an unexercised path)
 * relocated into the verification layer.
 *
 * This runs as vitest `globalSetup` for vitest.integration.config.ts, i.e.
 * BEFORE any test file is collected. Throwing here aborts the run with a
 * non-zero exit code and this message, which is the only outcome that makes
 * the gate mean anything.
 *
 * It deliberately lives outside tests/integration/cv-write-path.test.ts:
 * that file is one of the three frozen red-suite files and is byte-
 * identical to its original RED commit. Proving no assertion was weakened
 * after the fix landed depends on it staying that way, so the gate is
 * enforced from the runner instead of from inside the suite.
 *
 * Escape hatch: CI_SKIP_INTEGRATION=1 restores the old skip behaviour for
 * an environment that genuinely cannot run Docker. It is loud and explicit
 * — silence is never the default.
 */

import { isStackUp } from './supabase-harness'

const START_COMMAND =
  'pnpm exec supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime'

export async function setup(): Promise<void> {
  if (process.env.CI_SKIP_INTEGRATION === '1') {
    console.warn(
      '\n[tests/integration] CI_SKIP_INTEGRATION=1 — integration suite is running ' +
        'WITHOUT a local Supabase stack.\n' +
        'The real write path is NOT being exercised by this run. This is an ' +
        'explicit, acknowledged gap, not a pass.\n',
    )
    return
  }

  if (await isStackUp()) return

  throw new Error(
    'local Supabase stack is not running — start it with `pnpm exec supabase start`\n\n' +
      `  Full command used by this suite:\n    ${START_COMMAND}\n\n` +
      '  tests/integration/** is the ONLY layer that exercises the real write path\n' +
      '  against a real Postgres. Refusing to exit 0 having proved nothing.\n\n' +
      '  If this environment genuinely cannot run Docker, set CI_SKIP_INTEGRATION=1\n' +
      '  to acknowledge the gap explicitly.',
  )
}
