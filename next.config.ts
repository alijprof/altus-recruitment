import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // Plan 1 Task 1.1: voyageai 0.2.1's ESM build (dist/esm/extended/index.mjs)
  // re-exports via extensionless imports (`../local`, `./ExtendedClient`)
  // that Next/Webpack's strict ESM resolver rejects at build time. Marking
  // the package as a server-external dependency makes Node resolve it at
  // runtime (via the CJS entry in the exports map), bypassing the bundler.
  // The package is server-only (`import 'server-only'` in voyage.ts) so
  // there's no client-bundle implication.
  //
  // Plan 03-02: fluent-ffmpeg + @ffmpeg-installer ship Node-native binaries
  // (a static ffmpeg executable in @ffmpeg-installer/<platform>-<arch>) that
  // cannot be bundled by webpack. Marked server-external so Next resolves
  // them at runtime via Node's CJS resolver. The wrappers are server-only
  // (`import 'server-only'` in src/lib/ai/{ffmpeg,whisper}.ts).
  serverExternalPackages: ['voyageai', 'fluent-ffmpeg', '@ffmpeg-installer/ffmpeg'],
}

// Source-map upload only runs when SENTRY_AUTH_TOKEN is set (CI / deploy);
// local dev without the token is a no-op so missing auth doesn't break the build.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  // Org + project must be set via env when the auth token is present.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
})
