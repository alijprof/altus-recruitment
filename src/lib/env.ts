import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

// Validates required env vars at module load. Importing this module will throw
// loudly at boot if any required var is missing — preventing the "non-null
// assertion lies, then later cryptic fetch error" failure mode that the raw
// `process.env.X!` pattern allows.
//
// Sentry keys are optional because Sentry comes online in Task 0.5 — without
// them the runtime simply skips error capture.
export const env = createEnv({
  server: {
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // --- Phase 2: Voyage embeddings --------------------------------------
    // Embedding API key. Used by src/lib/ai/voyage.ts. Cost ~5p / MTok input
    // tokens; ~0.0035p per CV at voyage-3.
    //
    // Optional in Plan 0 so the app boots before the user generates a key;
    // Plan 1 (CV-embed Inngest function + semantic-search server action)
    // dereferences `env.VOYAGE_API_KEY` directly — if absent, the SDK
    // constructor throws at the call site and the failure surfaces in
    // Sentry rather than as a boot crash that blocks unrelated dev work.
    VOYAGE_API_KEY: z.string().min(1).optional(),

    // --- Phase 2: token encryption ---------------------------------------
    // 32 random bytes hex-encoded (64 hex chars). Generate once via
    //   openssl rand -hex 32
    // Used by src/lib/encryption.ts for aes-256-gcm encryption of OAuth
    // tokens (Outlook today; any future Gmail adapter in Phase 5 shares the
    // same key, hence the generalised name).
    //
    // Optional in the Zod schema so the app boots in dev before the user
    // generates the key. src/lib/encryption.ts fails-closed at call time
    // (encrypt/decrypt throw a clear error when the key is absent OR
    // malformed). Length+charset is validated by the helper, not here, so
    // we get a single failure surface and a clean error message.
    EMAIL_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),

    // --- Phase 2: Outlook (Microsoft Graph) — all optional ---------------
    // Optional in Phase 2 Plan 0 so the app boots in dev before Plan 4
    // lands the Connect-Outlook UI + webhook. Plan 4's route handlers
    // enforce presence at call time and surface a clean error when any of
    // these are missing.
    OUTLOOK_TENANT_ID: z.string().uuid().optional(),
    OUTLOOK_CLIENT_ID: z.string().uuid().optional(),
    OUTLOOK_CLIENT_SECRET: z.string().min(1).optional(),
    OUTLOOK_REDIRECT_URI: z.string().url().optional(),
    OUTLOOK_WEBHOOK_NOTIFICATION_URL: z.string().url().optional(),
    OUTLOOK_WEBHOOK_CLIENT_STATE_SECRET: z.string().min(32).optional(),

    // --- Phase 2: Cloudflare Turnstile (apply-form anti-spam) -----------
    // Optional in Plan 0 so dev boots without it. Plan 3's submitApplyAction
    // fails-closed at call time when missing via the verifyTurnstileToken
    // helper.
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

    // --- Phase 2: Sonnet match-scoring spend ceiling (Plan 2 Task 2.1) ---
    // Per-org month-to-date spend cap on `purpose='match_score'` rows in
    // ai_usage. When the org's current-month spend crosses this value the
    // precompute Inngest function bails with a Sentry warning and the
    // recruiter still sees vector-only results.
    //
    // Default 10000 pence = £100/month per RESEARCH §B.8 (anchor scale is
    // £20-50/month so this leaves headroom; product can override per
    // environment). z.coerce.number keeps the env var string-typed in
    // `process.env` while exposing a number at the call site.
    MAX_MONTHLY_MATCH_SPEND_PENCE: z.coerce.number().int().positive().default(10_000),

    // --- Phase 3: LinkedIn capture (Plan 03-01) -------------------------
    // Pinned chrome-extension ID. The extension's manifest.json "key" field
    // ensures the ID is stable across reloads + side-loads on every
    // recruiter's machine. /api/linkedin/ingest's CORS allowlist echoes
    // Allow-Origin only when the request origin matches
    // `chrome-extension://<LINKEDIN_EXTENSION_ID>`. Optional in dev — when
    // unset the route falls back to the chrome-extension://[a-p]{32}
    // pattern allowlist for developer side-loads.
    LINKEDIN_EXTENSION_ID: z.string().min(32).max(64).optional(),

    // Minimum extension version accepted by /api/linkedin/ingest. Stale
    // extensions get a 426 Upgrade Required with a link to update. Defaults
    // to '0.1.0' (the initial Plan 03-01 release).
    LINKEDIN_EXTENSION_MIN_VERSION: z.string().regex(/^\d+(\.\d+){0,2}$/).default('0.1.0'),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    // Public Turnstile widget site-key. Optional in Plan 0.
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  },
  // Next.js does not expose all NEXT_PUBLIC_* vars on the client automatically;
  // each must be referenced statically here so it ships with the client bundle.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  },
  emptyStringAsUndefined: true,
})
