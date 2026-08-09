import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// This config exists so the layer-2 integration suite can import real
// TypeScript app modules (path aliases, `@/lib/...`) without a new TS
// runner dependency. It hits a real local Supabase stack, so it runs only
// under `pnpm test:integration` — never under `pnpm test` (see the
// `tests/integration/**` exclude entry in vitest.config.ts).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // Belt and braces: `.claude/**` holds live agent worktrees (full repo
    // duplicates). The include glob above is already root-relative, but an
    // explicit exclude means a future include-widening cannot silently pull
    // a worktree copy of this suite into the gate.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    environment: 'node',
    globals: true,
    setupFiles: [],
    // Fail-closed precondition (review 2026-08-09 HI-01): aborts the whole
    // run with a non-zero exit code when the local Supabase stack is down,
    // instead of exiting 0 with "22 skipped". Lives in the runner rather
    // than inside cv-write-path.test.ts because that file is frozen
    // byte-identical to its RED commit. CI_SKIP_INTEGRATION=1 opts out,
    // loudly.
    globalSetup: ['./tests/integration/require-stack.setup.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
})
