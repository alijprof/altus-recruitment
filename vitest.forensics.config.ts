import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// This config exists so forensic scripts can import real TypeScript app
// modules (path aliases, `@/lib/...`) without a new TS runner dependency.
// `*.forensic.ts` is invisible to `pnpm test` because the default vitest
// include only matches `*.test.*` / `*.spec.*` — no exclude entry needed.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/forensics/**/*.forensic.ts'],
    // Belt and braces — see vitest.config.ts: `.claude/**` holds live agent
    // worktrees, which are full duplicates of this repo.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    environment: 'node',
    globals: true,
    setupFiles: [],
    testTimeout: 300000,
    hookTimeout: 300000,
  },
})
