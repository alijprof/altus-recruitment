/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-01 executor replaces `.todo` with real
// `.it` bodies once /api/linkedin/ingest/route.ts exists.

describe('POST /api/linkedin/ingest (LINKEDIN-01)', () => {
  it.todo('returns 401 when no Supabase session cookie is present')
  it.todo('returns 405 on GET (POST-only route)')
  it.todo('responds to OPTIONS preflight with CORS allow-origin = linkedin.com')
  it.todo('validates body shape via Zod (rejects oversize about/text fields)')
  it.todo('upserts candidate row scoped to authenticated user organization')
  it.todo('dedupes on existing linkedin_url within same org (UPDATE, not INSERT)')
  it.todo('fires inngest "linkedin/captured" event after successful upsert')
})
