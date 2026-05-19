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
    exclude: [
      '**/node_modules/**',
      'tests/e2e/**',
      '.next/**',
      'dist/**',
      'chrome-extension/dist/**',
    ],
  },
})
