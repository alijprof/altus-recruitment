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

    // --- Phase 3: OpenAI Whisper (spec-call transcription) ---------------
    // Used by src/lib/ai/whisper.ts. Whisper-1 is priced ~$0.006 / audio
    // minute (~0.48p / min at ~78p/$). A 10-min spec call costs ~5p.
    //
    // Optional in the Zod schema so dev boots without it; src/lib/ai/whisper.ts
    // surfaces an SDK auth error at the first transcribe call (captured to
    // Sentry by the caller). Production deployments MUST set this.
    OPENAI_API_KEY: z.string().min(1).optional(),

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

    // --- Quick 260524-b6v: Resend (in-app feedback notification email) ----
    // Used by src/lib/email/resend.ts to email alasdairj8@gmail.com when a
    // user submits feedback via the floating widget. Both vars optional in
    // dev so the app boots without them; src/lib/email/resend.ts fails open
    // (returns { ok: false, reason: 'no_api_key' } without throwing) and the
    // server action still persists the DB row + returns success to the user.
    // Production deployments MUST set RESEND_API_KEY for the bonus email to
    // fire; the DB row is canonical regardless.
    RESEND_API_KEY: z.string().min(1).optional(),
    // Accepts either a bare email (`noreply@altusmove.com`) OR the RFC 5322
    // mailbox format (`Altus <noreply@altusmove.com>`) — both are valid
    // Resend `from` values. `z.string().email()` would reject the mailbox
    // form and crash page-data collection at build time. Downstream Resend
    // API validates the exact format and returns a clean 4xx if malformed.
    RESEND_FROM: z.string().min(1).optional(),

    // Where in-app feedback emails are delivered TO. Optional in dev (same
    // fail-open pattern as RESEND_API_KEY). submit-feedback.ts skips the
    // outbound email and logs a `no_recipient_configured` Sentry warning
    // when unset. The DB row is still canonical.
    RESEND_FEEDBACK_RECIPIENT: z.string().email().optional(),

    // --- Phase 5: Stripe billing (Plans 05-01, 05-03, 05-05) -------------
    //
    // ALL Stripe vars are `.optional()` so `pnpm build` (and the dev server)
    // boot cleanly when Stripe is not yet configured — e.g., while the
    // founder is setting up Stripe products and price IDs in TEST mode.
    //
    // The Stripe client (src/lib/stripe/client.ts) fails CLOSED at CALL
    // TIME: it exports `null` when STRIPE_SECRET_KEY is absent, and
    // individual callers call `assertStripe()` to get a typed Stripe
    // instance or throw a clear "Stripe is not configured" error. This
    // prevents build-time crashes from killing unrelated development work.
    //
    // Production deployments MUST set all five vars; the billing
    // entitlement helper (05-01) enforces this at runtime by returning a
    // degraded "none" plan rather than crashing the app.
    STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
    // Price IDs for the three recurring GBP plans created in Stripe Dashboard
    // (TEST mode first, then LIVE). Values look like `price_1Abc...`.
    STRIPE_PRICE_STARTER: z.string().min(1).optional(),
    STRIPE_PRICE_PRO: z.string().min(1).optional(),
    STRIPE_PRICE_SCALE: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    // Public Turnstile widget site-key. Optional in Plan 0.
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),

    // Quick task 260524-iav (B3): authoritative origin used by server actions
    // when building absolute accept-invite URLs. MUST be set in production
    // (e.g. `https://app.altus.example.com`). When unset,
    // src/app/(app)/settings/team/actions.ts falls back to request-header
    // detection, which is safe on Vercel but vulnerable to X-Forwarded-Host
    // injection on other proxies.
    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  },
  // Next.js does not expose all NEXT_PUBLIC_* vars on the client automatically;
  // each must be referenced statically here so it ships with the client bundle.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    // Quick task 260524-iav (B3): see client schema comment above.
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  emptyStringAsUndefined: true,
})
