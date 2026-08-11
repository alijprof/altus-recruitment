/**
 * @vitest-environment node
 *
 * Cron-hardening regression test (Phase 07 Plan 05).
 *
 * A wedged run of embed-batch or reconcile-cv-parses — both
 * concurrency:{limit:1} — sat holding its single slot for days
 * (4-9 Aug 2026) and silently blocked every later cron tick behind it.
 * This test pins the fix: both functions must carry a `timeouts` config
 * (so a wedged run is cancelled instead of blocking forever) and a Sentry
 * heartbeat as their FIRST step (so a stall is visible same-day instead of
 * discovered by a customer).
 *
 * Heartbeat placement changed in CR-03 (review 2026-08-11): it used to be
 * asserted as bare code BEFORE the first step.run, which is exactly what
 * made it fire (steps + 1) times per run under Inngest's replay model —
 * ~816 Sentry events/day across these two functions, enough to exhaust the
 * errors quota the same phase relies on for stall alerting. The heartbeat
 * is now the first `step.run('heartbeat')`, which keeps "emitted before any
 * real work" while firing exactly once per run.
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
    expectedFirstStep: 'sweep-candidates',
  },
  {
    name: 'reconcile-cv-parses',
    path: resolve(process.cwd(), 'src/lib/inngest/functions/reconcile-cv-parses.ts'),
    expectedFirstStep: 'sweep-stuck-pending',
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

      it('emits its Sentry.captureMessage heartbeat INSIDE the first step.run', () => {
        const heartbeatIdx = code.indexOf('Sentry.captureMessage(')
        expect(
          heartbeatIdx,
          `${target.name}: no Sentry.captureMessage heartbeat found — a stall in this cron would be ` +
            'invisible in Sentry rather than detectable same-day',
        ).toBeGreaterThan(-1)

        const firstStepRunIdx = code.indexOf('step.run(')
        expect(firstStepRunIdx, `${target.name}: no step.run( call found`).toBeGreaterThan(-1)

        // The heartbeat must be the FIRST step — that keeps the original
        // intent (emitted before any real work, so a tick that finds nothing
        // to do is still provably alive) while making it memoized.
        const firstStepRunId = /step\.run\(\s*'([^']+)'/.exec(code.slice(firstStepRunIdx))?.[1]
        // WR-R2: the heartbeat is the FIRST STATEMENT inside the first REAL
        // step (a dedicated heartbeat step cost +1 step execution per run
        // against the same quota whose exhaustion caused the 4-9 Aug outage).
        expect(
          firstStepRunId,
          `${target.name}: the first step.run must be the expected sweep step that opens with the heartbeat`,
        ).toBe(target.expectedFirstStep)

        // …and it must be INSIDE that step, not bare handler code. Inngest
        // replays every non-step statement once per step boundary, so a
        // top-of-handler heartbeat fires (steps + 1) times per run — ~816
        // Sentry events/day across these two functions, against the ERRORS
        // quota that real production alerting depends on (CR-03). Because
        // indexOf finds the FIRST captureMessage, reintroducing a bare
        // top-of-handler heartbeat fails this assertion.
        expect(
          heartbeatIdx > firstStepRunIdx,
          `${target.name}: the heartbeat must live INSIDE step.run('heartbeat'), not outside it — ` +
            'code outside a step is replayed once per step boundary, multiplying the event count ' +
            'by (steps + 1) and silently changing what the docs/cron-monitoring.md alert measures.',
        ).toBe(true)
      })
    })
  }
})
