/**
 * @vitest-environment node
 *
 * Cron-hardening regression test (Phase 07 Plan 05).
 *
 * A wedged run of embed-batch or reconcile-cv-parses — both
 * concurrency:{limit:1} — sat holding its single slot for days
 * (4-9 Aug 2026) and silently blocked every later cron tick behind it.
 * This test pins the fix: both functions must carry a `timeouts` config
 * (so a wedged run is cancelled instead of blocking forever) and a
 * top-of-handler Sentry heartbeat (so a stall is visible same-day instead
 * of discovered by a customer).
 *
 * Source inspection via node:fs, rather than importing the two Inngest
 * function modules, is deliberate: importing embed-batch.ts or
 * reconcile-cv-parses.ts pulls in @/lib/supabase/service, @/lib/env and the
 * Sentry SDK, all of which require a populated server environment the unit
 * suite does not have — the existing unit tests under
 * tests/unit/lib/inngest/ mock heavily for exactly that reason, and none of
 * that machinery is needed to assert a config invariant.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TARGETS = [
  {
    name: 'embed-batch',
    path: resolve(process.cwd(), 'src/lib/inngest/functions/embed-batch.ts'),
  },
  {
    name: 'reconcile-cv-parses',
    path: resolve(process.cwd(), 'src/lib/inngest/functions/reconcile-cv-parses.ts'),
  },
]

/**
 * Strip full-line comments so a future comment merely MENTIONING
 * 'timeouts' or 'concurrency' in prose (e.g. explaining why they exist)
 * cannot make this test pass without the real config being present. Only
 * lines that are ENTIRELY a `//` comment after trimming are removed —
 * assertions below match structural code tokens, not comment text, so
 * inline trailing comments on real code lines are harmless either way.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

describe('cron-hardening — timeouts + heartbeat regression (Phase 07 Plan 05)', () => {
  for (const target of TARGETS) {
    describe(target.name, () => {
      const raw = readFileSync(target.path, 'utf8')
      const code = stripCommentLines(raw)

      it('declares a timeouts config with both start and finish', () => {
        const match = code.match(/timeouts:\s*{([^}]*)}/)
        expect(
          match,
          `${target.name}: expected a \`timeouts: { ... }\` block on the createFunction config — ` +
            'this is what cancels a wedged run instead of letting it block the queue for days',
        ).not.toBeNull()
        const body = match?.[1] ?? ''
        expect(
          body,
          `${target.name}: timeouts block is missing 'start' — without it, ticks queue up behind a run that never started`,
        ).toMatch(/start\s*:/)
        expect(
          body,
          `${target.name}: timeouts block is missing 'finish' — without it, a wedged run never releases its concurrency-1 slot`,
        ).toMatch(/finish\s*:/)
      })

      it('still declares concurrency with limit 1', () => {
        expect(
          code,
          `${target.name}: concurrency:{limit:1} is the exact property timeouts.start/finish exist ` +
            'to protect — it must not have been removed or changed by this hardening work',
        ).toMatch(/concurrency:\s*{\s*limit:\s*1\s*}/)
      })

      it('emits a Sentry.captureMessage heartbeat before the first step.run', () => {
        const heartbeatIdx = code.indexOf('Sentry.captureMessage(')
        expect(
          heartbeatIdx,
          `${target.name}: no Sentry.captureMessage heartbeat found — a stall in this cron would be ` +
            'invisible in Sentry rather than detectable same-day',
        ).toBeGreaterThan(-1)

        const firstStepRunIdx = code.indexOf('step.run(')
        expect(firstStepRunIdx, `${target.name}: no step.run( call found`).toBeGreaterThan(-1)

        expect(
          heartbeatIdx < firstStepRunIdx,
          `${target.name}: the heartbeat must fire BEFORE the first step.run. A heartbeat placed ` +
            'after the first step is worthless — a run that wedges IN that step never emits it, which ' +
            'is precisely the silent 4-9 Aug outage this phase closes.',
        ).toBe(true)
      })
    })
  }
})
