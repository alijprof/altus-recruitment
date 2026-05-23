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
  serverExternalPackages: [
    'voyageai',
    'fluent-ffmpeg',
    '@ffmpeg-installer/ffmpeg',
    '@ffprobe-installer/ffprobe',
  ],
  // serverExternalPackages prevents bundling but doesn't guarantee Vercel
  // includes the static binary files in the function deployment.
  // outputFileTracingIncludes explicitly traces the platform-specific
  // binaries so they land in the Lambda. The glob covers Linux x64 (Vercel's
  // runtime) and the macOS arm64 binary used in local dev.
  //
  // Without this, fluent-ffmpeg's setFfprobePath() points at a missing file
  // and the spec-call pipeline throws "ffprobe failed" on Vercel even when
  // it works locally on Mac.
  outputFileTracingIncludes: {
    '/api/inngest': [
      './node_modules/@ffmpeg-installer/**',
      './node_modules/@ffprobe-installer/**',
      './node_modules/.pnpm/@ffmpeg-installer+*/**',
      './node_modules/.pnpm/@ffprobe-installer+*/**',
    ],
  },
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
