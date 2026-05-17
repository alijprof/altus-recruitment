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
    exclude: ['node_modules', 'tests/e2e/**', '.next/**', 'dist/**'],
  },
})
