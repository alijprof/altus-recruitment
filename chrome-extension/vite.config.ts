import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'

import manifest from './manifest.json' assert { type: 'json' }

// Plan 03-01 Task A.1 — Chrome MV3 extension build via @crxjs/vite-plugin.
//
// Verified 2026-05-19: `npm view @crxjs/vite-plugin version time.created
// publisher` confirms v2.4.0, published 2022-04-20, publisher `jacksteamdev`
// (the canonical maintainer). Auto-approved for human-verify checkpoints per
// Wave 0 dependencies-landed notes.
//
// Output: `dist/` with manifest.json, popup.html, popup.js, ingest.js,
// content-script-entry.js bundled. Side-load via chrome://extensions per
// chrome-extension/README.md.

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
      },
    },
  },
})
