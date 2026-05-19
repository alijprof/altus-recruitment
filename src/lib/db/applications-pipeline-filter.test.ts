/**
 * @vitest-environment node
 */
import { describe, it } from 'vitest'

// Placeholder scaffold — Plan 03-03 executor replaces `.todo` with real
// `.it` bodies once shortlist filter wiring lands in the pipeline RPC.

describe('applications pipeline filter (SHORT-01, D3-17 invariant)', () => {
  it.todo('rows with application_type=shortlist are EXCLUDED from /jobs/[id]/pipeline')
  it.todo('rows with application_type=standard are INCLUDED')
  it.todo('rows with application_type=float are EXCLUDED from pipeline (live elsewhere)')
  it.todo('rows with application_type=spec are EXCLUDED from pipeline (live elsewhere)')
  it.todo('convertShortlistToApplicationAction flips application_type to standard and stage to applied')
  it.todo('after conversion, the same application_id surfaces in the pipeline view')
})
