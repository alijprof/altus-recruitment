/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-01 executor replaces `.todo` with real
// `.it` bodies once src/lib/db/candidates-linkedin-upsert.ts exists.

describe('candidates-linkedin-upsert (LINKEDIN-01 dedup-on-source_detail)', () => {
  it.todo('inserts a new candidate row when linkedin_url not seen before')
  it.todo('updates the existing row when linkedin_url matches an org candidate')
  it.todo('dedupes on email when linkedin_url is absent but email matches')
  it.todo('uses Postgres advisory lock on (organization_id, linkedin_url_hash) to serialize concurrent captures')
  it.todo('source_detail column stores the canonical LinkedIn URL')
  it.todo('returns DbResult { ok: true, data } on success and { ok: false, code } on RLS denial')
})
