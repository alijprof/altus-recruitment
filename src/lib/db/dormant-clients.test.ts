/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-05 executor replaces `.todo` with real
// `.it` bodies once src/lib/db/dormant-clients.ts (+ RPC migration) lands.

describe('src/lib/db/dormant-clients.listDormantClients (REPEAT-01)', () => {
  it.todo('returns clients whose last_contacted_at is older than the threshold (default 90 days)')
  it.todo('respects the recruiter-provided threshold parameter')
  it.todo('excludes clients with no placements ever (filter on min_placements param)')
  it.todo('orders results by days_dormant DESC (most overdue first)')
  it.todo('returns DbResult { ok: true, data } shape')
  it.todo('cross-org rows are invisible (RLS enforced by RPC current_organization_id check)')
})
