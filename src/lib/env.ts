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
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  },
  // Next.js does not expose all NEXT_PUBLIC_* vars on the client automatically;
  // each must be referenced statically here so it ships with the client bundle.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
})
