import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Exclude Playwright E2E specs — they run via `pnpm test:e2e`.
    // `**/node_modules/**` also excludes the workspace package's nested
    // node_modules (e.g. chrome-extension/node_modules/**) so dependency
    // test fixtures don't get accidentally discovered.
    // `tests/integration/**` hits a real database (layer-2 suite) and must
    // never be pulled into `pnpm test`, which has to stay fast and
    // dependency-free — it runs only via `pnpm test:integration`.
    exclude: [
      '**/node_modules/**',
      'tests/e2e/**',
      'tests/integration/**',
      '.next/**',
      'dist/**',
      'chrome-extension/dist/**',
    ],
  },
})
