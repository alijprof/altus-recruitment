# Layer 2 — real-Supabase write-path integration tests

## Why this layer exists

`tests/unit/mark-candidate-fields-from-cv.test.ts` mocks the entire Supabase
query builder. That mock has no type system, no CHECK constraints, no
PostgREST — and it **passes on every payload in the verified 25-row failure
matrix documented in `06-RESEARCH.md`**. That is exactly why the 12 CVs
Steele Charles uploaded on 5-6 Aug 2026 failed silently in production: the
write path had a green mocked test suite sitting on top of a broken real
write path (`06-RESEARCH.md` Pitfall 1).

This layer calls the REAL `updateCandidateCVParse` / `markCandidateFieldsFromCV`
helpers (`src/lib/db/candidate-cvs.ts`) against a REAL local Postgres 17.6 +
PostgREST v14.5, then re-reads the row and asserts on the STORED value — not
just the helper's return value. Keep the mocked unit test too; it correctly
guards the D-08 "never overwrite a manually-entered field" policy, which is a
different job from proving a real write succeeds.

## Starting the local stack

```bash
pnpm exec supabase start -x vector,logflare,edge-runtime,studio,imgproxy,realtime
```

The `-x` flags start only what the write-path tests need (Postgres, PostgREST,
GoTrue, Storage, Kong) and skip vector/logflare/edge-runtime/studio/imgproxy/
realtime — verified in `06-RESEARCH.md` to complete well inside a 7-minute
budget with images cached. API listens on `54321`, the database on `54322`
(`supabase/config.toml`). A different project's Supabase stack
(`altus-quay-forthports`) runs concurrently on the `544xx` port range — no
collision, but do not assume ports are free by default.

Stop it when you're done:

```bash
pnpm exec supabase stop
```

## Running the suite

```bash
pnpm test:integration
```

This runs `vitest.integration.config.ts`, which only collects
`tests/integration/**/*.test.ts`. `tests/integration/**` is explicitly
excluded from the default `vitest.config.ts` (see the `exclude` array there),
so a plain `pnpm test` never touches a database — it stays fast and
dependency-free by construction.

## What happens when the stack is down

The suite does not hang and does not fail obscurely. `isStackUp()`
(`tests/integration/supabase-harness.ts`) resolves local credentials and does
a 2-second-timeout `fetch` against `http://127.0.0.1:54321/rest/v1/`; any
failure — CLI not found, containers not running, connection refused, timeout —
returns `false`. The whole `describe` block is then skipped via
`describe.skipIf(!up)`, with a loud `console.warn` banner naming the exact
start command. A silent skip would be worse than no test at all — you would
believe the write path was proven safe when it was never exercised.

## The hard guard

`getHarness()` refuses to run against anything whose resolved URL is not
`localhost` or `127.0.0.1`. This suite constructs a service-role client with
full RLS bypass and writes deliberately illegal bytes (NUL bytes, lone UTF-16
surrogates, out-of-range numbers, an invalid enum value) to whatever database
it is pointed at. **This must never run against a remote or production
Supabase project.** Do not weaken or route around the guard in
`tests/integration/supabase-harness.ts` to make a remote run "just work".

## RED discipline

`tests/integration/cv-write-path.test.ts` is deliberately RED today (plan
06-05, wave 3 of Phase 6's CV-intake hardening) — it asserts the POST-FIX
behaviour for every one of the six verified failure classes from
`06-RESEARCH.md`, before plans 06-06 and 06-07 land the fixes. See that file's
header comment for the exact expected-red / expected-green test lists. Do NOT
weaken an assertion here to make the suite pass early — the whole point of
this layer is that these tests stay red until the real fix lands, and turn
green because the fix is correct, not because the test was loosened.

## Cleanup discipline

Every test seeds one `organizations` row (name prefixed
`gsd-phase06-integration-`), one `candidates` row, and one `candidate_cvs`
row, and resets them to an empty baseline between tests
(`resetCandidate()`). `afterAll` calls `teardown()`, which deletes the seeded
organization and lets FK cascades (`candidates.organization_id`,
`candidate_cvs.organization_id` / `candidate_id`, all `ON DELETE CASCADE` —
migration `20260513152244`) remove every row this suite created, then asserts
the organization row is actually gone. If a run is interrupted before
`afterAll` fires (e.g. a killed process), a stray `gsd-phase06-integration-*`
organization may be left behind — safe to delete manually; nothing else in
the local stack depends on it.
