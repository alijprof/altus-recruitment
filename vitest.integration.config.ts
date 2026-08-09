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
    environment: 'node',
    globals: true,
    setupFiles: [],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
})
