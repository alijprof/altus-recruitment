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
  // Phase 08-02: src/lib/pdf/register-fonts.ts reads the vendored Liberation
  // Sans TTFs via `readFileSync(join(process.cwd(), ...))` at module scope.
  // A `process.cwd()`-built path is not statically analysable by Next's
  // output file tracer, so without this entry the font files would be
  // excluded from the deployed serverless function bundle and the branded-CV
  // generation route would 500 at cold start on Vercel (works locally, where
  // the full repo is on disk, and fails only in production — research
  // Pitfall 4). The candidate detail route is where the 08-07 generation
  // Server Action is bundled.
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
