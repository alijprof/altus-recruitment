import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // Phase 8 review CR-03 (BLOCKER): Next's Server Action body limit defaults
  // to 1 MB (node_modules/next/dist/server/app-render/action-handler.js).
  // uploadOrgLogoAction and uploadCVAction are both Server Actions receiving
  // FormData, and every OTHER layer of the app already advertises a larger
  // cap than 1 MB: MAX_LOGO_BYTES = 2 MiB (src/lib/upload/image-signature.ts),
  // MAX_CV_BYTES = 10 MiB (candidates/[id]/actions.ts), and the org-logos
  // Storage bucket is capped at 2097152 bytes. Without this, a 1.0-2.0 MB
  // logo or a >1 MB CV never reaches the action at all -- Next 413s the
  // request before any of the application-level size checks run, and the
  // client sees an opaque framework error instead of the honest "too large"
  // copy. 12mb covers the larger of the two application caps (MAX_CV_BYTES)
  // with headroom for multipart/FormData overhead; the application caps
  // remain the real authority (they run before any Storage write) and are
  // pinned against this value in tests/unit/next-config.test.ts.
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
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
  // Phase 08-02 (updated for review WR-01): src/lib/pdf/register-fonts.ts
  // reads the vendored Liberation Sans TTFs via
  // `readFileSync(join(process.cwd(), ...))`, lazily, the first time a
  // branded CV is actually rendered. A `process.cwd()`-built path is not
  // statically analysable by Next's output file tracer, so without this
  // entry the font files would be excluded from the deployed serverless
  // function bundle and branded-CV generation would fail at first render on
  // Vercel (works locally, where the full repo is on disk, and fails only in
  // production — research Pitfall 4). The candidate detail route is where
  // the 08-07 generation Server Action is bundled.
  outputFileTracingIncludes: {
    '/candidates/[id]': ['./src/lib/pdf/fonts/**'],
  },
  // Strip the framework-fingerprinting header (pre-UAT HTTP smoke H3).
  poweredByHeader: false,
  // Baseline security response headers (pre-UAT smoke H2). Intentionally
  // conservative:
  //   - NO Content-Security-Policy yet — it needs a report-only rollout first
  //     (Turnstile, Supabase, Sentry and Recharts origins must be allowlisted;
  //     a blind blocking CSP would break the app). Tracked in LAUNCH-READINESS.
  //   - NO Permissions-Policy restricting microphone/camera — spec-call audio
  //     capture would break.
  //   - X-Frame-Options SAMEORIGIN is safe today; revisit if/when the public
  //     /apply form needs to be embeddable in a client's careers site (Phase 5).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ]
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
